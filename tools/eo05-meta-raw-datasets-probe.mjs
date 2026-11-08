import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomBytes,randomUUID} from "node:crypto";
import {createMetaRawDatasetReader} from "../app/lib/refresh/meta-raw-datasets.server.js";
import {loadMetaBackgroundOwner} from "../app/lib/refresh/meta-background-owner.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";

export function metaRawRehearsalEnvironment(){
 return {META_APP_ID:"123",META_APP_SECRET:"SYNTHETIC",ADSTABLE_META_SOURCE_DATABASE_URL:"postgresql://adstable_meta_source_runner.podpwkrpmjiksskxhwsu:"+"x".repeat(32)+"@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",ADSTABLE_META_SOURCE_DB_TIMEOUT_MS:"5000",
  ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION:"1",ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1:randomBytes(32).toString("base64url"),
  ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:randomBytes(32).toString("base64url"),ADSTABLE_SESSION_ENCRYPTION_KEY_V1:randomBytes(32).toString("base64url")};
}

// Actual F01 owner/job/quota/source RPCs and per-RPC narrow role checks. Only the
// physical Meta response and token are synthetic. Entire migration/role rolls back.
export async function metaRawDatasetProbe(client,{execution,connection,installation,scopes}){
 assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
 await client.query("savepoint meta_raw_outer");
 let phase="migration";
 try{
  const sql=readFileSync(new URL("../supabase/migrations/20261104142557_eo05_meta_raw_datasets.sql",import.meta.url),"utf8");
  await client.query(sql.trim().replace(/^begin;/," ").replace(/commit;$/," "));
  phase="role_install";await client.query("set local role postgres");
  const role=readFileSync(new URL("./sql/eo05-meta-source-role-install.sql",import.meta.url),"utf8");
  await client.query(role.trim().replace(/^begin;/," ").replace(/commit;$/," "));
  await client.query("set local role postgres");
  await client.query("grant adstable_meta_source_runner,adstable_runtime to adstable_owner with inherit false,set true,admin false");
  await client.query("set local role adstable_owner");
  const workspace=execution.claim.workspaceId,generation=execution.claim.installGeneration;
  const context=(await client.query("select client_scope_key,connection_scope_key,connection_epoch,api_version from operations.refresh_quota_contexts where workspace_id=$1 and provider='meta'",[workspace])).rows[0];
  const {quotaRouteIdentity}=await import("../app/lib/refresh/quota-scope-resolver.server.js");
  const ctx={provider:"meta",clientScopeKey:context.client_scope_key,connectionScopeKey:context.connection_scope_key,connectionEpoch:Number(context.connection_epoch),accountId:execution.claim.accountId,organizationId:null,apiVersion:context.api_version};
  for(const family of ["token_debug","insights","product_insights"]){
   const r=quotaRouteIdentity(ctx,{provider:"meta",family,accountId:family==="token_debug"?null:ctx.accountId,organizationId:null,version:ctx.apiVersion,includes:[]}),policy=randomUUID();
   await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,'meta') on conflict do nothing",[ctx.connectionScopeKey]);
   await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required) values($1,'meta',true,true) on conflict do nothing",[r.routeKey]);
   await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'meta',60000,1000000,0,5000,1000)",[policy]);
   await client.query("insert into operations.api_quota_bindings(operation_key,policy_id,units) values($1,$2,1)",[r.routeKey,policy]);
   await client.query("insert into operations.api_quota_failure_bindings(operation_key,domain_id) values($1,$2) on conflict do nothing",[r.routeKey,ctx.connectionScopeKey]);
   await client.query("insert into operations.api_quota_route_profiles(operation_key,domain_id,quota_fingerprint,enabled) select $1,$2,operations.shared_api_quota_fingerprint($1),true on conflict(operation_key) do update set quota_fingerprint=excluded.quota_fingerprint,enabled=true",[r.routeKey,ctx.connectionScopeKey]);
   await client.query("insert into operations.api_quota_routes(route_key,operation_key,enabled) values($1,$1,true) on conflict(route_key) do update set enabled=true",[r.routeKey]);
  }
  phase="scenarios";let ordinal=0;
  for(const mode of ["zero","nonempty","permission","lost_write","tampered","fence","selection","permission_expired"]){
   phase=mode;await client.query("savepoint meta_raw_case");let reader;
   try{
    let writes=0,reads=0,calls=0;
    const poolFactory=()=>({on(){},async end(){},async connect(){const name="meta_rpc_"+(++ordinal);let committed=false;
     return {release(){},async query(q,args){
      if(q==="begin")return client.query("savepoint "+name);
      if(q==="commit"){await client.query("set local role adstable_owner");await client.query("release savepoint "+name);committed=true;return {rows:[]};}
      if(q==="rollback"){if(!committed){await client.query("rollback to savepoint "+name);await client.query("release savepoint "+name);}await client.query("set local role adstable_owner");return {rows:[]};}
      if(q.startsWith("select pg_catalog.set_config"))return client.query(q,args);
      if(q.includes("commit_meta_dataset_source")){
       writes++;if(mode==="fence")await client.query("update operations.refresh_runs set fence=fence+1000 where fence=$1",[execution.claim.fence]);
       if(mode==="selection")await client.query("update integrations.reporting_account_bindings set effective_to=clock_timestamp() where connection_id=$1 and effective_to is null",[connection.id]);
       if(mode==="permission_expired"){const r=JSON.parse(args[4]);r.permissionExpiresAt=new Date(Date.now()-1000).toISOString();args=[...args.slice(0,4),JSON.stringify(r)];}
      }
      if(q.startsWith("select evidence.read_source_receipt("))reads++;
      await client.query("set local role adstable_meta_source_runner");const result=await client.query(q,args);await client.query("set local role adstable_owner");
      if(mode==="lost_write"&&q.includes("commit_meta_dataset_source")){await client.query("release savepoint "+name);committed=true;throw Error("synthetic lost acknowledgement");}
      if(mode==="tampered"&&q.startsWith("select evidence.read_source_pages(")&&result.rows[0].result.length)result.rows[0].result[0].ciphertext="00";
      return result;
     }};
    }});
    const runtime={query:async(q,args)=>{await client.query("set local role adstable_runtime");try{return await client.query(q,args);}finally{await client.query("set local role adstable_owner");}}};
    const verified=await loadMetaBackgroundOwner({database:runtime,owner:{workspaceId:workspace,installGeneration:Number(generation),shopId:installation.shop_id,shopDomain:installation.shop_domain}});
    const issued=Date.now(),environment=metaRawRehearsalEnvironment();
    reader=createMetaRawDatasetReader({environment,verified,execution,configuration:{operationId:randomUUID(),limits:{maxElapsedMs:60000,maxBytes:1048576,maxRequests:5,maxPages:1,maxRows:100},storageLimits:{maxRows:1000,maxBytes:1048576},sourcePolicy:sourceStoreFixture().input.policy},
     tokenVault:{loadProviderTokenSet:async()=>({access_token:"SYNTHETIC",permission_profile:"identity_v1",scopes})},poolFactory,
     fetchFn:async(endpoint)=>{calls++;const u=new URL(endpoint);
      if(u.pathname.endsWith("debug_token"))return Response.json({data:{is_valid:true,app_id:"123",scopes,expires_at:Math.floor(issued/1000)+3600,data_access_expires_at:Math.floor(issued/1000)+3600}});
      if(mode==="permission")return Response.json({error:{code:200}},{status:403});
      return Response.json({data:mode==="nonempty"?[{account_id:ctx.accountId.slice(4),campaign_id:"11",adset_id:"12",ad_id:"13",date_start:execution.window.from,date_stop:execution.window.to,product_id:"sku",spend:"0.1234567890123456789"}]:[]});
     }});
    const result=await reader.run();await reader.close();await assert.rejects(reader.run(),/EXECUTION_USED/);
    if(["zero","nonempty"].includes(mode)){assert.equal(result.status,"stored",JSON.stringify({mode,result}));assert.equal(result.contentVerified,true);assert.equal(result.recordCount,mode==="zero"?0:2);assert.equal(writes,2);assert.equal(reads,2);assert.equal(calls,3);}
    else{assert.notEqual(result.status,"stored",JSON.stringify({mode,result}));assert.equal(result.empty,null);assert.equal(result.recordCount,null);if(mode==="lost_write")assert.equal(reads,0);}
    const n=(await client.query("select count(*)::int n from evidence.source_batches where workspace_id=$1 and authority->>'provider'='meta'",[workspace])).rows[0].n;
    assert.equal(n,["zero","nonempty"].includes(mode)?2:["lost_write","tampered"].includes(mode)?1:0,mode);
   }finally{await reader?.close();await client.query("rollback to savepoint meta_raw_case");await client.query("release savepoint meta_raw_case");}
  }
  for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator","adstable_google_source_runner"]){
   if((await client.query("select exists(select 1 from pg_roles where rolname=$1) ok",[role])).rows[0].ok)
    assert.equal((await client.query("select has_function_privilege($1,'evidence.commit_meta_dataset_source(jsonb,uuid,integer,jsonb,jsonb)','EXECUTE') ok",[role])).rows[0].ok,false);
  }
  console.log("EO05_META_RAW_DATASETS_PASS scenarios=8 actual_SQL_narrow_role=true synthetic_HTTP_only=true receipt_decryption=true no_live_changes=true");
 }catch(error){console.log("EO05_META_RAW_DATASETS_SQL_STOP "+JSON.stringify({phase,code:error.code??"ASSERTION_FAILED"}));throw error;}finally{await client.query("rollback to savepoint meta_raw_outer");await client.query("release savepoint meta_raw_outer");}
}
