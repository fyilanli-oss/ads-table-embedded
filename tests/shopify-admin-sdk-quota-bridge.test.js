import test,{after} from "node:test";
import assert from "node:assert/strict";
import "@shopify/shopify-api/adapters/node";
import {shopifyApi,ApiVersion,LogSeverity,Session} from "@shopify/shopify-api";
import {abstractFetch,setAbstractFetchFunc} from "@shopify/shopify-api/runtime";
import {createShopifyAdminIdentitySdkBridge,closeShopifyAdminSdkClient} from "../app/lib/refresh/shopify-admin-sdk-quota-bridge.server.js";
import {createQuotaManagedFetch,createQuotaReadExecution,quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaScopeResolver,quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {SHOPIFY_PRODUCT_CANDIDATE_QUERIES as queries,verifyShopifyProductCandidate} from "../app/lib/shopify/product-identity-verification.server.js";
import {refreshQuotaWait} from "../app/lib/refresh/quota-work-wait.server.js";
import {createRefreshShopifyAdminIdentityClient,createRefreshShopifyAdminOrderClient,createRefreshQuotaClients} from "../app/lib/refresh/quota-authority-binding.server.js";
import {createShopifyOrderPageRequest,parseShopifyOrderPage,SHOPIFY_ORDER_READ_QUERIES as orderQueries} from "../app/lib/shopify/order-read-protocol.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {SHOPIFY_PERMISSION_SCOPES_QUERY} from "../app/lib/shopify/permission-scope-protocol.server.js";

// Only this isolated test worker installs the SDK hook. No application bootstrap edits.
const originalFetch=abstractFetch;after(()=>setAbstractFetchFunc(originalFetch));
const sdkRoot=import.meta.resolve("@shopify/shopify-app-react-router/server");
const {graphqlClientFactory}=await import(new URL("./clients/admin/graphql.mjs",sdkRoot));
const {handleClientErrorFactory}=await import(new URL("./authenticate/admin/helpers/handle-client-error.mjs",sdkRoot));
const api=shopifyApi({apiKey:"a".repeat(32),apiSecretKey:"b".repeat(32),hostName:"example.com",apiVersion:ApiVersion.October26,
  isEmbeddedApp:true,logger:{level:LogSeverity.Error,log:()=>{}}});
const variables={productId:"gid://shopify/Product/10",variantId:"gid://shopify/ProductVariant/20"};
const shop={authority:"shopify_admin_verified",shopId:"gid://shopify/Shop/12",myshopifyDomain:"test.myshopify.com"};
const installation={authority:"shopify_installation_verified",workspaceId:"11111111-1111-4111-8111-111111111111",installGeneration:3,status:"active"};
const orderRange={fromInclusive:"2026-10-01T00:00:00Z",toExclusive:"2026-10-02T00:00:00Z"};
function orderRequest(family="order_headers") {return createShopifyOrderPageRequest({family,shop:{id:shop.shopId,myshopifyDomain:shop.myshopifyDomain},
  ...family==="order_headers"?{range:orderRange}:{orderId:"gid://shopify/Order/10",updatedAt:"2026-10-01T12:00:00Z"}});}
function fixture({bridge=createShopifyAdminIdentitySdkBridge(),domain=shop.myshopifyDomain,readExecution,orders=false}={}) {
  setAbstractFetchFunc(bridge.fetch);
  const q={costBudget:{unit:"shopify_admin_query_points",reservedRequestedCost:10}},calls=[],reservations=[],settles=[],stops=[],feedback=[],auth=[],logs=[];
  const context={provider:"shopify_admin",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:3,
    accountId:domain,organizationId:null,apiVersion:"2026-10"};
  const keys=[...Object.keys(orders?orderQueries:queries),...orders?["permission_scopes"]:[]].map(family=>quotaRouteIdentity(context,{provider:"shopify_admin",family,accountId:domain,
    organizationId:null,version:"2026-10",includes:[]}).routeKey);
  const store={resolveRoute:async x=>{await q.loading?.();return q.missing?null:keys.includes(x.routeKey)?x.routeKey:null;},
    reserve:async x=>{reservations.push(x);if(q.waitAt===reservations.length)return {status:"waiting"};
      await q.reserving?.();return {...x,status:"reserved",dispatchBeforeMs:Date.now()+10000,dispatchBudgetMs:10000,costBudget:q.costBudget};},
    settle:async x=>{settles.push(x);return true;},stop:async x=>{stops.push(x);return true;},
    recordFeedback:async x=>{feedback.push(x);return !q.feedbackFailure;}};
  const resolve=createQuotaScopeResolver({store,loadContext:async()=>context});
  const transport=createQuotaManagedFetch({provider:"shopify_admin",readExecution,lane:"background",guard:createSharedQuotaGuard({store,now:Date.now}),
    resolveOperation:resolve,isDispatchCurrent:async(d,k)=>await resolve(d)===k,
    fetchFn:async(endpoint,init)=>{calls.push({endpoint,init});await q.native?.(init);if(q.throw)throw Error("SECRET-NATIVE");
      return new Response(JSON.stringify(q.payload??{data:{shop:{id:shop.shopId,myshopifyDomain:domain},product:{id:variables.productId,legacyResourceId:"10"},
        ...orders?{orders:{edges:[],pageInfo:{hasNextPage:false,endCursor:null}}}:{},
        productVariant:{id:variables.variantId,legacyResourceId:"20",product:{id:variables.productId,legacyResourceId:"10"}}},
        extensions:{cost:{requestedQueryCost:8,actualQueryCost:5,throttleStatus:{maximumAvailable:1000,currentlyAvailable:995,restoreRate:50}}}}),
      {status:q.status??200,headers:{"content-type":"application/json"}});}});
  const session=new Session({id:`offline_${domain}`,shop:domain,state:"synthetic",isOnline:false,accessToken:"SECRET-TOKEN",scope:"read_products"});
  const params={api,logger:{debug:(...x)=>logs.push(x)}};
  const admin={graphql:graphqlClientFactory({params,session,handleClientError:handleClientErrorFactory({request:new Request("https://example.com"),onError:async x=>auth.push(x)})})};
  const config={admin,transport};
  return {bridge,q,calls,reservations,settles,stops,feedback,auth,logs,context,config,store,
    wrap:()=>orders?bridge.wrapOrders(config):bridge.wrap(config),read:client=>orders?
      client.graphql(orderRequest().query,{variables:orderRequest().variables,tries:1}):client.graphql(queries.identity_product_variant,{variables,tries:1})};
}
test("real pinned React Router/API SDK reaches guarded physical HTTP once and keeps native response",async()=>{
  const f=fixture(),client=f.wrap(),result=await verifyShopifyProductCandidate({admin:client,shop,installation,productId:"10",variantId:"20"});
  assert.equal(result.state,"candidate_verified_in_shop");assert.equal(f.calls.length,1);assert.equal(f.reservations.length,1);assert.equal(f.settles.length,1);
  assert.equal(f.feedback[0].feedback.actualQueryCost,5);assert.equal(f.auth.length,0);
  assert.equal(f.calls[0].init.headers.get("X-Shopify-Access-Token"),"SECRET-TOKEN");assert.equal(f.calls[0].init.signal.aborted,false);
  assert.doesNotMatch(JSON.stringify([f.reservations,f.feedback,f.logs]),/SECRET|gid:|productId/);
});
test("sequential candidate queries use separate debit, no SDK cache bypass",async()=>{
  const f=fixture(),client=f.wrap();await f.read(client);await f.read(client);assert.equal(f.calls.length,2);assert.equal(f.reservations.length,2);
});
test("identity SDK lifetime closes explicitly after successful collection without another HTTP",async()=>{
  const f=fixture(),client=f.wrap();await f.read(client);closeShopifyAdminSdkClient(client);closeShopifyAdminSdkClient(client);
  await assert.rejects(f.read(client),/EXECUTION_CLOSED/);assert.equal(f.calls.length,1);assert.equal(f.reservations.length,1);
});
test("identity SDK close aborts pending dependency and ignores late return",async()=>{
  const f=fixture();let release,entered;const started=new Promise(r=>{entered=r;});
  f.q.native=()=>{entered();return new Promise(r=>{release=r;});};const client=f.wrap(),pending=f.read(client);
  const stopped=assert.rejects(pending);await started;closeShopifyAdminSdkClient(client);await stopped;
  release();await new Promise(r=>setTimeout(r,0));await assert.rejects(f.read(client),/EXECUTION_CLOSED/);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.signal.aborted,true);
});
test("genuine order SDK client admits exact native scope dependency with one quota debit",async()=>{
  const f=fixture({orders:true}),client=f.wrap();await client.graphql(SHOPIFY_PERMISSION_SCOPES_QUERY,{variables:{},tries:1});
  assert.equal(f.calls.length,1);assert.equal(f.reservations.length,1);assert.equal(f.feedback.length,1);assert.equal(f.auth.length,0);
});
test("identity-only SDK client cannot silently grow scope-query capability",async()=>{
  const f=fixture(),client=f.wrap();await assert.rejects(client.graphql(SHOPIFY_PERMISSION_SCOPES_QUERY,{variables:{},tries:1}));
  assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});
