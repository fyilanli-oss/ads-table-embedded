import test,{after} from "node:test";
import assert from "node:assert/strict";
import "@shopify/shopify-api/adapters/node";
import {shopifyApi,ApiVersion,LogSeverity,Session} from "@shopify/shopify-api";
import {abstractFetch,setAbstractFetchFunc} from "@shopify/shopify-api/runtime";
import {createShopifyAdminIdentitySdkBridge} from "../app/lib/refresh/shopify-admin-sdk-quota-bridge.server.js";
import {createQuotaManagedFetch,quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaScopeResolver,quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {SHOPIFY_PRODUCT_CANDIDATE_QUERIES as queries,verifyShopifyProductCandidate} from "../app/lib/shopify/product-identity-verification.server.js";
import {refreshQuotaWait} from "../app/lib/refresh/quota-work-wait.server.js";

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
function fixture({bridge=createShopifyAdminIdentitySdkBridge(),domain=shop.myshopifyDomain}={}) {
  setAbstractFetchFunc(bridge.fetch);
  const q={},calls=[],reservations=[],settles=[],stops=[],feedback=[],auth=[],logs=[];
  const context={provider:"shopify_admin",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:3,
    accountId:domain,organizationId:null,apiVersion:"2026-10"};
  const keys=Object.keys(queries).map(family=>quotaRouteIdentity(context,{provider:"shopify_admin",family,accountId:domain,
    organizationId:null,version:"2026-10",includes:[]}).routeKey);
  const store={resolveRoute:async x=>{await q.loading?.();return q.missing?null:keys.includes(x.routeKey)?x.routeKey:null;},
    reserve:async x=>{reservations.push(x);if(q.waitAt===reservations.length)return {status:"waiting"};
      await q.reserving?.();return {...x,status:"reserved",dispatchBeforeMs:Date.now()+10000,dispatchBudgetMs:10000};},
    settle:async x=>{settles.push(x);return true;},stop:async x=>{stops.push(x);return true;},
    recordFeedback:async x=>{feedback.push(x);return !q.feedbackFailure;}};
  const resolve=createQuotaScopeResolver({store,loadContext:async()=>context});
  const transport=createQuotaManagedFetch({provider:"shopify_admin",lane:"background",guard:createSharedQuotaGuard({store,now:Date.now}),
    resolveOperation:resolve,isDispatchCurrent:async(d,k)=>await resolve(d)===k,
    fetchFn:async(endpoint,init)=>{calls.push({endpoint,init});await q.native?.(init);if(q.throw)throw Error("SECRET-NATIVE");
      return new Response(JSON.stringify(q.payload??{data:{shop:{id:shop.shopId,myshopifyDomain:domain},product:{id:variables.productId,legacyResourceId:"10"},
        productVariant:{id:variables.variantId,legacyResourceId:"20",product:{id:variables.productId,legacyResourceId:"10"}}},
        extensions:{cost:{requestedQueryCost:8,actualQueryCost:5,throttleStatus:{maximumAvailable:1000,currentlyAvailable:995,restoreRate:50}}}}),
      {status:q.status??200,headers:{"content-type":"application/json"}});}});
  const session=new Session({id:`offline_${domain}`,shop:domain,state:"synthetic",isOnline:false,accessToken:"SECRET-TOKEN",scope:"read_products"});
  const params={api,logger:{debug:(...x)=>logs.push(x)}};
  const admin={graphql:graphqlClientFactory({params,session,handleClientError:handleClientErrorFactory({request:new Request("https://example.com"),onError:async x=>auth.push(x)})})};
  const config={admin,transport};
  return {bridge,q,calls,reservations,settles,stops,feedback,auth,logs,context,config,
    wrap:()=>bridge.wrap(config),read:client=>client.graphql(queries.identity_product_variant,{variables,tries:1})};
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
