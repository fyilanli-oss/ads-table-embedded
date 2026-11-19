import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {projectStoredGoogleDataset} from "../app/lib/providers/stored-dataset-projection.server.js";
import {prepareDailyDatasetPackages} from "../app/lib/database/dataset-reconciliation.server.js";
import {resolveReportRetentionPolicy} from "../app/lib/database/report-retention-policy.server.js";
import {GOOGLE_DAILY_STAGE_SQL,GOOGLE_DAILY_PUBLISH_SQL,GOOGLE_DAILY_INSPECT_SQL,GOOGLE_DAILY_FINISH_SQL} from "../app/lib/database/dataset-rpc.server.js";

// Synthetic source fixtures, real AEAD/readback, physical facts and daily RPCs.
// Caller owns the outer rollback transaction; no native HTTP or durable data.
export async function googleDailyPackagesProbe(client,{ownerFixture}) {
 assert.equal(client.connectionParameters.host,"127.0.0.1");
 assert.equal(Number(client.connectionParameters.port),54322);
 const cases=[];
 for(const payload of ['{}','[]','null','{"n":9007199254740993,"d":1.2300,"x":[true,null,"é"]}']){
  const r=(await client.query("select analytics.dataset_json($1::jsonb) a,analytics.google_daily_json($1::jsonb) b,analytics.dataset_digest($1::jsonb) h,analytics.google_daily_digest($1::jsonb) g",[payload])).rows[0];
  assert.equal(r.a,r.b);assert.equal(r.h,r.g);
 }
 for(const nonempty of [true,false]){
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
   const input=await storedBindingFixture(client,owner,{nonempty,googleProducts:250});
   const job="synthetic-binding-job",day="2026-11-01",deadlineAt=Date.now()+120000,deadline=new Date(deadlineAt).toISOString();
   const fence=(await client.query("select (coalesce(max(fence),0)+1)::text n from operations.refresh_runs")).rows[0].n;
   const scope=[owner.workspaceId,owner.generation,"google_ads",owner.accountId,job,fence];
   await client.query(`update operations.refresh_work_bindings set fence=$6,deadline_at_ms=$7,source=operations.refresh_preflight_source($1,$2,$3,$4)
    where workspace_id=$1 and install_generation=$2 and provider=$3 and account_id=$4 and job_id=$5`,[...scope,deadlineAt]);
   for(const b of input.batches)await client.query(`update evidence.source_batches set manifest=jsonb_set(jsonb_set(jsonb_set(manifest,
    '{googleDatasetRead,fence}',to_jsonb($3::text)),'{googleDatasetRead,observedAt}',to_jsonb($4::text)),'{googleDatasetRead,completedAt}',to_jsonb($4::text))
    where authority=$1::jsonb and attempt_id=$2`,[JSON.stringify(owner),b.attemptId,fence,new Date(Date.now()-1000).toISOString()]);
   await client.query(`insert into operations.refresh_runs(workspace_id,install_generation,provider,account_id,job_id,fence,cost,status)
    values($1,$2,$3,$4,$5,$6,'{"requests":18,"rows":1000,"bytes":1000000,"connections":1,"dbWrites":20}','running')`,scope);
   await client.query(`insert into operations.refresh_work_progress(workspace_id,install_generation,provider,account_id,job_id,fence,stage,from_date,to_date)
    values($1,$2,$3,$4,$5,$6,'ready_for_dataset',$7,$7)`,[...scope,day]);
   const bundle=await readStoredDatasetSources({...input,limits:{...input.limits,deadlineAt,maxBytes:16000000}});
   const rows=projectStoredGoogleDataset(bundle).rows;assert.equal(rows.length,nonempty?501:0);
   const operationId=randomUUID(),policy=resolveReportRetentionPolicy({businessDate:day,timeZone:"UTC"});
   const context={expectedRevision:0,businessDate:day,timeZone:"UTC",sourceContext:bundle.datasets[0].sourceContext,
    sources:bundle.datasets.flatMap(d=>d.pages.map(p=>p.ref)),batchIds:bundle.datasets.flatMap(d=>(d.packageReceipts??[d.receipt]).map(r=>r.batchId)),
    startedAt:new Date(Date.now()-1000).toISOString(),completedAt:new Date().toISOString()};
   const writes=prepareDailyDatasetPackages({owner,rows,policy,operationId,now:new Date().toISOString(),context,maxPackages:20});
   const args=[JSON.stringify(owner),JSON.stringify(context),deadline,operationId,JSON.stringify(policy)];
   const digests=[];
   const rpc=async(sql,parameters)=>{await client.query("set local role adstable_refresh_dataset_runner");const result=await client.query(sql,parameters);await client.query("set local role adstable_owner");return result;};
   assert.equal((await client.query("select has_function_privilege('adstable_refresh_dataset_runner','analytics.commit_google_daily_package(jsonb,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
   const publish=()=>rpc(GOOGLE_DAILY_PUBLISH_SQL,[...args,JSON.stringify(digests)]);
   async function reject(run){await client.query("savepoint google_daily_negative");let e;try{await run();}catch(error){e=error;}finally{await client.query("rollback to savepoint google_daily_negative");await client.query("release savepoint google_daily_negative");}assert.ok(e);}
   for(let i=0;i<writes.length;i++){
    const receipt=(await rpc(GOOGLE_DAILY_STAGE_SQL,[args[0],JSON.stringify(writes[i]),args[1],deadline,i,writes.length])).rows[0].result;
    digests.push(receipt.digest);
    if(i<writes.length-1){await reject(publish);assert.equal((await client.query("select count(*)::int n from analytics.cpd_product_sales_facts where installation_id=$1",[owner.installationId])).rows[0].n,0);}
   }
   await reject(()=>client.query("update pg_temp.adstable_google_daily_report_stage set digest=repeat('0',64);" ).then(publish));
   const result=(await publish()).rows[0].result;
   assert.equal(result.version,"google-daily-receipt-v1");assert.equal(result.rowCount,rows.length);assert.equal(result.packages.length,writes.length);
   assert.deepEqual((await rpc(GOOGLE_DAILY_INSPECT_SQL,[args[0],operationId])).rows[0].result,result);
   const finish=hash=>rpc(GOOGLE_DAILY_FINISH_SQL,[args[0],job,fence,operationId,hash]);
   assert.equal((await finish("f".repeat(64))).rows[0].result,false);
   assert.equal((await finish(result.digest)).rows[0].result,true);
   assert.equal((await client.query("select status from operations.refresh_runs where workspace_id=$1 and fence=$2",[owner.workspaceId,fence])).rows[0].status,"completed");
   cases.push({rows:rows.length,packages:writes.length,receipt:true,closed:true});
  } finally {await client.query("rollback to savepoint google_daily_case");await client.query("release savepoint google_daily_case");}
 }
 return {synthetic:true,rollbackOnly:true,cases};
}