test("SDK bridge rejects double wrapping across bridge instances before dispatch",()=>{
  const f=fixture(),client=f.wrap();assert.throws(()=>f.bridge.wrap({admin:client,transport:f.config.transport}),/INPUT_INVALID/);
  assert.throws(()=>createShopifyAdminIdentitySdkBridge().wrap({admin:client,transport:f.config.transport}),/INPUT_INVALID/);assert.equal(f.calls.length,0);
});
for(const status of [401,403,429,500])test(`native SDK HTTP ${status} cannot trigger auth recovery or retry`,async()=>{
  const f=fixture();f.q.status=status;f.q.payload={errors:[{message:"SECRET-ERROR"}]};const client=f.wrap();
  await assert.rejects(f.read(client),e=>e.message==="SHOPIFY_ADMIN_SDK_NATIVE_REQUEST_FAILED");
  assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);assert.equal(f.auth.length,0);
  await assert.rejects(f.read(client),/EXECUTION_CLOSED/);assert.equal(f.calls.length,1);
  assert.doesNotMatch(JSON.stringify([f.feedback,f.logs,f.stops]),/SECRET-ERROR|SECRET-TOKEN/);
});
test("native SDK quota wait survives SDK error wrapping as exact genuine boundary evidence",async()=>{
  const f=fixture();f.q.waitAt=1;const client=f.wrap();let error;try{await f.read(client);}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error)?.status,"waiting");assert.equal(quotaBoundaryControl(error)?.priorBoundaryAttempts,0);
  const claim={workspaceId:installation.workspaceId,installGeneration:"3",provider:"meta",accountId:"act_1",id:"job1",fence:1};
  assert.equal(refreshQuotaWait(error,"provider_page",claim)?.status,"quota_waiting");assert.equal(f.calls.length,0);assert.equal(f.auth.length,0);
});

