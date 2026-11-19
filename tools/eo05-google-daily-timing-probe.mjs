import assert from "node:assert/strict";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
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

// Only two outer storage-boundary observations are inserted into a fresh module
// instance. No branch, guard, credential logic or SQL is replaced.
export async function loadObservedGoogleReader(ledger){
 assert.equal(globalThis[observationKey],undefined);globalThis[observationKey]=ledger;
 const original=readFileSync(sourceUrl,"utf8");
 const start="const save=async(dataset,pages,complete,reason=null)=>{";
 const end="datasets[dataset]={status:complete?\"stored\":\"unavailable\",reason,recordCount:complete?recordCount:null,empty:complete?recordCount===0:null,...receipt};";
 assert.equal(original.split(start).length,2);assert.equal(original.split(end).length,2);
 const transformed=original.replace(start,()=>start+'globalThis[Symbol.for("adstable.google.nano.stage-observer")].raw(true);')
  .replace(end,()=>end+'globalThis[Symbol.for("adstable.google.nano.stage-observer")].raw(false);');
 const id=randomUUID();
 const hooks=registerHooks({load(url,context,next){if(url===sourceUrl.href+"?googleTiming="+id)return {format:"module",source:transformed,shortCircuit:true};return next(url,context);}});
 try{return (await import(sourceUrl.href+"?googleTiming="+id)).createGoogleRawDatasetReader;}
 catch(error){delete globalThis[observationKey];throw error;}
 finally{hooks.deregister();}
}

// A test-only, invoker adapter: one network call, real SET ROLE and real result.
// It has no clock or privilege elevation. Outer rollback owns all changes.
async function installRoleAdapter(client){
 await client.query(`create function pg_temp.eo05_google_role_query(target text,statement text,parameters jsonb)
 returns jsonb language plpgsql security invoker set search_path='' as $fn$
 declare previous text:=current_user;payload jsonb;
 begin
  if target<>all(array['adstable_owner','adstable_runtime','adstable_refresh_coordinator','adstable_refresh_queue_runner','adstable_google_source_runner','adstable_refresh_dataset_runner'])
   or statement !~* '^select ' or position(';' in statement)>0 then raise exception 'GOOGLE_TEST_ADAPTER_SCOPE';end if;
  execute format('set local role %I',target);
  execute 'select coalesce(jsonb_agg(to_jsonb(output)),''[]''::jsonb) from ('||statement||') output' into payload using parameters;
  execute format('set local role %I',previous);
  return payload;
 end $fn$`);
 await client.query("revoke all on function pg_temp.eo05_google_role_query(text,text,jsonb) from public,anon,authenticated,service_role");
}

export async function googleDailyTimingProbe(client,{ownerFixture}){
 assertGoogleTimingTarget(client.connectionParameters);
 const ledger=createGoogleTimingLedger(),createReader=await loadObservedGoogleReader(ledger);
 let ordinal=0,failed,reader,roleChecks=0;
 const q=async(sql,args=[],kind=null)=>ledger.sql(()=>client.query(sql,args),kind);
 async function roleQuery(role,sql,args=[]){
  assert.ok(GOOGLE_TIMING_ROLES.includes(role));assert.match(sql,/^select /i);assert.ok(!sql.includes(";"));
  const statement=sql.replace(/\$(\d+)/g,(_m,n)=>`($1->>${Number(n)-1})`);
  try{
   const result=await q("select pg_temp.eo05_google_role_query($1,$2,$3) as payload",[role,statement,JSON.stringify(args.map(googleTimingParameter))],role==="adstable_refresh_dataset_runner"?"dataset":null);
   const rows=result.rows[0].payload;
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
  await installRoleAdapter(client);
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
    claimId=claim.id;scope={claim,window,entitlementReceipt};ledger.phaseAt("providerCollection");
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
  return {provider:"google_ads",synthetic:true,rollbackOnly:true,reportRows:1000,nativeRows:1501,requests,reportPackages:5,receipts:1,completed:true,roleChecks,...measured,
   adstableWallMs:measured.totalMs-measured.postgresCallWallMs,providerNetworkMeasured:false,sqlInnerTimers:false,durableCommitMeasured:false};
 }catch(error){
  if(failed)throw Object.assign(Error("GOOGLE_TIMING_SQL_STOP "+failed.operation+": "+failed.message),{code:failed.code??"GOOGLE_TIMING_SQL_STOP"});
  throw error;
 }finally{try{await reader?.close();}finally{delete globalThis[observationKey];}}
}
