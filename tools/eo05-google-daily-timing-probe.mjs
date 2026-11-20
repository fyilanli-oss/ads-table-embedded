import assert from "node:assert/strict";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {collectComparableReportTiming,installComparableReportTiming} from "./eo05-klaviyo-daily-timing-probe.mjs";
import {registerHooks} from "node:module";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {runScheduledRefreshWithDataset} from "../app/lib/refresh/scheduled-queue-check.server.js";
import {loadGoogleBackgroundOwner} from "../app/lib/refresh/google-background-owner.server.js";
import {createTokenVault} from "../app/lib/oauth/token-vault.server.js";
import {createTokenEnvelopeCipher,readProviderTokenKeyring} from "../app/lib/oauth/token-envelope.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createConfiguredSourceEvidenceCipher} from "../app/lib/database/source-evidence-config.server.js";
import {buildGoogleReportingQueries} from "../app/lib/providers/google-reporting.server.js";
import {googleDatasetNativeRows} from "../tests/fixtures/dataset-source-binding-fixture.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {googleSourceRoleInstallationBodyForRehearsal} from "./eo05-google-source-role-plan.mjs";
import {GOOGLE_ACCEPTANCE_COORDINATOR_ROLE_CHECK_SQL,GOOGLE_ACCEPTANCE_COORDINATOR_RPC} from "../app/lib/database/google-acceptance-coordinator-postgres.server.js";
import {GOOGLE_DAILY_STAGE_SQL,GOOGLE_DAILY_PUBLISH_SQL,GOOGLE_DAILY_INSPECT_SQL,GOOGLE_DAILY_FINISH_SQL} from "../app/lib/database/dataset-rpc.server.js";

export const GOOGLE_TIMING_ROLES=Object.freeze(["adstable_owner","adstable_runtime","adstable_refresh_coordinator","adstable_refresh_queue_runner","adstable_google_source_runner","adstable_refresh_dataset_runner"]);
export const GOOGLE_TIMING_STEPS=Object.freeze(["queueEnqueue","queueAndAdmission","providerCollection","rawStore","handoff","reportSourceRead","reportPreparation","reportWrite","receiptReadback","jobClose"]);
const observationKey=Symbol.for("adstable.google.nano.stage-observer");
const sourceUrl=new URL("../app/lib/refresh/google-raw-datasets.server.js",import.meta.url);

export function assertGoogleTimingTarget(connection){
 const local=connection.host==="127.0.0.1"&&Number(connection.port)===54322;
 const nano=connection.host==="aws-1-eu-central-1.pooler.supabase.com"&&Number(connection.port)===5432
  &&/^adstable_benchmark_google_[a-z0-9]+\.lxphenczjmueblnonklm$/.test(connection.user??"");
 assert.ok(local||nano,"GOOGLE_TIMING_ISOLATED_TARGET_REQUIRED");return local?"local":"nano";
}

export async function prepareGoogleTimingLocalRoles(client){
 assert.equal(assertGoogleTimingTarget(client.connectionParameters),"local");
 await client.query("set local role postgres");
 const present=(await client.query("select exists(select 1 from pg_roles where rolname='adstable_google_source_runner') present")).rows[0].present;
 if(!present)await client.query(googleSourceRoleInstallationBodyForRehearsal());
 await client.query("set local role postgres");
 await client.query(readFileSync(new URL("./sql/eo05-google-dataset-source-role-extension.sql",import.meta.url),"utf8").replace(/^begin;\s*$/m,"").replace(/^commit;\s*$/m,""));
 await client.query("set local role postgres");
 await client.query("grant "+GOOGLE_TIMING_ROLES.filter(r=>r!=="adstable_owner").join(",")+" to adstable_owner with inherit false,set true,admin false");
 await client.query("set local role adstable_owner");
}

export function googleTimingParameter(value){
 if(value===null||value===undefined)return null;
 if(Buffer.isBuffer(value))return "\\x"+value.toString("hex");
 if(value instanceof Date)return value.toISOString();
 if(Array.isArray(value))return "{"+value.map(v=>'"'+String(v).replaceAll("\\","\\\\").replaceAll('"','\\"')+'"').join(",")+"}";
 return typeof value==="object"?JSON.stringify(value):String(value);
}

export function createGoogleTimingLedger(clock=()=>performance.now()){
 const durations=Object.fromEntries(GOOGLE_TIMING_STEPS.map(k=>[k,0])),calls=[],spans=[];
 let phase=null,stamp=0,started=0,ended=0,rawReturns=0;
 return {durations,calls,get phase(){return phase;},
  start(){assert.equal(phase,null);started=stamp=clock();phase="queueEnqueue";},
  phaseAt(next,at=clock()){assert.ok(GOOGLE_TIMING_STEPS.includes(next));assert.ok(at>=stamp);spans.push({phase,from:stamp,to:at});durations[phase]+=at-stamp;phase=next;stamp=at;},
  raw(active){this.phaseAt(active?"rawStore":"providerCollection");if(!active)rawReturns++;},
  async sql(run,kind=null){const begin=clock();try{return await run();}finally{if(phase!==null)calls.push({from:begin,to:clock(),kind});}},
  stop(){ended=clock();spans.push({phase,from:stamp,to:ended});durations[phase]+=ended-stamp;phase=null;
   const reads=calls.filter(c=>c.kind==="dataset").reduce((n,c)=>n+spans.filter(s=>s.phase==="reportPreparation").reduce((v,s)=>v+Math.max(0,Math.min(s.to,c.to)-Math.max(s.from,c.from)),0),0);
   durations.reportPreparation-=reads;durations.reportSourceRead+=reads;
   return {totalMs:ended-started,durationsMs:{...durations},postgresCallWallMs:calls.reduce((n,c)=>n+c.to-c.from,0),rawDatasets:rawReturns};}
 };
}

export function summarizeGoogleReportWrite(calls, reportWriteMs) {
 const stage = calls.filter(call=>call.kind==="reportStage");
 const publish = calls.filter(call=>call.kind==="reportPublish");
 const wall = entries=>entries.reduce((total,{from,to})=>total+to-from,0);
 const stageCallWallMs=wall(stage),publishCallWallMs=wall(publish);
 const otherReportWriteMs=reportWriteMs-stageCallWallMs-publishCallWallMs;
 assert.ok(otherReportWriteMs>=-0.01);
 return {stageCalls:stage.length,stageCallWallMs,publishCalls:publish.length,publishCallWallMs,otherReportWriteMs,reportWriteMs};
}

const rawStoreUrl=new URL("../app/lib/database/google-dataset-source-store.server.js",import.meta.url);

export function googleCombinedReadbackSource(source) {
 let result=replaceOnce(source,'let cursor="0",seen=0;','let cursor="0",seen=0,checkedEnd=false;');
 result=replaceOnce(result,'  const stored=await repository.readPages({owner,attemptId,ordinal,after:cursor,limit:Math.min(100,write.body.pages.length-seen)});',
  `  const remaining=write.body.pages.length-seen;
  const limit=Math.min(100,remaining+1);
  const stored=await repository.readPages({owner,attemptId,ordinal,after:cursor,limit});
  if(stored.length>remaining)fail();
  checkedEnd=limit>remaining&&stored.length===remaining;`);
 return replaceOnce(result,' const extra=await repository.readPages({owner,attemptId,ordinal,after:cursor,limit:1});if(extra.length)fail();',
  ' if(!checkedEnd){const extra=await repository.readPages({owner,attemptId,ordinal,after:cursor,limit:1});if(extra.length)fail();}');
}

