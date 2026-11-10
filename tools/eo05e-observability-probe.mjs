import assert from "node:assert/strict";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {reconcileStoredDatasetSources} from "../app/lib/database/dataset-reconciliation.server.js";
import {readRefreshObservation} from "../app/lib/refresh/observability.server.js";

// Actual SQL/AEAD/physical receipt checks in existing localhost F01 rollback.
// All owners, pages and clocks synthetic. No live metrics/notification claim.
export async function observabilityProbe(client,{ownerFixture}) {
 assert.equal(process.env.GITHUB_ACTIONS,"true");let scenarios=0;
 for(const provider of ["google_ads","meta","klaviyo"]) {
  const owner=await ownerFixture(client,provider),input={database:client,owner,businessDate:"2026-11-01",timeZone:"UTC"};
  let result=await readRefreshObservation(input);
  assert.equal(result.status,"observed");assert.equal(result.snapshot.freshness.status,"missing");assert.equal(result.snapshot.freshness.isZero,null);scenarios++;
  const stored=await storedBindingFixture(client,owner,{nonempty:false});
  const key=provider==="google_ads"?"googleDatasetRead":provider==="meta"?"metaDatasetRead":"klaviyoDatasetRead";
  const stamp=new Date(Date.now()-1000).toISOString();
  for(const b of stored.batches) await client.query("update evidence.source_batches set manifest=jsonb_set(jsonb_set(manifest,$3::text[],to_jsonb($4::text)),$5::text[],to_jsonb($4::text)) where authority=$1::jsonb and attempt_id=$2::uuid",
   [JSON.stringify(owner),b.attemptId,[key,"observedAt"],stamp,[key,"completedAt"]]);
  result=await readRefreshObservation(input);assert.equal(result.snapshot.freshness.status,"missing","raw saved != Dataset fresh");scenarios++;
  const committed=await reconcileStoredDatasetSources({...stored,database:client,expectedRevision:0,limits:{...stored.limits,deadlineAt:Date.now()+60000}});
  assert.equal(committed.consumerReceipt,true);
  const before=(await client.query("select id::text,manifest,handoff_state from evidence.source_batches where authority=$1::jsonb order by id",[JSON.stringify(owner)])).rows;
  result=await readRefreshObservation(input);
  assert.equal(result.status,"observed");assert.equal(result.snapshot.freshness.status,"verified");assert.equal(result.snapshot.freshness.isZero,true);
  assert.equal(result.snapshot.freshness.rowCount,0);assert.ok(result.snapshot.freshness.lastVerifiedAtMs>0);scenarios++;
  assert.deepEqual((await client.query("select id::text,manifest,handoff_state from evidence.source_batches where authority=$1::jsonb order by id",[JSON.stringify(owner)])).rows,before);scenarios++;
  assert.equal(result.snapshot.resources.scope,"database_cumulative_not_tenant_attribution");
  assert.match(result.snapshot.resources.databaseBytes,/^\d+$/);assert.equal(result.snapshot.resources.diskIOPS,"unknown");
  assert.equal(result.snapshot.reconciliation.status,"unknown");assert.equal(result.snapshot.liveMonitoringActive,false);scenarios++;
  assert.equal((await readRefreshObservation({...input,owner:{...owner,generation:String(Number(owner.generation)+1)}})).status,"unavailable");scenarios++;
  assert.equal((await readRefreshObservation({...input,timeZone:"Invalid/Clock"})).status,"unavailable");scenarios++;
  assert.equal((await readRefreshObservation({...input,businessDate:"2026-11-02"})).snapshot.freshness.status,"missing");scenarios++;
  for(const id of ["workspaceId","accountId","credentialId","shopDomain","installationId"]) assert.equal(Object.hasOwn(result.snapshot,id),false);
  await client.query("savepoint observation_unknown_job");
  const fence=(await client.query("select coalesce(max(fence),0)+1 f from operations.refresh_runs")).rows[0].f;
  await client.query(`insert into operations.refresh_runs(workspace_id,install_generation,provider,account_id,job_id,fence,cost,status)
   values($1,$2,$3,$4,'synthetic-observation-job',$5,'{"requests":1,"dbWrites":1,"connections":1,"rows":1,"bytes":1}','running')`,[owner.workspaceId,owner.generation,provider,owner.accountId,fence]);
  await client.query(`insert into operations.refresh_work_stops(workspace_id,install_generation,provider,account_id,job_id,fence,version,state,reason,call_state,source,action)
   values($1,$2,$3,$4,'synthetic-observation-job',$5,1,'uncertain','request_outcome_unknown','unknown','unknown','verify_execution_stopped')`,[owner.workspaceId,owner.generation,provider,owner.accountId,fence]);
  const unknown=await readRefreshObservation(input);assert.equal(unknown.snapshot.jobs[0].stopState,"uncertain");assert.equal(unknown.snapshot.jobs[0].budgetIsActualUsage,false);
  assert.equal((await client.query("select status from operations.refresh_runs where fence=$1",[fence])).rows[0].status,"running");scenarios++;
  await client.query("rollback to savepoint observation_unknown_job");await client.query("release savepoint observation_unknown_job");
  await client.query("savepoint observation_bad_digest");
  await client.query("update evidence.source_batches set manifest=jsonb_set(manifest,'{datasetReconciliation,digest}',to_jsonb(repeat('f',64))) where authority=$1::jsonb and manifest ? 'datasetReconciliation'",[JSON.stringify(owner)]);
  const invalid=await readRefreshObservation(input);assert.equal(invalid.snapshot.freshness.status,"unavailable");assert.equal(invalid.snapshot.freshness.isZero,null);scenarios++;
  await client.query("rollback to savepoint observation_bad_digest");await client.query("release savepoint observation_bad_digest");
 }
 for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator","adstable_google_source_runner","adstable_meta_source_runner","adstable_klaviyo_source_runner"]) {
  for(const signature of ["operations.read_refresh_observation(jsonb,date,text)","operations.read_refresh_queue_witness()"]) {
   assert.equal((await client.query("select coalesce((select has_function_privilege(r.oid,$2,'EXECUTE') from pg_roles r where rolname=$1),false) allowed",[role,signature])).rows[0].allowed,false);scenarios++;
  }
 }
 assert.equal((await client.query("select operations.read_refresh_queue_witness() result")).rows[0].result,null);scenarios++;
 console.log("EO05E_OBSERVABILITY_PROBE",JSON.stringify({scenarios,rollbackOnly:true,actualSQL:true,syntheticOwners:true,rawNotFreshness:true,knownEmptyVerified:true,noLiveActivation:true}));
}
