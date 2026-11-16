import assert from "node:assert/strict";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {buildKlaviyoHourlyOrderedProductEventsRequest} from "../app/lib/providers/klaviyo-reporting.server.js";
import {createKlaviyoHourlySourceRepository} from "../app/lib/database/klaviyo-hourly-source-repository.server.js";
import {createSourceEvidenceCipher} from "../app/lib/database/source-evidence-store.server.js";
import {sourceRetentionDurationPolicy} from "../app/lib/database/source-retention-policy.server.js";
import {commitKlaviyoHourlyEventReport, commitKlaviyoHourlySourceBatch,
  prepareKlaviyoHourlySourceBatch} from "../app/lib/database/klaviyo-hourly-source-page.server.js";
import {createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {runScheduledRefreshCheck} from "../app/lib/refresh/scheduled-queue-check.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {setTimeout as delay} from "node:timers/promises";

// Invoked only by the loopback F01 Dataset replay inside its rollback transaction.
export async function klaviyoHourlyMinuteProbe(client, ownerFixture, {cohort=24}={}) {
  await client.query("savepoint klaviyo_minute");
  try {
    const rowsPerJob=42, owners=new Map(), shops=new Map(), reports=new Map();
    const timings=new Map();
    let activeStage;
    const measure=(stage,action)=>async (...args)=>{
      const start=performance.now(), previous=activeStage;
      const sample=timings.get(stage) ?? {calls:0,totalMs:0,dbCalls:0,dbMs:0};
      timings.set(stage,sample);
      activeStage=sample;
      try {return await action(...args);}
      finally {
        sample.calls++;
        sample.totalMs+=performance.now()-start;
        activeStage=previous;
      }
    };
    const timedDatabase={async query(...args) {
      const start=performance.now(), sample=activeStage;
      try {return await client.query(...args);}
      finally {
        if (sample) {
          sample.dbCalls++;
          sample.dbMs+=performance.now()-start;
        }
      }
    }};
    const hash=()=>randomBytes(32).toString("hex");
    for (let i=0;i<cohort;i++) {
      const owner=await ownerFixture(client,"klaviyo");
      owners.set(owner.workspaceId,owner);
      shops.set(owner.shopId,owner);
      await client.query("update integrations.provider_connections set connected_at=statement_timestamp()-interval '3 days' where id=$1",[owner.connectionId]);
      await client.query(`
        insert into operations.refresh_quota_contexts
          (workspace_id,install_generation,provider,installation_id,connection_id,connection_version,
           account_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled)
        values($1,$2,'klaviyo',$3,$4,$5,$6,$7,$8,1,'2026-10-15',true)
      `,[owner.workspaceId,owner.generation,owner.installationId,owner.connectionId,owner.connectionVersion,owner.accountId,hash(),hash()]);
    }
    const cost={requests:4,dbWrites:128,connections:1,rows:100,bytes:200000};
    const budget={global:cost,interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},
      providers:[{provider:"klaviyo",limit:cost}],
      workspaces:[...owners.keys()].map(workspaceId=>({workspaceId,limit:cost})),
      accounts:[{provider:"klaviyo",accountId:"account-123",limit:cost}]};
    await client.query(`
      update operations.refresh_control set budget=$1,bounds=$2,
        next_fence=greatest(next_fence,(select coalesce(max(fence),0)+1 from operations.refresh_runs))
      where singleton
    `,[budget,{maxWorkspaces:512,maxCandidates:512,maxClaims:1,maxAdmissions:1}]);
    await client.query(`
      update operations.refresh_queue_control set max_workspaces=1000,max_accounts=1000,
        max_snapshot_bytes=4194304,max_snapshot_age_ms=60000 where singleton
    `);
    const store=createRefreshWorkRepository(timedDatabase);
    const timedStore={...store};
    for (const [method,stage] of Object.entries({
      checkScheduledQueue:"queue",reviewInterruptedWork:"interruptionReview",readPreflightSnapshot:"candidateSnapshot",
      readAdmissionSnapshot:"admissionState",commitPreflight:"admission",loadBoundAuthority:"workerAuthority",advanceStage:"workProgress",
    })) timedStore[method]=measure(stage,store[method]);
    await store.checkQueueFromAuthority({expectedRevision:(await store.readQueueCheck()).revision});
    const previousHour=Math.floor(Date.now()/3_600_000)*3_600_000-3_600_000;
    await client.query(`
      update operations.refresh_queue_accounts set state='pending',first_due_hour_ms=$2,
        latest_due_hour_ms=greatest(coalesce(latest_due_hour_ms,0),$2),first_queued_at_ms=$2
      where workspace_id=any($1::uuid[]) and provider='klaviyo'
    `,[[...owners.keys()],previousHour]);
    const generation=randomUUID();
    await client.query("update operations.refresh_tick_control set enabled=true,generation=$1,last_minute=null,last_checked_at_ms=null,queue_revision=null where singleton",[generation]);
    const available=60_000-Date.now()%60_000;
    if (available<(cohort>24?50_000:15_000)) await delay(available+50);
    const startMs=Date.now(), deadlineAt=(Math.floor(startMs/60_000)+1)*60_000;
    const limits={deadlineAt,requestTimeoutMs:5_000,finishReserveMs:1_000,maxRows:100,maxBytes:200000};
    const appId="gid://shopify/App/456";
    const entitlementVerifier=createRefreshEntitlementVerifier({store,appId,now:Date.now,limits,authorizeRead:async()=>true,
      partnerApi:{appId,activeSubscription:async({variables:{shopId}})=>{
        const owner=shops.get(shopId);
        assert.ok(owner);
        return {data:{activeSubscription:{shop:{id:shopId,myshopifyDomain:owner.shopDomain},billingPeriod:"EVERY_30_DAYS",
          cancelAtEndOfCycle:false,trialEndsAt:null,currentBillingCycle:{startTime:new Date(startMs-86_400_000).toISOString(),
            endTime:new Date(startMs+86_400_000).toISOString()},items:[{handle:"monthly",price:{active:true}}],pendingUpdate:null}}};
      }}});
    const timedEntitlement={verify:measure("entitlement",entitlementVerifier.verify),
      isCurrent:measure("entitlement",entitlementVerifier.isCurrent)};
    const cipher=createSourceEvidenceCipher({keys:new Map([[1,randomBytes(32)]]),activeVersion:1,forbiddenKeys:[]});
    const result=await runScheduledRefreshCheck({store:timedStore,generation,work:{
      drainReadyWork:true,now:Date.now,entitlementVerifier:timedEntitlement,
      buildWorkPlan:async (source,job)=>owners.has(source.workspaceId)&&job?.kind==="klaviyo_hourly"
        ? {workClass:"hourly_hot_window",cost,limits} : null,
      loadCompletedKlaviyoHourlyJobs:measure("completedLookup",async jobs=>(await timedDatabase.query(
        "select analytics.list_completed_klaviyo_hourly_jobs($1) as result",[JSON.stringify(jobs)])).rows[0].result),
      readPage:async ({claim,window,hourlySource,entitlementReceipt})=>{
        const owner=owners.get(claim.workspaceId), metricId="ordered-product", attemptId=randomUUID();
        const quotaContext=await measure("quotaContext",store.loadQuotaContext)({claim,window,provider:"klaviyo",entitlementReceipt});
        assert.ok(quotaContext);
        const sourceReceipt=await measure("source",async ()=>{
          const {sourceScope:scope}=buildKlaviyoHourlyOrderedProductEventsRequest({accessToken:"synthetic-only",
            orderedProductMetricId:metricId,tickAt:hourlySource.end,timeZone:"UTC",job:{...claim,window:hourlySource}});
          const records=Array.from({length:rowsPerJob},(_,i)=>({type:"event",id:`event-${i}`,
            attributes:{datetime:new Date(Date.parse(hourlySource.start)+i*120_000).toISOString(),
              event_properties:{ProductID:`product-${i}`,Quantity:{jsonNumber:"1"},$value:{jsonNumber:"19.99"}}},
            relationships:{metric:{data:{type:"metric",id:metricId}}}}));
          const batch=prepareKlaviyoHourlySourceBatch({owner,scope,attemptId,cipher,limits:{maxPages:1,maxRows:100,maxBytes:200000},
            projections:[{revision:scope.revision,hasNext:false,records,included:[]}]});
          const repository=createKlaviyoHourlySourceRepository({database:timedDatabase,policy:sourceRetentionDurationPolicy(),
            observedAt:entitlementReceipt.observedAt,quotaContext});
          return commitKlaviyoHourlySourceBatch({batch,repository,deadlineAt});
        })();
        const report=await measure("dataset",commitKlaviyoHourlyEventReport)({database:timedDatabase,sourceReceipt,deadlineAt});
        assert.equal(report.counts.reduce((a,b)=>a+b,0),rowsPerJob);
        reports.set(claim.id,{owner,attemptId,report});
        return {kind:"complete",payload:{}};
      },
      validatePage:()=>({complete:true,rows:[]}),
      finishKlaviyoHourlyReport:measure("closure",async ({claim})=>{
        const {owner,attemptId,report}=reports.get(claim.id);
        return (await timedDatabase.query("select analytics.finish_klaviyo_hourly_event_report($1,$2,$3,$4,$5) as result",
          [owner,claim.id,claim.fence,attemptId,report])).rows[0].result;
      }),
    }});
    const elapsedMs=Date.now()-startMs;
    assert.equal(result.status,"queue_checked",JSON.stringify(result));
    const timedStop=result.work.status==="paused" && result.work.stopRecorded===true
      && ["stopped_before_call","worker_stopped"].includes(result.work.reason);
    assert.ok(["waiting","tick_budget_elapsed"].includes(result.work.status) || timedStop,JSON.stringify(result));
    assert.ok(result.completedThisTick>=2,JSON.stringify(result));
    assert.equal(timings.get("candidateSnapshot")?.calls,1);
    assert.ok(timings.get("admissionState")?.calls>=result.completedThisTick-1);
    const {rows:[counts]}=await client.query(`
      select count(*) filter (where status='completed')::int as completed,
        count(*) filter (where status='running')::int as running
      from operations.refresh_runs where workspace_id=any($1::uuid[]) and provider='klaviyo'
    `,[[...owners.keys()]]);
    assert.deepEqual(counts,{completed:result.completedThisTick,running:0});
    console.log("EO05_KLAVIYO_HOURLY_MINUTE_PASS "+JSON.stringify({cohort,rowsPerJob,elapsedMs,preparedTimeMs:deadlineAt-startMs,
      completed:counts.completed,remaining:cohort-counts.completed,stop:result.work.status,stopReason:result.work.reason??null,providerCalls:0,
      stages:Object.fromEntries([...timings].map(([name,sample])=>[name,{...sample,
        totalMs:Math.round(sample.totalMs),dbMs:Math.round(sample.dbMs)}])),
      otherMs:Math.max(0,elapsedMs-Math.round([...timings.values()].reduce((sum,sample)=>sum+sample.totalMs,0)))}));
  } finally {
    await client.query("rollback to savepoint klaviyo_minute");
    await client.query("release savepoint klaviyo_minute");
  }
}

