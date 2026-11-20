import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {EventEmitter} from "node:events";
import {createFourPhaseDiagnostics} from "../tools/eo05-four-phase-diagnostics.mjs";
import {loadSingleReportCloseCandidate,singleReportCloseSql,singleReportCloseSource} from "../tools/eo05-single-report-close-probe.mjs";
import {klaviyoQuotaContextSource,klaviyoQuotaProfileSource,reuseGoogleProfileOids,reuseVerifiedRawHash,loadKlaviyoRawHashCandidate} from "../tools/eo05-final-synthetic-candidate.mjs";
import {GOOGLE_SOURCE_ROLE_CHECK_SQL} from "../app/lib/database/google-source-postgres.server.js";
import {GOOGLE_ACCEPTANCE_COORDINATOR_ROLE_CHECK_SQL} from "../app/lib/database/google-acceptance-coordinator-postgres.server.js";
import {collectComparableReportTiming,installComparableReportTiming} from "../tools/eo05-klaviyo-daily-timing-probe.mjs";
import {assertGoogleTimingTarget,googleTimingParameter,createGoogleTimingLedger,loadObservedGoogleReader,googleCollectionCallKind,summarizeGoogleCollection,summarizeGoogleReportWrite,summarizeGooglePublishTrace,installGoogleFactTriggerTrace,summarizeGoogleFactTriggerTrace,installGoogleWriterPreparationCandidate,installGooglePackageReuseCandidate,installGooglePublishTrace} from "../tools/eo05-google-daily-timing-probe.mjs";

test("single-close rehearsal keeps the locked inspection and compares the exact receipt for both providers",async()=>{
 const source=readFileSync(new URL("../app/lib/database/dataset-reconciliation.server.js",import.meta.url),"utf8").replaceAll("\r\n","\n");
 const candidate=singleReportCloseSource(source);
 for(const [provider,migration] of [["google","20261119112554_eo05_google_daily_packages.sql"],["klaviyo","20261117183725_eo05_klaviyo_report_package_staging.sql"]]){
  assert.ok(!candidate.includes(`database.query(${provider.toUpperCase()}_DAILY_INSPECT_SQL`));
  assert.ok(candidate.includes(`${provider.toUpperCase()}_DAILY_FINISH_SQL,[ownerJson,admittedScope.jobId,admittedScope.fence,operationId,JSON.stringify(receipt)]`));
  const sql=readFileSync(new URL(`../supabase/migrations/${migration}`,import.meta.url),"utf8");
  const finish=sql.slice(sql.indexOf(`create function analytics.finish_${provider}_daily_report_job(`)).split("end $fn$;")[0];
  const changed=singleReportCloseSql(finish);
  assert.match(changed,/r is distinct from h::jsonb/);
  assert.equal(changed,finish.replace("h is null or h !~ '^[0-9a-f]{64}$'","h is null or jsonb_typeof(h::jsonb) is distinct from 'object'").replace("r->>'digest' is distinct from h","r is distinct from h::jsonb"));
  assert.ok(changed.indexOf("for update")<changed.indexOf(`r:=analytics.inspect_${provider}_daily_report`));
  assert.ok(changed.indexOf("r is distinct from h::jsonb")<changed.indexOf("return operations.finish_refresh_work_before_stops"));
  const client={connectionParameters:{host:"127.0.0.1",port:54322},async query(_sql,args){return args?{rows:[{definition:finish}]}:{rows:[]};}};
  assert.equal(typeof (await loadSingleReportCloseCandidate(client,provider)).runScheduledRefreshWithDataset,"function");
 }
 await assert.rejects(loadSingleReportCloseCandidate({connectionParameters:{host:"remote",port:54322}},"google"));
});