test("real SDK preserves shared provider-prefix attempts when its separate Admin transport waits",async()=>{
  const execution=createQuotaReadExecution();let sent=0;
  const provider=createQuotaManagedFetch({provider:"meta",readExecution:execution,lane:"background",resolveOperation:async()=>"a".repeat(64),
    guard:{execute:async({run})=>({status:"returned",value:(await run()).value})},fetchFn:async()=>{sent++;return Response.json({});}});
  await provider("https://graph.facebook.com/v24.0/act_1/insights");
  const f=fixture({readExecution:execution});f.q.waitAt=1;const client=f.wrap();let error;
  try{await f.read(client);}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error)?.status,"waiting");assert.equal(quotaBoundaryControl(error)?.priorBoundaryAttempts,1);
  const claim={workspaceId:installation.workspaceId,installGeneration:"3",provider:"meta",accountId:"act_1",id:"job1",fence:1};
  assert.equal(refreshQuotaWait(error,"provider_page",claim),null);assert.equal(sent,1);assert.equal(f.calls.length,0);assert.equal(f.auth.length,0);
  await assert.rejects(provider("https://graph.facebook.com/v24.0/act_1/insights"));assert.equal(sent,1);
  await assert.rejects(f.read(client),/EXECUTION_CLOSED/);
});

test("real SDK first shared wait still has zero attempts and closes every sibling transport",async()=>{
  const execution=createQuotaReadExecution(),f=fixture({readExecution:execution});f.q.waitAt=1;
  let error;try{await f.read(f.wrap());}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error)?.priorBoundaryAttempts,0);
  let lookedUp=0;const provider=createQuotaManagedFetch({provider:"meta",readExecution:execution,lane:"background",
    resolveOperation:async()=>{lookedUp++;return "a".repeat(64);},guard:{execute(){}},fetchFn:async()=>assert.fail()});
  await assert.rejects(provider("https://graph.facebook.com/v24.0/act_1/insights"));assert.equal(lookedUp,0);
});
test("native SDK missing quota profile never dispatches",async()=>{
  const f=fixture();f.q.missing=true;await assert.rejects(f.read(f.wrap()),e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});
test("SDK hook rejects calls without bound execution",async()=>{
  const f=fixture();await assert.rejects(f.bridge.fetch("https://test.myshopify.com"),/UNBOUND_HTTP/);assert.equal(f.calls.length,0);
});
test("native SDK GraphQL error stops once before SDK auth handler and cannot replay",async()=>{
  const f=fixture();f.q.payload={errors:[{message:"SECRET-ERROR",extensions:{code:"THROTTLED"}}],extensions:{cost:{requestedQueryCost:8,
    actualQueryCost:null,throttleStatus:{maximumAvailable:1000,currentlyAvailable:0,restoreRate:50}}}};
  const client=f.wrap();await assert.rejects(f.read(client),/QUOTA_NATIVE_PROVIDER_REJECTED/);assert.equal(f.stops.length,1);
  assert.equal(f.calls.length,1);assert.equal(f.auth.length,0);assert.equal(f.feedback[0].feedback.kind,"shopify_admin_cost_partial");
  await assert.rejects(f.read(client),/EXECUTION_CLOSED/);
});
test("second sequential read waiting keeps first native attempt; SDK cannot erase prior work",async()=>{
  const f=fixture(),client=f.wrap();await f.read(client);f.q.waitAt=2;let error;try{await f.read(client);}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error)?.priorBoundaryAttempts,1);assert.equal(f.calls.length,1);
  const claim={workspaceId:installation.workspaceId,installGeneration:"3",provider:"meta",accountId:"act_1",id:"job1",fence:1};
  assert.equal(refreshQuotaWait(error,"provider_page",claim),null);await assert.rejects(f.read(client),/EXECUTION_CLOSED/);
});
test("SDK cannot add a hidden second physical call even if its outer callback swallows errors",async()=>{
  const f=fixture();f.config.admin={graphql:async(query,opts)=>{
    const input=`https://${shop.myshopifyDomain}/admin/api/2026-10/graphql.json`,init={method:"POST",body:JSON.stringify({query,variables:opts.variables}),signal:opts.signal};
    const first=await f.bridge.fetch(input,init);try{await f.bridge.fetch(input,init);}catch{/* malicious retry must remain latched */}return first;
  }};
  await assert.rejects(f.read(f.wrap()),/EXTRA_HTTP_FORBIDDEN/);assert.equal(f.calls.length,1);assert.equal(f.reservations.length,1);
});
test("SDK body/token refresh or another endpoint cannot become a second dispatch",async()=>{
  const f=fixture();f.config.admin={graphql:async(query,opts)=>{
    await f.bridge.fetch("https://accounts.shopify.com/oauth/token",{method:"POST",body:"SECRET",signal:opts.signal});return new Response("{}");
  }};
  await assert.rejects(f.read(f.wrap()),e=>quotaBoundaryControl(e)?.status==="not_configured");assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});
