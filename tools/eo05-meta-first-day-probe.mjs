import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {metaRawRehearsalEnvironment} from "./eo05-meta-raw-datasets-probe.mjs";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {planRefreshPreflightAdmissions} from "../app/lib/refresh/admission-policy.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {createTokenEnvelopeCipher,readProviderTokenKeyring} from "../app/lib/oauth/token-envelope.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createMetaRawCaptureExecution} from "../app/lib/refresh/meta-raw-server.server.js";
import {handleMetaRawCaptureRequest} from "../app/lib/refresh/meta-raw-request.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";

export function metaFirstDayRehearsalEnvironment(){
 const url=role=>`postgresql://${role}.podpwkrpmjiksskxhwsu:${"x".repeat(32)}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require`;
 return {...metaRawRehearsalEnvironment(),VERCEL_ENV:"production",SHOPIFY_APP_URL:"https://embedded.adstable.app",
  ADSTABLE_META_RAW_CAPTURE_ENABLED:"true",ADSTABLE_META_RAW_CAPTURE_SERVER_SECRET:randomBytes(32).toString("base64url"),
  ADSTABLE_RUNTIME_DATABASE_URL:url("adstable_runtime"),ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DATABASE_URL:url("adstable_refresh_coordinator"),
  ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DB_TIMEOUT_MS:"5000",SHOPIFY_PARTNER_ORG_ID:"10",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"SYNTHETIC-PARTNER"};
}