// Both modes use the same outer observations. Only the approved candidate
// loads a fresh raw-store module with the bounded final page check combined.
export async function loadObservedGoogleReader(ledger,combinedCandidate=false){
 assert.equal(globalThis[observationKey],undefined);globalThis[observationKey]=ledger;
 const original=readFileSync(sourceUrl,"utf8");
 const start="const save=async(dataset,pages,complete,reason=null)=>{";
 const end="datasets[dataset]={status:complete?\"stored\":\"unavailable\",reason,recordCount:complete?recordCount:null,empty:complete?recordCount===0:null,...receipt};";
 assert.equal(original.split(start).length,2);assert.equal(original.split(end).length,2);
 let transformed=original.replace(start,()=>start+'globalThis[Symbol.for("adstable.google.nano.stage-observer")].raw(true);')
  .replace(end,()=>end+'globalThis[Symbol.for("adstable.google.nano.stage-observer")].raw(false);');
 const id=randomUUID();
 const storeCandidateUrl=rawStoreUrl.href+"?googleTiming="+id;
 if(combinedCandidate)transformed=replaceOnce(transformed,'"../database/google-dataset-source-store.server.js"',JSON.stringify(storeCandidateUrl));
 const storeSource=combinedCandidate?googleCombinedReadbackSource(readFileSync(rawStoreUrl,"utf8")):null;
 const hooks=registerHooks({load(url,context,next){
  if(url===sourceUrl.href+"?googleTiming="+id)return {format:"module",source:transformed,shortCircuit:true};
  if(storeSource&&url===storeCandidateUrl)return {format:"module",source:storeSource,shortCircuit:true};
  return next(url,context);
 }});
 try{return (await import(sourceUrl.href+"?googleTiming="+id)).createGoogleRawDatasetReader;}
 catch(error){delete globalThis[observationKey];throw error;}
 finally{hooks.deregister();}
}

const quotaKinds = Object.freeze({
 load_refresh_quota_context:"quotaContext",
 resolve_shared_api_quota_route:"quotaRoute",
 reserve_shared_api_quota:"quotaReserve",
 settle_shared_api_quota:"quotaSettle",
});