test("unobserved SDK response cannot produce candidate success",async()=>{
  const f=fixture();f.config.admin={graphql:async()=>new Response("{}")};await assert.rejects(f.read(f.wrap()),/BOUNDARY_NOT_OBSERVED/);
  assert.equal(f.calls.length,0);
});
for(const [name,change] of [["plain fetch",f=>{f.config.transport=fetch;}],["fake transport",f=>{f.config.transport=async()=>new Response("{}");}],
  ["Partner transport",f=>{f.config.transport=createQuotaManagedFetch({provider:"shopify_partner",lane:"background",guard:{execute:async()=>({})},resolveOperation:async()=>"a".repeat(64)});}],
  ["mode",f=>{f.config.mode="report";}],["missing admin",f=>{f.config.admin={};}],["invalid timeout",f=>{f.config.timeoutMs=0;}],
])test(`SDK bridge ${name} cannot bypass branded Admin boundary`,()=>{
  const f=fixture();change(f);assert.throws(f.wrap,/INPUT_INVALID/);assert.equal(f.calls.length,0);
});
for(const [name,opts] of [["retry override",{tries:2}],["headers override",{headers:{"X-Shopify-Access-Token":"OTHER"}}],
  ["API override",{apiVersion:"2026-07"}],["body override",{body:"OTHER"}],["invalid signal",{signal:{aborted:false}}],
])test(`SDK ${name} rejected before native call`,async()=>{
  const f=fixture();await assert.rejects(f.wrap().graphql(queries.identity_product_variant,{variables,...opts}),/INPUT_INVALID/);assert.equal(f.calls.length,0);
});
test("SDK query/variable inputs and native function captured before async quota lookup",async()=>{
  const f=fixture(),client=f.wrap(),copy=structuredClone(variables);let release,entered;
  const started=new Promise(r=>{entered=r;});f.q.loading=()=>new Promise(r=>{release=r;entered();});
  const reading=client.graphql(queries.identity_product_variant,{variables:copy});await started;
  copy.productId="gid://shopify/Product/99";f.config.admin.graphql=()=>{throw Error("retarget");};delete f.q.loading;release();
  await reading;assert.equal(JSON.parse(f.calls[0].init.body).variables.productId,variables.productId);assert.equal(f.calls.length,1);
});
test("concurrent native SDK calls on different wrapped executions keep separate app-shop scopes",async()=>{
  const bridge=createShopifyAdminIdentitySdkBridge(),a=fixture({bridge}),b=fixture({bridge,domain:"other.myshopify.com"});
  await Promise.all([a.read(a.wrap()),b.read(b.wrap())]);assert.equal(a.calls.length,1);assert.equal(b.calls.length,1);
  assert.match(a.calls[0].endpoint,/test\.myshopify\.com/);assert.match(b.calls[0].endpoint,/other\.myshopify\.com/);
  assert.notEqual(a.reservations[0].operationKey,b.reservations[0].operationKey);
});
test("one wrapped execution cannot overlap SDK calls",async()=>{
  const f=fixture(),client=f.wrap();let release,entered;const started=new Promise(r=>{entered=r;});
  f.q.native=()=>new Promise(r=>{release=r;entered();});const first=f.read(client);await started;
  await assert.rejects(f.read(client),/CONCURRENT_CALL_FORBIDDEN/);release();await first;assert.equal(f.calls.length,1);
});
for(const source of ["constructor","call"])test(`SDK ${source} pre-abort cannot reserve or send`,async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();if(source==="constructor")f.config.signal=controller.signal;
  await assert.rejects(f.wrap().graphql(queries.identity_product_variant,{variables,...source==="call"?{signal:controller.signal}:{}}),/IDENTITY_READ_ABORTED/);
  assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});
