import assert from "node:assert/strict";
import {randomUUID,createHash,randomBytes} from "node:crypto";
import "@shopify/shopify-api/adapters/node";
import {shopifyApi,ApiVersion,LogSeverity,Session} from "@shopify/shopify-api";
import {abstractFetch,setAbstractFetchFunc} from "@shopify/shopify-api/runtime";
import {createShopifyAdminIdentitySdkBridge} from "../app/lib/refresh/shopify-admin-sdk-quota-bridge.server.js";
import {createGoogleSourceServerExecution} from "../app/lib/refresh/google-source-server.server.js";
import {createGoogleReadRunner} from "../app/lib/refresh/google-read-runner.server.js";
import {GOOGLE_SOURCE_RPC,GOOGLE_SOURCE_ROLE,GOOGLE_SOURCE_ROLE_CHECK_SQL} from "../app/lib/database/google-source-postgres.server.js";
import {createGoogleSourceMappingFlow} from "../app/lib/refresh/google-source-mapping-flow.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {dispatchRefreshPreflight} from "../app/lib/refresh/preflight-bridge.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {googleSourceRoleInstallationBodyForRehearsal} from "./eo05-google-source-role-plan.mjs";

const sdkRoot=import.meta.resolve("@shopify/shopify-app-react-router/server");
const {graphqlClientFactory}=await import(new URL("./clients/admin/graphql.mjs",sdkRoot));
const {handleClientErrorFactory}=await import(new URL("./authenticate/admin/helpers/handle-client-error.mjs",sdkRoot));