export function googleCollectionCallKind(sql) {
 if (/^select current_user as role\b/i.test(sql)) return "roleProfile";
 const operation=/^select operations\.([a-z_]+)\(/i.exec(sql)?.[1]?.toLowerCase();
 if(Object.hasOwn(quotaKinds,operation))return quotaKinds[operation];
 if (/^(savepoint |release savepoint |rollback to savepoint |select pg_catalog\.set_config\()/i.test(sql)) return "transactionControl";
 return "other";
}

export function summarizeGoogleCollection(calls, collectionMs) {
 const empty = () => ({calls:0,wallMs:0,sqlTimedCalls:0,sqlMs:0,residualMs:0,untimedWallMs:0});
 const groups = {roleProfile:empty(),quota:empty(),transactionControl:empty(),other:empty()};
 const quotaDetails = Object.fromEntries(Object.values(quotaKinds).map(kind=>[kind,empty()]));
 let databaseWallMs = 0;
 function add(group,wallMs,sqlMs) {
  group.calls++;
  group.wallMs += wallMs;
  if (sqlMs === null) {
   group.untimedWallMs += wallMs;
  } else {
   assert.ok(Number.isFinite(sqlMs) && sqlMs >= 0);
   group.sqlTimedCalls++;
   group.sqlMs += sqlMs;
   group.residualMs += wallMs - sqlMs;
  }
 }
 for (const {kind, wallMs, sqlMs} of calls) {
  const detail = quotaDetails[kind];
  const group = detail ? groups.quota : groups[kind];
  assert.ok(group && Number.isFinite(wallMs) && wallMs >= 0);
  add(group,wallMs,sqlMs);
  if(detail)add(detail,wallMs,sqlMs);
  databaseWallMs += wallMs;
 }
 assert.ok(databaseWallMs <= collectionMs + 0.01);
 return {groups,quotaDetails,databaseWallMs,outsideDatabaseCallsMs:collectionMs-databaseWallMs};
}

// An opt-in clock measures execution inside the same temporary invoker. It
// returns aggregate inputs without issuing an extra database request.
async function installRoleAdapter(client, collectionDiagnostics){
 const argument = collectionDiagnostics ? ",measure boolean" : "";
 const type = collectionDiagnostics ? ",boolean" : "";
 await client.query(`create function pg_temp.eo05_google_role_query(target text,statement text,parameters jsonb${argument})
 returns jsonb language plpgsql security invoker set search_path='' as $fn$
 declare previous text:=current_user;payload jsonb;${collectionDiagnostics ? "started timestamptz;" : ""}
 begin
  if target<>all(array['adstable_owner','adstable_runtime','adstable_refresh_coordinator','adstable_refresh_queue_runner','adstable_google_source_runner','adstable_refresh_dataset_runner'])
   or statement !~* '^select ' or position(';' in statement)>0 then raise exception 'GOOGLE_TEST_ADAPTER_SCOPE';end if;
  ${collectionDiagnostics ? "if measure then started:=clock_timestamp(); end if;" : ""}
  execute format('set local role %I',target);
  execute 'select coalesce(jsonb_agg(to_jsonb(output)),''[]''::jsonb) from ('||statement||') output' into payload using parameters;
  execute format('set local role %I',previous);
  ${collectionDiagnostics ? "if measure then return jsonb_build_object('rows',payload,'sqlMs',extract(epoch from (clock_timestamp()-started))*1000); end if;" : ""}
  return payload;
 end $fn$`);
 await client.query(`revoke all on function pg_temp.eo05_google_role_query(text,text,jsonb${type}) from public,anon,authenticated,service_role`);
}

const quotaSignature="uuid,bigint,text,text,text,bigint,date,date,text,timestamptz";
const claimSignature="uuid,bigint,text,text,text,bigint";
const currentClaim="operations.refresh_claim_is_current(p_workspace,p_generation,p_provider,p_account,p_job,p_fence)";

function replaceOnce(text, anchor, replacement) {
 assert.equal(text.split(anchor).length,2,"GOOGLE_QUOTA_COMPARISON_DEFINITION_CHANGED");
 return text.replace(anchor,()=>replacement);
}

const functionDefinition=async(client,signature)=>(await client.query(
 "select pg_get_functiondef($1::regprocedure) definition",[signature])).rows[0].definition;

async function installGoogleQuotaClaimReuse(client,combinedCandidate=false) {
 assertGoogleTimingTarget(client.connectionParameters);
 const definition=signature=>functionDefinition(client,signature);
 const sqlBody=async(name,signature)=>{
  const body=(await definition(`operations.${name}(${signature})`)).split("$function$");
  assert.equal(body.length,3,"GOOGLE_QUOTA_COMPARISON_BODY_CHANGED");
  return replaceOnce(body[1].trim(),currentClaim,"common_claim");
 };
 const authority=await sqlBody("load_refresh_bound_authority",`${claimSignature},date,date`);
 const installation=await sqlBody("load_refresh_entitlement_installation",claimSignature);
 const entitlement=await sqlBody("refresh_entitlement_is_current",`${claimSignature},timestamptz`);
 const baseName="operations.load_refresh_quota_context_before_merchant";
 const signature=`(${quotaSignature})`;
 const tempBase="pg_temp.eo05_quota_context_reuse_base";
 const tempOuter="pg_temp.eo05_quota_context_reuse";
 let base=replaceOnce(await definition(baseName+signature),`FUNCTION ${baseName}(`,`FUNCTION ${tempBase}(`);
 base=replaceOnce(base,"SECURITY DEFINER","SECURITY INVOKER");
 base=replaceOnce(base,"declare authority jsonb;","declare common_claim boolean; authority jsonb;");
 base=replaceOnce(base,"  authority:=operations.load_refresh_bound_authority(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_from,p_to);",
  `  if p_provider is distinct from 'google_ads' or p_target is distinct from 'google_ads' then return null; end if;
  common_claim:=${currentClaim};
  if common_claim is distinct from true then return null; end if;
  authority:=(${authority});`);
 base=replaceOnce(base,"operations.load_refresh_entitlement_installation(p_workspace,p_generation,p_provider,p_account,p_job,p_fence)",`(${installation})`);
 base=replaceOnce(base,"operations.refresh_entitlement_is_current(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_observed)",`(${entitlement})`);
 // The original claim clock runs once. Reject a deadline crossed while
 // checking the remaining predicates, before returning any quota context.
 base=replaceOnce(base,"  return jsonb_build_object('provider',cfg.provider",
  `  if not exists(select 1 from operations.refresh_work_bindings b
    where b.workspace_id=p_workspace and b.install_generation=p_generation and b.provider=p_provider
      and b.account_id=p_account and b.job_id=p_job and b.fence=p_fence
      and b.deadline_at_ms>floor(extract(epoch from clock_timestamp())*1000)::bigint) then return null; end if;
  return jsonb_build_object('provider',cfg.provider`);
 assert.equal(base.split(currentClaim).length,2);
 let outer=await definition("operations.load_refresh_quota_context"+signature);
 if(combinedCandidate){
  const originalCall=`base:=${baseName}(p_workspace,p_generation,p_provider,p_account,p_job,p_fence,p_from,p_to,p_target,p_observed);`;
  outer=replaceOnce(outer,originalCall,`if p_provider='google_ads' and p_target='google_ads' then
    ${originalCall.replace(baseName,tempBase)}
  else
    ${originalCall}
  end if;`);
 }else{
  outer=replaceOnce(outer,"FUNCTION operations.load_refresh_quota_context(",`FUNCTION ${tempOuter}(`);
  outer=replaceOnce(outer,"SECURITY DEFINER","SECURITY INVOKER");
  outer=replaceOnce(outer,baseName,tempBase);
 }
 await client.query(base);
 await client.query(outer);
 const restricted=combinedCandidate?`${tempBase}${signature}`:`${tempBase}${signature}, ${tempOuter}${signature}`;
 await client.query(`revoke all on function ${restricted} from public,anon,authenticated,service_role`);
 return tempOuter;
}

async function compareGoogleQuotaClaimReuse(client,{claim,window,entitlementReceipt}) {
 assert.equal(assertGoogleTimingTarget(client.connectionParameters),"local");
 await client.query("savepoint google_quota_comparison");
 try{
  const tempOuter=await installGoogleQuotaClaimReuse(client);
  const args=[claim.workspaceId,claim.installGeneration,"google_ads",claim.accountId,claim.id,String(claim.fence),
   window.from,window.to,"google_ads",entitlementReceipt.observedAt];
  const placeholders=quotaSignature.split(",").map((type,i)=>`$${i+1}::${type}`).join(",");
  const read=async(name,parameters)=>{
   const start=performance.now();
   const {rows:[{value}]}=await client.query(`select ${name}(${placeholders}) value`,parameters);
   return {value,ms:performance.now()-start};
  };
  const original="operations.load_refresh_quota_context";
  const parity=async(parameters,allowed)=>{
   const reference=await read(original,parameters),candidate=await read(tempOuter,parameters);
   assert.deepEqual(candidate.value,reference.value);
   assert.equal(reference.value!==null,allowed);
  };
  const changed=(index,value)=>args.map((parameter,i)=>i===index?value:parameter);
  await parity(args,true);
  await parity(changed(4,"wrong-synthetic-job"),false);
  await parity(changed(5,String(BigInt(claim.fence)+1n)),false);
  await parity(changed(6,"2026-10-30"),false);
  await parity(changed(9,"2100-01-01T00:00:00Z"),false);
  const samples=[];
  for(let i=0;i<6;i++){
   const order=i%2?[tempOuter,original]:[original,tempOuter];
   const first=await read(order[0],args),second=await read(order[1],args);
   assert.ok(first.value);
   assert.deepEqual(first.value,second.value);
   samples.push(i%2?{originalMs:second.ms,candidateMs:first.ms}:{originalMs:first.ms,candidateMs:second.ms});
  }
  const expired=await client.query("update operations.refresh_work_bindings set deadline_at_ms=1 where workspace_id=$1 and job_id=$2 and fence=$3",args.filter((_,i)=>[0,4,5].includes(i)));
  assert.equal(expired.rowCount,1);
  await parity(args,false);
  console.log("EO05_GOOGLE_QUOTA_CLAIM_REUSE_PASS",JSON.stringify({correctnessChecks:6,samples,localOnly:true,rollbackOnly:true,rpcOnly:true}));
 }finally{
  await client.query("rollback to savepoint google_quota_comparison");
  await client.query("release savepoint google_quota_comparison");
 }
}

export async function installGoogleCombinedCandidate(client) {
 assertGoogleTimingTarget(client.connectionParameters);
 const encoding=(await client.query("show server_encoding")).rows[0].server_encoding;
 assert.equal(encoding,"UTF8");
 await installGoogleQuotaClaimReuse(client,true);
 let stage=await functionDefinition(client,"analytics.stage_google_daily_report_package(jsonb,jsonb,jsonb,timestamptz,integer,integer)");
 stage=replaceOnce(stage,"  package_digest text;","  package_digest text;\n  package_bytes bytea;");
 stage=replaceOnce(stage,"  row_count:=jsonb_array_length(p->'rows');",
  "  row_count:=jsonb_array_length(p->'rows');\n  package_bytes:=convert_to(analytics.google_daily_json(jsonb_build_object('write',p,'context',c)),'UTF8');");
 stage=replaceOnce(stage,"octet_length(analytics.google_daily_json(jsonb_build_object('write',p,'context',c)))","octet_length(package_bytes)");
 stage=replaceOnce(stage,"package_digest:=analytics.google_daily_digest(jsonb_build_object('write',p,'context',c));",
  "package_digest:=encode(sha256(package_bytes),'hex');");
 await client.query(stage);
 let write=await functionDefinition(client,"analytics.write_google_staged_first_report_day(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)");
 const verify="  perform analytics.verify_google_daily_report_stage(o,c,d,operation,policy,digests);";
 write=replaceOnce(write,"  has_facts boolean;",`  has_facts boolean;
  verified_binding text:=analytics.google_daily_digest(jsonb_build_object(
    'owner',o,'context',c,'deadline',d,'operationId',operation,'policy',policy,'packageCount',jsonb_array_length(digests)));`);
 // The publisher verifies and locks before setting this owner-only flag.
 // The post-write physical verification still independently rechecks stage.
 write=replaceOnce(write,verify,`  if pg_catalog.to_regclass('pg_temp.adstable_google_daily_report_stage') is null then
${verify}
  elsif not exists(select 1 from pg_catalog.pg_class
    where oid=pg_catalog.to_regclass('pg_temp.adstable_google_daily_report_stage')
      and relnamespace=pg_catalog.pg_my_temp_schema() and relowner=current_user::regrole
      and relpersistence='t' and relkind='r') then
${verify}
  elsif (select count(*) from pg_temp.adstable_google_daily_report_stage) is distinct from jsonb_array_length(digests)::bigint
    or exists(select 1 from pg_temp.adstable_google_daily_report_stage staged
      where staged.daily_sources_verified is distinct from true
        or staged.digest is distinct from digests->>staged.package_ordinal
        or staged.day_binding is distinct from verified_binding) then
${verify}
  end if;`);
 await client.query(write);
}

export async function installGoogleWriterPreparationCandidate(client) {
 assert.equal(assertGoogleTimingTarget(client.connectionParameters),"local");
 let writer=await functionDefinition(client,"analytics.commit_google_daily_package(jsonb,jsonb)");
 writer=replaceOnce(writer," bulk_rows jsonb:='{}'; bulk_ids jsonb:='{}'; stored record;",` column_metadata jsonb:='{}'; table_metadata jsonb; numeric_columns text[];
 package_tables text[]:='{}'; package_rows jsonb[]:='{}';
 prepared_group record; bulk_ids jsonb:='{}'; stored record;`);
 const start=writer.indexOf("  select array_agg(attname::text order by attnum) into allowed");
 const end=writer.indexOf("   if r->k<>'null'::jsonb",start);
 assert.ok(start>=0&&end>start);
 const catalog=writer.slice(start,end);
 const exclusions=catalog.match(/and attname not in \([^)]+\)/)?.[0];
 assert.ok(exclusions);
 writer=replaceOnce(writer,catalog,`   table_metadata:=column_metadata->name;
   if table_metadata is null then
    select array_agg(attname::text order by attnum) filter (where true ${exclusions}),
      coalesce(array_agg(attname::text order by attnum) filter (where atttypid='numeric'::regtype),'{}')
    into allowed,numeric_columns
    from pg_catalog.pg_attribute
    where attrelid=('analytics.'||name)::regclass and attnum>0 and not attisdropped;
    column_metadata:=column_metadata||jsonb_build_object(name,
      jsonb_build_object('allowed',allowed,'numeric',numeric_columns));
   else
    allowed:=array(select jsonb_array_elements_text(table_metadata->'allowed'));
    numeric_columns:=array(select jsonb_array_elements_text(table_metadata->'numeric'));
   end if;
   if (select count(*) from jsonb_object_keys(r))<>cardinality(allowed) or not r ?& allowed then raise exception 'DATASET_ROW_SHAPE_INVALID';end if;
   foreach k in array numeric_columns loop
`);
 writer=replaceOnce(writer,"   bulk_rows:=jsonb_set(bulk_rows,array[name],coalesce(bulk_rows->name,'[]')||jsonb_build_array(injected));",`   package_tables:=array_append(package_tables,name);
   package_rows:=array_append(package_rows,injected);`);
 writer=replaceOnce(writer,`  for name in select jsonb_object_keys(bulk_rows) order by 1 loop
   select string_agg(quote_ident(key),',' order by key) into cols from jsonb_object_keys(bulk_rows->name->0) key;`,`  for prepared_group in
    select target_table,jsonb_agg(body order by ordinal) as payload
    from unnest(package_tables,package_rows) with ordinality as prepared(target_table,body,ordinal)
    group by target_table order by target_table
   loop
    name:=prepared_group.target_table;
    select string_agg(quote_ident(key),',' order by key) into cols from jsonb_object_keys(prepared_group.payload->0) key;`);
 writer=replaceOnce(writer,"using bulk_rows->name,p->'policy'","using prepared_group.payload,p->'policy'");
 await client.query(writer);
}

export async function installGooglePackageReuseCandidate(client) {
 assert.equal(assertGoogleTimingTarget(client.connectionParameters),"local");
 const dailyArgs="jsonb,jsonb,timestamptz,uuid,jsonb,jsonb";
 const read=(name,args)=>functionDefinition(client,`analytics.${name}(${args})`);
 const canonical="analytics.google_daily_json";
 const hash=text=>`encode(sha256(convert_to(${text},'UTF8')),'hex')`;
 const privateRoles="public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator,adstable_refresh_dataset_runner";
 const definitions=[];
 const privateCopy=(sql,from,to,param,after)=>{
  sql=replaceOnce(sql,`FUNCTION analytics.${from}(`,`FUNCTION analytics.${to}(`);
  sql=replaceOnce(sql,after,after.slice(0,-1)+`, ${param})`);
  return replaceOnce(sql," SECURITY DEFINER"," SECURITY INVOKER");
 };
 await client.query(`create function analytics.eo05_google_package_from_rows(p jsonb, rows_text text, depth integer)
  returns text language sql immutable strict set search_path='' as $fn$
   select '{"operationId":'||${canonical}(p->'operationId',depth+1)||
     ',"policy":'||${canonical}(p->'policy',depth+1)||',"rows":'||rows_text||
     ',"version":'||${canonical}(p->'version',depth+1)||'}'
  $fn$;
  revoke all on function analytics.eo05_google_package_from_rows(jsonb,text,integer) from ${privateRoles}`);
 const envelope=(body,rows)=>`'{"context":'||${canonical}(c,1)||',"write":'||analytics.eo05_google_package_from_rows(${body},${rows},1)||'}'`;
 let stage=await read("stage_google_daily_report_package","jsonb,jsonb,jsonb,timestamptz,integer,integer");
 stage=replaceOnce(stage,"  package_bytes bytea;","  package_bytes bytea;\n  canonical_rows text;");
 stage=replaceOnce(stage,"  package_bytes:=convert_to(analytics.google_daily_json(jsonb_build_object('write',p,'context',c)),'UTF8');",`
  if p ?& array['operationId','policy','rows','version'] and (select count(*) from jsonb_object_keys(p))=4 then
    canonical_rows:=${canonical}(p->'rows',2);
    package_bytes:=convert_to(${envelope("p","canonical_rows")},'UTF8');
    if octet_length(package_bytes)>1048576 then raise exception 'DATASET_JSON_BOUNDS';end if;
  else
    package_bytes:=convert_to(${canonical}(jsonb_build_object('write',p,'context',c)),'UTF8');
  end if;`);
 stage=replaceOnce(stage,"      body jsonb not null,","      body jsonb not null,\n      canonical_payload text not null,\n      canonical_rows text,");
 stage=replaceOnce(stage,"(package_ordinal,day_binding,body,digest)\n  values (ordinal,binding,p,package_digest);",`
    (package_ordinal,day_binding,body,canonical_payload,canonical_rows,digest)
  values (ordinal,binding,p,convert_from(package_bytes,'UTF8'),canonical_rows,package_digest);`);
 definitions.push(stage);
 let verify=await read("verify_google_daily_report_stage",dailyArgs);
 verify=replaceOnce(verify,"or s.digest is distinct from analytics.google_daily_digest(jsonb_build_object('write',s.body,'context',c))",`or s.digest is distinct from ${hash("s.canonical_payload")}
        or jsonb_send(s.canonical_payload::jsonb) is distinct from jsonb_send(jsonb_build_object('write',s.body,'context',c))
        or (s.canonical_rows is not null and s.canonical_payload collate "C" is distinct from
          (${envelope("s.body","s.canonical_rows")}) collate "C")`);
 definitions.push(verify);

 let commit=privateCopy(await read("commit_google_daily_package","jsonb,jsonb"),"commit_google_daily_package",
  "eo05_google_commit_verified_package","verified_rows text","(o jsonb, p jsonb)");
 commit=replaceOnce(commit,"declare item jsonb;","declare canonical_package text; item jsonb;");
 commit=replaceOnce(commit," or octet_length(analytics.google_daily_json(p))>1048576 then raise exception 'DATASET_INPUT_INVALID';end if;",` then raise exception 'DATASET_INPUT_INVALID';end if;
 canonical_package:=case when verified_rows is null then ${canonical}(p)
   else analytics.eo05_google_package_from_rows(p,verified_rows,0) end;
 if octet_length(canonical_package)>1048576 then raise exception 'DATASET_JSON_BOUNDS';end if;`);
 commit=replaceOnce(commit,"h:=analytics.google_daily_digest(p);",`h:=${hash("canonical_package")};`);
 definitions.push(commit);

 const args=" digests jsonb)";
 let checker=privateCopy(await read("check_google_daily_report_facts",dailyArgs),"check_google_daily_report_facts",
  "eo05_google_check_verified_facts","verified_summary jsonb",args);
 checker=replaceOnce(checker,"summary:=analytics.verify_google_daily_report_stage(o,c,d,operation,policy,digests);","summary:=verified_summary;");
 definitions.push(checker);
 let writer=privateCopy(await read("write_google_staged_first_report_day",dailyArgs),"write_google_staged_first_report_day",
  "eo05_google_write_verified_day","verified_summary jsonb",args);
 const bindingStart=writer.indexOf("  verified_binding text:=");
 const bindingEnd=writer.indexOf("  day date :=",bindingStart);
 assert.ok(bindingStart>=0&&bindingEnd>bindingStart);
 writer=replaceOnce(writer,writer.slice(bindingStart,bindingEnd),"");
 const guardStart=writer.indexOf("  if pg_catalog.to_regclass('pg_temp.adstable_google_daily_report_stage') is null then");
 const guardEnd=writer.indexOf("  if c->'expectedRevision' is distinct from",guardStart);
 assert.ok(guardStart>=0&&guardEnd>guardStart);
 writer=replaceOnce(writer,writer.slice(guardStart,guardEnd),"");
 writer=replaceOnce(writer,"for s in select body from pg_temp.adstable_google_daily_report_stage","for s in select body,canonical_rows from pg_temp.adstable_google_daily_report_stage");
 writer=replaceOnce(writer,"analytics.commit_google_daily_package(o,s.body||jsonb_build_object('operationId',gen_random_uuid()))",
  "analytics.eo05_google_commit_verified_package(o,s.body||jsonb_build_object('operationId',gen_random_uuid()),s.canonical_rows)");
 writer=replaceOnce(writer,"analytics.check_google_daily_report_facts(o,c,d,operation,policy,digests)",
  "analytics.eo05_google_check_verified_facts(o,c,d,operation,policy,digests,verified_summary)");
 definitions.push(writer);

 let publish=await read("publish_google_staged_report_day",dailyArgs);
 publish=replaceOnce(publish,"groups integer:=0;","groups integer:=0; verified_summary jsonb;");
 publish=replaceOnce(publish,"perform analytics.verify_google_daily_report_stage(o,c,d,operation,policy,digests);",
  "verified_summary:=analytics.verify_google_daily_report_stage(o,c,d,operation,policy,digests);");
 publish=replaceOnce(publish,"proof:=analytics.write_google_staged_first_report_day(o,c,d,operation,policy,digests);",
  "proof:=analytics.eo05_google_write_verified_day(o,c,d,operation,policy,digests,verified_summary);");
 for(const sql of definitions)await client.query(sql);
 await client.query(`revoke all on function analytics.eo05_google_commit_verified_package(jsonb,jsonb,text),
  analytics.eo05_google_check_verified_facts(${dailyArgs},jsonb),
  analytics.eo05_google_write_verified_day(${dailyArgs},jsonb) from ${privateRoles}`);
 await client.query(publish);
}

export async function installGoogleReportCandidate(client) {
 assertGoogleTimingTarget(client.connectionParameters);
 const canonical="analytics.google_daily_json(v,depth+1)";
 const scalar=`case when depth<32 and jsonb_typeof(v) in ('null','boolean','number','string')
  and octet_length(v::text)<=1048576 then v::text else ${canonical} end`;
 let json=await functionDefinition(client,"analytics.google_daily_json(jsonb,integer)");
 json=replaceOnce(json,`to_jsonb(k)::text||':'||${canonical}`,`to_jsonb(k)::text||':'||(${scalar})`);
 json=replaceOnce(json,`string_agg(${canonical},',' order by ordinal)`,`string_agg(${scalar},',' order by ordinal)`);
 await client.query(json);

 let write=await functionDefinition(client,"analytics.commit_google_daily_package(jsonb,jsonb)");
 write=replaceOnce(write," operation uuid; h text;"," package_bytes bytea;\n operation uuid; h text;");
 write=replaceOnce(write," or octet_length(analytics.google_daily_json(p))>1048576 then raise exception 'DATASET_INPUT_INVALID';end if;",
  ` then raise exception 'DATASET_INPUT_INVALID';end if;
 package_bytes:=convert_to(analytics.google_daily_json(p),'UTF8');
 if octet_length(package_bytes)>1048576 then raise exception 'DATASET_INPUT_INVALID';end if;`);
 write=replaceOnce(write,"h:=analytics.google_daily_digest(p);","h:=encode(sha256(package_bytes),'hex');");
 await client.query(write);
}

export async function proveGoogleReportCanonicalParity(client) {
 assert.equal(assertGoogleTimingTarget(client.connectionParameters),"local");
 const valid=[
  '{}','[]','null','{"z":[true,null,false],"a":{"e":1}}',
  '{"decimal":1.2300,"integer":9007199254740993,"negative":-42,"exponent":1e-8}',
  JSON.stringify({name:'é\n"\\\t',nested:[{b:[],a:{}},false,null],block:'a'.repeat(131072)}),
  "[".repeat(32)+"null"+"]".repeat(32),
  JSON.stringify(["a".repeat(1048572)]),
 ];
 const invalid=[
  ['{"nested":[{"secret":"blocked"}]}',"DATASET_PRIVATE_FIELD"],
  ['{"é":1}',"DATASET_PRIVATE_FIELD"],
  ["[".repeat(33)+"null"+"]".repeat(33),"DATASET_JSON_BOUNDS"],
  [JSON.stringify(["a".repeat(1048573)]),"DATASET_JSON_BOUNDS"],
  [JSON.stringify({s:"a".repeat(1048576)}),"DATASET_JSON_BOUNDS"],
 ];
 const read=async value=>(await client.query(
  "select analytics.google_daily_json($1::jsonb) canonical,analytics.google_daily_digest($1::jsonb) digest",[value])).rows[0];
 const rejection=async([value,code])=>{
  let failure;
  await client.query("savepoint google_report_canonical_negative");
  try{await read(value);}catch(error){failure=error;}
  finally{
   await client.query("rollback to savepoint google_report_canonical_negative");
   await client.query("release savepoint google_report_canonical_negative");
  }
  assert.equal(failure?.message,code);
 };
 const original=[];
 for(const value of valid)original.push(await read(value));
 for(const value of invalid)await rejection(value);
 await installGoogleReportCandidate(client);
 for(const [index,value] of valid.entries())assert.deepEqual(await read(value),original[index]);
 for(const value of invalid)await rejection(value);
 return {identical:valid.length,rejected:invalid.length};
}

const writerTracePrefix="EO05_GOOGLE_WRITER_TRACE ";
const publisherTracePrefix="EO05_GOOGLE_PUBLISH_TRACE ";
const elapsedSql=(from,to)=>`(extract(epoch from (${to}-${from}))*1000)::double precision`;

const triggerTraceSetting="adstable_probe.google_fact_trace";

// Keep one transaction-local aggregate instead of emitting a notice for every row.
export async function installGoogleFactTriggerTrace(client) {
 assert.equal(assertGoogleTimingTarget(client.connectionParameters),"local");
 let definition=await functionDefinition(client,"analytics.validate_dataset_fact()");
 definition=replaceOnce(definition,"permit jsonb;",`permit jsonb;
  trace_start timestamptz;
  trace_owner_ms double precision;
  trace_binding_ms double precision:=0;
  trace_source_ms double precision:=0;
  trace_refs integer;
  trace_counts jsonb;`);
 const start="\n select * into strict b from evidence.source_batches where workspace_id=new.workspace_id";
 definition=replaceOnce(definition,start,`\n trace_start:=clock_timestamp();
${start}`);
 const owner=" o:=b.authority; perform evidence.assert_source_owner(o);";
 definition=replaceOnce(definition,owner,`${owner}
  trace_owner_ms:=${elapsedSql("trace_start","clock_timestamp()")};`);
 const binding="  select source into original_source from operations.refresh_work_bindings";
 definition=replaceOnce(definition,binding,`   trace_start:=clock_timestamp();
${binding}`);
 const manifests="  for ref in select value from jsonb_array_elements(new.provenance->'sources') loop";
 definition=replaceOnce(definition,manifests,`   trace_binding_ms:=${elapsedSql("trace_start","clock_timestamp()")};
   trace_start:=clock_timestamp();
${manifests}`);
 const fx=" if new.provenance ? 'reporting_currency' or new.fx_engine_version=";
 definition=replaceOnce(definition,"  end loop;\n end if;\n"+fx,`  end loop;
   trace_source_ms:=${elapsedSql("trace_start","clock_timestamp()")};
 end if;
${fx}`);
 const sourceLoop=" for ref in select value from jsonb_array_elements(new.provenance->'sources') loop\n  perform analytics.assert_dataset_source";
 definition=replaceOnce(definition,sourceLoop,`  trace_start:=clock_timestamp();
${sourceLoop}`);
 const completeness=" if new.source_completeness is distinct from";
 definition=replaceOnce(definition,completeness,`  trace_source_ms:=trace_source_ms+${elapsedSql("trace_start","clock_timestamp()")};
${completeness}`);
 definition=replaceOnce(definition," return new;",` if tg_op='INSERT' and new.platform='google_ads' then
  trace_refs:=jsonb_array_length(new.provenance->'sources');
  trace_counts:=coalesce(nullif(current_setting('${triggerTraceSetting}',true),'')::jsonb,'{}'::jsonb);
  perform set_config('${triggerTraceSetting}',jsonb_build_object(
   'rows',coalesce((trace_counts->>'rows')::int,0)+1,
   'bindings',coalesce((trace_counts->>'bindings')::int,0)+(case when context is null then 0 else 1 end),
   'references',coalesce((trace_counts->>'references')::int,0)+trace_refs,
   'ownerMs',coalesce((trace_counts->>'ownerMs')::double precision,0)+trace_owner_ms,
   'bindingMs',coalesce((trace_counts->>'bindingMs')::double precision,0)+trace_binding_ms,
   'sourceMs',coalesce((trace_counts->>'sourceMs')::double precision,0)+trace_source_ms)::text,true);
 end if;
 return new;`);
 await client.query(definition);
 await client.query("select set_config($1,'{}',true)",[triggerTraceSetting]);
}

export function summarizeGoogleFactTriggerTrace(trace, rows, physicalWriteMs) {
 assert.deepEqual(Object.keys(trace).sort(),["bindingMs","bindings","ownerMs","references","rows","sourceMs"]);
 assert.equal(trace.rows,rows);
 assert.equal(trace.bindings,rows);
 assert.ok(Number.isInteger(trace.references)&&trace.references>=rows);
 const times=[trace.ownerMs,trace.bindingMs,trace.sourceMs];
 assert.ok(times.every(ms=>Number.isFinite(ms)&&ms>=0));
 const measuredMs=times.reduce((a,b)=>a+b,0);
 assert.ok(measuredMs<=physicalWriteMs+0.01);
 return {...trace,measuredMs};
}

async function installGooglePublishTrace(client) {
 assert.equal(assertGoogleTimingTarget(client.connectionParameters),"local");
 const signature="(jsonb,jsonb,timestamptz,uuid,jsonb,jsonb)";
 let writer=await functionDefinition(client,"analytics.write_google_staged_first_report_day"+signature);
 writer=replaceOnce(writer,"  has_facts boolean;",`  has_facts boolean;
  trace_writer_start timestamptz;
  trace_write_start timestamptz;
  trace_verify_start timestamptz;
  trace_writer_end timestamptz;
  trace_checked jsonb;`);
 const lock="  perform 1 from operations.refresh_control where singleton for update;";
 writer=replaceOnce(writer,lock,"  trace_writer_start:=clock_timestamp();\n"+lock);
 const loop="  for s in select body from pg_temp.adstable_google_daily_report_stage order by package_ordinal loop";
 writer=replaceOnce(writer,loop,"  trace_write_start:=clock_timestamp();\n"+loop);
 writer=replaceOnce(writer,"  return analytics.check_google_daily_report_facts(o,c,d,operation,policy,digests);",`
  trace_verify_start:=clock_timestamp();
  trace_checked:=analytics.check_google_daily_report_facts(o,c,d,operation,policy,digests);
  trace_writer_end:=clock_timestamp();
  raise notice '${writerTracePrefix}%',jsonb_build_object(
    'writerSetupMs',${elapsedSql("trace_writer_start","trace_write_start")},
    'physicalWriteMs',${elapsedSql("trace_write_start","trace_verify_start")},
    'physicalVerificationMs',${elapsedSql("trace_verify_start","trace_writer_end")});
  return trace_checked;`);
 await client.query(writer);
 let publish=await functionDefinition(client,"analytics.publish_google_staged_report_day"+signature);
 publish=replaceOnce(publish,"completed timestamptz;groups integer:=0;",`completed timestamptz;groups integer:=0;
 trace_publish_start timestamptz;
 trace_source_start timestamptz;
 trace_call_writer timestamptz;
 trace_receipt_start timestamptz;
 trace_publish_end timestamptz;`);
 const publishLock=" "+lock.trimStart();
 publish=replaceOnce(publish,"\n"+publishLock,"\n trace_publish_start:=clock_timestamp();\n"+publishLock);
 const source=" perform analytics.assert_report_source_context(o,c->'sourceContext',(policy->>'until')::timestamptz,c->'sources');";
 publish=replaceOnce(publish,source," trace_source_start:=clock_timestamp();\n"+source);
 const call=" proof:=analytics.write_google_staged_first_report_day(o,c,d,operation,policy,digests);";
 publish=replaceOnce(publish,call," trace_call_writer:=clock_timestamp();\n"+call+"\n trace_receipt_start:=clock_timestamp();");
 publish=replaceOnce(publish," return receipt;",` trace_publish_end:=clock_timestamp();
 raise notice '${publisherTracePrefix}%',jsonb_build_object(
   'scopeAndStageMs',${elapsedSql("trace_publish_start","trace_source_start")},
   'sourcesAndRetentionMs',${elapsedSql("trace_source_start","trace_call_writer")},
   'writerCallMs',${elapsedSql("trace_call_writer","trace_receipt_start")},
   'receiptAndHandoffMs',${elapsedSql("trace_receipt_start","trace_publish_end")},
   'publishSqlMs',${elapsedSql("trace_publish_start","trace_publish_end")});
 return receipt;`);
 await client.query(publish);
}

export function summarizeGooglePublishTrace(notices) {
 const read=(prefix,keys)=>{
  const matching=notices.filter(message=>message.startsWith(prefix));
  assert.equal(matching.length,1);
  const value=JSON.parse(matching[0].slice(prefix.length));
  assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
  assert.ok(Object.values(value).every(ms=>Number.isFinite(ms)&&ms>=0));
  return value;
 };
 const writer=read(writerTracePrefix,["writerSetupMs","physicalWriteMs","physicalVerificationMs"]);
 const publish=read(publisherTracePrefix,["scopeAndStageMs","sourcesAndRetentionMs","writerCallMs","receiptAndHandoffMs","publishSqlMs"]);
 const writerTotalMs=Object.values(writer).reduce((a,b)=>a+b,0);
 const writerBoundaryOverheadMs=publish.writerCallMs-writerTotalMs;
 assert.ok(writerBoundaryOverheadMs>=-0.01);
 assert.ok(Math.abs(publish.scopeAndStageMs+publish.sourcesAndRetentionMs+publish.writerCallMs+publish.receiptAndHandoffMs-publish.publishSqlMs)<0.01);
 return {...publish,...writer,writerBoundaryOverheadMs};
}

export async function googleDailyTimingProbe(client,{ownerFixture,collectionDiagnostics=false,quotaClaimComparison=false,combinedCandidate=false,reportCandidate=false,reportBreakdown=false,publishTrace=false,factTriggerTrace=false,writerPreparationCandidate=false,comparableReport=false,packageReuseCandidate=false}){
 const target=assertGoogleTimingTarget(client.connectionParameters);
 if(quotaClaimComparison)assert.equal(target,"local");
 assert.ok(!combinedCandidate||!quotaClaimComparison);
 assert.ok(!reportCandidate||combinedCandidate);
 assert.ok(!reportBreakdown||(combinedCandidate&&!reportCandidate));
 assert.ok(!publishTrace||(target==="local"&&reportBreakdown&&!collectionDiagnostics));
 assert.ok(!factTriggerTrace||publishTrace);
 assert.ok(!writerPreparationCandidate||(target==="local"&&combinedCandidate&&!reportCandidate));
 assert.ok(!packageReuseCandidate||(target==="local"&&reportBreakdown&&!publishTrace&&!comparableReport));
 assert.ok(!comparableReport||(target==="local"&&reportBreakdown&&!publishTrace&&!collectionDiagnostics&&!writerPreparationCandidate));
 const ledger=createGoogleTimingLedger(),createReader=await loadObservedGoogleReader(ledger,combinedCandidate);
 let ordinal=0,failed,reader,roleChecks=0,comparable;
 const publishNotices=[];
 const observePublish=notice=>{
  const message=notice.message;
  if(message?.startsWith(writerTracePrefix)||message?.startsWith(publisherTracePrefix))publishNotices.push(message);
 };
 const collectionCalls=[];
 const q=async(sql,args=[],kind=null,observedSql=sql,sqlMeasured=false)=>ledger.sql(async()=>{
  if(!collectionDiagnostics||ledger.phase!=="providerCollection")return client.query(sql,args);
  const start=performance.now();
  const result=await client.query(sql,args);
  const wallMs=performance.now()-start;
  collectionCalls.push({kind:googleCollectionCallKind(observedSql),wallMs,sqlMs:sqlMeasured?result.rows[0].payload.sqlMs:null});
  return result;
 },kind);
 async function roleQuery(role,sql,args=[]){
  assert.ok(GOOGLE_TIMING_ROLES.includes(role));assert.match(sql,/^select /i);assert.ok(!sql.includes(";"));
  const statement=sql.replace(/\$(\d+)/g,(_m,n)=>`($1->>${Number(n)-1})`);
  try{
   const observe=collectionDiagnostics&&ledger.phase==="providerCollection";
   const parameters=[role,statement,JSON.stringify(args.map(googleTimingParameter))];
   if(collectionDiagnostics)parameters.push(observe);
   let kind=role==="adstable_refresh_dataset_runner"?"dataset":null;
   if(reportBreakdown&&kind==="dataset"){
    if(sql===GOOGLE_DAILY_STAGE_SQL)kind="reportStage";
    if(sql===GOOGLE_DAILY_PUBLISH_SQL)kind="reportPublish";
   }
   const result=await q(`select pg_temp.eo05_google_role_query($1,$2,$3${collectionDiagnostics?",$4":""}) as payload`,parameters,kind,sql,observe);
   const rows=observe?result.rows[0].payload.rows:result.rows[0].payload;
   for(const row of rows)for(const k of ["payload_ciphertext","nonce","auth_tag"])if(typeof row[k]==="string"&&row[k].startsWith("\\x"))row[k]=Buffer.from(row[k].slice(2),"hex");
   if(rows[0]?.role===role&&rows[0]?.profile_ready===true)roleChecks++;
   if(rows[0]?.profile_ready===false)failed??={code:"GOOGLE_PROFILE_NOT_READY",message:"Role profile rejected: "+role,operation:"catalogue"};
   return {rows,rowCount:rows.length};
  }catch(error){failed??={code:error.code,message:error.message,operation:sql.match(/(?:operations|integrations|evidence|analytics)\.[a-z_]+/)?.[0]};throw error;}
 }
 function poolFactory(role){return ()=>({on(){},async end(){},async connect(){
  const name="google_rpc_"+(++ordinal),connected=performance.now();let open=false,report=false;
  return {release(){if(report&&ledger.phase==="reportWrite")ledger.phaseAt("reportPreparation");},async query(sql,args=[]){
   if(sql==="begin"){open=true;return q("savepoint "+name,[],role==="adstable_refresh_dataset_runner"?"dataset":null);}
   if(role==="adstable_google_source_runner"&&sql.startsWith("begin; set local statement_timeout = ")){
    open=true;return q("savepoint "+name+sql.slice("begin".length));
   }
   if(sql==="commit"){assert.ok(open);open=false;return q("release savepoint "+name,[],role==="adstable_refresh_dataset_runner"?"dataset":null);}
   if(sql==="rollback"){if(open){await q("rollback to savepoint "+name);open=false;return q("release savepoint "+name);}return {rows:[]};}
   // Keep transaction-local deadlines outside the invoker function's GUC scope.
   if(sql.startsWith("select pg_catalog.set_config("))return q(sql,args,role==="adstable_refresh_dataset_runner"?"dataset":null);
   if(sql===GOOGLE_DAILY_STAGE_SQL&&!report){report=true;if(ledger.phase==="reportPreparation")ledger.phaseAt("reportWrite",connected);}
   if(sql===GOOGLE_DAILY_INSPECT_SQL&&ledger.phase==="reportPreparation")ledger.phaseAt("receiptReadback",connected);
   if(sql===GOOGLE_DAILY_FINISH_SQL&&ledger.phase==="receiptReadback")ledger.phaseAt("jobClose",connected);
   return roleQuery(role,sql,args);
  }};
 }});}
 const runtime={query:(sql,args)=>roleQuery("adstable_runtime",sql,args)};
 const coordinator={async query(sql,args){
  const identity=(await roleQuery("adstable_refresh_coordinator",GOOGLE_ACCEPTANCE_COORDINATOR_ROLE_CHECK_SQL,
   [GOOGLE_ACCEPTANCE_COORDINATOR_RPC.map(([,s])=>s)])).rows[0];assert.equal(identity.profile_ready,true);
  return roleQuery("adstable_refresh_coordinator",sql,args);
 }};
 const queue={query:(sql,args)=>roleQuery("adstable_refresh_queue_runner",sql,args)};
 const store=createRefreshWorkRepository({query:(sql,args)=>/operations\.(check_refresh_queue_on_tick|review_refresh_interrupted_work)\(/.test(sql)?queue.query(sql,args):coordinator.query(sql,args)});
 try{
  if(combinedCandidate)await installGoogleCombinedCandidate(client);
  // The private package-reuse writer copies the selected preparation definition.
  if(writerPreparationCandidate)await installGoogleWriterPreparationCandidate(client);
  if(packageReuseCandidate)await installGooglePackageReuseCandidate(client);
  if(reportCandidate)await installGoogleReportCandidate(client);
  if(publishTrace){await installGooglePublishTrace(client);client.on("notice",observePublish);}
  if(factTriggerTrace)await installGoogleFactTriggerTrace(client);
  if(comparableReport){await installComparableReportTiming(client,"google");comparable=collectComparableReportTiming(client);}
  await installRoleAdapter(client,collectionDiagnostics);
  const owner=await ownerFixture(client,"google_ads"),day="2026-11-01",window={from:day,to:day},now=Date.now;
  const issued=now(),generation=randomUUID(),operationId=randomUUID(),hash=()=>randomBytes(32).toString("hex"),key=()=>randomBytes(32).toString("base64url");
  const environment={GOOGLE_ADS_DEVELOPER_TOKEN:"SYNTHETIC-ONLY",ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:key(),
   ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION:"1",ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1:key(),ADSTABLE_SESSION_ENCRYPTION_KEY_V1:key(),
   ADSTABLE_GOOGLE_SOURCE_DB_TIMEOUT_MS:"5000",ADSTABLE_REFRESH_DATASET_DB_TIMEOUT_MS:"30000"};
  for(const [name,role]of [["ADSTABLE_GOOGLE_SOURCE_DATABASE_URL","adstable_google_source_runner"],["ADSTABLE_REFRESH_DATASET_DATABASE_URL","adstable_refresh_dataset_runner"]])
   environment[name]=`postgresql://${role}.podpwkrpmjiksskxhwsu:${"x".repeat(32)}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require`;
  for(const {v}of(await client.query("select distinct key_version v from integrations.provider_credential_envelopes union select distinct key_version v from integrations.oauth_pkce_envelopes")).rows)
   if(Number(v)!==1)environment[`ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V${v}`]=key();
  const scopes=oauthPermissionScopes("google_ads","identity_v1"),token={access_token:"SYNTHETIC-ACCESS",refresh_token:"SYNTHETIC-REFRESH",permission_profile:"identity_v1",
   scope:scopes.join(" "),scope_verified_at:new Date(issued).toISOString(),expires_in:3600,expires_at:new Date(issued+3600000).toISOString()};
  const sealed=createTokenEnvelopeCipher({keyring:readProviderTokenKeyring(environment)}).seal({identity:{recordId:owner.credentialId,workspaceId:owner.workspaceId,
   installGeneration:Number(owner.generation),provider:"google_ads",purpose:"provider_token_set"},secret:JSON.stringify(token)});
  await client.query("update integrations.provider_credential_envelopes set payload_ciphertext=$2,nonce=$3,auth_tag=$4,key_version=$5 where id=$1",
   [owner.credentialId,sealed.ciphertext,sealed.nonce,sealed.authTag,sealed.keyVersion]);
  await client.query("update integrations.provider_connections set granted_scopes=$2,connected_at='2026-10-31' where id=$1",[owner.connectionId,scopes]);
  await client.query("update integrations.reporting_account_bindings set effective_from='2026-10-31' where connection_id=$1",[owner.connectionId]);
  const context={provider:"google_ads",clientScopeKey:hash(),connectionScopeKey:hash(),connectionEpoch:1,accountId:owner.accountId,organizationId:null,apiVersion:"v25"};
  await client.query(`insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,connection_id,connection_version,account_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled)
   values($1,$2,'google_ads',$3,$4,$5,$6,$7,$8,1,'v25',true)`,[owner.workspaceId,owner.generation,owner.installationId,owner.connectionId,owner.connectionVersion,owner.accountId,context.clientScopeKey,context.connectionScopeKey]);
  const policyId=randomUUID(),route=quotaRouteIdentity(context,{provider:"google_ads",family:"reporting_query",accountId:owner.accountId,organizationId:null,version:"v25",includes:[]});
  await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,'google_ads')",[context.connectionScopeKey]);
  await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'google_ads',60000,1000,0,5000,1)",[policyId]);
  await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required) values($1,'google_ads',true,true)",[route.routeKey]);
  await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[route.routeKey,policyId]);
  await client.query("insert into operations.api_quota_failure_bindings values($1,$2)",[route.routeKey,context.connectionScopeKey]);
  await client.query("insert into operations.api_quota_route_profiles values($1,$2,operations.shared_api_quota_fingerprint($1),true)",[route.routeKey,context.connectionScopeKey]);
  await client.query("insert into operations.api_quota_routes values($1,$1,true)",[route.routeKey]);
  const cost={requests:40,dbWrites:10000,connections:6,rows:6000,bytes:8000000};
  await client.query("update operations.refresh_control set budget=$1,bounds=$2 where singleton",[
   {global:cost,interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},providers:[{provider:"google_ads",limit:cost}],workspaces:[{workspaceId:owner.workspaceId,limit:cost}],accounts:[{provider:"google_ads",accountId:owner.accountId,limit:cost}]},
   {maxWorkspaces:8,maxCandidates:8,maxClaims:1,maxAdmissions:1}]);
  await client.query("update operations.refresh_tick_control set enabled=true,generation=$1,last_minute=null,last_checked_at_ms=null,queue_revision=null where singleton",[generation]);
  await client.query("update operations.refresh_queue_control set max_workspaces=8,max_accounts=8,max_snapshot_bytes=100000,max_snapshot_age_ms=60000 where singleton");
  const verified=await loadGoogleBackgroundOwner({database:runtime,owner:{workspaceId:owner.workspaceId,installGeneration:Number(owner.generation),shopId:owner.shopId,shopDomain:owner.shopDomain}});
  const tokenVault=createTokenVault({database:runtime,environment}),cipher=createConfiguredSourceEvidenceCipher(environment);
  const limits={deadlineAt:now()+120000,requestTimeoutMs:100000,finishReserveMs:2000,maxRows:2000,maxBytes:cost.bytes};
  const appId="gid://shopify/App/456",entitlementVerifier=createRefreshEntitlementVerifier({store,appId,now,limits,authorizeRead:async()=>true,
   partnerApi:{appId,activeSubscription:async()=>({data:{activeSubscription:{shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,trialEndsAt:null,
    currentBillingCycle:{startTime:new Date(now()-86400000).toISOString(),endTime:new Date(now()+86400000).toISOString()},items:[{handle:"monthly",price:{active:true}}]}}})}});
  const queries=buildGoogleReportingQueries({dateWindow:{start:day,end:day}}),batches=[];let requests=0,claimId,scope;
  ledger.start();
  await store.checkQueueFromAuthority({expectedRevision:(await store.readQueueCheck()).revision});
  ledger.phaseAt("queueAndAdmission");
  const run=await runScheduledRefreshWithDataset({store,generation,environment,poolFactory:poolFactory("adstable_refresh_dataset_runner"),work:{now,entitlementVerifier,
   buildWorkPlan:async candidate=>candidate.workspaceId===owner.workspaceId&&candidate.provider==="google_ads"?{window,partitionId:"synthetic-google-daily:"+day,workClass:"deep_reconciliation",cost,limits}:null,
   async readPage({claim,entitlementReceipt,signal}){
    claimId=claim.id;scope={claim,window,entitlementReceipt};
    if(quotaClaimComparison){
     try{await compareGoogleQuotaClaimReuse(client,scope);}
     catch(error){
      failed??={code:error.code,message:error.message,operation:"quota_claim_comparison"};
      throw error;
     }
    }
    ledger.phaseAt("providerCollection");
    reader=createReader({verified,environment,tokenVault,execution:scope,configuration:{operationId,limits:{maxRows:2000,maxBytes:1048576,maxElapsedMs:60000,maxRequests:40,maxPages:10,maxLinkPages:1,maxLinks:100},
     storageLimits:{maxRows:1000,maxBytes:2097152},sourcePolicy:sourceStoreFixture().input.policy,merchant:null},signal,now,poolFactory:poolFactory("adstable_google_source_runner"),
     fetchFn:async(url,init)=>{assert.equal(new URL(url).hostname,"googleads.googleapis.com");requests++;const query=JSON.parse(init.body).query;
      if(query.includes("FROM product_link"))return Response.json({results:[]});const family=Object.keys(queries).find(f=>queries[f]===query);assert.ok(family);
      return Response.json({results:googleDatasetNativeRows(family,owner.accountId,{googleProducts:500,googleSalesProducts:499})});}});
    const capture=await reader.run();await reader.close();reader=null;
    if(failed)throw Object.assign(Error(failed.message),failed);
    assert.equal(capture.status,"partial",JSON.stringify({capture,failed}));assert.equal(capture.contentVerified,true);
    assert.equal(capture.datasets.account_performance.recordCount,3);assert.equal(capture.datasets.product_performance.recordCount,1498);
    for(const kind of ["account_performance","product_performance"]){const d=capture.datasets[kind];for(const p of d.packageReceipts??[d])batches.push({attemptId:p.attemptId,ordinal:p.ordinal});}
    ledger.phaseAt("handoff");return {kind:"complete",payload:{batchCount:batches.length}};
   },validatePage:({payload})=>({complete:payload.batchCount>=2,rows:[]}),
   async loadDatasetInputs(){ledger.phaseAt("reportPreparation");return {owner,batches,cipher,expectedRevision:0,googleDailyPackages:true};}
  }});
  const measured=ledger.stop();if(failed)throw Object.assign(Error(failed.message),failed);
  assert.equal(run.work?.status,"completed",JSON.stringify(run));assert.equal(requests,18);assert.equal(measured.rawDatasets,3);assert.ok(roleChecks>0);
  const rows=(await client.query(`select (select count(*)::int from analytics.pd_facts where installation_id=$1) pd,
   (select count(*)::int from analytics.cpd_product_performance_facts where installation_id=$1) performance,
   (select count(*)::int from analytics.cpd_product_sales_facts where installation_id=$1) sales`,[owner.installationId])).rows[0];
  assert.deepEqual(rows,{pd:1,performance:500,sales:499});
  const receipts=(await client.query("select manifest->'googleDailyReceipt' receipt from evidence.source_batches where authority=$1::jsonb and manifest ? 'googleDailyReceipt'",[JSON.stringify(owner)])).rows;
  assert.equal(receipts.length,1);assert.equal(receipts[0].receipt.rowCount,1000);assert.deepEqual(receipts[0].receipt.packages.map(p=>p.rowCount),[200,200,200,200,200]);
  assert.equal((await client.query("select status from operations.refresh_runs where workspace_id=$1 and job_id=$2",[owner.workspaceId,claimId])).rows[0].status,"completed");
  assert.ok(Math.abs(Object.values(measured.durationsMs).reduce((a,b)=>a+b,0)-measured.totalMs)<0.01);
  const reportWriteBreakdown=reportBreakdown?summarizeGoogleReportWrite(ledger.calls,measured.durationsMs.reportWrite):null;
  if(reportWriteBreakdown){
   assert.equal(reportWriteBreakdown.stageCalls,5);
   assert.equal(reportWriteBreakdown.publishCalls,1);
  }
  const publishDetails=publishTrace?summarizeGooglePublishTrace(publishNotices):null;
  const triggerDetails=factTriggerTrace?summarizeGoogleFactTriggerTrace(
   (await client.query("select current_setting($1)::jsonb as trace",[triggerTraceSetting])).rows[0].trace,
   receipts[0].receipt.rowCount,publishDetails.physicalWriteMs,
  ):null;
  const reportComparison=comparable?await comparable.result(reportWriteBreakdown.reportWriteMs,reportWriteBreakdown.stageCallWallMs):undefined;
  return {provider:"google_ads",synthetic:true,rollbackOnly:true,combinedCandidate,reportCandidate,reportRows:1000,nativeRows:1501,requests,reportPackages:5,receipts:1,completed:true,roleChecks,...measured,
   adstableWallMs:measured.totalMs-measured.postgresCallWallMs,providerNetworkMeasured:false,sqlInnerTimers:collectionDiagnostics||publishTrace||comparableReport,durableCommitMeasured:false,
   ...(reportComparison?{reportComparison}:{}),
   ...(reportWriteBreakdown?{reportWriteBreakdown}:{}),
   ...(publishDetails?{publishTrace:publishDetails}:{}),
   ...(triggerDetails?{factTriggerTrace:triggerDetails}:{}),
   ...(collectionDiagnostics?{collectionBreakdown:summarizeGoogleCollection(collectionCalls,measured.durationsMs.providerCollection)}:{})};
 }catch(error){
  if(failed)throw Object.assign(Error("GOOGLE_TIMING_SQL_STOP "+failed.operation+": "+failed.message),{code:failed.code??"GOOGLE_TIMING_SQL_STOP"});
  throw error;
 }finally{try{await reader?.close();}finally{if(publishTrace)client.off("notice",observePublish);comparable?.stop();delete globalThis[observationKey];}}
}