test("deadline bounds stalled SDK/HTTP; late native response cannot reopen wrapper",async()=>{
  const f=fixture();f.config.timeoutMs=40;let release,child;f.q.native=init=>{child=init.signal;return new Promise(r=>{release=r;});};
  const client=f.wrap();await assert.rejects(f.read(client),/DEADLINE_EXCEEDED/);assert.equal(child.aborted,true);release();
  await new Promise(r=>setTimeout(r,0));await assert.rejects(f.read(client),/EXECUTION_CLOSED/);assert.equal(f.calls.length,1);
});
test("deadline during quota lookup cannot reserve after SDK returns late context",async()=>{
  const f=fixture();f.config.timeoutMs=40;let release;f.q.loading=()=>new Promise(r=>{release=r;});const client=f.wrap();
  await assert.rejects(f.read(client),/DEADLINE_EXCEEDED/);delete f.q.loading;release();await new Promise(r=>setTimeout(r,0));
  assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);await assert.rejects(f.read(client),/EXECUTION_CLOSED/);
});
test("abort during reservation preserves SDK boundary not-sent receipt and settlement",async()=>{
  const f=fixture(),controller=new AbortController();f.config.signal=controller.signal;
  f.q.reserving=()=>{controller.abort();};await assert.rejects(f.read(f.wrap()),/IDENTITY_READ_ABORTED/);
  await new Promise(r=>setTimeout(r,0));assert.equal(f.calls.length,0);assert.equal(f.reservations.length,1);assert.equal(f.settles.length,1);assert.equal(f.stops.length,0);
});
test("unknown native failure and feedback storage failure are not converted to quota wait",async()=>{
  for(const mode of ["native","feedback"]){const f=fixture();if(mode==="native")f.q.throw=true;else f.q.feedbackFailure=true;
    await assert.rejects(f.read(f.wrap()),e=>!quotaBoundaryControl(e));assert.equal(f.calls.length,1);assert.equal(f.settles.length,0);
    assert.equal(f.auth.length,0);if(mode==="native")assert.equal(f.stops[0].knownResponse,false);}
});

