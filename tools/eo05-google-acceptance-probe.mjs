import assert from "node:assert/strict";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import {createGoogleAcceptanceExecution,GOOGLE_ACCEPTANCE_WORK_COST} from "../app/lib/refresh/google-acceptance-server.server.js";
import {GOOGLE_ACCEPTANCE_COORDINATOR_ROLE_CHECK_SQL} from "../app/lib/database/google-acceptance-coordinator-postgres.server.js";
import {GOOGLE_SOURCE_ROLE_CHECK_SQL} from "../app/lib/database/google-source-postgres.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {createTokenVault} from "../app/lib/oauth/token-vault.server.js";
import {createTokenEnvelopeCipher,readProviderTokenKeyring} from "../app/lib/oauth/token-envelope.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {googleSourceRoleInstallationBodyForRehearsal} from "./eo05-google-source-role-plan.mjs";
import {readFileSync} from "node:fs";
import {createGoogleRawCaptureExecution} from "../app/lib/refresh/google-raw-server.server.js";
import {createConfiguredSourceEvidenceCipher} from "../app/lib/database/source-evidence-config.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {handleGoogleRawCaptureRequest} from "../app/lib/refresh/google-raw-request.server.js";

// Existing F01 isolated databases only. Real SQL admission, role checks, vault,
// quota, native reader and paused closure. Physical provider HTTP is synthetic.
export async function googleAcceptanceRehearsal(client,{workspace,shopId,shopDomain,rawCapture=false,datasetMode=false}){
 assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
 await client.query("begin");
 try{
  if(rawCapture){const sql=readFileSync(new URL("../supabase/migrations/20261103221715_eo05_google_refresh_credential_handoff.sql",import.meta.url),"utf8");
   await client.query(sql.trim().replace(/^begin;/," ").replace(/commit;$/," "));}
  if(datasetMode){const sql=readFileSync(new URL("../supabase/migrations/20261104110401_eo05_google_raw_datasets.sql",import.meta.url),"utf8");
   await client.query(sql.trim().replace(/^begin;/," ").replace(/commit;$/," "));}
  await client.query("set local role postgres");await client.query(googleSourceRoleInstallationBodyForRehearsal());
  if(datasetMode){const sql=readFileSync(new URL("./sql/eo05-google-dataset-source-role-extension.sql",import.meta.url),"utf8");
   await client.query(sql.replace(/^begin;/m," ").replace(/commit;\s*$/," "));}
  await client.query("grant adstable_google_source_runner,adstable_refresh_coordinator,adstable_runtime to adstable_owner with inherit false, set true, admin false");
  await client.query("set local role adstable_owner");
  let ordinal=0;
  const modes=datasetMode?["zero_repeat","nonempty","no_merchant","expired_token","permission","partial","wrong_role","missing_context","lost_source","lost_readback","tampered_content","lost_finish","authority_drift"]:rawCapture?["zero_repeat","nonempty","expired_token","permission","partial","wrong_role","missing_context","lost_admission","lost_source","lost_readback","lost_finish","late_source_failure","authority_drift"]:
   ["zero_repeat","nonempty","permission","partial","wrong_role","missing_context","expired_token","lost_admission","lost_finish","hold_after_read"];
  for(const mode of modes){
   await client.query("savepoint acceptance_case");let execution;
   try{
    const issued=Date.now(),initial=new Date(issued-3*86400000).toISOString(),scopes=oauthPermissionScopes("google_ads","identity_v1");
    await client.query("update integrations.provider_connections set connected_at=$1 where workspace_id=$2",[initial,workspace]);
    await client.query("update integrations.reporting_account_bindings set effective_from=$1 where workspace_id=$2 and effective_to is null",[initial,workspace]);
    const c=(await client.query("update integrations.provider_connections set granted_scopes=$2 where workspace_id=$1 and provider='google_ads' returning id,credential_id,connection_version",[workspace,scopes])).rows[0];
    const installation=(await client.query("select id::text from shopify.installations where workspace_id=$1 and status='active'",[workspace])).rows[0];
    const store=createRefreshWorkRepository(client);
    const vector={requests:datasetMode?100:10,dbWrites:datasetMode?10000:rawCapture?4096:128,connections:6,rows:datasetMode?10000:2000,bytes:datasetMode?8388608:4194304};
    const budget={global:vector,interactiveReserve:{requests:1,dbWrites:8,connections:1,rows:0,bytes:131072},providers:[{provider:"google_ads",limit:vector}],
     workspaces:[{workspaceId:workspace,limit:vector}],accounts:[{provider:"google_ads",accountId:"111",limit:vector}]};
    await client.query("update operations.refresh_control set budget=$1::jsonb,bounds=$2::jsonb where singleton",[JSON.stringify(budget),JSON.stringify({maxCandidates:8,maxClaims:8,maxAdmissions:1,maxWorkspaces:8})]);
    await client.query("update operations.refresh_queue_control set max_snapshot_age_ms=60000 where singleton");
    await store.checkQueueFromAuthority({expectedRevision:(await store.readQueueCheck()).revision});
    const source=(await store.readPreflightSnapshot()).candidates.find(s=>s.provider==="google_ads");assert.ok(source);
    const environment={ADSTABLE_GOOGLE_ACCEPTANCE_ENABLED:"true",ADSTABLE_GOOGLE_SOURCE_DB_TIMEOUT_MS:"5000",ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DB_TIMEOUT_MS:"5000",
     GOOGLE_ADS_DEVELOPER_TOKEN:"SYNTHETIC-DEVELOPER",SHOPIFY_PARTNER_ORG_ID:"10",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"SYNTHETIC-PARTNER",
     ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:randomBytes(32).toString("base64url")};
    if(rawCapture)Object.assign(environment,{ADSTABLE_GOOGLE_RAW_CAPTURE_ENABLED:"true",
     ADSTABLE_RUNTIME_DATABASE_URL:`postgresql://adstable_runtime.podpwkrpmjiksskxhwsu:${"x".repeat(32)}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require`,
     ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION:"1",ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1:randomBytes(32).toString("base64url"),
     ADSTABLE_SESSION_ENCRYPTION_KEY_V1:randomBytes(32).toString("base64url"),GOOGLE_ADS_OAUTH_CLIENT_ID:"SYNTHETIC-CLIENT",GOOGLE_ADS_OAUTH_CLIENT_SECRET:"SYNTHETIC-SECRET",
     GOOGLE_ADS_OAUTH_REDIRECT_URI:"https://embedded.adstable.app/auth/google-ads/callback"});
    for(const {v}of(await client.query("select distinct key_version v from integrations.provider_credential_envelopes union select distinct key_version v from integrations.oauth_pkce_envelopes")).rows)
     if(Number(v)!==1)environment[`ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V${v}`]=randomBytes(32).toString("base64url");
    for(const [key,role]of[["ADSTABLE_GOOGLE_SOURCE_DATABASE_URL","adstable_google_source_runner"],["ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DATABASE_URL","adstable_refresh_coordinator"]])
     environment[key]=`postgresql://${role}.podpwkrpmjiksskxhwsu:${"x".repeat(32)}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require`;
    const token={access_token:"SYNTHETIC-ACCESS",refresh_token:"SYNTHETIC-REFRESH",permission_profile:"identity_v1",scope:scopes.join(" "),scope_verified_at:new Date(issued-(rawCapture&&mode==="expired_token"?3600001:0)).toISOString(),
     expires_in:3600,expires_at:new Date(issued+(mode==="expired_token"?-1:3600000)).toISOString()};
    const sealed=createTokenEnvelopeCipher({keyring:readProviderTokenKeyring(environment)}).seal({identity:{recordId:c.credential_id,workspaceId:workspace,installGeneration:1,provider:"google_ads",purpose:"provider_token_set"},secret:JSON.stringify(token)});
    await client.query("update integrations.provider_credential_envelopes set payload_ciphertext=$2,nonce=$3,auth_tag=$4,key_version=$5 where id=$1",[c.credential_id,sealed.ciphertext,sealed.nonce,sealed.authTag,sealed.keyVersion]);
    const hash=()=>createHash("sha256").update(randomUUID()).digest("hex"),googleContext={provider:"google_ads",clientScopeKey:hash(),connectionScopeKey:hash(),connectionEpoch:1,accountId:"111",organizationId:null,apiVersion:"v25",
     merchant:{targetAccountId:"99",quotaAccountId:"98",apiVersion:"products/v1",bindingEpoch:1}},partnerContext={provider:"shopify_partner",clientScopeKey:hash(),connectionScopeKey:hash(),connectionEpoch:1,accountId:null,organizationId:"10",apiVersion:"2026-07"};
    await client.query("insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,connection_id,connection_version,account_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled,merchant_enabled,merchant_target_account_id,merchant_quota_account_id,merchant_api_version,merchant_binding_epoch,merchant_credential_id) values($1,1,'google_ads',$2,$3,$4,'111',$5,$6,1,'v25',true,true,'99','98','products/v1',1,$7)",
     [workspace,installation.id,c.id,c.connection_version,googleContext.clientScopeKey,googleContext.connectionScopeKey,c.credential_id]);
    await client.query("insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,client_scope_key,connection_scope_key,connection_epoch,organization_id,api_version,enabled) values($1,1,'shopify_partner',$2,$3,$4,1,'10','2026-07',true)",[workspace,installation.id,partnerContext.clientScopeKey,partnerContext.connectionScopeKey]);
    const gp=randomUUID(),pp=randomUUID();
    for(const [p,ctx,units]of[[gp,googleContext,datasetMode?100:rawCapture?5:4],[pp,partnerContext,2]]){
     await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,$2)",[ctx.connectionScopeKey,ctx.provider]);
     await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,$2,60000,$3,1,5000,1)",[p,ctx.provider,units]);
    }
    for(const [ctx,family,accountId,version,p]of[[googleContext,"reporting_query","111","v25",gp],[googleContext,"merchant_products","99","products/v1",gp],[partnerContext,"partner_graphql",null,"2026-07",pp],
     ...rawCapture?[[googleContext,"token",null,null,gp]]:[]]){
     const r=quotaRouteIdentity(ctx,{provider:ctx.provider,family,accountId,organizationId:ctx.organizationId,version,includes:[]});
     await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required) values($1,$2,true,true)",[r.routeKey,ctx.provider]);
     await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[r.routeKey,p]);
     await client.query("insert into operations.api_quota_failure_bindings values($1,$2)",[r.routeKey,ctx.connectionScopeKey]);
     await client.query("insert into operations.api_quota_route_profiles values($1,$2,operations.shared_api_quota_fingerprint($1),true)",[r.routeKey,ctx.connectionScopeKey]);
     await client.query("insert into operations.api_quota_routes values($1,$1,true)",[r.routeKey]);
    }
    if(mode==="missing_context")await client.query("update operations.refresh_quota_contexts set enabled=false,merchant_binding_epoch=merchant_binding_epoch+1 where workspace_id=$1 and provider='google_ads'",[workspace]);
    if(datasetMode&&mode==="no_merchant")await client.query("update operations.refresh_quota_contexts set merchant_enabled=false,merchant_binding_epoch=merchant_binding_epoch+1 where workspace_id=$1 and provider='google_ads'",[workspace]);
    if(mode==="late_source_failure")await client.query("alter table evidence.source_pages add constraint synthetic_raw_page_failure check(page_ordinal<>1) not valid");
    let admitted,googleCalls=0,partnerCalls=0,rpcCalls=0,tokenCalls=0;
    function poolFactory(role){return ()=>{let active=0,drained;return {on(){},async end(){if(active)await new Promise(resolve=>drained=resolve);},async connect(){
     active++;const name="accept_rpc_"+(++ordinal);let committed=false,lastSql="";
     return {release(){active--;if(!active)drained?.();},async query(sql,args){
      if(sql==="begin")return client.query("savepoint "+name);
      if(sql==="commit"){
       await client.query("set local role adstable_owner");await client.query("release savepoint "+name);committed=true;
       if(mode==="lost_admission"&&lastSql.includes("commit_refresh_preflight_with_deadline")||mode==="lost_finish"&&lastSql.includes("finish_refresh_work")
        ||mode==="lost_source"&&lastSql.includes(datasetMode?"commit_google_dataset_source":"commit_google_identity_source"))throw Error("SYNTHETIC-LOST");return {rows:[]};
      }
      if(sql==="rollback"){if(!committed){await client.query("rollback to savepoint "+name);await client.query("release savepoint "+name);}await client.query("set local role adstable_owner");return {rows:[]};}
      if(sql.startsWith("select pg_catalog.set_config"))return client.query(sql,args);
      if(mode==="lost_readback"&&sql.includes("read_source_receipt"))throw Error("SYNTHETIC-LOST");
      await client.query("set local role "+(mode==="wrong_role"&&role==="adstable_refresh_coordinator"?"adstable_runtime":role));
      const r=await client.query(sql,args);await client.query("set local role adstable_owner");
      if(datasetMode&&mode==="tampered_content"&&sql.startsWith("select evidence.read_source_pages(")&&r.rows[0].result.length)r.rows[0].result[0].ciphertext="00";
      if(sql!==GOOGLE_ACCEPTANCE_COORDINATOR_ROLE_CHECK_SQL&&sql!==GOOGLE_SOURCE_ROLE_CHECK_SQL){rpcCalls++;lastSql=sql;
       if(sql.includes("commit_refresh_preflight_with_deadline")&&r.rows[0].result===true)admitted=JSON.parse(args[2]).claims.find(x=>!admitted||x.id!==admitted.id)??JSON.parse(args[2]).claims.at(-1);}
      return r;
     }};
    }};};}
    const database={async query(sql,args){const name="accept_vault_"+(++ordinal);await client.query("savepoint "+name);
     try{await client.query("set local role adstable_runtime");const r=await client.query(sql,args);await client.query("set local role adstable_owner");await client.query("release savepoint "+name);return r;}
     catch(e){await client.query("rollback to savepoint "+name);await client.query("release savepoint "+name);throw e;}
    }};
    const tokenVault=createTokenVault({database,environment});
    const plan={operationId:randomUUID(),workspaceId:workspace,installGeneration:"1",shopId,shopDomain,accountId:"111",connectionId:c.id,connectionVersion:Number(c.connection_version),credentialId:c.credential_id,
     selectionId:source.selectionId,merchantId:"99",merchantQuotaAccountId:"98",merchantBindingEpoch:1,window:{from:new Date(issued-86400000).toISOString().slice(0,10),to:new Date(issued-86400000).toISOString().slice(0,10)},expiresAt:new Date(issued+600000).toISOString()};
    environment.ADSTABLE_GOOGLE_ACCEPTANCE_PLAN=JSON.stringify(plan);
    const verified={installationAuthority:{authority:"shopify_installation_verified",status:"active",workspaceId:workspace,installGeneration:1},identity:{session:{authority:"shopify_id_token_verified",shopDomain},shop:{authority:"shopify_admin_verified",shopId,myshopifyDomain:shopDomain}},context:{admin:{graphql(){throw Error("No Shopify product lookup");}}}};
    const options={environment,verified,database,tokenVault,operationId:plan.operationId,coordinatorPoolFactory:poolFactory("adstable_refresh_coordinator"),readerPoolFactory:poolFactory("adstable_google_source_runner"),fetchFn:async(endpoint,init)=>{
     const u=new URL(endpoint);
     if(u.hostname==="partners.shopify.com"){partnerCalls++;return Response.json({data:{activeSubscription:{shop:{id:shopId,myshopifyDomain:shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,trialEndsAt:null,
      currentBillingCycle:{startTime:initial,endTime:new Date(Date.now()+86400000).toISOString()},items:[{handle:"monthly",price:{active:true}}],pendingUpdate:null}}});}
     if(rawCapture&&u.hostname==="oauth2.googleapis.com"){tokenCalls++;return Response.json({access_token:"SYNTHETIC-NEW",expires_in:3600,token_type:"Bearer",scope:scopes.join(" ")});}
     googleCalls++;
     if(mode==="authority_drift"&&googleCalls===3)await client.query("update integrations.provider_connections set connection_version=connection_version+1 where id=$1",[c.id]);
     if(mode==="hold_after_read"&&googleCalls===3){const s=await store.readAdmissionSnapshot();assert.equal((await store.recordStop({job:admitted,reason:"worker_lost",expectedRevision:s.state.revision})).recorded,true);}
     if(u.hostname==="googleads.googleapis.com"){
      if(datasetMode){const query=JSON.parse(init.body).query;
       if(!query.includes("FROM product_link")){
        if(googleCalls===10&&mode==="permission")return Response.json({error:{message:"SYNTHETIC-PRIVATE"}},{status:403});
        return Response.json({results:mode==="nonempty"&&query.includes("FROM customer")?[{customer:{id:"111",currencyCode:"USD",timeZone:"UTC"}}]:[],...mode==="partial"&&googleCalls===10?{nextPageToken:"more"}:{}});
       }
       if(mode==="no_merchant")return Response.json({results:[]});
      }
      return Response.json({results:[{productLink:{resourceName:"customers/111/productLinks/7",productLinkId:"7",type:"MERCHANT_CENTER",merchantCenter:{merchantCenterId:"99"}}}]});
     }
     assert.equal(u.hostname,"merchantapi.googleapis.com");
     if(mode==="permission")return Response.json({error:{message:"SYNTHETIC-PRIVATE"}},{status:403});
     return Response.json({products:["nonempty","late_source_failure"].includes(mode)?[{name:"accounts/99/products/en~US~sku",offerId:"sku",feedLabel:"US",contentLanguage:"en",dataSource:"accounts/99/dataSources/7"}]:[],...mode==="partial"?{nextPageToken:"more"}:{}});
    }};
    if(rawCapture){
     Object.assign(environment,{VERCEL_ENV:"production",SHOPIFY_APP_URL:"https://embedded.adstable.app",ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET:randomBytes(32).toString("base64url")});
     environment.ADSTABLE_GOOGLE_RAW_CAPTURE_PLAN=JSON.stringify({target:plan,limits:{maxElapsedMs:60000,maxBytes:1048576,maxPages:1,maxRows:100,maxLinkPages:1,maxLinks:100},
      storageLimits:{maxRows:1000,maxBytes:1048576},sourcePolicy:sourceStoreFixture().input.policy});
     if(datasetMode){const {merchantId,merchantQuotaAccountId,merchantBindingEpoch,...target}=plan;
      environment.ADSTABLE_GOOGLE_RAW_CAPTURE_PLAN=JSON.stringify({version:2,target,merchant:mode==="no_merchant"?null:googleContext.merchant,
       limits:{maxElapsedMs:60000,maxBytes:1048576,maxPages:1,maxRows:1000,maxLinkPages:1,maxLinks:100,maxRequests:40},storageLimits:{maxRows:1000,maxBytes:1048576},sourcePolicy:sourceStoreFixture().input.policy});}
     const rawOptions={environment,operationId:plan.operationId,coordinatorPoolFactory:options.coordinatorPoolFactory,readerPoolFactory:options.readerPoolFactory,
      runtimePoolFactory:poolFactory("adstable_runtime"),fetchFn:options.fetchFn};
     const runRequest=async()=>{
      const request=new Request("https://embedded.adstable.app/internal/google/raw-capture",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${environment.ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET}`},body:JSON.stringify({operationId:plan.operationId})});
      const response=await handleGoogleRawCaptureRequest(request,{environment,createExecution:args=>{execution=createGoogleRawCaptureExecution({...rawOptions,...args});return execution;}});
      return response.json();
     };
     const result=await runRequest();
     assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC|payload|ciphertext|access_token|credentialId/);
     if(datasetMode){
      if(["zero_repeat","nonempty","expired_token","no_merchant"].includes(mode)){
       assert.equal(result.status,mode==="no_merchant"?"partial":"stored",JSON.stringify({mode,result,googleCalls,partnerCalls,tokenCalls,rpcCalls}));
       assert.equal(result.contentVerified,true);assert.equal(result.datasets.account_performance.recordCount,mode==="nonempty"?1:0);
       assert.equal(result.datasets.merchant_identity.status,mode==="no_merchant"?"unavailable":"stored");
       assert.equal((await client.query("select count(*)::int n from evidence.source_batches where workspace_id=$1",[workspace])).rows[0].n,3);
       assert.equal(googleCalls,mode==="no_merchant"?18:20);
       if(mode==="zero_repeat"){const again=await runRequest();assert.notEqual(again.status,"stored");assert.equal(googleCalls,20);}
      }else{
       assert.notEqual(result.status,"stored",JSON.stringify({mode,result,googleCalls,partnerCalls,rpcCalls}));assert.notEqual(result.status,"partial");
       assert.equal(result.recordCount,null);assert.equal(result.empty,null);
       if(mode==="permission"||mode==="partial")assert.equal(result.datasets.account_performance.status,"stored");
      }
      assert.equal(result.DatasetWritePerformed,false);assert.equal(result.hourlyRefreshActivated,false);assert.ok(tokenCalls<=1);continue;
     }
     if(["zero_repeat","nonempty","expired_token"].includes(mode)){
      assert.equal(result.status,"stored",JSON.stringify({mode,result,googleCalls,partnerCalls,tokenCalls,rpcCalls}));
      assert.equal(result.recordCount,mode==="nonempty"?1:0);assert.equal(result.receiptVerified,true);assert.equal(result.sourceStored,true);
      assert.equal(googleCalls,3);assert.equal(partnerCalls,1);assert.equal(tokenCalls,mode==="expired_token"?1:0);
      assert.equal((await client.query("select status from operations.refresh_runs where job_id=$1",[admitted.id])).rows[0].status,"paused");
      const b=(await client.query("select * from evidence.source_batches where id=$1",[result.receipt.batchId])).rows[0];
      const pages=(await client.query("select page_ordinal ordinal,family,origin,capture_layer as \"captureLayer\",numeric_fidelity as \"numericFidelity\",field_coverage as \"fieldCoverage\",payload_schema_version as \"schemaVersion\",sanitizer_version as \"sanitizerVersion\",key_version as \"keyVersion\",payload_hash as \"payloadHash\",plain_byte_count as \"plainBytes\",encode(ciphertext,'hex') ciphertext,encode(nonce,'hex') nonce,encode(auth_tag,'hex') as \"authTag\" from evidence.source_pages where batch_id=$1 order by page_ordinal",[b.id])).rows;
      assert.equal(pages.length,3);const cipher=createConfiguredSourceEvidenceCipher(environment);
      const restored=pages.map(page=>cipher.open({owner:b.authority,attemptId:b.attempt_id,ordinal:b.batch_ordinal,page}));
      assert.equal(restored[1].records.length,result.recordCount);assert.ok(restored.every(p=>Array.isArray(p.records)));
      if(mode==="nonempty")assert.equal(restored[1].records[0].offerId,"sku");
      assert.equal((await client.query("select count(*)::int n from identity.product_identity_mappings where accepted_batch_id=$1 and mapping_state='verified'",[b.id])).rows[0].n,0);
      if(mode==="zero_repeat"){const repeated=await runRequest();assert.notEqual(repeated.status,"stored");assert.equal(googleCalls,3);assert.equal(partnerCalls,1);}
     }else{
      assert.notEqual(result.status,"stored",JSON.stringify({mode,result,googleCalls,partnerCalls,tokenCalls,rpcCalls}));assert.equal(result.recordCount,null);assert.equal(result.empty,null);
      const n=(await client.query("select count(*)::int n from evidence.source_batches where workspace_id=$1",[workspace])).rows[0].n;
      assert.equal(n,["lost_source","lost_readback","lost_finish"].includes(mode)?1:0,JSON.stringify({mode,result}));
      if(mode==="lost_source")assert.equal(result.sourceStored,null);
      if(mode==="lost_readback")assert.equal(result.sourceStored,true);
     }
     assert.equal(result.DatasetWritePerformed,false);assert.equal(result.mappingVerified,false);assert.equal(result.hourlyRefreshActivated,false);
     assert.ok(tokenCalls<=1);continue;
    }
    execution=createGoogleAcceptanceExecution(options);const r=await execution.run();
    if(["zero_repeat","nonempty"].includes(mode)){
     assert.equal(r.status,"observed",JSON.stringify({mode,r,googleCalls,partnerCalls,rpcCalls}));assert.equal(r.recordCount,mode==="nonempty"?1:0);assert.equal(googleCalls,3);assert.equal(partnerCalls,1);
     const job=(await client.query("select status,cost from operations.refresh_runs where job_id=$1",[admitted.id])).rows[0];assert.equal(job.status,"paused");assert.deepEqual(job.cost,GOOGLE_ACCEPTANCE_WORK_COST);
     assert.equal((await client.query("select stage from operations.refresh_work_progress where fence=$1",[admitted.fence])).rows[0].stage,"response_received");
     if(mode==="zero_repeat"){const repeated=await createGoogleAcceptanceExecution(options).run();assert.equal(repeated.status,"stopped");assert.equal(googleCalls,3);assert.equal(partnerCalls,1);}
    }else{assert.equal(r.status,"stopped",JSON.stringify({mode,r}));assert.equal(r.recordCount,null);assert.equal(r.empty,null);}
    if(["wrong_role","expired_token","lost_admission"].includes(mode))assert.equal(googleCalls+partnerCalls,0);
    if(mode==="missing_context")assert.equal(googleCalls,0);
    if(mode==="lost_admission")assert.equal((await client.query("select count(*)::int n from operations.refresh_runs where job_id=$1",[admitted.id])).rows[0].n,1);
    if(mode==="lost_finish")assert.equal((await client.query("select status from operations.refresh_runs where job_id=$1",[admitted.id])).rows[0].status,"paused");
    assert.ok(rpcCalls<128);assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|payload|ciphertext/);
    assert.equal((await client.query("select count(*)::int n from evidence.source_batches where workspace_id=$1",[workspace])).rows[0].n,0);
   }catch(e){console.error("EO05_GOOGLE_PACKAGE2_CASE_STOP",JSON.stringify({mode,code:e.code??"ASSERTION_FAILED",message:e.code==="ERR_ASSERTION"?e.message:undefined}));throw e;}
   finally{await client.query("rollback to savepoint acceptance_case");await client.query("release savepoint acceptance_case");}
  }
  if(datasetMode)console.log("EO05_GOOGLE_RAW_DATASETS_SQL_PASS scenarios=13 fixed17_queries_three_envelopes=true real_roles_encryption_decrypt_readback=true absent_merchant_not_zero=true first_error_no_replay=true native_HTTP=synthetic live_changes=false");
  else if(rawCapture)console.log("EO05_GOOGLE_RAW_SERVER_SQL_PASS scenarios=13 browser_free=true actual_runtime_vault_coordinator_source_roles=true source_receipt_and_decrypted_pages=true zero_nonzero_expired_token=true unknown_no_replay_atomic_rollback=true no_mapping_Dataset_or_hourly_activation=true native_HTTP=synthetic live_changes=false");
  else console.log("EO05_GOOGLE_PACKAGE2_INVOCATION_SQL_PASS scenarios=10 actual_vault_and_two_roles=true admission_entitlement_native_read_and_paused_close=true repeat_no_HTTP=true unknown_no_replay=true no_fixture_stage_reset=true no_Dataset=true native_HTTP=synthetic live_changes=false");
 }finally{await client.query("rollback");}
}