test("final candidate keeps fresh profile, quota, and authenticated raw content checks",async()=>{
 for(const profile of [GOOGLE_SOURCE_ROLE_CHECK_SQL,GOOGLE_ACCEPTANCE_COORDINATOR_ROLE_CHECK_SQL]){
  const candidate=reuseGoogleProfileOids(profile);
  assert.match(candidate,/required_rpc as materialized/);
  assert.equal(candidate.match(/to_regprocedure\(s\.signature\)/g)?.length,1);
  assert.match(candidate,/s\.oid is null or not coalesce\(has_function_privilege\(current_user,s\.oid,'EXECUTE'\),false\)/);
  assert.match(candidate,/has_table_privilege/);
 }
 const read=path=>readFileSync(new URL(path,import.meta.url),"utf8").replaceAll("\r\n","\n");
 const context=read("../supabase/migrations/20261028132721_eo05a_admin_quota_context.sql");
 const changedContext=klaviyoQuotaContextSource(context);
 assert.match(changedContext,/p_target='klaviyo' and p_provider='klaviyo'/);
 assert.match(changedContext,/p\.fence=p_fence and p\.stage='request_intent'/);
 assert.equal(changedContext.match(/not operations\.refresh_entitlement_is_current/g)?.length,1);
 const route=read("../supabase/migrations/20261020152516_eo05a_quota_scope_resolver.sql");
 const changedRoute=klaviyoQuotaProfileSource(route,route);
 assert.match(changedRoute,/having count\(\*\) between 1 and 16 and bool_and\(q.provider=op.provider\)/);
 assert.match(changedRoute,/p\.quota_fingerprint=encode\(sha256\(convert_to\(string_agg\(/);
 assert.match(changedRoute,/API_QUOTA_ROUTE_CHANGED/);
 for(const provider of ["google","klaviyo"]){
  const before=read(`../app/lib/database/${provider}-dataset-source-store.server.js`);
  const after=reuseVerifiedRawHash(before);
  assert.equal(after,before.replace("const payload=cipher.open","cipher.open").replace("sourcePayloadHash(payload)!==sourcePayloadHash(plain)","expected.payloadHash!==sourcePayloadHash(plain)"));
  assert.match(after,/if\(extra.length\)fail\(\)/);
 }
 assert.equal(typeof (await loadKlaviyoRawHashCandidate()).storeKlaviyoRawProductPackages,"function");
});

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
 const trace={rows:1000,bindings:1000,references:1300,ownerMs:200,bindingMs:120,sourceMs:950,triggerMs:1850};
 assert.deepEqual(summarizeGoogleFactTriggerTrace(trace,1000,5800),{...trace,measuredMs:1270,otherTriggerMs:580});
 assert.throws(()=>summarizeGoogleFactTriggerTrace({...trace,bindings:999},1000,5800));
 assert.throws(()=>summarizeGoogleFactTriggerTrace({...trace,references:999},1000,5800));
 assert.throws(()=>summarizeGoogleFactTriggerTrace(trace,1000,1200));
 assert.throws(()=>summarizeGoogleFactTriggerTrace({...trace,triggerMs:1100},1000,5800));
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

test("comparable report timers recognize the persisted Google SQL anchors",async()=>{
 const paths=["20261119112554_eo05_google_daily_packages.sql","20261110191004_eo05d_dataset_reconciliation.sql"];
 const migrations=paths.map(path=>readFileSync(new URL("../supabase/migrations/"+path,import.meta.url),"utf8").replace(/\r\n/g,"\n")).join("\n");
 const statements=[];
 const client={connectionParameters:{host:"127.0.0.1",port:54322},async query(sql,args){
  if(sql.startsWith("select pg_get_functiondef")){
   const name=(args?.[0]??"analytics.validate_dataset_fact()").split("(")[0].replace(".","\\.");
   const definition=migrations.match(new RegExp("create (?:or replace )?function "+name+"\\([\\s\\S]*?end \\$fn\\$;","i"))?.[0];
   assert.ok(definition,args?.[0]??sql);
   return {rows:[{definition}]};
  }
  statements.push(sql);
 }};
 await installComparableReportTiming(client,"google");
 assert.equal(statements.length,8);
 assert.ok(statements.some(sql=>sql.includes("EO05_REPORT_COMPARABLE physicalVerification")&&sql.includes("report_comparison_result:=analytics.check_google_daily_report_facts")));
});

test("comparable report rollup allocates repeated stage checks without double counting",async()=>{
 const client=new EventEmitter();
 client.query=async()=>({rows:[{triggerMs:8}]});
 const timing=collectComparableReportTiming(client);
 const note=(prefix,phase,value)=>client.emit("notice",{message:`${prefix} ${phase} ${value}`});
 for(const [phase,value] of Object.entries({publisherAuthority:8,publisherSources:4,publisherWriter:44,publisherReceipt:3,writerSetup:3,writerPackages:30,physicalVerification:7})){
  note("EO05_REPORT_COMPARABLE",phase,value);
 }
 for(const value of [5,2])note("EO05_REPORT_COMPARABLE","stageValidation",value);
 for(let i=0;i<5;i++)for(const [phase,value] of Object.entries({lookupLock:0.2,packageValidation:1,packageJsonSize:0.4,packageHash:0.2,sourceRetention:0.4,rowValidation:0.1,rowHash:0.3,rowPreparation:0.4,bulkStatement:2,packageReceipt:0.1})){
  note("EO05_WRITER_TIMING",phase,value);
 }
 const r=await timing.result(70,10);
 assert.equal(r.authorityMs,7);
 assert.equal(r.packageValidationMs,20);
 assert.equal(r.physicalVerificationMs,5);
 assert.equal(r.lookupAndInsertMs,2);
 assert.ok(Math.abs(r.writerMs+r.authorityMs+r.packageValidationMs+r.sharedSourcesMs+r.physicalVerificationMs+r.receiptMs+r.remainderMs-r.reportWriteMs)<0.001);
 timing.stop();
 assert.equal(client.listenerCount("notice"),0);
});

test("Google package reuse keeps the audited stage, private writer and physical check connected",async()=>{
 const migration=readFileSync(new URL("../supabase/migrations/20261119112554_eo05_google_daily_packages.sql",import.meta.url),"utf8").replace(/\r\n/g,"\n");
 const signatures={
  commit_google_daily_package:"o jsonb, p jsonb",
  check_google_daily_report_facts:"o jsonb, c jsonb, d timestamp with time zone, operation uuid, policy jsonb, digests jsonb",
  write_google_staged_first_report_day:"o jsonb, c jsonb, d timestamp with time zone, operation uuid, policy jsonb, digests jsonb",
 };
 const installed=[];
 const client={connectionParameters:{host:"127.0.0.1",port:54322},async query(sql,args){
  if(!sql.startsWith("select pg_get_functiondef")){installed.push(sql);return;}
  const name=args[0].split("(")[0].slice("analytics.".length);
  if(name==="eo05_google_write_verified_day"||name==="publish_google_staged_report_day"){
   const previous=installed.findLast(sql=>sql.includes(`FUNCTION analytics.${name}(`)||sql.startsWith(`create function analytics.${name}(`));
   if(previous)return {rows:[{definition:previous}]};
  }
  const fn=new RegExp("create function analytics\\."+name+"\\([\\s\\S]*?end \\$fn\\$;","i");
  let definition=migration.match(fn)?.[0];
  assert.ok(definition,name);
  if(name==="commit_google_daily_package"){
   const previous=installed.findLast(sql=>sql.startsWith("CREATE OR REPLACE FUNCTION analytics.commit_google_daily_package("));
   if(previous)return {rows:[{definition:previous}]};
  }
  if(signatures[name]){
   definition=definition.replace(/^create function [^(]+\([^)]*\)/,`CREATE OR REPLACE FUNCTION analytics.${name}(${signatures[name]})`)
    .replace(/language plpgsql security definer/i,"LANGUAGE plpgsql\n SECURITY DEFINER");
  }
  if(name==="stage_google_daily_report_package"){
   definition=definition.replace("  package_digest text;","  package_digest text;\n  package_bytes bytea;")
    .replace("  row_count:=jsonb_array_length(p->'rows');","  row_count:=jsonb_array_length(p->'rows');\n  package_bytes:=convert_to(analytics.google_daily_json(jsonb_build_object('write',p,'context',c)),'UTF8');");
  }
  if(name==="write_google_staged_first_report_day"){
   definition=definition.replace("  has_facts boolean;","  has_facts boolean;\n  verified_binding text:='fixture';")
    .replace("  perform analytics.verify_google_daily_report_stage(o,c,d,operation,policy,digests);",`  if pg_catalog.to_regclass('pg_temp.adstable_google_daily_report_stage') is null then
   perform analytics.verify_google_daily_report_stage(o,c,d,operation,policy,digests);
  end if;`);
  }
  return {rows:[{definition}]};
 }};
 await installGooglePackageReuseCandidate(client);
 const publish=installed.at(-1), checker=installed.find(sql=>sql.includes("FUNCTION analytics.eo05_google_check_verified_facts"));
 assert.match(publish,/verified_summary:=analytics\.verify_google_daily_report_stage/);
 assert.match(publish,/proof:=analytics\.eo05_google_write_verified_day/);
 assert.match(checker,/summary:=verified_summary/);
 assert.match(checker,/GOOGLE_REPORT_FACT_READBACK_MISMATCH/);
 assert.match(installed.at(-2),/revoke all on function.*eo05_google_commit_verified_package/);
 installed.length=0;
 await installGoogleWriterPreparationCandidate(client);
 await installGooglePackageReuseCandidate(client);
 const combined=installed.find(sql=>sql.includes("FUNCTION analytics.eo05_google_commit_verified_package"));
 assert.match(combined,/jsonb_agg\(body order by ordinal\)/);
 assert.match(combined,/eo05_google_package_from_rows\(p,verified_rows,0\)/);
 assert.match(combined,/DATASET_DECIMAL_INVALID/);
 await installGooglePublishTrace(client,{packageReuse:true});
 assert.match(installed.at(-2),/trace_checked:=analytics\.eo05_google_check_verified_facts/);
 assert.match(installed.at(-1),/trace_call_writer:=clock_timestamp\(\);\n proof:=analytics\.eo05_google_write_verified_day/);
});

test("four phase diagnostics measure nested closure work and empty-page checks in both providers",async()=>{
 for(const [provider,file] of [
  ["google","20261119112554_eo05_google_daily_packages.sql"],
  ["klaviyo","20261117183725_eo05_klaviyo_report_package_staging.sql"],
 ]){
  const migration=readFileSync(new URL("../supabase/migrations/"+file,import.meta.url),"utf8").replace(/\r\n/g,"\n");
  const client=new EventEmitter(),installed=[];
  client.connectionParameters={host:"127.0.0.1",port:54322};
  client.query=async(sql,args)=>{
   if(!sql.startsWith("select pg_get_functiondef")){installed.push(sql);return;}
   const name=args[0].split("(")[0];
   const definition=migration.match(new RegExp(`create function ${name.replace(".","\\.")}\\([\\s\\S]*?end \\$fn\\$;`))?.[0];
   assert.ok(definition,name);
   return {rows:[{definition}]};
  };
  const timing=await createFourPhaseDiagnostics(client,provider);
  assert.equal(installed.length,2);
  const sample=async()=>({rows:[{result:[1]}]});
  const empty=async()=>({rows:[{result:[]}]});
  await timing.query("providerCollection","select current_user as role",[],sample);
  for(const op of ["reserve","settle"])await timing.query("providerCollection",`select operations.${op}_shared_api_quota($1)`,[],sample);
  await timing.query("rawStore",`select evidence.commit_${provider}_dataset_source($1)`,[],sample);
  const pages="select evidence.read_source_pages($1)";
  await timing.query("rawStore",pages,[null,null,null,"0",1],sample);
  await timing.query("rawStore",pages,[null,null,null,"1",1],empty);
  for(const phase of ["receiptReadback","jobClose"]){
   const op=phase==="receiptReadback"?`inspect_${provider}_daily_report`:`finish_${provider}_daily_report_job`;
   await timing.query(phase,`select analytics.${op}($1)`,[],async()=>{
    const notes=phase==="receiptReadback"?{receiptLookup:0,fingerprint:0}:
      {lockAcquisition:0,repeatedInspection:0,receiptLookup:0,fingerprint:0,finalUpdate:0};
    for(const [key,value] of Object.entries(notes))client.emit("notice",{message:`EO05_FOUR_PHASE ${key} ${value}`});
    return sample();
   });
  }
  const result=timing.result({providerCollection:500,rawStore:500,receiptReadback:500,jobClose:500},1);
  assert.equal(result.calls.rawStore.pages.count,1);
  assert.equal(result.calls.rawStore.extraPage.count,1);
  assert.equal(result.calls.providerCollection.quota.count,2);
  timing.close();
  assert.equal(client.listenerCount("notice"),0);
 }
});
