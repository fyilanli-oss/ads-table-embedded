import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createSourceEvidenceCipher} from "../app/lib/database/source-evidence-store.server.js";
import {storeKlaviyoRawDataset,storeKlaviyoRawProductPackages} from "../app/lib/database/klaviyo-dataset-source-store.server.js";
import {KLAVIYO_DAILY_STAGE_SQL,KLAVIYO_DAILY_PUBLISH_SQL,KLAVIYO_DAILY_INSPECT_SQL,KLAVIYO_DAILY_FINISH_SQL} from "../app/lib/database/dataset-rpc.server.js";
import {collectKlaviyoRawDatasets} from "../app/lib/refresh/klaviyo-raw-collection.server.js";
import {createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {runScheduledRefreshCheck} from "../app/lib/refresh/scheduled-queue-check.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";

const productEvents=1000;
const pageSize=100;
const storageLimits={maxRows:1000,maxBytes:1048576};

async function measurePlainSalesInserts(client,installationId) {
  // Keep WAL, indexes and declarative constraints on a disposable logged table.
  // LIKE does not copy foreign keys or AdsTable's application triggers.
  await client.query(`create table analytics.eo05_sales_insert_probe
    (like analytics.cpd_product_sales_facts including all)`);
  const {rows:[{foreignKeys,columns}]}=await client.query(`select
    (select array_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint
     where conrelid='analytics.cpd_product_sales_facts'::regclass and contype='f') "foreignKeys",
    (select string_agg(quote_ident(attname),',' order by attnum) from pg_attribute
     where attrelid='analytics.cpd_product_sales_facts'::regclass and attnum>0
       and not attisdropped and attidentity='' and attgenerated='' and attname<>'id') columns`);
  assert.ok(foreignKeys.length>0&&columns);
  for (const constraint of foreignKeys) {
    await client.query(`alter table analytics.eo05_sales_insert_probe add ${constraint}`);
  }
  await client.query(`create temp table eo05_prepared_insert_rows on commit drop as
    select row_number() over (order by id) ordinal,${columns}
    from analytics.cpd_product_sales_facts where installation_id=$1`,[installationId]);
  await client.query("create unique index on eo05_prepared_insert_rows(ordinal)");
  await client.query("analyze eo05_prepared_insert_rows");
  const packageMs=[];
  for(let offset=0;offset<productEvents;offset+=200) {
    const result=await client.query(`explain (analyze,buffers,wal,timing off,format json)
      insert into analytics.eo05_sales_insert_probe(${columns})
      select ${columns} from pg_temp.eo05_prepared_insert_rows
      where ordinal>$1 and ordinal<=$2 order by ordinal`,[offset,offset+200]);
    const plan=result.rows[0]["QUERY PLAN"][0];
    const executionMs=plan["Execution Time"];
    assert.ok(Number.isFinite(executionMs)&&executionMs>=0);
    packageMs.push(executionMs);
  }
  const {rows:[{count}]}=await client.query("select count(*)::int from analytics.eo05_sales_insert_probe");
  assert.equal(count,productEvents);
  return {rows:count,packageMs,executionMs:packageMs.reduce((total,ms)=>total+ms,0)};
}

async function installPublishTimers(client) {
  const args="jsonb,jsonb,timestamptz,uuid,jsonb,jsonb";
  const anchors={
    publish_klaviyo_staged_report_day:[
      ["  perform 1 from operations.refresh_control",null],
      ["  revision:=(c->>'expectedRevision')","sharedSourceChecks"],
      ["  receipt:=jsonb_build_object('version','klaviyo-daily-receipt-v1'","writerAndVerification"],
      ["  return receipt;","receiptPersist"],
    ],
    write_klaviyo_staged_first_report_day:[
      ["  for s in select body from pg_temp.adstable_klaviyo_daily_report_stage",null],
      ["  return analytics.check_klaviyo_daily_report_facts","physicalWrite"],
    ],
    check_klaviyo_daily_report_facts:[
      ["  summary:=analytics.verify_klaviyo_daily_report_stage",null],
      ["  return summary||jsonb_build_object('digest'","physicalVerification"],
    ],
  };
  for(const [name,points] of Object.entries(anchors)) {
    const {rows:[{definition}]}=await client.query("select pg_get_functiondef($1::regprocedure) definition",[`analytics.${name}(${args})`]);
    let sql=definition.replace("declare\n","declare\n  probe_time timestamptz;\n");
    assert.notEqual(sql,definition);
    for(const [anchor,label] of points) {
      assert.equal(sql.split(anchor).length,2,`timing anchor ${name}: ${anchor}`);
      const notice=label?`  raise notice 'EO05_DAILY_PUBLISH_PHASE ${label} %',1000*extract(epoch from clock_timestamp()-probe_time);\n`:"";
      sql=sql.replace(anchor,()=>notice+"  probe_time:=clock_timestamp();\n"+anchor);
    }
    await client.query(sql);
  }
}

function syntheticResponse(endpoint,owner,day) {
  const url=new URL(endpoint);
  assert.equal(url.origin,"https://a.klaviyo.com");
  if (url.pathname.includes("/accounts")) return Response.json({data:[
    {type:"account",id:owner.accountId,attributes:{timezone:"UTC",preferred_currency:"USD"}},
  ]});
  if (url.pathname.includes("/metrics")) return Response.json({
    data:["Placed Order","Added to Cart","Checkout Started","Ordered Product"].map((name,i)=>({
      id:"m"+i,type:"metric",attributes:{name,integration:{name:"Shopify"}},
    })),links:{next:null},
  });
  if (url.pathname.includes("values-reports")) {
    const kind=url.pathname.includes("campaign")?"campaign":"flow";
    return Response.json({data:{type:kind+"-values-report",attributes:{results:[]}},links:{next:null}});
  }
  assert.equal(url.pathname,"/api/events");
  const offset=Number(url.searchParams.get("page[cursor]")??0);
  assert.ok(offset>=0&&offset<productEvents&&offset%pageSize===0);
  return Response.json({
    data:Array.from({length:pageSize},(_,i)=>({
      type:"event",id:"e"+(offset+i),attributes:{datetime:day+"T12:00:00Z",
        event_properties:{ProductID:"p"+(offset+i),Quantity:1,$value:"19.99"}},
      relationships:{metric:{data:{type:"metric",id:"m3"}}},
    })),
    links:{next:offset+pageSize<productEvents?url.origin+url.pathname+"?page%5Bcursor%5D="+(offset+pageSize):null},
  });
}

/** Run within the existing F01 localhost rollback transaction. */
export async function klaviyoDailyTimingProbe(client,{ownerFixture,connection,environment=process.env}) {
  assert.equal(environment.GITHUB_ACTIONS,"true");assert.ok(environment.RUNNER_TEMP);
  assert.equal(connection.host,"127.0.0.1");assert.equal(connection.port,54322);
  // The enclosing rehearsal savepoint restores the inherited timeout.
  await client.query("set local statement_timeout='60s'");
  const owner=await ownerFixture(client,"klaviyo"),now=Date.now;
  const day=new Date(now()-86400000).toISOString().slice(0,10),window={from:day,to:day};
  const generation=randomUUID(),operationId=randomUUID(),hash=()=>randomBytes(32).toString("hex");
  const cipher=createSourceEvidenceCipher({keys:new Map([[1,randomBytes(32)]]),activeVersion:1,forbiddenKeys:[]});
  const policy=sourceStoreFixture().input.policy;
  // The enclosing savepoint is rolled back, including these diagnostics.
  await installPublishTimers(client);
  await client.query("update integrations.provider_connections set connected_at=clock_timestamp()-interval '3 days' where id=$1",[owner.connectionId]);
  await client.query(`insert into operations.refresh_quota_contexts
    (workspace_id,install_generation,provider,installation_id,connection_id,connection_version,account_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled)
    values ($1,$2,'klaviyo',$3,$4,$5,$6,$7,$8,1,'2026-10-15',true)`,
  [owner.workspaceId,owner.generation,owner.installationId,owner.connectionId,owner.connectionVersion,owner.accountId,hash(),hash()]);
  const cost={requests:21,dbWrites:4000,connections:3,rows:2000,bytes:4000000};
  await client.query("update operations.refresh_control set budget=$1,bounds=$2 where singleton",[
    {global:cost,interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},
      providers:[{provider:"klaviyo",limit:cost}],workspaces:[{workspaceId:owner.workspaceId,limit:cost}],
      accounts:[{provider:"klaviyo",accountId:owner.accountId,limit:cost}]},
    {maxWorkspaces:8,maxCandidates:8,maxClaims:1,maxAdmissions:1},
  ]);
  await client.query("update operations.refresh_tick_control set enabled=true,generation=$1,last_minute=null,last_checked_at_ms=null,queue_revision=null where singleton",[generation]);
  await client.query("update operations.refresh_queue_control set max_workspaces=8,max_accounts=8,max_snapshot_bytes=100000,max_snapshot_age_ms=60000 where singleton");

  const databaseTimings={queue:0,rawWrite:0,rawReadback:0,reportSourceRead:0,reportStage:0,reportPublish:0,reportReadback:0,jobClose:0};
  const publishPhasesMs={};
  const onNotice=({message})=>{
    const match=/^EO05_DAILY_PUBLISH_PHASE ([a-zA-Z]+) ([0-9.]+)$/.exec(message);
    if(match)publishPhasesMs[match[1]]=Number(match[2]);
  };
  let failed,phase="start",requests=0,claimId,reportReceipt;
  const durations={queueEnqueue:0,queueAndAdmission:0,providerCollection:0,providerFixture:0,rawStore:0,handoff:0,reportFlow:0};
  async function timedQuery(bucket,sql,args) {
    const start=performance.now();
    try {return await client.query(sql,args);}
    catch(error) {failed??=error;throw error;}
    finally {databaseTimings[bucket]+=performance.now()-start;}
  }
  const store=createRefreshWorkRepository({query:(sql,args)=>timedQuery("queue",sql,args)});
  const rawDatabase={query:(sql,args)=>timedQuery(sql.includes("commit_klaviyo_dataset_source(")?"rawWrite":"rawReadback",sql,args)};
  const reportDatabase={
    query(sql,args) {
      const bucket=sql===KLAVIYO_DAILY_STAGE_SQL?"reportStage":sql===KLAVIYO_DAILY_PUBLISH_SQL?"reportPublish":
        sql===KLAVIYO_DAILY_INSPECT_SQL?"reportReadback":sql===KLAVIYO_DAILY_FINISH_SQL?"jobClose":"reportSourceRead";
      return timedQuery(bucket,sql,args);
    },
    async transaction(run) {
      await timedQuery("reportStage","savepoint daily_timing_report");
      try {
        reportReceipt=await run(reportDatabase);
        await timedQuery("reportPublish","release savepoint daily_timing_report");
        return reportReceipt;
      } catch(error) {
        failed??=error;
        await client.query("rollback to savepoint daily_timing_report");
        await client.query("release savepoint daily_timing_report");
        throw error;
      }
    },
  };
  const start=performance.now();
  client.on("notice",onNotice);
  try {
    await store.checkQueueFromAuthority({expectedRevision:(await store.readQueueCheck()).revision});
    durations.queueEnqueue=performance.now()-start;
    const limits={deadlineAt:now()+120000,requestTimeoutMs:100000,finishReserveMs:2000,maxRows:2000,maxBytes:4000000};
    const appId="gid://shopify/App/456";
    const entitlementVerifier=createRefreshEntitlementVerifier({store,appId,now,limits,authorizeRead:async()=>true,
      partnerApi:{appId,activeSubscription:async()=>({data:{activeSubscription:{
        shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},billingPeriod:"EVERY_30_DAYS",
        cancelAtEndOfCycle:false,trialEndsAt:null,currentBillingCycle:{
          startTime:new Date(now()-86400000).toISOString(),endTime:new Date(now()+86400000).toISOString()},
        items:[{handle:"monthly",price:{active:true}}],
      }}})},
    });
    const batches=[];
    let collectedAt,reportAt;
    phase="admission";
    const run=await runScheduledRefreshCheck({store,generation,work:{
      now,entitlementVerifier,
      buildWorkPlan:async candidate=>candidate.workspaceId===owner.workspaceId&&candidate.provider==="klaviyo"
        ? {window,partitionId:"synthetic-daily-timing:"+day,workClass:"deep_reconciliation",cost,limits}:null,
      async readPage({claim,entitlementReceipt,signal}) {
        try {
          claimId=claim.id;
          const quotaContext=await store.loadQuotaContext({claim,window,provider:"klaviyo",entitlementReceipt});
          assert.ok(quotaContext);
          const beforeCollect=performance.now();
          durations.queueAndAdmission=beforeCollect-start-durations.queueEnqueue;
          phase="collection";
          const guard=async()=>assert.equal(await store.isClaimCurrent({claim}),true);
          await collectKlaviyoRawDatasets({
            accessToken:"synthetic-only",accountId:owner.accountId,source:{timezone:"UTC",currency:"USD"},
            window,limits:{...limits,maxPages:10,maxBytes:1048576},signal,now,guard,pacerFactory:()=>async()=>{},
            async transport(endpoint) {
              const before=performance.now();requests++;
              try {return syntheticResponse(endpoint,owner,day);}
              finally {durations.providerFixture+=performance.now()-before;}
            },
            async onDataset({dataset,pages,complete,coverage}) {
              assert.equal(complete,true);
              const begin=performance.now(),attemptId=randomUUID(),stamp=new Date(now()).toISOString();
              const read={jobId:claim.id,fence:String(claim.fence),window,operationId,quotaContext,
                observedAt:entitlementReceipt.observedAt,completedAt:stamp,deadlineAt:new Date(limits.deadlineAt).toISOString(),coverage};
              if (dataset==="product_performance") {
                const stored=await storeKlaviyoRawProductPackages({database:rawDatabase,owner,attemptId,pages,read,cipher,
                  policy,limits:storageLimits,now:stamp,maxPackages:20,guard});
                batches.push(...stored.map(({ordinal})=>({attemptId,ordinal})));
              } else {
                const stored=await storeKlaviyoRawDataset({database:rawDatabase,owner,attemptId,dataset,pages,complete,
                  read,cipher,policy,limits:storageLimits,now:stamp});
                assert.equal(stored.contentVerified,true);
                batches.push({attemptId,ordinal:0});
              }
              durations.rawStore+=performance.now()-begin;
            },
          });
          collectedAt=performance.now();
          durations.providerCollection=collectedAt-beforeCollect-durations.rawStore;
          return {kind:"complete",payload:{batchCount:batches.length}};
        } catch(error) {failed??=error;throw error;}
      },
      validatePage:({payload})=>({complete:payload.batchCount>3,rows:[]}),
      async loadDatasetInputs({claim}) {
        assert.equal(claim.id,claimId);
        phase="report";
        reportAt=performance.now();
        durations.handoff=reportAt-collectedAt;
        return {owner,batches,cipher,expectedRevision:0,database:reportDatabase};
      },
    }});
    if (failed) throw failed;
    const ended=performance.now();
    durations.reportFlow=ended-reportAt;
    assert.equal(run.work?.status,"completed",JSON.stringify(run));
    assert.equal(reportReceipt?.rowCount,productEvents);
    assert.deepEqual(reportReceipt.packages.map(part=>part.rowCount),[200,200,200,200,200]);
    for (const name of ["sharedSourceChecks","physicalWrite","physicalVerification","receiptPersist"]) {
      assert.ok(Number.isFinite(publishPhasesMs[name]),`missing SQL timing ${name}`);
    }
    assert.equal(requests,20);
    const status=(await client.query("select status from operations.refresh_runs where workspace_id=$1 and job_id=$2",
      [owner.workspaceId,claimId])).rows[0]?.status;
    assert.equal(status,"completed");
    const sales=(await client.query("select count(*)::int n from analytics.cpd_product_sales_facts where installation_id=$1",
      [owner.installationId])).rows[0].n;
    assert.equal(sales,productEvents);
    const receipts=(await client.query(`select count(*)::int n from evidence.source_batches
      where authority=$1::jsonb and manifest->'klaviyoDailyReceipt'->>'jobId'=$2`,
      [JSON.stringify(owner),claimId])).rows[0].n;
    assert.equal(receipts,1);
    const postgresqlMs=Object.values(databaseTimings).reduce((sum,ms)=>sum+ms,0),totalMs=ended-start;
    phase="plain_insert";
    const plainInsert=await measurePlainSalesInserts(client,owner.installationId);
    console.log("EO05_KLAVIYO_DAILY_TIMING_PASS "+JSON.stringify({
      provider:"klaviyo",synthetic:true,rollbackOnly:true,queueMode:"isolated_no_backlog",productEvents,reportRows:reportReceipt.rowCount,
      rawPackages:batches.length,reportPackages:reportReceipt.packages.length,receipts,requests,
      durationsMs:durations,postgresqlMsByPhase:databaseTimings,publishPhasesMs,totalMs,postgresqlMs,
      adsTableAndFixtureOverheadMs:totalMs-postgresqlMs-durations.providerFixture,plainInsert,
    }));
  } catch(error) {
    console.error("EO05_KLAVIYO_DAILY_TIMING_STOP "+JSON.stringify({
      phase,code:error.code,message:error.message,where:error.where,requests,
      elapsedBeforeStopMs:performance.now()-start,durationsMs:durations,postgresqlMsByPhase:databaseTimings,publishPhasesMs,
    }));
    throw error;
  } finally {
    client.off("notice",onNotice);
  }
}
