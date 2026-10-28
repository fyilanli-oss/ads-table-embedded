import assert from "node:assert/strict";
import {abstractFetch,setAbstractFetchFunc} from "@shopify/shopify-api/runtime";
import {initializeShopifyAdminRefreshSdk as initialize,getShopifyAdminRefreshSdkBridge as getBridge,closeShopifyAdminRefreshSdk as close} from "../../app/lib/refresh/shopify-admin-sdk-bootstrap.server.js";
import {isShopifyAdminIdentitySdkBridge} from "../../app/lib/refresh/shopify-admin-sdk-quota-bridge.server.js";

const mode=process.argv[2];
async function main(){
  const before=abstractFetch;
  assert.throws(getBridge,/NOT_INITIALIZED/);assert.equal(abstractFetch,before,"import does not install an adapter");
  if(mode==="import-only"){assert.throws(initialize,/NODE_ADAPTER_REQUIRED/);assert.equal(abstractFetch,before);return;}
  await import("@shopify/shopify-app-react-router/adapters/node");
  if(mode==="router-only"){assert.throws(initialize,/NODE_ADAPTER_REQUIRED/);assert.equal(abstractFetch,before);return;}
  await import("@shopify/shopify-api/adapters/node");
  assert.equal(abstractFetch,globalThis.fetch);
  if(mode==="foreign-hook"){
    const foreign=async()=>{throw Error("must not call");};setAbstractFetchFunc(foreign);
    assert.throws(initialize,/NODE_ADAPTER_REQUIRED/);assert.equal(abstractFetch,foreign);return;
  }
  if(mode==="close-before"){close();assert.throws(initialize,/CLOSED/);assert.equal(abstractFetch,globalThis.fetch);return;}
  const nativeFetch=globalThis.fetch,bridge=initialize();
  assert.ok(isShopifyAdminIdentitySdkBridge(bridge));assert.equal(abstractFetch,bridge.fetch);assert.equal(globalThis.fetch,nativeFetch);
  assert.equal(initialize(),bridge);assert.equal(getBridge(),bridge);
  if(mode==="singleton")return;
  if(mode==="input"){
    for(const fn of [initialize,getBridge,close])for(const arg of [undefined,{},bridge,()=>{}])assert.throws(()=>fn(arg),/INPUT_INVALID/);
    assert.equal(getBridge(),bridge);return;
  }
  if(mode==="unbound"){await assert.rejects(abstractFetch("https://test.myshopify.com/admin/api/2026-10/graphql.json"),/UNBOUND_HTTP/);return;}
  if(mode==="close"){
    close();close();assert.throws(initialize,/CLOSED/);assert.throws(getBridge,/CLOSED/);assert.equal(abstractFetch,bridge.fetch);
    await assert.rejects(bridge.fetch("https://example.com"),/RUNTIME_CLOSED/);assert.throws(()=>bridge.wrap({}),/RUNTIME_CLOSED/);return;
  }
  if(mode==="changed"){
    const foreign=async()=>{};setAbstractFetchFunc(foreign);assert.throws(getBridge,/HOOK_CHANGED/);assert.equal(abstractFetch,foreign);
    setAbstractFetchFunc(bridge.fetch);assert.throws(initialize,/CLOSED/);await assert.rejects(bridge.fetch("https://example.com"),/RUNTIME_CLOSED/);return;
  }
  const {shopifyApi,ApiVersion,LogSeverity,Session}=await import("@shopify/shopify-api");
  const {createRefreshShopifyAdminIdentityClient,createRefreshShopifyAdminOrderClient}=await import("../../app/lib/refresh/quota-authority-binding.server.js");
  const {SHOPIFY_PRODUCT_CANDIDATE_QUERIES:queries}=await import("../../app/lib/shopify/product-identity-verification.server.js");
  const {createShopifyOrderPageRequest}=await import("../../app/lib/shopify/order-read-protocol.server.js");
  const {SHOPIFY_PERMISSION_SCOPES_QUERY}=await import("../../app/lib/shopify/permission-scope-protocol.server.js");
  const {quotaBoundaryControl}=await import("../../app/lib/refresh/quota-native-fetch.server.js");
  const sdkRoot=import.meta.resolve("@shopify/shopify-app-react-router/server");
  const {graphqlClientFactory}=await import(new URL("./clients/admin/graphql.mjs",sdkRoot));
  const {handleClientErrorFactory}=await import(new URL("./authenticate/admin/helpers/handle-client-error.mjs",sdkRoot));
  const api=shopifyApi({apiKey:"a".repeat(32),apiSecretKey:"b".repeat(32),hostName:"example.com",apiVersion:ApiVersion.October26,isEmbeddedApp:true,logger:{level:LogSeverity.Error,log:()=>{}}});
  const workspace="11111111-1111-4111-8111-111111111111";
  function fixture(domain="test.myshopify.com"){
    const calls=[],loads=[],reserves=[],settles=[],stops=[],feedback=[],auth=[],q={};
    const context={provider:"shopify_admin",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:1,accountId:domain,organizationId:null,apiVersion:"2026-10"};
    const session=new Session({id:`offline_${domain}`,shop:domain,state:"synthetic",isOnline:false,accessToken:`SECRET-${domain}`,scope:"read_products,read_orders"});
    const admin={graphql:graphqlClientFactory({params:{api,logger:{debug:()=>{}}},session,
      handleClientError:handleClientErrorFactory({request:new Request("https://example.com"),onError:async x=>auth.push(x)})})};
    const config={sdkBridge:getBridge(),verified:{installationAuthority:{authority:"shopify_installation_verified",status:"active",workspaceId:workspace,installGeneration:3},
      identity:{shop:{authority:"shopify_admin_verified",shopId:"gid://shopify/Shop/12",myshopifyDomain:domain},session:{authority:"shopify_id_token_verified",shopDomain:domain}},context:{admin}},
      claim:{workspaceId:workspace,installGeneration:"3",provider:"meta",accountId:"act_123",id:"job1",fence:2},window:{from:"2026-10-01",to:"2026-10-01"},
      entitlementReceipt:{observedAt:"2026-10-28T15:00:00Z"},now:Date.now,
      workStore:{loadQuotaContext:async x=>{loads.push(x);return context;}},quotaStore:{
        resolveRoute:async x=>q.missing?null:x.routeKey,
        reserve:async x=>{reserves.push(x);await q.reserving?.();return {...x,status:"reserved",dispatchBeforeMs:Date.now()+5000,dispatchBudgetMs:5000,costBudget:{unit:"shopify_admin_query_points",reservedRequestedCost:8}};},
        settle:async x=>{settles.push(x);return true;},stop:async x=>{stops.push(x);return true;},recordFeedback:async x=>{feedback.push(x);return true;}},
      fetchFn:async(endpoint,init)=>{calls.push({endpoint,init});await q.native?.();
        assert.equal(new URL(endpoint).hostname,domain);assert.equal(init.headers.get("X-Shopify-Access-Token"),session.accessToken);
        return new Response(JSON.stringify({data:{shop:{id:"gid://shopify/Shop/12",myshopifyDomain:domain}},extensions:{cost:{requestedQueryCost:8,actualQueryCost:0,throttleStatus:{maximumAvailable:1000,currentlyAvailable:0,restoreRate:0.5}}}}),{status:q.status??200,headers:{"content-type":"application/json"}});}};
    return {q,context,calls,loads,reserves,settles,stops,feedback,auth,config,identity:()=>createRefreshShopifyAdminIdentityClient(config),orders:()=>createRefreshShopifyAdminOrderClient(config)};
  }
  const read=client=>client.graphql(queries.identity_product,{variables:{productId:"gid://shopify/Product/10"},tries:1});
  if(mode==="identity-orders-permission"){
    const f=fixture();assert.equal((await read(f.identity())).status,200);
    const order=f.orders(),request=createShopifyOrderPageRequest({family:"order_headers",shop:{id:"gid://shopify/Shop/12",myshopifyDomain:f.context.accountId},range:{fromInclusive:"2026-10-01T00:00:00Z",toExclusive:"2026-10-02T00:00:00Z"}});
    await order.graphql(request.query,{variables:request.variables,tries:1});await order.graphql(SHOPIFY_PERMISSION_SCOPES_QUERY,{variables:{},tries:1});
    assert.equal(f.calls.length,3);assert.equal(f.reserves.length,3);assert.equal(f.settles.length,3);assert.equal(f.feedback.length,3);
    assert.ok(f.loads.every(x=>x.provider==="shopify_admin"&&x.claim.provider==="meta"&&x.claim.accountId==="act_123"&&x.claim.fence===2));assert.equal(f.auth.length,0);return;
  }
  if(mode==="two-shops"){
    const a=fixture(),b=fixture("other.myshopify.com");await Promise.all([read(a.identity()),read(b.identity())]);
    for(const f of [a,b]){assert.equal(f.calls.length,1);assert.equal(f.reserves.length,1);assert.equal(f.feedback.length,1);assert.equal(f.stops.length,0);}return;
  }
  if(mode==="authority"){
    const f=fixture();f.q.reserving=()=>{f.context.connectionEpoch++;};await assert.rejects(read(f.identity()),e=>quotaBoundaryControl(e)?.status==="not_sent");
    assert.equal(f.calls.length,0);assert.equal(f.settles.length,1);return;
  }
  if(mode==="missing-profile"){
    const f=fixture();f.q.missing=true;await assert.rejects(read(f.identity()),e=>quotaBoundaryControl(e)?.status==="not_configured");assert.equal(f.calls.length,0);assert.equal(f.reserves.length,0);return;
  }
  if(mode==="known-error"){
    const f=fixture();f.q.status=401;await assert.rejects(read(f.identity()));assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);assert.equal(f.auth.length,0);assert.equal(f.settles.length,0);return;
  }
  if(mode==="shutdown"){
    const f=fixture();let entered,release;const started=new Promise(r=>{entered=r;}),blocked=new Promise(r=>{release=r;});
    f.q.reserving=()=>{entered();return blocked;};const client=f.identity(),pending=read(client);await started;
    close();await assert.rejects(pending,/ABORTED/);release();await new Promise(r=>setImmediate(r));
    assert.equal(f.calls.length,0);assert.equal(f.settles.length,1);await assert.rejects(read(client),/RUNTIME_CLOSED/);assert.throws(f.orders,/RUNTIME_CLOSED/);return;
  }
  throw Error("unknown scenario");
}
await main();console.log(`SHOPIFY_ADMIN_SDK_BOOTSTRAP_PASS ${mode} native_HTTP=0`);