async function probeCompletedLookupAt500(client, lookup) {
  const candidates = Array.from({length:500}, (_, index) => {
    const workspaceId = randomUUID();
    return {
      id:createHash("sha256").update(workspaceId).digest("hex"),
      workspaceId, installGeneration:"1", accountId:`klaviyo-capacity-${index}`,
    };
  });
  const completed = candidates.slice(0,-1);
  await client.query("update operations.refresh_control set bounds=jsonb_set(bounds,'{maxCandidates}','500') where singleton");
  await client.query("insert into app.workspaces(id) select unnest($1::uuid[])",[candidates.map(job=>job.workspaceId)]);
  await client.query(`
    insert into operations.refresh_runs
      (workspace_id,install_generation,provider,account_id,job_id,fence,cost,status,finished_at)
    select c."workspaceId",c."installGeneration",'klaviyo',c."accountId",c.id,
      fences.last+row_number() over (order by c.id),'{}'::jsonb,'completed',statement_timestamp()
    from jsonb_to_recordset($1::jsonb) as c(id text,"workspaceId" uuid,"installGeneration" bigint,"accountId" text)
    cross join (select coalesce(max(fence),0) as last from operations.refresh_runs) fences
  `,[JSON.stringify(completed)]);
  const expected = completed.map(job=>job.id).sort();
  const samples = [];
  for (let pass=0;pass<21;pass++) {
    const start = performance.now();
    const ids = await lookup(candidates);
    if (pass>0) samples.push(performance.now()-start);
    assert.deepEqual(ids.sort(),expected);
  }
  samples.sort((a,b)=>a-b);
  console.log("EO05_KLAVIYO_HOURLY_QUEUE_LOOKUP_500 " + JSON.stringify({
    workspaces:candidates.length,alreadyCompleted:completed.length,remaining:1,
    samples:samples.length,p50Ms:Number(samples[9].toFixed(2)),p95Ms:Number(samples[18].toFixed(2)),
    scope:"completed-job lookup round trip only",
  }));
}

