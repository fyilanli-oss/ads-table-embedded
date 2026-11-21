import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createAuthorityQuotaEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";

const order=["google_ads","klaviyo","meta"];

// One real queue tick, followed by three ordinary preflight admissions. These
// gates keep setup and the later per-provider audits outside the common clock.
export function createSharedRefreshProbe(client) {
  const generation=randomUUID(), day=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const slots=new Map(order.map(provider=>[provider,{
    ready:Promise.withResolvers(), run:Promise.withResolvers(), closed:Promise.withResolvers(), audit:Promise.withResolvers(),
  }]));
  let coordinator,partnerEnvironment,tick;

  return {
    generation,day,
    setCoordinator(database){coordinator=database;},
    setPartnerEnvironment(environment){partnerEnvironment=environment;},
    partnerVerifier({owner,store,limits,now}){
      assert.ok(coordinator&&partnerEnvironment);
      return createAuthorityQuotaEntitlementVerifier({store,quotaStore:createSharedQuotaRepository(coordinator),
        appId:partnerEnvironment.SHOPIFY_APP_GID,environment:partnerEnvironment,now,limits,async fetchFn(endpoint){
          assert.equal(new URL(endpoint).hostname,"partners.shopify.com");
          return Response.json({data:{activeSubscription:{shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},billingPeriod:"EVERY_30_DAYS",
            cancelAtEndOfCycle:false,trialEndsAt:null,currentBillingCycle:{startTime:new Date(now()-86400000).toISOString(),
              endTime:new Date(now()+86400000).toISOString()},items:[{handle:"monthly",price:{active:true}}],pendingUpdate:null}}});
        }});
    },
    async beforeWork({owner,cost,store}){
      const slot=slots.get(owner.provider);
      slot.ready.resolve({owner,cost,store});
      assert.equal(await slot.run.promise,true,"shared rehearsal interrupted");
      return {...store,async checkScheduledQueue({generation:expected}){
        assert.equal(expected,generation);
        return tick;
      }};
    },
    async afterClose(owner,run){
      const ended=performance.now();
      assert.equal(run.work?.status,"completed",JSON.stringify(run));
      assert.equal(run.work.claim.provider,owner.provider);
      const slot=slots.get(owner.provider);
      slot.closed.resolve({ended,jobId:run.work.claim.id});
      assert.equal(await slot.audit.promise,true,"shared rehearsal interrupted");
    },
    async run(probes){
      const active=new Map(), entries=[];
      const earlyExit=(task,stage)=>task.then(()=>{throw Error(`SHARED_REFRESH_EXIT_BEFORE_${stage}`);});
      try {
        for(const provider of order){
          const task=probes[provider]();
          void task.catch(()=>{});
          active.set(provider,task);
          entries.push(await Promise.race([slots.get(provider).ready.promise,earlyExit(task,"SETUP")]));
          console.log("EO05_THREE_PROVIDER_READY",provider);
        }
        const first=entries[0],workspaceId=first.owner.workspaceId, installationId=first.owner.installationId;
        assert.ok(entries.every(({owner})=>owner.workspaceId===workspaceId&&owner.installationId===installationId));
        const global=Object.fromEntries(Object.keys(first.cost).map(k=>[k,entries.reduce((n,{cost})=>n+cost[k],0)]));
        const interactiveReserve=Object.fromEntries(Object.keys(global).map(k=>[k,0]));
        await client.query("update operations.refresh_control set budget=$1,bounds=$2 where singleton",[
          {global,interactiveReserve,providers:entries.map(({owner,cost})=>({provider:owner.provider,limit:cost})),
            accounts:entries.map(({owner,cost})=>({provider:owner.provider,accountId:owner.accountId,limit:cost})),
            workspaces:[{workspaceId,limit:global}]},
          {maxWorkspaces:8,maxCandidates:8,maxClaims:1,maxAdmissions:1},
        ]);
        await client.query("update operations.refresh_tick_control set enabled=true,generation=$1,last_minute=null,last_checked_at_ms=null,queue_revision=null where singleton",[generation]);
        await client.query("update operations.refresh_queue_control set max_workspaces=8,max_accounts=8,max_snapshot_bytes=100000,max_snapshot_age_ms=60000 where singleton");
        const started=performance.now();
        tick=await first.store.checkScheduledQueue({generation});
        assert.equal(tick.status,"checked");
        const queueMs=performance.now()-started;
        const snapshot=await first.store.readPreflightSnapshot();
        assert.equal(snapshot.queueRevision,tick.queueRevision);
        const queued=snapshot.candidates.filter(candidate=>candidate.workspaceId===workspaceId);
        assert.deepEqual(queued.map(candidate=>candidate.provider).sort(),[...order].sort());
        for(const c of queued) assert.equal(c.accountId,entries.find(({owner})=>owner.provider===c.provider).owner.accountId);
        console.log("EO05_THREE_PROVIDER_QUEUED",queued.length);

        const closed=[];
        for(const provider of order){
          const slot=slots.get(provider);
          slot.run.resolve(true);
          closed.push({provider,...await Promise.race([slot.closed.promise,earlyExit(active.get(provider),"CLOSURE")])});
        }
        const totalMs=closed.at(-1).ended-started;
        console.log("EO05_THREE_PROVIDER_CLOSED",JSON.stringify(closed.map(({provider,ended})=>({provider,elapsedMs:ended-started}))));
        const {rows:jobs}=await client.query(`select r.provider,r.status,b.from_date::text as day,b.to_date::text as end_day
          from operations.refresh_runs r join operations.refresh_work_bindings b on b.workspace_id=r.workspace_id and b.fence=r.fence and b.job_id=r.job_id
          where r.workspace_id=$1 and r.job_id=any($2::text[]) order by r.provider`,[workspaceId,closed.map(row=>row.jobId)]);
        assert.deepEqual(jobs,[...order].sort().map(provider=>({provider,status:"completed",day,end_day:day})));
        const {rows:facts}=await client.query(`select platform,count(*)::int as n,min(business_date)::text as day,max(business_date)::text as end_day from (
          select platform,business_date from analytics.pd_facts where installation_id=$1 union all
          select platform,business_date from analytics.cpd_product_performance_facts where installation_id=$1 union all
          select platform,business_date from analytics.cpd_product_sales_facts where installation_id=$1
        ) f group by platform order by platform`,[installationId]);
        assert.deepEqual(facts,[...order].sort().map(platform=>({platform,n:1000,day,end_day:day})));
        const {rows:receipts}=await client.query(`select primary_source as provider,count(*)::int as n from evidence.source_batches
          where installation_id=$1 and (manifest ? 'googleDailyReceipt' or manifest ? 'klaviyoDailyReceipt' or manifest ? 'datasetReconciliation')
          group by primary_source order by primary_source`,[installationId]);
        assert.deepEqual(receipts,[...order].sort().map(provider=>({provider,n:1})));
        const providers={};let partnerQuotaDebits;
        for(const provider of order){
          slots.get(provider).audit.resolve(true);
          const result=await active.get(provider);
          providers[provider]={totalMs:result.totalMs,durationsMs:result.durationsMs,requests:result.requests??result.calls.meta,
            quotaDebits:result.quotaDebits,shopifyMapping:result.shopifyMappingMeasurement??result.mapping};
          if(result.partnerQuotaDebits)partnerQuotaDebits=result.partnerQuotaDebits;
        }
        assert.deepEqual(partnerQuotaDebits,{reserved:3,settled:3});
        assert.ok(totalMs>=queueMs+Object.values(providers).reduce((sum,item)=>sum+item.totalMs,0));
        return {day,totalMs,queueMs,order,facts,receipts,providers,partnerQuotaDebits,closedMs:closed.map(({ended})=>ended-started),rollbackOnly:true};
      } finally {
        for(const slot of slots.values()){slot.run.resolve(false);slot.audit.resolve(false);}
        await Promise.allSettled(active.values());
      }
    },
  };
}
