import assert from "node:assert/strict";
import {createGooglePmaxHistoryLoader,GOOGLE_PMAX_HISTORY_FIND_SQL} from "../app/lib/database/google-pmax-history.server.js";
import {createConfiguredSourceEvidenceCipher} from "../app/lib/database/source-evidence-config.server.js";
import {createGoogleSourcePostgresClient} from "../app/lib/database/google-source-postgres.server.js";

// Existing rollback-only F01 scenario supplies its connected local SQL client.
// No URL lookup, native HTTP, schedule or live role provisioning.
export async function googlePmaxHistoryProbe(client,{environment,poolFactory,batchId,businessDate,expectedListingRows}) {
 assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
 await client.query("savepoint pmax_history_probe");
 try{
  const b=(await client.query("select authority,attempt_id::text,batch_ordinal from evidence.source_batches where id=$1",[batchId])).rows[0];assert.ok(b);
  const options={environment,poolFactory},args=[JSON.stringify(b.authority),businessDate,5];
  const denied=createGoogleSourcePostgresClient({...options,historyMode:true});
  await assert.rejects(denied.query(GOOGLE_PMAX_HISTORY_FIND_SQL,args),/DATABASE_UNAVAILABLE/);await denied.close();
  for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
   assert.equal((await client.query("select has_function_privilege($1,'evidence.find_google_pmax_source_batches(jsonb,date,integer)','EXECUTE') ok",[role])).rows[0].ok,false);
  await client.query("grant execute on function evidence.find_google_pmax_source_batches(jsonb,date,integer) to adstable_google_source_runner");
  const database=createGoogleSourcePostgresClient({...options,historyMode:true});
  const limits={maxBatches:4,maxPages:100,maxRows:20000,maxBytes:8388608,maxElapsedMs:10000};
  const load=async(owner=b.authority)=>createGooglePmaxHistoryLoader({database,cipher:createConfiguredSourceEvidenceCipher(environment),limits})
   .load({owner,businessDate,timezone:"UTC",deadlineAt:Date.now()+10000});
  const r=await load();assert.equal(r.status,"observed_history_only");assert.equal(r.snapshots.length,1);
  assert.equal(r.snapshots[0].batch_id,batchId);assert.equal(r.complete,false);assert.equal(r.snapshots[0].valid_from,null);
  assert.equal(r.snapshots[0].rows.length,expectedListingRows);
  assert.equal(r.historical_coverage_verified,false);assert.equal(r.DatasetWritePerformed,false);
  // The same narrowly known read grant does not break the existing dataset profile.
  const existing=createGoogleSourcePostgresClient({...options,datasetMode:true});
  assert.equal((await existing.query("select evidence.read_source_receipt($1::jsonb,$2::uuid,$3::integer) as result",
   [JSON.stringify(b.authority),b.attempt_id,0])).rows[0].result.status,"committed");await existing.close();
  await client.query("savepoint pmax_wrong_owner");
  await assert.rejects(client.query(GOOGLE_PMAX_HISTORY_FIND_SQL,[JSON.stringify({...b.authority,generation:"999"}),businessDate,5]));
  await client.query("rollback to savepoint pmax_wrong_owner");await client.query("release savepoint pmax_wrong_owner");
  const otherDate=new Date(Date.parse(businessDate)+86400000).toISOString().slice(0,10);
  assert.deepEqual((await database.query(GOOGLE_PMAX_HISTORY_FIND_SQL,[JSON.stringify(b.authority),otherDate,5])).rows[0].result,[]);
  // Expired and privacy-invalidated evidence cannot be resurrected by readback.
  await client.query("update evidence.source_pages set retain_until=statement_timestamp()-interval '1 second' where batch_id=$1",[batchId]);
  assert.equal((await load()).status,"unavailable");
  await client.query("update evidence.source_batches set storage_state='invalidated',commit_id=null,committed_at=null,manifest=manifest||'{\"privacyRedacted\":true}'::jsonb where id=$1",[batchId]);
  assert.equal((await load()).status,"unavailable");
  await database.close();
  console.log("EO05_PMAX_HISTORY_SQL_PASS existing_encrypted_shelves=true exact_owner_and_day=true expiry_privacy_and_role_denial=true no_validity_inferred=true native_HTTP=0 live_changes=false");
 }finally{await client.query("rollback to savepoint pmax_history_probe");await client.query("release savepoint pmax_history_probe");}
}