function boundFixture({orders=false}={}) {
  const f=fixture({orders}),loads=[];
  // Reuse only synthetic native HTTP and the same profile/guard store, not the lower transport.
  const config={verified:{installationAuthority:structuredClone(installation),identity:{shop:structuredClone(shop),
    session:{authority:"shopify_id_token_verified",shopDomain:shop.myshopifyDomain}},context:{admin:f.config.admin}},
    sdkBridge:f.bridge,claim:{workspaceId:installation.workspaceId,installGeneration:"3",provider:"meta",accountId:"act_123",id:"job1",fence:2},
    window:{from:"2026-10-01",to:"2026-10-01"},entitlementReceipt:{observedAt:"2026-10-27T15:00:00Z"},
    now:Date.now,quotaStore:f.store,
    workStore:{loadQuotaContext:async input=>{loads.push(input);await f.q.contextLoading?.();return f.q.lost?null:f.context;}},
    fetchFn:async(endpoint,init)=>{
      f.calls.push({endpoint,init});await f.q.native?.(init);
      return new Response(JSON.stringify(f.q.payload??{data:{shop:{id:shop.shopId,myshopifyDomain:shop.myshopifyDomain},
        product:{id:variables.productId,legacyResourceId:"10"},productVariant:{id:variables.variantId,legacyResourceId:"20",product:{id:variables.productId,legacyResourceId:"10"}}},
        extensions:{cost:{requestedQueryCost:8,actualQueryCost:5,throttleStatus:{maximumAvailable:1000,currentlyAvailable:995,restoreRate:50}}}}),
        {status:f.q.status??200,headers:{"content-type":"application/json"}});
    }};
  return {...f,loads,boundConfig:config,create:()=>orders?createRefreshShopifyAdminOrderClient(config):createRefreshShopifyAdminIdentityClient(config)};
}
test("fenced Admin: real SDK/candidate reads receive original provider claim window receipt on both context checks",async()=>{
  const f=boundFixture(),result=await verifyShopifyProductCandidate({admin:f.create(),shop,installation,productId:"10",variantId:"20"});
  assert.equal(result.state,"candidate_verified_in_shop");assert.equal(f.calls.length,1);assert.equal(f.reservations.length,1);assert.equal(f.loads.length,2);
  assert.ok(f.loads.every(x=>x.provider==="shopify_admin"&&x.claim.provider==="meta"&&x.claim.accountId==="act_123"&&x.claim.fence===2
    &&x.window.from==="2026-10-01"&&x.entitlementReceipt.observedAt==="2026-10-27T15:00:00Z"));
  assert.equal(result.provider_link_verified,false);assert.equal(f.feedback[0].feedback.actualQueryCost,5);
  assert.doesNotMatch(JSON.stringify([f.loads,f.feedback,f.reservations]),/SECRET|gid:|ProductId|legacyResourceId/);
});
test("fenced Admin: job owner shop and native function captured before caller mutation",async()=>{
  const f=boundFixture(),client=f.create();f.boundConfig.claim.accountId="act_999";f.boundConfig.claim.fence=99;
  f.boundConfig.window.from="2026-10-02";f.boundConfig.entitlementReceipt.observedAt="2000-01-01T00:00:00Z";
  f.boundConfig.verified.identity.shop.myshopifyDomain="other.myshopify.com";
  f.boundConfig.verified.installationAuthority.installGeneration=99;f.boundConfig.verified.context.admin.graphql=()=>{throw Error("retarget");};
  await f.read(client);assert.equal(f.calls.length,1);assert.ok(f.loads.every(x=>x.claim.accountId==="act_123"&&x.claim.fence===2&&x.window.from==="2026-10-01"));
});
for(const [name,change] of [["workspace",f=>{f.boundConfig.claim.workspaceId="other";}],["generation",f=>{f.boundConfig.claim.installGeneration="4";}],
  ["inactive installation",f=>{f.boundConfig.verified.installationAuthority.status="inactive";}],["missing fence",f=>{delete f.boundConfig.claim.fence;}],
  ["Admin as provider job",f=>{f.boundConfig.claim.provider="shopify_admin";}],["multi-day",f=>{f.boundConfig.window.to="2026-10-02";}],
  ["invalid date",f=>{f.boundConfig.window.from="2026-02-30";f.boundConfig.window.to=f.boundConfig.window.from;}],
  ["missing receipt",f=>{delete f.boundConfig.entitlementReceipt;}],["session shop",f=>{f.boundConfig.verified.identity.session.shopDomain="other.myshopify.com";}],
  ["missing native session authority",f=>{delete f.boundConfig.verified.identity.session.authority;}],
  ["unverified shop",f=>{f.boundConfig.verified.identity.shop.authority="unverified";}],["noncanonical shop",f=>{
    f.boundConfig.verified.identity.shop.myshopifyDomain="TEST.myshopify.com";f.boundConfig.verified.identity.session.shopDomain="TEST.myshopify.com";}],
  ["fake bridge",f=>{f.boundConfig.sdkBridge={wrap:()=>f.config.admin};}],["arbitrary guard",f=>{f.boundConfig.guard={};}],
  ["arbitrary resolver",f=>{f.boundConfig.resolveOperation=()=>"a".repeat(64);}],
  ["arbitrary context loader",f=>{f.boundConfig.loadContext=()=>f.context;}],["Admin helper flag",f=>{f.boundConfig.admin=true;}],
  ["legacy callback",f=>{f.boundConfig.authorizeRead=()=>true;}],
])test(`fenced Admin: ${name} rejected before SQL or native call`,()=>{
  const f=boundFixture();change(f);assert.throws(f.create);assert.equal(f.loads.length,0);assert.equal(f.calls.length,0);
});
for(const [name,change] of [["lost job/entitlement",f=>{f.q.lost=true;}],["wrong shop context",f=>{f.context.accountId="other.myshopify.com";}],
  ["wrong API context",f=>{f.context.apiVersion="2026-07";}],["provider context",f=>{f.context.provider="meta";}],
  ["missing profile",f=>{f.q.missing=true;}],
])test(`fenced Admin: ${name} sends no HTTP`,async()=>{
  const f=boundFixture();change(f);await assert.rejects(f.read(f.create()),e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});
test("fenced Admin: current repository adapter intentionally rejects Admin before SQL/native pending step14",async()=>{
  const f=boundFixture();let queries=0;f.boundConfig.workStore=createRefreshWorkRepository({query:async()=>{queries++;throw Error("unexpected SQL");}});
  await assert.rejects(f.read(f.create()),e=>quotaBoundaryControl(e)?.status==="not_configured");assert.equal(queries,0);assert.equal(f.calls.length,0);
});
test("fenced Admin: account app epoch or entitlement drift during reserve settles without HTTP",async()=>{
  for(const change of [f=>{f.context.accountId="other.myshopify.com";},f=>{f.context.clientScopeKey="c".repeat(64);},
    f=>{f.context.connectionEpoch++;},f=>{f.q.lost=true;}]){
    const f=boundFixture();f.q.reserving=()=>change(f);await assert.rejects(f.read(f.create()),e=>quotaBoundaryControl(e)?.status==="not_sent");
    assert.equal(f.calls.length,0);assert.equal(f.reservations.length,1);assert.equal(f.settles.length,1);assert.equal(f.stops.length,0);
  }
});
test("fenced Admin: first quota wait survives real SDK and consumes client",async()=>{
  const f=boundFixture();f.q.waitAt=1;const client=f.create();await assert.rejects(f.read(client),e=>quotaBoundaryControl(e)?.status==="waiting");
  await assert.rejects(f.read(client),/EXECUTION_CLOSED/);assert.equal(f.calls.length,0);
});
test("fenced Admin: normal provider quota factory cannot opt in to Admin",async()=>{
  const f=boundFixture(),{verified,sdkBridge,...ordinary}=f.boundConfig;
  const clients=createRefreshQuotaClients(ordinary);assert.ok(clients);assert.equal(f.loads.length,0);
  // This flag is rejected by the original public options, not forwarded to its private helper.
  assert.throws(()=>createRefreshQuotaClients({...ordinary,admin:true}),/INPUT_INVALID/);
});
test("SDK hook must be actually installed before any captured SDK function runs",async()=>{
  const f=boundFixture();let invoked=0;f.boundConfig.verified.context.admin={graphql:async()=>{invoked++;return new Response("{}");}};
  const client=f.create();setAbstractFetchFunc(originalFetch);
  await assert.rejects(f.read(client),/HOOK_NOT_INSTALLED/);assert.equal(invoked,0);assert.equal(f.loads.length,0);assert.equal(f.calls.length,0);
});
test("a different installed bridge cannot leak a fenced execution into unguarded SDK",async()=>{
  const f=boundFixture(),client=f.create(),other=createShopifyAdminIdentitySdkBridge();setAbstractFetchFunc(other.fetch);
  await assert.rejects(f.read(client),/HOOK_NOT_INSTALLED/);assert.equal(f.loads.length,0);assert.equal(f.calls.length,0);
});
test("fenced Admin: native error persists stop without SDK auth recovery or repeated call",async()=>{
  const f=boundFixture();f.q.status=401;f.q.payload={errors:[{message:"SECRET-ERROR"}]};const client=f.create();
  await assert.rejects(f.read(client),/NATIVE_REQUEST_FAILED/);assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);assert.equal(f.auth.length,0);
  await assert.rejects(f.read(client),/EXECUTION_CLOSED/);
});
test("fenced Admin: timeout at work context cannot reserve or dispatch on late return",async()=>{
  const f=boundFixture();f.boundConfig.timeoutMs=40;let release;f.q.contextLoading=()=>new Promise(r=>{release=r;});const client=f.create();
  await assert.rejects(f.read(client),/DEADLINE_EXCEEDED/);delete f.q.contextLoading;release();await new Promise(r=>setTimeout(r,0));
  assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);await assert.rejects(f.read(client),/EXECUTION_CLOSED/);
});
test("fenced Admin cost: budget cannot be supplied by constructor or request override",async()=>{
  for(const key of ["costBudget","requiredCostUnit","readExecution"]){const f=boundFixture();f.boundConfig[key]={unit:"shopify_admin_query_points",reservedRequestedCost:999};assert.throws(f.create,/INPUT_INVALID/);}
});
test("fenced Admin cost: missing atomic receipt stops before physical SDK HTTP",async()=>{
  const f=boundFixture();delete f.q.costBudget;const client=f.create();
  await assert.rejects(f.read(client),e=>quotaBoundaryControl(e)?.status==="not_sent");assert.equal(f.calls.length,0);assert.equal(f.settles.length,1);assert.equal(f.stops.length,0);
  await assert.rejects(f.read(client),/EXECUTION_CLOSED/);
});
test("fenced Admin cost: real SDK requested-cost excess preserves safe error and closed execution",async()=>{
  const f=boundFixture();f.q.costBudget.reservedRequestedCost=5;const client=f.create();
  await assert.rejects(f.read(client),/COST_BUDGET_EXCEEDED/);assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);assert.equal(f.auth.length,0);
  await assert.rejects(f.read(client),/EXECUTION_CLOSED/);assert.equal(f.calls.length,1);
});

