import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assertGoogleTimingTarget,googleTimingParameter,createGoogleTimingLedger,loadObservedGoogleReader,googleCollectionCallKind,summarizeGoogleCollection,summarizeGoogleReportWrite,summarizeGooglePublishTrace,installGoogleFactTriggerTrace,summarizeGoogleFactTriggerTrace,installGoogleWriterPreparationCandidate} from "../tools/eo05-google-daily-timing-probe.mjs";

test("Google measurement refuses production, alternate project/host and unbound users",()=>{
 assert.equal(assertGoogleTimingTarget({host:"127.0.0.1",port:54322}),"local");
 assert.equal(assertGoogleTimingTarget({host:"aws-1-eu-central-1.pooler.supabase.com",port:5432,user:"adstable_benchmark_google_r1.lxphenczjmueblnonklm"}),"nano");
 for(const c of [{host:"127.0.0.1",port:5432},{host:"aws-1-eu-central-1.pooler.supabase.com",port:6543,user:"adstable_benchmark_google_r1.lxphenczjmueblnonklm"},
  {host:"aws-0-eu-central-1.pooler.supabase.com",port:5432,user:"adstable_benchmark_google_r1.lxphenczjmueblnonklm"},
  {host:"aws-1-eu-central-1.pooler.supabase.com",port:5432,user:"postgres.lxphenczjmueblnonklm"},
  {host:"aws-1-eu-central-1.pooler.supabase.com",port:5432,user:"adstable_benchmark_google_r1.podpwkrpmjiksskxhwsu"}])assert.throws(()=>assertGoogleTimingTarget(c));
});
test("role adapter preserves parameter bytes, nulls and escaped PostgreSQL arrays",()=>{
 assert.equal(googleTimingParameter(Buffer.from([0,255])),"\\x00ff");assert.equal(googleTimingParameter(null),null);
 assert.equal(googleTimingParameter(["a(b,c)",'a"b',"a\\b"]),'{"a(b,c)","a\\"b","a\\\\b"}');
 assert.equal(googleTimingParameter({decimal:"9007199254740993.125"}),'{"decimal":"9007199254740993.125"}');
});
test("outer ledger partitions source DB calls once and preserves the total",async()=>{
 let t=0;const l=createGoogleTimingLedger(()=>t);l.start();t=3;l.phaseAt("queueAndAdmission");t=7;l.phaseAt("reportPreparation");
 await l.sql(async()=>{t=12;},"dataset");t=15;l.phaseAt("reportWrite");await l.sql(async()=>{t=30;},"dataset");
 t=32;l.phaseAt("receiptReadback");t=35;l.phaseAt("jobClose");t=40;const r=l.stop();
 assert.equal(r.totalMs,40);assert.equal(r.postgresCallWallMs,20);assert.equal(r.durationsMs.reportSourceRead,5);assert.equal(r.durationsMs.reportPreparation,3);
 assert.equal(Object.values(r.durationsMs).reduce((a,b)=>a+b,0),40);
});
test("collection diagnostics partition call wall time without calling the residual network time", () => {
 const calls = [
  {sql:"select current_user as role, true as profile_ready",wallMs:5,sqlMs:2},
  {sql:"select operations.reserve_shared_api_quota($1)",wallMs:8,sqlMs:6},
  {sql:"savepoint sample; set local statement_timeout = '5000ms'",wallMs:4,sqlMs:null},
  {sql:"select * from integrations.load_provider_identity_authority($1)",wallMs:7,sqlMs:1},
 ].map(({sql,...call})=>({...call,kind:googleCollectionCallKind(sql)}));
 const result=summarizeGoogleCollection(calls,30);
 assert.equal(result.databaseWallMs,24);
 assert.equal(result.outsideDatabaseCallsMs,6);
 assert.deepEqual(result.groups.roleProfile,{calls:1,wallMs:5,sqlTimedCalls:1,sqlMs:2,residualMs:3,untimedWallMs:0});
 assert.equal(result.groups.quota.residualMs,2);
 assert.deepEqual(result.quotaDetails.quotaReserve,result.groups.quota);
 assert.equal(result.quotaDetails.quotaContext.calls,0);
 for(const [sql,kind] of [
  ["select operations.load_refresh_quota_context($1)","quotaContext"],
  ["select operations.resolve_shared_api_quota_route($1)","quotaRoute"],
  ["select operations.settle_shared_api_quota($1)","quotaSettle"],
 ]) assert.equal(googleCollectionCallKind(sql),kind);
 assert.equal(result.groups.transactionControl.untimedWallMs,4);
 assert.equal(result.groups.other.residualMs,6);
});

test("storage observations load a fresh module without changing production source bytes",async()=>{
 const p=new URL("../app/lib/refresh/google-raw-datasets.server.js",import.meta.url),before=readFileSync(p);
 const reader=await loadObservedGoogleReader({raw(){}});assert.equal(typeof reader,"function");
 assert.deepEqual(readFileSync(p),before);delete globalThis[Symbol.for("adstable.google.nano.stage-observer")];
});

