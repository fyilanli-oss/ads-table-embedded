import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {projectStoredGoogleDataset} from "../app/lib/providers/stored-dataset-projection.server.js";
import {prepareDailyDatasetPackages} from "../app/lib/database/dataset-reconciliation.server.js";
import {resolveReportRetentionPolicy} from "../app/lib/database/report-retention-policy.server.js";
import {GOOGLE_DAILY_STAGE_SQL,GOOGLE_DAILY_PUBLISH_SQL,GOOGLE_DAILY_INSPECT_SQL,GOOGLE_DAILY_FINISH_SQL} from "../app/lib/database/dataset-rpc.server.js";

async function verifyGoogleDailyReplacement(client,{owner,first,rpc,reject,day}) {
 const ownerJson=JSON.stringify(owner),job="synthetic-reread-job";
 const input=await storedBindingFixture(client,owner,{jobId:job,googleProducts:500,googleSalesProducts:499,
  googleRevenueMicros:"17500000",googlePageSize:10000,googleStorageMaxBytes:2097152});
 const deadlineAt=Date.now()+120000,deadline=new Date(deadlineAt).toISOString();
 const observedAt=new Date().toISOString();
 const fence=(await client.query("select (max(fence)+1)::text n from operations.refresh_runs")).rows[0].n;
 const scope=[owner.workspaceId,owner.generation,"google_ads",owner.accountId,job,fence];
 await client.query(`update operations.refresh_work_bindings set fence=$6,deadline_at_ms=$7,source=operations.refresh_preflight_source($1,$2,$3,$4)
  where workspace_id=$1 and install_generation=$2 and provider=$3 and account_id=$4 and job_id=$5`,[...scope,deadlineAt]);
 for(const b of input.batches) await client.query(`update evidence.source_batches set manifest=jsonb_set(jsonb_set(jsonb_set(manifest,
   '{googleDatasetRead,fence}',to_jsonb($3::text)),'{googleDatasetRead,observedAt}',to_jsonb($4::text)),'{googleDatasetRead,completedAt}',to_jsonb($4::text))
   where authority=$1::jsonb and attempt_id=$2`,[ownerJson,b.attemptId,fence,observedAt]);
 await client.query(`insert into operations.refresh_runs(workspace_id,install_generation,provider,account_id,job_id,fence,cost,status)
  values($1,$2,$3,$4,$5,$6,'{"requests":18,"rows":2000,"bytes":16000000,"connections":1,"dbWrites":20}'::jsonb,'running')`,scope);
 await client.query(`insert into operations.refresh_work_progress(workspace_id,install_generation,provider,account_id,job_id,fence,stage,from_date,to_date)
  values($1,$2,$3,$4,$5,$6,'ready_for_dataset',$7,$7)`,[...scope,day]);
 const bundle=await readStoredDatasetSources({...input,limits:{...input.limits,deadlineAt,maxBytes:16000000,maxRows:2000}});
 const rows=projectStoredGoogleDataset(bundle).rows;
 const operationId=randomUUID(),policy=resolveReportRetentionPolicy({businessDate:day,timeZone:"UTC"});
 const context={expectedRevision:first.revision,businessDate:day,timeZone:"UTC",sourceContext:bundle.datasets[0].sourceContext,
  sources:bundle.datasets.flatMap(d=>d.pages.map(p=>p.ref)),batchIds:bundle.datasets.flatMap(d=>(d.packageReceipts??[d.receipt]).map(r=>r.batchId)),
  startedAt:observedAt,completedAt:observedAt};
 const writes=prepareDailyDatasetPackages({owner,rows,policy,operationId,now:new Date().toISOString(),context,maxPackages:20});
 assert.deepEqual(writes.map(part=>part.rows.length),[200,200,200,200,200]);
 // The enclosing rehearsal keeps both logical publications in one rollback.
 await client.query("truncate pg_temp.adstable_google_daily_report_stage");
 const contextJson=JSON.stringify(context),digests=[];
 const facts=async()=>(await client.query(`select id::text,native_key_hash,sales_value::text,revision from analytics.cpd_product_sales_facts
   where workspace_id=$1 and installation_id=$2 and business_date=$3 order by native_key_hash`,[owner.workspaceId,owner.installationId,day])).rows;
 const originalFacts=await facts();
 assert.equal(originalFacts.length,499);
 const publish=()=>rpc(GOOGLE_DAILY_PUBLISH_SQL,[ownerJson,contextJson,deadline,operationId,JSON.stringify(policy),JSON.stringify(digests)]);
 const inspect=id=>rpc(GOOGLE_DAILY_INSPECT_SQL,[ownerJson,id]);
 for(let i=0;i<writes.length;i++){
  const staged=(await rpc(GOOGLE_DAILY_STAGE_SQL,[ownerJson,JSON.stringify(writes[i]),contextJson,deadline,i,writes.length])).rows[0].result;
  digests.push(staged.digest);
  if(i===3){
   await reject(publish,/GOOGLE_REPORT_PACKAGE_VERIFICATION_FAILED/);
   assert.deepEqual((await inspect(first.operationId)).rows[0].result,first);
   assert.deepEqual(await facts(),originalFacts);
  }
 }
 const revised=(await publish()).rows[0].result;
 assert.equal(revised.revision,2);
 assert.equal(revised.rowCount,1000);
 assert.equal(revised.packages.length,5);
 assert.deepEqual((await inspect(operationId)).rows[0].result,revised);
 assert.equal((await inspect(first.operationId)).rows[0].result.status,"superseded");
 const updatedFacts=await facts();
 assert.deepEqual(updatedFacts.map(r=>r.id),originalFacts.map(r=>r.id));
 assert.ok(updatedFacts.some((row,i)=>row.sales_value!==originalFacts[i].sales_value));
 assert.equal((await rpc(GOOGLE_DAILY_FINISH_SQL,[ownerJson,job,fence,operationId,revised.digest])).rows[0].result,true);
 return {revision:2,rows:1000,packages:5,incompletePreservedPrevious:true,receipt:true,closed:true};
}