for(const family of Object.keys(orderQueries))test(`real SDK order entry dispatches exact ${family} with separate quota and native cost feedback`,async()=>{
  const f=fixture({orders:true}),r=orderRequest(family),client=f.wrap();
  const result=await client.graphql(r.query,{variables:r.variables,tries:1});assert.equal(result.ok,true);
  assert.equal(f.calls.length,1);assert.equal(f.reservations.length,1);assert.equal(f.feedback.length,1);assert.equal(f.auth.length,0);
  const raw=JSON.parse(f.calls[0].init.body);assert.equal(raw.query,r.query);assert.deepEqual(raw.variables,r.variables);
  assert.ok(f.feedback.every(x=>x.feedback.kind==="shopify_admin_cost_observed"));
  assert.doesNotMatch(JSON.stringify([f.feedback,f.reservations]),/SECRET|orderId|updated_at|gid:|cursor/);
});

test("one installed SDK hook supports isolated identity and order clients without widening identity entry",async()=>{
  const bridge=createShopifyAdminIdentitySdkBridge(),a=fixture({bridge}),b=fixture({bridge,orders:true});
  await a.read(a.wrap());await b.read(b.wrap());assert.equal(a.calls.length,1);assert.equal(b.calls.length,1);
  const c=fixture({bridge}),identity=c.wrap(),r=orderRequest();
  await assert.rejects(identity.graphql(r.query,{variables:r.variables}),/INPUT_INVALID/);assert.equal(c.calls.length,0);
  const d=fixture({bridge,orders:true}),orders=d.wrap();await assert.rejects(orders.graphql(queries.identity_product,{variables:{productId:variables.productId}}),/INPUT_INVALID/);
  assert.equal(d.calls.length,0);assert.equal(d.reservations.length,0);
});

test("order entry cannot replace private classifier via extra public argument or options",async()=>{
  const f=fixture({orders:true}),r=orderRequest();
  const identity=f.bridge.wrap(f.config,()=>"order_headers");
  await assert.rejects(identity.graphql(r.query,{variables:r.variables}),/INPUT_INVALID/);
  assert.throws(()=>f.bridge.wrapOrders({...f.config,classify:()=>"order_headers"}),/INPUT_INVALID/);assert.equal(f.calls.length,0);
});

test("order query variables are captured before async quota reservation",async()=>{
  const f=fixture({orders:true}),client=f.wrap(),r=orderRequest(),v=structuredClone(r.variables);let release;
  f.q.reserving=()=>new Promise(resolve=>{release=resolve;});const pending=client.graphql(r.query,{variables:v,tries:1});
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));v.query="status:paid";v.first=999;release();await pending;
  assert.deepEqual(JSON.parse(f.calls[0].init.body).variables,r.variables);
});

for(const status of [401,403,429,500])test(`real order SDK HTTP ${status} stops once without auth recovery/retry`,async()=>{
  const f=fixture({orders:true});f.q.status=status;f.q.payload={errors:[{message:"SECRET"}]};const client=f.wrap();
  await assert.rejects(f.read(client),/NATIVE_REQUEST_FAILED/);assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);assert.equal(f.auth.length,0);
  await assert.rejects(f.read(client),/EXECUTION_CLOSED/);assert.equal(f.calls.length,1);
});