test("combined candidate loads its alternate raw store without editing tracked source",async()=>{
 const p=new URL("../app/lib/database/google-dataset-source-store.server.js",import.meta.url),before=readFileSync(p);
 try{
  const reader=await loadObservedGoogleReader({raw(){}},true);
  assert.equal(typeof reader,"function");
  assert.deepEqual(readFileSync(p),before);
 }finally{delete globalThis[Symbol.for("adstable.google.nano.stage-observer")];}
});

test("report breakdown counts only stage and publish, leaving connection overhead in the existing total",()=>{
 const calls=[
  {kind:"dataset",from:0,to:2},
  {kind:"reportStage",from:2,to:7},
  {kind:"reportStage",from:7,to:11},
  {kind:"reportPublish",from:12,to:26},
  {kind:"dataset",from:28,to:34},
 ];
 assert.deepEqual(summarizeGoogleReportWrite(calls,26),{
  stageCalls:2,stageCallWallMs:9,publishCalls:1,publishCallWallMs:14,otherReportWriteMs:3,reportWriteMs:26,
 });
});

test("publication trace partitions nested writer time without double counting",()=>{
 const writer="EO05_GOOGLE_WRITER_TRACE "+JSON.stringify({writerSetupMs:5,physicalWriteMs:30,physicalVerificationMs:10});
 const publish="EO05_GOOGLE_PUBLISH_TRACE "+JSON.stringify({
  scopeAndStageMs:7,sourcesAndRetentionMs:3,writerCallMs:46,receiptAndHandoffMs:4,publishSqlMs:60,
 });
 const result=summarizeGooglePublishTrace([writer,publish]);
 assert.equal(result.publishSqlMs,60);
 assert.equal(result.writerBoundaryOverheadMs,1);
 assert.equal(result.physicalWriteMs,30);
 assert.throws(()=>summarizeGooglePublishTrace([writer,publish,writer]));
 assert.throws(()=>summarizeGooglePublishTrace([writer,publish.replace('"publishSqlMs":60','"publishSqlMs":58')]));
});

test("fact trigger trace checks row coverage and reconciles with the enclosing write",()=>{
 const trace={rows:1000,bindings:1000,references:1300,ownerMs:200,bindingMs:120,sourceMs:950};
 assert.deepEqual(summarizeGoogleFactTriggerTrace(trace,1000,5800),{...trace,measuredMs:1270});
 assert.throws(()=>summarizeGoogleFactTriggerTrace({...trace,bindings:999},1000,5800));
 assert.throws(()=>summarizeGoogleFactTriggerTrace({...trace,references:999},1000,5800));
 assert.throws(()=>summarizeGoogleFactTriggerTrace(trace,1000,1200));
});

test("fact trigger diagnostics match the real validator and refuse hosted installation",async()=>{
 const migration=readFileSync(new URL("../supabase/migrations/20261110191004_eo05d_dataset_reconciliation.sql",import.meta.url),"utf8").replace(/\r\n/g,"\n");
 const definition=migration.match(/create or replace function analytics\.validate_dataset_fact\(\)[\s\S]*?end \$fn\$;/)[0];
 const calls=[];
 const client={connectionParameters:{host:"127.0.0.1",port:54322},async query(sql){
  calls.push(sql);
  return {rows:[{definition}]};
 }};
 await installGoogleFactTriggerTrace(client);
 assert.equal(calls.length,3);
 assert.match(calls[1],/trace_source_ms:=trace_source_ms\+/);
 assert.match(calls[1],/select source into original_source from operations\.refresh_work_bindings/);
 await assert.rejects(installGoogleFactTriggerTrace({...client,connectionParameters:{
  host:"aws-1-eu-central-1.pooler.supabase.com",port:5432,user:"adstable_benchmark_google_r1.lxphenczjmueblnonklm",
 }}));
 assert.equal(calls.length,3);
});

test("Google writer preparation targets the real package writer and preserves validation and ordering",async()=>{
 const migration=readFileSync(new URL("../supabase/migrations/20261119112554_eo05_google_daily_packages.sql",import.meta.url),"utf8").replace(/\r\n/g,"\n");
 const definition=migration.match(/create function analytics\.commit_google_daily_package\(o[\s\S]*?end \$fn\$;/)[0];
 const calls=[];
 const client={connectionParameters:{host:"127.0.0.1",port:54322},async query(sql){
  calls.push(sql);
  return {rows:[{definition}]};
 }};
 await installGoogleWriterPreparationCandidate(client);
 assert.equal(calls.length,2);
 assert.doesNotMatch(calls[1],/bulk_rows/);
 assert.match(calls[1],/jsonb_agg\(body order by ordinal\)/);
 for(const guard of ["DATASET_ROW_SHAPE_INVALID","DATASET_DECIMAL_INVALID","DATASET_PAYLOAD_DIGEST_INVALID","DATASET_NATIVE_CONFLICT"]){
  assert.ok(calls[1].includes(guard));
 }
});