// Independent actual admission; no short deadline borrowed from another test.
// Real SQL, real SDK/REST/quota/collection/writers. Only physical HTTP responses,
// credentials and explicit source-review decisions are synthetic. No snapshot,
// source manifest, review page, mapping ID or rule row is fabricated/rewritten.
export async function googleMappingFlowRehearsal(client,{workspace,shopId,shopDomain,server=false,nativeRead=false}){
 assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
 assert.ok(!nativeRead||server,"native runner uses actual limited-role transport");
 const previous=abstractFetch;await client.query("begin");
 try{
  const initial=new Date(Date.now()-3*86400000).toISOString();
  await client.query("update integrations.provider_connections set connected_at=$1 where workspace_id=$2",[initial,workspace]);
  await client.query("update integrations.reporting_account_bindings set effective_from=$1 where workspace_id=$2 and effective_to is null",[initial,workspace]);
  const scopes=[...oauthPermissionScopes("google_ads","identity_v1")];
  const connection=(await client.query("update integrations.provider_connections set granted_scopes=$2 where workspace_id=$1 and provider='google_ads' returning id,credential_id,connection_version",[workspace,scopes])).rows[0];
  const installation=(await client.query("select id::text from shopify.installations where workspace_id=$1 and status='active'",[workspace])).rows[0];
  const store=createRefreshWorkRepository(client),quotaStore=createSharedQuotaRepository(client);await store.checkQueueFromAuthority({expectedRevision:(await store.readQueueCheck()).revision});
  const vector={requests:20,dbWrites:20,connections:10,rows:100,bytes:10000},accounts=[{provider:"meta",accountId:"act_101"},{provider:"google_ads",accountId:"111"},{provider:"klaviyo",accountId:"klaviyo-a"}];
  const budget={global:vector,interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},providers:accounts.map(a=>({provider:a.provider,limit:vector})),workspaces:[{workspaceId:workspace,limit:vector}],accounts:accounts.map(a=>({...a,limit:vector}))};
  await client.query("update operations.refresh_control set budget=$1::jsonb,bounds=$2::jsonb where singleton",[JSON.stringify(budget),JSON.stringify({maxCandidates:8,maxClaims:8,maxAdmissions:8,maxWorkspaces:8})]);
  const day=new Date(Date.now()-86400000).toISOString().slice(0,10),window={from:day,to:day},limits={deadlineAt:Date.now()+120000,requestTimeoutMs:1000,finishReserveMs:10};
  const entitlementVerifier=createRefreshEntitlementVerifier({store,appId:"gid://shopify/App/456",now:Date.now,limits,authorizeRead:async()=>true,
   partnerApi:{appId:"gid://shopify/App/456",activeSubscription:async()=>({data:{activeSubscription:{shop:{id:shopId,myshopifyDomain:shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,trialEndsAt:null,
    currentBillingCycle:{startTime:initial,endTime:new Date(Date.now()+86400000).toISOString()},items:[{handle:"monthly",price:{active:true}}],pendingUpdate:null}}})}});
  let execution;const admission=await dispatchRefreshPreflight({store,now:Date.now,entitlementVerifier,
   buildWorkPlan:async s=>s.provider==="google_ads"?{partitionId:"google-source-mapping-flow",workClass:"hourly_hot_window",window,cost:{requests:2,dbWrites:5,connections:1,rows:5,bytes:1000},limits:{...limits,maxRows:5,maxBytes:1000}}:null,
   readPage:async value=>{execution=structuredClone({claim:value.claim,window:value.window,entitlementReceipt:value.entitlementReceipt});return {kind:"complete",payload:{}};},validatePage:()=>({complete:true,rows:[]})});
  assert.equal(admission.status,"awaiting_dataset");
  await client.query("update operations.refresh_work_progress set stage='request_intent',rows_observed=0,bytes_observed=0 where fence=$1",[execution.claim.fence]);
  const hash=()=>createHash("sha256").update(randomUUID()).digest("hex");
  await client.query("insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,connection_id,connection_version,account_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled,merchant_enabled,merchant_target_account_id,merchant_quota_account_id,merchant_api_version,merchant_binding_epoch,merchant_credential_id) values($1,1,'google_ads',$2,$3,$4,'111',$5,$6,1,'v25',true,true,'99','98','products/v1',1,$7)",
   [workspace,installation.id,connection.id,connection.connection_version,hash(),hash(),connection.credential_id]);
  await client.query("insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,account_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled) values($1,1,'shopify_admin',$2,$3,$4,$5,1,'2026-10',true)",[workspace,installation.id,shopDomain,hash(),hash()]);
  async function route(provider,family,account,version){
   const ctx=await store.loadQuotaContext({...execution,provider});assert.ok(ctx,provider+" context");const r=quotaRouteIdentity(ctx,{provider,family,accountId:account,organizationId:null,version,includes:[]}),p=randomUUID(),admin=provider==="shopify_admin";
   await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,$2) on conflict do nothing",[ctx.connectionScopeKey,provider]);
   await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required,reserved_requested_cost) values($1,$2,true,true,$3) on conflict do nothing",[r.routeKey,provider,admin?10:null]);
   await client.query("insert into operations.api_quota_policies(id,provider,cost_unit,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,$2,$3,60000,1000000,0,5000,1000)",[p,provider,admin?"shopify_admin_query_points":"quota_units"]);
   await client.query("insert into operations.api_quota_bindings values($1,$2,$3)",[r.routeKey,p,admin?10:1]);
   await client.query("insert into operations.api_quota_failure_bindings values($1,$2) on conflict do nothing",[r.routeKey,ctx.connectionScopeKey]);
   await client.query("insert into operations.api_quota_route_profiles select $1,$2,operations.shared_api_quota_fingerprint($1),true on conflict(operation_key) do update set quota_fingerprint=excluded.quota_fingerprint,enabled=true",[r.routeKey,ctx.connectionScopeKey]);
   await client.query("insert into operations.api_quota_routes values($1,$1,true) on conflict(route_key) do update set enabled=true",[r.routeKey]);
  }
  await route("google_ads","reporting_query","111","v25");await route("google_ads","merchant_products","99","products/v1");await route("shopify_admin","identity_product_variant",shopDomain,"2026-10");
  const api=shopifyApi({apiKey:"a".repeat(32),apiSecretKey:"b".repeat(32),hostName:"example.com",apiVersion:ApiVersion.October26,isEmbeddedApp:true,logger:{level:LogSeverity.Error,log:()=>{}}});
  const session=new Session({id:"offline_"+shopDomain,shop:shopDomain,state:"synthetic",isOnline:false,accessToken:"SYNTHETIC-ADMIN",scope:"read_products"});
  const admin={graphql:graphqlClientFactory({params:{api,logger:{debug:()=>{}}},session,handleClientError:handleClientErrorFactory({request:new Request("https://example.com"),onError:async()=>{}})})};
  const verified={installationAuthority:{authority:"shopify_installation_verified",status:"active",workspaceId:workspace,installGeneration:1},
   identity:{session:{authority:"shopify_id_token_verified",shopDomain},shop:{authority:"shopify_admin_verified",shopId,myshopifyDomain:shopDomain}},context:{admin}};
  const context={merchant_id:"99",feed_label:"US",content_language:"en",data_source:"accounts/99/dataSources/7",legacy_local:false};
  await client.query("set local role postgres");
  assert.equal((await client.query("select exists(select 1 from pg_roles where rolname=$1) present",[GOOGLE_SOURCE_ROLE])).rows[0].present,false);
  await client.query(googleSourceRoleInstallationBodyForRehearsal());
  // Fixture-only SET ROLE authority for the outer rollback transaction, never installed by the artifact.
  await client.query("grant adstable_google_source_runner to adstable_owner with inherit false, set true, admin false");
  await client.query("set local role adstable_owner");
  assert.equal((await client.query("select has_table_privilege('adstable_google_source_runner','identity.product_identity_mappings','SELECT,INSERT,UPDATE,DELETE') allowed")).rows[0].allowed,false);
  const profileSignatures=[...new Set(GOOGLE_SOURCE_RPC.map(x=>x[1]))];
  async function profileReady(){await client.query("set local role adstable_google_source_runner");try{return (await client.query(GOOGLE_SOURCE_ROLE_CHECK_SQL,[profileSignatures])).rows[0].profile_ready;}finally{await client.query("set local role adstable_owner");}}
  assert.equal(await profileReady(),true,"exact dedicated role profile");
  await client.query("savepoint missing_rpc");
  await client.query("revoke execute on function identity.commit_verified_mapping(jsonb,uuid,jsonb) from adstable_google_source_runner");
  assert.equal(await profileReady(),false,"missing write grant must refuse startup before native I/O");
  await client.query("rollback to savepoint missing_rpc");await client.query("release savepoint missing_rpc");

  await client.query("savepoint unsafe_profile");
  await client.query("grant select on identity.product_identity_mappings to adstable_google_source_runner");
  assert.equal(await profileReady(),false,"a direct table grant must refuse startup");
  await client.query("rollback to savepoint unsafe_profile");await client.query("release savepoint unsafe_profile");
  await client.query("savepoint extra_rpc");
  await client.query("grant execute on function evidence.cleanup_source_retention(uuid,bigint,bigint,uuid,text,bigint,integer,timestamptz,jsonb) to adstable_google_source_runner");
  assert.equal(await profileReady(),false,"an unrelated private RPC must refuse startup");
  await client.query("rollback to savepoint extra_rpc");await client.query("release savepoint extra_rpc");
  assert.equal(await profileReady(),true);

  assert.equal((await client.query("select has_function_privilege('adstable_google_source_runner','evidence.cleanup_source_retention(uuid,bigint,bigint,uuid,text,bigint,integer,timestamptz,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);

  const modes=nativeRead?["empty","empty_omitted","nonempty","permission","malformed","link_missing","partial_native","response_limit","role_drift","fence_before_native","expired_token","native_error","deadline","lost_quota_ack","post_context_drift"]:
   ["success","source_lost","rule_lost","mapping_lost","read_failed","denied","wrong_parent","partial_native","native_error","fence_before_rule","abort_after_source","target_missing","review_timeout","mapping_abort"];
  for(const mode of modes){
   await client.query("savepoint google_flow_case");
   let flow;
   try{
    const {input}=sourceStoreFixture(),counts={source:0,rule:0,mapping:0,current:0,ads:0,merchant:0,admin:0},controller=new AbortController();let decisionCalls=0;
    const database={async query(sql,args){
     const kind=sql.includes("commit_google_identity_source")?"source":sql.includes("commit_reviewed_source_rule")?"rule":sql.includes("commit_verified_mapping")?"mapping":null;
     if(kind)counts[kind]++;
     if(sql.includes("lookup_verified_mapping"))counts.current++;
     if(mode==="fence_before_rule"&&sql.includes("source_rule_review_state"))await client.query("update operations.refresh_runs set fence=fence+1 where workspace_id=$1 and job_id=$2",[workspace,execution.claim.id]);
     if(mode==="read_failed"&&sql.includes("lookup_verified_mapping"))throw Error("SYNTHETIC-PRIVATE-READ");
     const privateSql=kind||sql.includes("source_rule_review_state")||sql.includes("mapping_review_state")||sql.includes("lookup_verified_mapping");
     if(privateSql)await client.query("savepoint google_flow_rpc");let r;
     try{if(server)await client.query("set local role adstable_google_source_runner");r=await client.query(sql,args);if(server)await client.query("set local role adstable_owner");if(privateSql)await client.query("release savepoint google_flow_rpc");}
     catch(error){if(privateSql){await client.query("rollback to savepoint google_flow_rpc");await client.query("release savepoint google_flow_rpc");}throw error;}
     if(!server&&mode===kind+"_lost")throw Error("SYNTHETIC-PRIVATE-LOST");
     if(!server&&kind==="mapping"&&mode==="mapping_abort"){controller.abort();return new Promise(resolve=>setTimeout(()=>resolve(r),20));}return r;
    }};
    const issued=Date.now(),bridge=nativeRead?null:createShopifyAdminIdentitySdkBridge();if(bridge)setAbstractFetchFunc(bridge.fetch);
    const rule={state:"verified_source_rule",source_reference:"synthetic-reviewed-native-configuration",scope:{workspace_id:workspace,installation_generation:1,provider_connection_id:connection.id,platform:"google_ads",platform_account_id:"111"},product_context:context,shop_id:shopId,format:"shopify_market_product_variant",market:"US"};
    const plan={identity:{provider:"google_ads",accountId:"111",nativeId:mode==="target_missing"?"not-present":"shopify_US_123_456",context},
     ruleProposal:{ruleKey:"synthetic-google-flow",previousRuleId:null,basis:{version:"product-source-rule-v1",provider:"google_ads",format:rule.format,market:rule.market},from:new Date(issued-1000).toISOString(),until:new Date(issued+60000).toISOString(),maxObservationAgeMs:60000},
     rulePolicy:{version:"synthetic",until:new Date(issued+30000).toISOString()},mappingPolicy:{version:"synthetic",until:new Date(issued+30000).toISOString()},deadlineAt:new Date(issued+60000).toISOString()};
    const options={plan,reviewAuthority:async request=>{decisionCalls++;if(mode==="abort_after_source")controller.abort();if(mode==="review_timeout"){controller.abort();return new Promise(()=>{});}return {status:mode==="denied"?"denied":"approved",decisionId:randomUUID(),snapshotHash:request.snapshotHash,proposalHash:request.proposalHash,validUntil:request.expiresAt};},
     readerOptions:{verified,database,tokenVault:{loadProviderTokenSet:async()=>({access_token:"SYNTHETIC-ACCESS",refresh_token:"SYNTHETIC-REFRESH",permission_profile:"identity_v1",scope:scopes.join(" "),expires_in:3600,scope_verified_at:new Date(issued).toISOString(),expires_at:new Date(issued+(mode==="expired_token"?-1:3600000)).toISOString()})},
      merchantId:"99",developerToken:"SYNTHETIC-DEVELOPER",sdkBridge:bridge,sourceRules:[rule],...execution,workStore:store,quotaStore,now:Date.now,readNow:()=>new Date(),signal:controller.signal,
      maxPages:mode==="partial_native"?1:10,sourceStorage:{cipher:input.cipher,policy:input.policy,limits:{maxRows:1000,maxBytes:1000000}},fetchFn:async(endpoint)=>{
       const u=new URL(endpoint);
       if(u.hostname==="googleads.googleapis.com"){counts.ads++;if(mode==="deadline")return new Promise(()=>{});
        if(mode==="post_context_drift"&&counts.ads===2)await client.query("update operations.refresh_quota_contexts set merchant_binding_epoch=merchant_binding_epoch+1 where workspace_id=$1 and provider='google_ads'",[workspace]);
        return Response.json({results:mode==="link_missing"?[]:[{productLink:{resourceName:"customers/111/productLinks/7",productLinkId:"7",type:"MERCHANT_CENTER",merchantCenter:{merchantCenterId:"99"}}}]});}
       if(u.hostname==="merchantapi.googleapis.com"){counts.merchant++;
        if(mode==="native_error"||mode==="permission")return Response.json({error:{message:"SYNTHETIC-PRIVATE"}},{status:mode==="permission"?403:500});
        if(mode==="malformed")return Response.json({products:null});if(mode==="empty_omitted")return Response.json({});
        return Response.json({products:nativeRead&&mode!=="nonempty"?[]:[{name:"accounts/99/products/en~US~shopify_US_123_456",offerId:"shopify_US_123_456",feedLabel:"US",contentLanguage:"en",dataSource:context.data_source}],...(mode==="partial_native"?{nextPageToken:"more"}:{})});}
       assert.equal(u.hostname,shopDomain);counts.admin++;return Response.json({data:{shop:{id:shopId,myshopifyDomain:shopDomain},product:{id:"gid://shopify/Product/123",legacyResourceId:"123"},productVariant:{id:"gid://shopify/ProductVariant/456",legacyResourceId:"456",product:{id:mode==="wrong_parent"?"gid://shopify/Product/999":"gid://shopify/Product/123",legacyResourceId:mode==="wrong_parent"?"999":"123"}}},
        extensions:{cost:{requestedQueryCost:8,actualQueryCost:5,throttleStatus:{maximumAvailable:1000,currentlyAvailable:995,restoreRate:50}}}});
      }}};
    if(server){
     const key=()=>randomBytes(32).toString("base64url"),environment={
      ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION:"1",ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1:key(),
      ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:key(),ADSTABLE_SESSION_ENCRYPTION_KEY_V1:key(),
      GOOGLE_ADS_DEVELOPER_TOKEN:"SYNTHETIC-DEVELOPER",ADSTABLE_GOOGLE_SOURCE_DB_TIMEOUT_MS:"30000",
      ADSTABLE_GOOGLE_SOURCE_DATABASE_URL:"postgresql://adstable_google_source_runner.podpwkrpmjiksskxhwsu:"+"x".repeat(32)+"@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require"};
     // Test-only adapter retains the outer rollback fixture. Each actual RPC runs
     // as the exact narrow role with only the published function grants. Lost
     // acknowledgement is injected AFTER releasing the successful SQL savepoint.
     let poolOrdinal=0;
     const poolFactory=()=>{let active=0,drained;return {on(){},async end(){if(active)await new Promise(resolve=>{drained=resolve;});},async connect(){
      active++;
      const name="server_rpc_"+(++poolOrdinal);let committed=false,lastKind=null;
      return {release(){active--;if(!active)drained?.();},async query(sql,args){
       if(sql==="begin")return client.query("savepoint "+name);
       if(sql==="commit"){
        await client.query("set local role adstable_owner");await client.query("release savepoint "+name);committed=true;
        if(mode==="lost_quota_ack"&&lastKind==="quota")throw Error("SYNTHETIC-PRIVATE-LOST");
        if(lastKind&&mode===lastKind+"_lost")throw Error("SYNTHETIC-PRIVATE-LOST");
        if(lastKind==="mapping"&&mode==="mapping_abort"){controller.abort();return new Promise(resolve=>setTimeout(()=>resolve({rows:[]}),20));}
        return {rows:[]};
       }
       if(sql==="rollback"){if(!committed){await client.query("rollback to savepoint "+name);await client.query("release savepoint "+name);}await client.query("set local role adstable_owner");return {rows:[]};}
       if(sql===GOOGLE_SOURCE_ROLE_CHECK_SQL){
        await client.query("set local role adstable_google_source_runner");const r=await client.query(sql,args);await client.query("set local role adstable_owner");return r;
       }
       if(sql.startsWith("select pg_catalog.set_config"))return client.query(sql,args);
       lastKind=sql.includes("reserve_shared_api_quota")?"quota":sql.includes("commit_google_identity_source")?"source":sql.includes("commit_reviewed_source_rule")?"rule":sql.includes("commit_verified_mapping")?"mapping":null;
       return database.query(sql,args);
      }};
     }};};
     if(nativeRead){
      for(const k of Object.keys(environment))if(k.startsWith("ADSTABLE_SOURCE_EVIDENCE_"))delete environment[k];
      if(mode==="role_drift")await client.query("revoke execute on function identity.lookup_verified_mapping(jsonb,jsonb) from adstable_google_source_runner");
      if(mode==="fence_before_native")await client.query("update operations.refresh_runs set fence=fence+1 where workspace_id=$1 and job_id=$2",[workspace,execution.claim.id]);
      flow=createGoogleReadRunner({environment,verified,tokenVault:options.readerOptions.tokenVault,execution,
       configuration:{merchantId:"99",limits:{maxRows:1000,maxBytes:mode==="response_limit"?8:1000000,maxPages:mode==="partial_native"?1:10,maxLinkPages:10,maxLinks:1000,maxElapsedMs:mode==="deadline"?20:120000}},
       signal:controller.signal,poolFactory,fetchFn:options.readerOptions.fetchFn});
     }else flow=createGoogleSourceServerExecution({environment,verified,tokenVault:options.readerOptions.tokenVault,sdkBridge:bridge,
      execution,configuration:{merchantId:"99",sourceRules:[rule],plan,sourcePolicy:input.policy,
       limits:{maxRows:1000,maxBytes:1000000,maxPages:mode==="partial_native"?1:10,maxLinkPages:10,maxLinks:1000,maxElapsedMs:120000}},
      reviewAuthority:options.reviewAuthority,signal:controller.signal,poolFactory,fetchFn:options.readerOptions.fetchFn});
    }else flow=createGoogleSourceMappingFlow(options);
    const r=await flow.run();assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC-PRIVATE|SYNTHETIC-ACCESS|SYNTHETIC-ADMIN|SYNTHETIC-REFRESH/);
    await assert.rejects(flow.run(),/EXECUTION_USED/);
    if(nativeRead){
     if(["empty","empty_omitted","nonempty"].includes(mode)){assert.equal(r.status,"read_complete",JSON.stringify({mode,r,counts}));assert.equal(r.recordCount,mode==="nonempty"?1:0);assert.equal(r.empty,mode!=="nonempty");}
     else{assert.equal(r.status,"read_stopped",JSON.stringify({mode,r,counts}));assert.equal(r.recordCount,null);assert.equal(r.empty,null);}
     assert.equal(counts.source+counts.rule+counts.mapping+counts.current+counts.admin+decisionCalls,0,"native read cannot write evidence, review mappings, or call Shopify");
     assert.equal(r.sourceStored,false);assert.equal(r.mappingVerified,false);assert.equal(r.DatasetWritePerformed,false);
     if(["role_drift","fence_before_native","expired_token","lost_quota_ack"].includes(mode))assert.equal(counts.ads+counts.merchant,0);
     if(mode==="link_missing")assert.equal(counts.merchant,0);
     assert.equal((await client.query("select status from operations.refresh_runs where workspace_id=$1 and job_id=$2",[workspace,execution.claim.id])).rows[0].status,"running");
     await flow.close();continue;
    }
    if(mode==="success"){
     assert.equal(r.status,"verified",JSON.stringify({mode,stage:r.stage,reason:r.reason,counts}));assert.equal(r.current.productId,"gid://shopify/Product/123");assert.equal(r.current.variantId,"gid://shopify/ProductVariant/456");assert.equal(r.current.revision,"2");assert.equal(decisionCalls,1);
     assert.equal(counts.source,1);assert.equal(counts.rule,1);assert.equal(counts.mapping,1);assert.equal(r.reportNamespaceVerified,false);assert.equal(r.authorizesActivation,false);
     assert.equal((await client.query("select manifest->'googleRead'->>'deadlineAt' value from evidence.source_batches where id=$1",[r.source.batchId])).rows[0].value,plan.deadlineAt,"actual source SQL deadline is bounded by the whole flow");
     const old=(await client.query("select mapping_state,shopify_product_id from identity.product_identity_mappings where id=$1",[r.sourceMappingId])).rows[0];assert.deepEqual(old,{mapping_state:"unresolved",shopify_product_id:null});
     assert.equal((await client.query("select source_rule_version_id::text,supersedes_id::text from identity.product_identity_mappings where id=$1",[r.acceptedMappingId])).rows[0].source_rule_version_id,r.ruleId);
     assert.equal((await client.query("select count(*)::int n from evidence.source_batches where workspace_id=$1 and handoff_state<>'pending'",[workspace])).rows[0].n,0);
     await client.query("set constraints all immediate");await client.query("set constraints all deferred");
    }else if(mode.endsWith("_lost")||mode==="mapping_abort"){
     const kind=mode.split("_")[0];assert.equal(r.status,"unconfirmed",JSON.stringify({mode,r,counts}));assert.equal(r[kind].status,"unconfirmed");const inspected=await flow.inspect(kind);assert.equal(inspected.receipt.status,"committed");assert.equal(inspected.flowAdvanced,false);
     if(mode==="mapping_abort"){await new Promise(resolve=>setTimeout(resolve,30));assert.equal(counts.current,0,"late acknowledgement cannot advance to current read");}
     if(kind==="source")assert.equal(counts.rule+counts.mapping,0);if(kind==="rule")assert.equal(counts.mapping,0);
    }else{
     assert.equal(r.status,"stopped",JSON.stringify({mode,r,counts}));
     if(mode==="read_failed"){assert.equal(r.stage,"current_read");assert.equal(r.mapping.status,"committed");}
     else assert.equal(counts.rule+counts.mapping,0,mode+" cannot progress to a rule write");
     if(["partial_native","native_error"].includes(mode))assert.equal(counts.source,0);
     if(mode==="abort_after_source")assert.equal(r.source.status,"committed");
    }
    if(server)await flow.close();
    assert.equal((await client.query("select status from operations.refresh_runs where workspace_id=$1 and job_id=$2",[workspace,execution.claim.id])).rows[0].status,"running");
   }catch(error){if(nativeRead)console.error("EO05_GOOGLE_PACKAGE1_CASE_STOP",JSON.stringify({mode,code:error.code??"ASSERTION_FAILED",...(error.code==="ERR_ASSERTION"?{assertion:error.message}:{})}));throw error;
   }finally{if(server&&flow)await flow.close();await client.query("rollback to savepoint google_flow_case");await client.query("release savepoint google_flow_case");}
  }
  if(nativeRead)console.log("EO05_GOOGLE_PACKAGE1_READ_RUNNER_SQL_PASS scenarios=15 actual_reader_and_limited_role=true native_zero_and_nonzero_distinct=true errors_missing_links_partial_and_unknown_never_zero=true no_source_key_or_retention_policy=true no_source_mapping_Dataset_or_job_finish=true native_HTTP=synthetic live_changes=false");
  else if(server)console.log("EO05_GOOGLE_SOURCE_SERVER_SQL_PASS scenarios=14 exact_limited_role_RPC=true separate_source_key=true explicit_policy_and_review=true lost_commit_inspection_readonly=true native_evidence_synthetic=true live_grants=false");
  else console.log("EO05_GOOGLE_MAPPING_FLOW_SQL_PASS actual_source_capture_to_review_to_mapping_to_current_read=true real_SQL_and_SDK=true source_rule_mapping_lost_replies_stop=true explicit_inspection_only=true no_fixture_snapshot_or_manifest_rewrite=true native_evidence_synthetic=true no_Dataset_or_job_finish=true");
 }finally{setAbstractFetchFunc(previous);await client.query("rollback");}
}