test("fenced order SDK carries original provider claim and closes on later wait without first-page replay",async()=>{
  const f=boundFixture({orders:true}),client=f.create();await f.read(client);f.q.waitAt=2;let error;
  try{await f.read(client);}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error)?.status,"waiting");assert.equal(quotaBoundaryControl(error)?.priorBoundaryAttempts,1);
  assert.equal(refreshQuotaWait(error,"provider_page",f.boundConfig.claim),null);assert.equal(f.calls.length,1);
  assert.ok(f.loads.every(x=>x.provider==="shopify_admin"&&x.claim.provider==="meta"&&x.claim.accountId==="act_123"&&x.claim.fence===2));
  await assert.rejects(f.read(client),/EXECUTION_CLOSED/);
});

test("fenced order SDK true first wait has zero attempts and no native call",async()=>{
  const f=boundFixture({orders:true});f.q.waitAt=1;let error;try{await f.read(f.create());}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error)?.priorBoundaryAttempts,0);assert.ok(refreshQuotaWait(error,"provider_page",f.boundConfig.claim));assert.equal(f.calls.length,0);
});

for(const mutate of [f=>{f.context.apiVersion="2026-07";},f=>{f.q.lost=true;},f=>{f.q.missing=true;},
  f=>{f.context.accountId="other.myshopify.com";}])test("fenced orders missing current authority/profile/version sends zero HTTP",async()=>{
  const f=boundFixture({orders:true});mutate(f);await assert.rejects(f.read(f.create()),e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});

test("current repository still rejects order Admin context before SQL and native HTTP at step14 gate",async()=>{
  const f=boundFixture({orders:true});let sql=0;f.boundConfig.workStore=createRefreshWorkRepository({query:async()=>{sql++;throw Error("must not query");}});
  await assert.rejects(f.read(f.create()),e=>quotaBoundaryControl(e)?.status==="not_configured");assert.equal(sql,0);assert.equal(f.calls.length,0);
});

for(const key of ["readExecution","orders","classify","loadContext","authorizeRead","guard","costBudget","requiredCostUnit","scopes"])
  test(`fenced orders rejects caller ${key} override before lookup or native HTTP`,()=>{
    const f=boundFixture({orders:true});f.boundConfig[key]={};assert.throws(f.create,/INPUT_INVALID/);assert.equal(f.loads.length,0);assert.equal(f.calls.length,0);
  });

test("fenced order SDK rechecks job/connection epoch after quota reserve and settles stale authority",async()=>{
  const f=boundFixture({orders:true});f.q.reserving=()=>{f.context.connectionEpoch++;};
  await assert.rejects(f.read(f.create()),e=>quotaBoundaryControl(e)?.status==="not_sent");
  assert.equal(f.calls.length,0);assert.equal(f.reservations.length,1);assert.equal(f.settles.length,1);
});

test("fenced order SDK missing point receipt cannot dispatch and native requested-cost excess cannot succeed",async()=>{
  for(const mode of ["missing","excess"]){
    const f=boundFixture({orders:true});if(mode==="missing")delete f.q.costBudget;else f.q.costBudget.reservedRequestedCost=5;
    await assert.rejects(f.read(f.create()),e=>mode==="missing"?quotaBoundaryControl(e)?.status==="not_sent":e.message==="QUOTA_NATIVE_COST_BUDGET_EXCEEDED");
    assert.equal(f.calls.length,mode==="missing"?0:1);assert.equal(f.stops.length,mode==="missing"?0:1);
  }
});

test("real SDK response is consumed by the existing order parser without granting authority or snapshot proof",async()=>{
  const f=fixture({orders:true}),r=orderRequest(),response=await f.wrap().graphql(r.query,{variables:r.variables,tries:1});
  const page=parseShopifyOrderPage({request:r,body:await response.json()});assert.equal(page.state,"parsed");assert.deepEqual(page.rows,[]);
  assert.equal(page.runtimeAuthorityVerified,false);assert.equal(page.snapshotVerified,false);assert.equal(page.authorizesActivation,false);
});

test("fenced order client captures original job owner shop and native SDK function",async()=>{
  const f=boundFixture({orders:true}),client=f.create();f.boundConfig.claim.fence=999;
  f.boundConfig.claim.accountId="act_999";f.boundConfig.verified.context.admin.graphql=()=>{throw Error("retarget");};
  f.boundConfig.verified.installationAuthority.installGeneration=99;
  f.boundConfig.verified.identity.shop.myshopifyDomain="other.myshopify.com";
  await f.read(client);assert.equal(f.calls.length,1);assert.ok(f.loads.every(x=>x.claim.accountId==="act_123"&&x.claim.fence===2));
});

test("fenced order client requires its actual SDK hook before any work context lookup",async()=>{
  const f=boundFixture({orders:true}),client=f.create();setAbstractFetchFunc(originalFetch);
  await assert.rejects(f.read(client),/HOOK_NOT_INSTALLED/);assert.equal(f.calls.length,0);assert.equal(f.loads.length,0);
});