// Synthetic source fixtures, real AEAD/readback, physical facts and daily RPCs.
// Caller owns the outer rollback transaction; no native HTTP or durable data.
export async function googleDailyPackagesProbe(client,{ownerFixture,verifyWriterPreparation=false,verifyPackageReuse=false}) {
 assert.equal(client.connectionParameters.host,"127.0.0.1");
 assert.equal(Number(client.connectionParameters.port),54322);
 const cases=[];
 for(const payload of ['{}','[]','null','{"n":9007199254740993,"d":1.2300,"x":[true,null,"é"]}']){
  const r=(await client.query("select analytics.dataset_json($1::jsonb) a,analytics.google_daily_json($1::jsonb) b,analytics.dataset_digest($1::jsonb) h,analytics.google_daily_digest($1::jsonb) g",[payload])).rows[0];
  assert.equal(r.a,r.b);assert.equal(r.h,r.g);
 }
 for(const scenario of [{nonempty:true,rows:501,packages:3},{nonempty:false,rows:0,packages:1},
  {nonempty:true,rows:1000,packages:5,googleProducts:500,googleSalesProducts:499,googlePageSize:10000}]){
  const {nonempty}=scenario;
  await client.query("savepoint google_daily_case");
  try{
   // Same ephemeral membership used by the existing scheduled Dataset probe.
   // It exists only inside this localhost savepoint and is rolled back below.
   await client.query("set local role postgres");
   await client.query("grant adstable_refresh_dataset_runner to adstable_owner with inherit false,set true,admin false");
   await client.query("set local role adstable_owner");
   const owner=await ownerFixture(client,"google_ads");
   await client.query("update integrations.provider_connections set connected_at='2026-10-31' where id=$1",[owner.connectionId]);
   await client.query("update integrations.reporting_account_bindings set effective_from='2026-10-31' where connection_id=$1",[owner.connectionId]);
   const input=await storedBindingFixture(client,owner,{nonempty,googleProducts:scenario.googleProducts??250,
    ...(scenario.rows===1000?{googleSalesProducts:scenario.googleSalesProducts,googlePageSize:scenario.googlePageSize,googleStorageMaxBytes:2097152}:{})});
   const job="synthetic-binding-job",day="2026-11-01",deadlineAt=Date.now()+120000,deadline=new Date(deadlineAt).toISOString();
   const fence=(await client.query("select (coalesce(max(fence),0)+1)::text n from operations.refresh_runs")).rows[0].n;
   const scope=[owner.workspaceId,owner.generation,"google_ads",owner.accountId,job,fence];
   await client.query(`update operations.refresh_work_bindings set fence=$6,deadline_at_ms=$7,source=operations.refresh_preflight_source($1,$2,$3,$4)
    where workspace_id=$1 and install_generation=$2 and provider=$3 and account_id=$4 and job_id=$5`,[...scope,deadlineAt]);
   for(const b of input.batches)await client.query(`update evidence.source_batches set manifest=jsonb_set(jsonb_set(jsonb_set(manifest,
    '{googleDatasetRead,fence}',to_jsonb($3::text)),'{googleDatasetRead,observedAt}',to_jsonb($4::text)),'{googleDatasetRead,completedAt}',to_jsonb($4::text))
    where authority=$1::jsonb and attempt_id=$2`,[JSON.stringify(owner),b.attemptId,fence,new Date(Date.now()-1000).toISOString()]);
   await client.query(`insert into operations.refresh_runs(workspace_id,install_generation,provider,account_id,job_id,fence,cost,status)
    values($1,$2,$3,$4,$5,$6,$7::jsonb,'running')`,[...scope,JSON.stringify({requests:18,rows:scenario.rows===1000?2000:1000,
     bytes:scenario.rows===1000?16000000:1000000,connections:1,dbWrites:20})]);
   await client.query(`insert into operations.refresh_work_progress(workspace_id,install_generation,provider,account_id,job_id,fence,stage,from_date,to_date)
    values($1,$2,$3,$4,$5,$6,'ready_for_dataset',$7,$7)`,[...scope,day]);
   const bundle=await readStoredDatasetSources({...input,limits:{...input.limits,deadlineAt,maxBytes:16000000,maxRows:scenario.rows===1000?2000:1000}});
   const rows=projectStoredGoogleDataset(bundle).rows;assert.equal(rows.length,scenario.rows);
   if(scenario.rows===1000){assert.equal(bundle.rowsRead,1501);assert.equal(bundle.pagesRead,17);
    assert.deepEqual(["pd_facts","cpd_product_performance_facts","cpd_product_sales_facts"].map(t=>rows.filter(r=>r.table===t).length),[1,500,499]);}
   const operationId=randomUUID(),policy=resolveReportRetentionPolicy({businessDate:day,timeZone:"UTC"});
   const context={expectedRevision:0,businessDate:day,timeZone:"UTC",sourceContext:bundle.datasets[0].sourceContext,
    sources:bundle.datasets.flatMap(d=>d.pages.map(p=>p.ref)),batchIds:bundle.datasets.flatMap(d=>(d.packageReceipts??[d.receipt]).map(r=>r.batchId)),
    startedAt:new Date(Date.now()-1000).toISOString(),completedAt:new Date().toISOString()};
   const writes=prepareDailyDatasetPackages({owner,rows,policy,operationId,now:new Date().toISOString(),context,maxPackages:20});
   assert.equal(writes.length,scenario.packages);
   if(scenario.rows===1000)assert.deepEqual(writes.map(w=>w.rows.length),[200,200,200,200,200]);
   const args=[JSON.stringify(owner),JSON.stringify(context),deadline,operationId,JSON.stringify(policy)];
   const digests=[];
   const rpc=async(sql,parameters)=>{await client.query("set local role adstable_refresh_dataset_runner");const result=await client.query(sql,parameters);await client.query("set local role adstable_owner");return result;};
   assert.equal((await client.query("select has_function_privilege('adstable_refresh_dataset_runner','analytics.commit_google_daily_package(jsonb,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
   const publish=()=>rpc(GOOGLE_DAILY_PUBLISH_SQL,[...args,JSON.stringify(digests)]);
   async function reject(run,pattern){await client.query("savepoint google_daily_negative");let e;try{await run();}catch(error){e=error;}finally{await client.query("rollback to savepoint google_daily_negative");await client.query("release savepoint google_daily_negative");}assert.ok(e);if(pattern)assert.match(e.message,pattern);}
   if(verifyWriterPreparation&&scenario.rows===1000){
    const commit=p=>client.query("select analytics.commit_google_daily_package($1::jsonb,$2::jsonb)",[args[0],JSON.stringify(p)]);
    const first=structuredClone(writes[0]);
    const repeatIndex=first.rows.findIndex((item,index)=>first.rows.slice(0,index).some(before=>before.table===item.table));
    // Use two rows in the same table to exercise the cached metadata path.
    assert.ok(repeatIndex>0);
    const repeated=first.rows[repeatIndex];
    const sample={...first,rows:[first.rows.find(item=>item.table===repeated.table),repeated]};
    const malformed=structuredClone(sample);
    delete malformed.rows[1].row.metric_extensions;
    await reject(()=>commit(malformed),/DATASET_ROW_SHAPE_INVALID/);
    const invalidDecimal=structuredClone(sample),item=invalidDecimal.rows[1];
    const metric=item.table==="cpd_product_sales_facts"?"sales_value":"spend_value";
    assert.ok(Object.hasOwn(item.row,metric));
    item.row[metric]="1.00";
    await reject(()=>commit(invalidDecimal),/DATASET_DECIMAL_INVALID/);
   }
   for(let i=0;i<writes.length;i++){
    const receipt=(await rpc(GOOGLE_DAILY_STAGE_SQL,[args[0],JSON.stringify(writes[i]),args[1],deadline,i,writes.length])).rows[0].result;
    if(verifyPackageReuse){
     const {rows:[baseline]}=await client.query(`select
       analytics.google_daily_digest(jsonb_build_object('write',$1::jsonb,'context',$2::jsonb)) digest,
       analytics.google_daily_json($1::jsonb) collate "C" = analytics.eo05_google_package_from_rows(
         $1::jsonb,analytics.google_daily_json(($1::jsonb)->'rows',2),0) collate "C" as identical`,[JSON.stringify(writes[i]),args[1]]);
     assert.equal(receipt.digest,baseline.digest);
     assert.equal(baseline.identical,true);
    }
    digests.push(receipt.digest);
    if(i<writes.length-1){await reject(publish);assert.equal((await client.query("select count(*)::int n from analytics.cpd_product_sales_facts where installation_id=$1",[owner.installationId])).rows[0].n,0);}
   }
   await reject(()=>client.query("update pg_temp.adstable_google_daily_report_stage set digest=repeat('0',64);" ).then(publish));
   if(verifyPackageReuse&&scenario.rows===1000){
    for(const mutation of [
     "canonical_payload=canonical_payload||' '",
     "canonical_rows='[]'",
     "body=jsonb_set(body,'{version}',to_jsonb('tampered'::text))",
    ])await reject(()=>client.query(`update pg_temp.adstable_google_daily_report_stage set ${mutation} where package_ordinal=0`).then(publish),
     /GOOGLE_REPORT_PACKAGE_VERIFICATION_FAILED/);
    const privateAccess=await client.query(`select has_function_privilege('adstable_refresh_dataset_runner',
     'analytics.eo05_google_write_verified_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb,jsonb)','execute') allowed`);
    assert.equal(privateAccess.rows[0].allowed,false);
   }
   const result=(await publish()).rows[0].result;
   assert.equal(result.version,"google-daily-receipt-v1");assert.equal(result.rowCount,rows.length);assert.equal(result.packages.length,writes.length);
   assert.deepEqual((await rpc(GOOGLE_DAILY_INSPECT_SQL,[args[0],operationId])).rows[0].result,result);
   const finish=hash=>rpc(GOOGLE_DAILY_FINISH_SQL,[args[0],job,fence,operationId,hash]);
   assert.equal((await finish("f".repeat(64))).rows[0].result,false);
   assert.equal((await finish(result.digest)).rows[0].result,true);
   assert.equal((await client.query("select status from operations.refresh_runs where workspace_id=$1 and fence=$2",[owner.workspaceId,fence])).rows[0].status,"completed");
   const replacement=scenario.rows===1000 && !verifyWriterPreparation && !verifyPackageReuse
    ? await verifyGoogleDailyReplacement(client,{owner,first:result,rpc,reject,day}) : null;
   cases.push({rows:rows.length,packages:writes.length,receipt:true,closed:true,...replacement?{replacement}:{}});
  } finally {await client.query("rollback to savepoint google_daily_case");await client.query("release savepoint google_daily_case");}
 }
 return {synthetic:true,rollbackOnly:true,cases};
}