export async function klaviyoHourlyPrivateWriterProbe(client, {store,workspace,shopId,shopDomain,connection,installation}) {
  await client.query("savepoint klaviyo_hourly_private_writer");
  try {
    await client.query(readFileSync(new URL("./sql/eo05-klaviyo-hourly-source.sql",import.meta.url),"utf8"));
    await client.query(readFileSync(new URL("./sql/eo05-klaviyo-hourly-event-report.sql",import.meta.url),"utf8"));
    await client.query("update integrations.provider_connections set connected_at=statement_timestamp()-interval '3 days' where id=$1",
      [connection.id]);
    await client.query("update integrations.reporting_account_bindings set effective_from=statement_timestamp()-interval '3 days' where connection_id=$1 and effective_to is null",
      [connection.id]);
    await store.checkQueueFromAuthority({expectedRevision:(await store.readQueueCheck()).revision});
    const current = Date.now();
    const dueHour = Math.floor(current/3_600_000)*3_600_000-3_600_000;
    await client.query(`
      update operations.refresh_queue_accounts set first_due_hour_ms=$2, first_queued_at_ms=$2
      where workspace_id=$1 and provider='klaviyo' and account_id='klaviyo-a' and state='pending'
    `, [workspace,dueHour]);
    const generation = randomUUID();
    await client.query("update operations.refresh_tick_control set enabled=true,generation=$1,last_minute=null,last_checked_at_ms=null,queue_revision=null where singleton",[generation]);
    const deadlineAt = current+90_000;
    let finishReport, partition;
    const loadCompletedKlaviyoHourlyJobs = async jobs => (await client.query(
      "select analytics.list_completed_klaviyo_hourly_jobs($1::jsonb) as ids",[JSON.stringify(jobs)],
    )).rows[0].ids;
    const verifier = createRefreshEntitlementVerifier({
      store, appId:"gid://shopify/App/456", now:Date.now,
      limits:{deadlineAt, requestTimeoutMs:10000, finishReserveMs:1000},
      authorizeRead:async () => true,
      partnerApi:{appId:"gid://shopify/App/456",activeSubscription:async () => ({data:{activeSubscription:{
        shop:{id:shopId,myshopifyDomain:shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,
        trialEndsAt:null,currentBillingCycle:{startTime:new Date(current-86_400_000).toISOString(),
          endTime:new Date(current+86_400_000).toISOString()},
        items:[{handle:"monthly",price:{active:true}}],pendingUpdate:null,
      }}})},
    });
    const scheduled = await runScheduledRefreshCheck({store,generation,work:{
      now:Date.now,
      loadCompletedKlaviyoHourlyJobs,
      buildWorkPlan:async (candidate, job) => {
        if (candidate.provider!=="klaviyo" || job?.kind!=="klaviyo_hourly") return null;
        return {workClass:"hourly_hot_window",cost:{requests:4,dbWrites:8,connections:1,rows:10,bytes:10000},
          limits:{deadlineAt,requestTimeoutMs:10000,finishReserveMs:1000,maxRows:10,maxBytes:10000}};
      },
      entitlementVerifier:verifier,
      readPage:async execution => {
        const {hourlySource:{start,end},window}=execution;
        partition=`klaviyo-hourly-source:${start}/${end}`;
        const endMs=Date.parse(end);
        const {claim,entitlementReceipt:{observedAt}} = execution;
        const owner = {provider:"klaviyo",workspaceId:workspace,installationId:installation.id,
          generation:claim.installGeneration,shopId,shopDomain,accountId:claim.accountId,
          connectionId:connection.id,connectionVersion:String(connection.connection_version),
          selectionEpoch:null,credentialId:connection.credential_id};
        const {rows:[quota]} = await client.query(
          "select operations.load_refresh_quota_context($1,$2,'klaviyo',$3,$4,$5,$6,$7,'klaviyo',$8) as context",
          [workspace,claim.installGeneration,claim.accountId,claim.id,claim.fence,window.from,window.to,observedAt],
        );
        assert.ok(quota.context,"hourly claim must retain current quota authority");
        const metricId = "m".repeat(256);
        const {sourceScope:scope} = buildKlaviyoHourlyOrderedProductEventsRequest({
          accessToken:"synthetic-only",orderedProductMetricId:metricId,tickAt:end,timeZone:"UTC",
          job:{...claim,window:{start,end}},
        });
        const attemptId = randomUUID();
        const cipher = createSourceEvidenceCipher({keys:new Map([[1,randomBytes(32)]]),activeVersion:1,forbiddenKeys:[]});
        const sourceInput = {owner,scope,attemptId,cipher,
          limits:{maxPages:2,maxRows:2,maxBytes:10000},
          projections:[{revision:scope.revision,included:[{type:"attribution",id:"sale-attribution",relationships:{
            flow:{data:{type:"flow",id:"parent-flow"}},
            "flow-message":{data:{type:"flow-message",id:"message"}},
            "flow-message-variation":{data:{type:"flow-message-variation",id:"variation"}},
          }}],hasNext:false,records:[
            {type:"event",id:"event",attributes:{datetime:start,event_properties:{ProductID:"first",Quantity:"2",$value:"24.50"}},
              relationships:{metric:{data:{type:"metric",id:metricId}},
                attributions:{data:[{type:"attribution",id:"sale-attribution"}]}}},
            {type:"event",id:"next-hour-event",attributes:{datetime:new Date(endMs-3_600_000).toISOString()},
              relationships:{metric:{data:{type:"metric",id:metricId}}}},
          ]}],
        };
        let sqlFailure;
        const repository = createKlaviyoHourlySourceRepository({policy:sourceRetentionDurationPolicy(),
          database:{async query(sql,args) {
            try {return await client.query(sql,args);}
            catch (error) {sqlFailure = error; throw error;}
          }},observedAt,quotaContext:quota.context});
        const staleAttempt = randomUUID();
        const stale = prepareKlaviyoHourlySourceBatch({...sourceInput,attemptId:staleAttempt,
          scope:{...scope,fence:scope.fence+1}});
        await client.query("savepoint stale_hourly_claim");
        try {
          await assert.rejects(commitKlaviyoHourlySourceBatch({batch:stale,repository,deadlineAt}), /WRITE_UNCONFIRMED/);
        } finally {
          await client.query("rollback to savepoint stale_hourly_claim");
          await client.query("release savepoint stale_hourly_claim");
        }
        assert.equal((await client.query("select count(*)::int n from evidence.source_batches where attempt_id=$1",
          [staleAttempt])).rows[0].n, 0);
        const batch = prepareKlaviyoHourlySourceBatch(sourceInput);
        await client.query("savepoint hourly_write_roundtrip");
        let receipt;
        sqlFailure = undefined;
        try {
          receipt = await commitKlaviyoHourlySourceBatch({batch,repository,deadlineAt});
        } catch (error) {
          await client.query("rollback to savepoint hourly_write_roundtrip");
          console.error("EO05_KLAVIYO_HOURLY_PRIVATE_WRITE_STOP", JSON.stringify({
            code:sqlFailure?.code, message:sqlFailure?.message ?? error.message,
          }));
          throw error;
        } finally {
          await client.query("release savepoint hourly_write_roundtrip");
        }
        assert.deepEqual(receipt,{attemptId,digest:batch.manifest.digest,pageCount:1,rowCount:2,contentVerified:true});
        await assert.rejects(commitKlaviyoHourlyEventReport({database:client,sourceReceipt:{...receipt},deadlineAt}),
          /SCOPE_INVALID/);
        const report = await commitKlaviyoHourlyEventReport({database:client,sourceReceipt:receipt,deadlineAt});
        assert.deepEqual(report.counts,[1,1]);
        assert.equal(report.applied.length,2);
        const facts = await client.query("select event_count from analytics.klaviyo_hourly_event_facts order by hour_start");
        assert.deepEqual(facts.rows,[{event_count:1},{event_count:1}]);
        const products = await client.query("select sale from analytics.klaviyo_hourly_product_sales order by ordinal");
        assert.deepEqual(products.rows.map(({sale}) => [sale.productId,sale.quantity,sale.value]),
          [["first","2","24.5"],[null,null,null]]);
        const {attribution} = products.rows[0].sale;
        assert.deepEqual([attribution.source,attribution.source_entity_id,attribution.channel_id,
          attribution.variation_id,attribution.sales_role],["flow","parent-flow","message","variation","Triggered"]);
        finishReport = async (fence, verified = report) => (await client.query(
          "select analytics.finish_klaviyo_hourly_event_report($1,$2,$3,$4,$5) as finished",
          [owner,claim.id,fence,attemptId,verified],
        )).rows[0].finished;
        assert.equal(await finishReport(claim.fence),false,"request intent must not release the job");
        assert.equal(await store.isClaimCurrent({claim}),true);
        return {kind:"complete",payload:{}};
      },
      validatePage:() => ({complete:true,rows:[]}),
      finishKlaviyoHourlyReport:async ({claim,partitionId}) => {
        assert.equal(partitionId,partition);
        assert.equal(typeof finishReport,"function");
        assert.equal(await finishReport(claim.fence+1),false,"stale fence cannot finish");
        assert.equal(await finishReport(claim.fence,{counts:[1,1]}),false,"inexact receipt cannot finish");
        assert.equal(await store.isClaimCurrent({claim}),true);
        await client.query("savepoint hourly_physical_receipt_missing");
        await client.query("delete from analytics.klaviyo_hourly_event_facts");
        assert.equal(await finishReport(claim.fence),false,"missing physical facts cannot finish");
        await client.query("rollback to savepoint hourly_physical_receipt_missing");
        await client.query("release savepoint hourly_physical_receipt_missing");
        return finishReport(claim.fence);
      },
    }});
    const run=scheduled.work;
    assert.equal(run?.status,"completed",JSON.stringify({status:scheduled.status,work:run?.status,reason:run?.reason,deferred:run?.deferred}));
    assert.equal(run.reservationRetained,false);
    assert.equal(await finishReport(run.claim.fence),false,"job is already closed");
    const finished = await client.query("select status from operations.refresh_runs where fence=$1", [run.claim.fence]);
    assert.deepEqual(finished.rows,[{status:"completed"}]);
    const {id,workspaceId,installGeneration,accountId}=run.claim;
    const completed={id,workspaceId,installGeneration,accountId};
    assert.deepEqual(await loadCompletedKlaviyoHourlyJobs([
      {...completed,id:randomUUID()}, {...completed,accountId:"other"}, completed,
    ]),[id]);
    await probeCompletedLookupAt500(client,loadCompletedKlaviyoHourlyJobs);
    console.log("EO05_KLAVIYO_HOURLY_PRIVATE_WRITER_ROUNDTRIP_PASS actual_source_tables=true actual_claim=true readback=true real_provider_calls=0");
    console.log("EO05_KLAVIYO_HOURLY_EVENT_REPORT_PASS actual_hourly_facts=true source_receipt_bound=true report_readback=true runtime_grants=false");
    console.log("EO05_KLAVIYO_HOURLY_JOB_FINISH_PASS ready_for_dataset=true exact_receipt=true stale_fence_denied=true missing_physical_facts_denied=true completed=true");
    console.log("EO05_KLAVIYO_HOURLY_SCHEDULER_PASS real_tick=true fenced_job=true verified_dataset=true reservation_released=true");
    console.log("EO05_KLAVIYO_HOURLY_COMPLETED_LOOKUP_PASS completed_scope=true different_job_excluded=true different_account_excluded=true");
  } finally {
    await client.query("rollback to savepoint klaviyo_hourly_private_writer");
    await client.query("release savepoint klaviyo_hourly_private_writer");
  }
}