// Isolated F01 databases only. Admission, vault, roles, quota, encrypted source
// commit/readback and paused closure are real SQL. Only physical HTTP is synthetic.
export async function metaFirstDayRehearsal(client,{workspace,shopId,shopDomain}){
 assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
 await client.query("begin");let phase="migration",ordinal=0;
 try{
  const definitions=async()=>(await client.query("select oid::regprocedure::text name,pg_get_functiondef(oid) body from pg_proc where pronamespace='operations'::regnamespace and proname in ('commit_refresh_preflight','commit_refresh_preflight_with_deadline','commit_refresh_admissions') order by 1")).rows;
  const before=await definitions();
  for(const path of ["../supabase/migrations/20261104142557_eo05_meta_raw_datasets.sql","./sql/eo05-meta-source-role-install.sql","../supabase/migrations/20261104161732_eo05_meta_raw_first_day.sql"]){
   await client.query("set local role postgres");
   await client.query(readFileSync(new URL(path,import.meta.url),"utf8").trim().replace(/^begin;/," ").replace(/commit;$/," "));
  }
  await client.query("set local role postgres");
  await client.query("grant adstable_meta_source_runner,adstable_refresh_coordinator,adstable_runtime to adstable_owner with inherit false,set true,admin false");
  await client.query("set local role adstable_owner");assert.deepEqual(await definitions(),before);
  const modes=["zero_repeat","nonempty","previous_day","future_day","multi_day","wrong_provider","wrong_operation","stale_source","stale_revision","expired_deadline","permission","lost_admission"];
  for(const mode of modes){
   phase=mode;await client.query("savepoint first_day_case");let execution;
   try{
    const scopes=oauthPermissionScopes("meta","identity_v1"),issued=Date.now();
    // More than one jittered hour has elapsed, without fabricating a pending row.
    // Always query the connection native day, including runs crossing midnight.
    const c=(await client.query("update integrations.provider_connections set connected_at=date_trunc('hour',statement_timestamp())-interval '2 hours'+interval '1 millisecond',last_verified_at=statement_timestamp(),updated_at=statement_timestamp(),granted_scopes=$2 where workspace_id=$1 and provider='meta' returning id,credential_id,connection_version",[workspace,scopes])).rows[0];
    await client.query("update integrations.reporting_account_bindings set effective_from=(select connected_at from integrations.provider_connections where id=$1) where connection_id=$1 and effective_to is null",[c.id]);
    await client.query("update integrations.provider_accounts set timezone_name='America/Los_Angeles' where connection_id=$1",[c.id]);
    const installation=(await client.query("select id::text from shopify.installations where workspace_id=$1 and status='active'",[workspace])).rows[0];
    const store=createRefreshWorkRepository(client),vector={requests:100,dbWrites:20000,connections:10,rows:10000,bytes:16777216};
    await client.query("update operations.refresh_control set budget=$1::jsonb,bounds=$2::jsonb where singleton",[JSON.stringify({global:vector,interactiveReserve:{requests:1,dbWrites:8,connections:1,rows:0,bytes:131072},providers:[{provider:"meta",limit:vector}],workspaces:[{workspaceId:workspace,limit:vector}],accounts:[{provider:"meta",accountId:"act_101",limit:vector}]}),JSON.stringify({maxCandidates:8,maxClaims:8,maxAdmissions:1,maxWorkspaces:8})]);
    await client.query("update operations.refresh_queue_control set max_snapshot_age_ms=60000 where singleton");
    await store.checkQueueFromAuthority({expectedRevision:(await store.readQueueCheck()).revision});
    const snapshot=await store.readPreflightSnapshot(),source=snapshot.candidates.find(s=>s.provider==="meta");assert.ok(source);
    const environment=metaFirstDayRehearsalEnvironment();
    for(const {v}of(await client.query("select distinct key_version v from integrations.provider_credential_envelopes union select distinct key_version v from integrations.oauth_pkce_envelopes")).rows)
     if(Number(v)!==1)environment[`ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V${v}`]=randomBytes(32).toString("base64url");
    const sealed=createTokenEnvelopeCipher({keyring:readProviderTokenKeyring(environment)}).seal({identity:{recordId:c.credential_id,workspaceId:workspace,installGeneration:1,provider:"meta",purpose:"provider_token_set"},secret:JSON.stringify({access_token:"SYNTHETIC-ACCESS",permission_profile:"identity_v1",scopes,scope_verified_at:new Date(issued).toISOString(),expires_at:new Date(issued+3600000).toISOString()})});
    await client.query("update integrations.provider_credential_envelopes set payload_ciphertext=$2,nonce=$3,auth_tag=$4,key_version=$5 where id=$1",[c.credential_id,sealed.ciphertext,sealed.nonce,sealed.authTag,sealed.keyVersion]);
    const hash=()=>createHash("sha256").update(randomUUID()).digest("hex"),meta={provider:"meta",clientScopeKey:hash(),connectionScopeKey:hash(),connectionEpoch:1,accountId:"act_101",organizationId:null,apiVersion:"v26.0"},partner={provider:"shopify_partner",clientScopeKey:hash(),connectionScopeKey:hash(),connectionEpoch:1,accountId:null,organizationId:"10",apiVersion:"2026-07"};
    await client.query("insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,connection_id,connection_version,account_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled) values($1,1,'meta',$2,$3,$4,'act_101',$5,$6,1,'v26.0',true)",[workspace,installation.id,c.id,c.connection_version,meta.clientScopeKey,meta.connectionScopeKey]);
    await client.query("insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,client_scope_key,connection_scope_key,connection_epoch,organization_id,api_version,enabled) values($1,1,'shopify_partner',$2,$3,$4,1,'10','2026-07',true)",[workspace,installation.id,partner.clientScopeKey,partner.connectionScopeKey]);
    for(const ctx of [meta,partner]){
     const policy=randomUUID();await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,$2)",[ctx.connectionScopeKey,ctx.provider]);
     await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,$2,60000,100,1,5000,1)",[policy,ctx.provider]);
     for(const family of ctx===meta?["token_debug","insights","product_insights"]:["partner_graphql"]){
      const r=quotaRouteIdentity(ctx,{provider:ctx.provider,family,accountId:family==="token_debug"?null:ctx.accountId,organizationId:ctx.organizationId,version:ctx.apiVersion,includes:[]});
      await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required) values($1,$2,true,true)",[r.routeKey,ctx.provider]);
      await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[r.routeKey,policy]);
      await client.query("insert into operations.api_quota_failure_bindings values($1,$2)",[r.routeKey,ctx.connectionScopeKey]);
      await client.query("insert into operations.api_quota_route_profiles values($1,$2,operations.shared_api_quota_fingerprint($1),true)",[r.routeKey,ctx.connectionScopeKey]);
      await client.query("insert into operations.api_quota_routes values($1,$1,true)",[r.routeKey]);
     }
    }
    const dates=(await client.query("select (connected_at at time zone 'America/Los_Angeles')::date::text today,((connected_at at time zone 'America/Los_Angeles')::date-1)::text yesterday,((clock_timestamp() at time zone 'America/Los_Angeles')::date+1)::text tomorrow from integrations.provider_connections where id=$1",[c.id])).rows[0];
    const operationId=randomUUID(),window={from:dates.today,to:dates.today},cost={requests:6,dbWrites:4068,connections:3,rows:2100,bytes:3145728};
    const id=createHash("sha256").update(JSON.stringify(["meta_raw_capture_v1",operationId,workspace,source.installGeneration,"act_101"])).digest("hex");
    const proposal=planRefreshPreflightAdmissions({...snapshot,now:Date.now(),candidates:[{id,workspaceId:workspace,installGeneration:source.installGeneration,provider:"meta",accountId:"act_101",scheduledHour:source.scheduledHour,queuedAt:source.queuedAt,workClass:"bootstrap",cost,authority:{installationVerified:true,connected:true,setupComplete:true,allowedWindow:true}}]});assert.equal(proposal.status,"proposed");
    assert.equal(await store.commitPreflight({expectedRevision:snapshot.state.revision,queueRevision:snapshot.queueRevision,nextState:proposal.nextState,source,window,partitionId:"meta-raw-capture:"+operationId,deadlineAt:Date.now()+90000}),false,"generic refresh still rejects first-day pre-connection hours");
    if(!["zero_repeat","nonempty","permission","lost_admission"].includes(mode)){
     const args=[snapshot.state.revision,snapshot.queueRevision,JSON.stringify(proposal.nextState),JSON.stringify(source),JSON.stringify(window),operationId,Date.now()+90000];
     if(mode==="previous_day")args[4]=JSON.stringify({from:dates.yesterday,to:dates.yesterday});
     if(mode==="future_day")args[4]=JSON.stringify({from:dates.tomorrow,to:dates.tomorrow});
     if(mode==="multi_day")args[4]=JSON.stringify({from:dates.yesterday,to:dates.today});
     if(mode==="wrong_provider")args[3]=JSON.stringify({...source,provider:"google_ads"});
     if(mode==="wrong_operation")args[5]=randomUUID();
     if(mode==="stale_source")args[3]=JSON.stringify({...source,selectionId:"stale"});
     if(mode==="stale_revision")args[0]++;
     if(mode==="expired_deadline")args[6]=Date.now()-1;
     const r=await client.query("select operations.commit_meta_raw_preflight_with_deadline($1::bigint,$2::bigint,$3::jsonb,$4::jsonb,$5::jsonb,$6::uuid,$7::bigint) result",args);
     assert.equal(r.rows[0].result,false,mode);
     assert.equal((await client.query("select count(*)::int n from operations.refresh_runs where job_id=$1",[id])).rows[0].n,0);continue;
    }
    let metaCalls=0,partnerCalls=0,admissionCalls=0;
    function poolFactory(role){return ()=>({on(){},async end(){},async connect(){const name="first_rpc_"+(++ordinal);let committed=false,lastSql="";return {release(){},async query(sql,args){
     if(sql==="begin")return client.query("savepoint "+name);
     if(sql==="commit"){await client.query("set local role adstable_owner");await client.query("release savepoint "+name);committed=true;if(mode==="lost_admission"&&lastSql.includes("commit_meta_raw_preflight"))throw Error("SYNTHETIC-LOST");return {rows:[]};}
     if(sql==="rollback"){if(!committed){await client.query("rollback to savepoint "+name);await client.query("release savepoint "+name);}await client.query("set local role adstable_owner");return {rows:[]};}
     if(sql.startsWith("select pg_catalog.set_config"))return client.query(sql,args);
     assert.ok(!sql.includes("commit_refresh_preflight"),"private Meta path cannot call generic admission");
     await client.query("set local role "+role);let result;try{result=await client.query(sql,args);}catch(error){console.error("EO05_META_FIRST_DAY_RPC_STOP "+JSON.stringify({role,rpc:sql.match(/^select ([a-z_]+\.[a-z_]+)/)?.[1]??"profile",code:error.code??"UNCONFIRMED",routine:error.routine,constraint:error.constraint}));throw error;}await client.query("set local role adstable_owner");lastSql=sql;
     if(sql.includes("commit_meta_raw_preflight"))admissionCalls++;return result;
    }};}});}
    const target={operationId,workspaceId:workspace,installGeneration:source.installGeneration,shopId,shopDomain,accountId:"act_101",connectionId:c.id,connectionVersion:Number(c.connection_version),credentialId:c.credential_id,selectionId:source.selectionId,window,expiresAt:new Date(issued+600000).toISOString()};
    environment.ADSTABLE_META_RAW_CAPTURE_PLAN=JSON.stringify({version:1,target,limits:{maxElapsedMs:60000,maxBytes:1048576,maxPages:1,maxRows:100,maxRequests:5},storageLimits:{maxRows:1000,maxBytes:1048576},sourcePolicy:sourceStoreFixture().input.policy});
    const fetchFn=async endpoint=>{const u=new URL(endpoint);
     if(u.hostname==="partners.shopify.com"){partnerCalls++;return Response.json({data:{activeSubscription:{shop:{id:shopId,myshopifyDomain:shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,trialEndsAt:null,currentBillingCycle:{startTime:new Date(issued-86400000).toISOString(),endTime:new Date(issued+86400000).toISOString()},items:[{handle:"monthly",price:{active:true}}],pendingUpdate:null}}});}
     assert.equal(u.hostname,"graph.facebook.com");metaCalls++;
     if(u.pathname.endsWith("debug_token"))return Response.json({data:{is_valid:true,app_id:"123",scopes,expires_at:Math.floor(issued/1000)+3600,data_access_expires_at:Math.floor(issued/1000)+3600}});
     if(mode==="permission")return Response.json({error:{code:200}},{status:403});
     return Response.json({data:mode==="nonempty"?[{account_id:"101",campaign_id:"11",adset_id:"12",ad_id:"13",date_start:dates.today,date_stop:dates.today,product_id:"sku",spend:"0.1234567890123456789"}]:[]});
    };
    const run=async()=>{const request=new Request("https://embedded.adstable.app/internal/meta/raw-capture",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${environment.ADSTABLE_META_RAW_CAPTURE_SERVER_SECRET}`},body:JSON.stringify({operationId})});
     const response=await handleMetaRawCaptureRequest(request,{environment,createExecution:args=>{execution=createMetaRawCaptureExecution({...args,runtimePoolFactory:poolFactory("adstable_runtime"),coordinatorPoolFactory:poolFactory("adstable_refresh_coordinator"),readerPoolFactory:poolFactory("adstable_meta_source_runner"),fetchFn});return execution;}});return response.json();};
    const result=await run();assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC|payload|ciphertext|access_token|credentialId/);
    if(["zero_repeat","nonempty"].includes(mode)){
     assert.equal(result.status,"stored",JSON.stringify({mode,result,metaCalls,partnerCalls,admissionCalls}));assert.equal(result.recordCount,mode==="nonempty"?2:0);assert.equal(result.jobPaused,true);assert.equal(metaCalls,3);assert.equal(partnerCalls,1);
     for(const dataset of Object.values(result.datasets)){assert.equal(dataset.contentVerified,true);assert.equal(dataset.eligibility.timezone,"America/Los_Angeles");assert.equal(dataset.eligibility.businessDate,dates.today);assert.equal(dataset.eligibility.includesPreConnectionHours,true);assert.equal(dataset.eligibility.authorizesReportingDataset,false);}
     if(mode==="zero_repeat"){assert.notEqual((await run()).status,"stored");assert.equal(metaCalls,3);assert.equal(partnerCalls,1);}
    }else{assert.notEqual(result.status,"stored");assert.equal(result.recordCount,null);assert.equal(result.empty,null);if(mode==="lost_admission"){assert.equal(metaCalls+partnerCalls,0);assert.equal(admissionCalls,1);}}
    assert.equal(result.DatasetWritePerformed,false);assert.equal(result.hourlyRefreshActivated,false);
    assert.equal((await client.query("select count(*)::int n from evidence.source_batches where workspace_id=$1",[workspace])).rows[0].n,["zero_repeat","nonempty"].includes(mode)?2:0);
   }finally{await execution?.close();await client.query("rollback to savepoint first_day_case");await client.query("release savepoint first_day_case");}
  }
  for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_queue_runner","adstable_google_source_runner","adstable_meta_source_runner"])
   if((await client.query("select exists(select 1 from pg_roles where rolname=$1) present",[role])).rows[0].present)assert.equal((await client.query("select has_function_privilege($1,'operations.commit_meta_raw_preflight_with_deadline(bigint,bigint,jsonb,jsonb,jsonb,uuid,bigint)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  assert.deepEqual(await definitions(),before);
  console.log("EO05_META_FIRST_DAY_SQL_PASS scenarios=12 actual_private_server_vault_roles_quota_source_decrypt_close=true generic_refresh_unchanged_rejects_first_day=true LA_native_day_provenance=true prior_future_stale_wrong_operation_denied=true native_HTTP=synthetic live_changes=false");
 }catch(error){console.error("EO05_META_FIRST_DAY_SQL_STOP "+JSON.stringify({phase,constraint:error.constraint??undefined,code:error.code??"ASSERTION_FAILED",message:error.code==="ERR_ASSERTION"?error.message:undefined}));throw error;}finally{await client.query("rollback");}
}
