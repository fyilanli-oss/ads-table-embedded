import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaManagedFetch,quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createQuotaManagedClients} from "../app/lib/providers/quota-managed-clients.server.js";
import {createGoogleAdsRestClient} from "../app/lib/providers/google-ads-rest.server.js";
import {refreshKlaviyoAccessToken} from "../app/lib/providers/klaviyo-api.server.js";
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
const owner={authority:"shopify_installation_verified",workspaceId:"11111111-1111-4111-8111-111111111111",installGeneration:2,status:"active"};
const window={start:"2026-10-19",end:"2026-10-19"};
function fixture({fetchFn=async()=>json({data:[]}),lane="background"}={}) {
  const reservations=[],metadata=[],stops=[],settles=[];let calls=0;
  const store={reserve:async x=>{reservations.push(x);return {status:"reserved",...x,dispatchBudgetMs:10000,dispatchBeforeMs:Date.now()+10000};},
    recordFeedback:async()=>true,settle:async x=>{settles.push(x);return true;},stop:async x=>{stops.push(x);return true;}};
  const guard=createSharedQuotaGuard({store,now:Date.now});
  const options={guard,lane,resolveOperation:async d=>{metadata.push(d);return "a".repeat(64);},fetchFn:async(...args)=>{calls++;return fetchFn(...args);}};
  return {store,options,reservations,metadata,stops,settles,calls:()=>calls,clients:createQuotaManagedClients(options)};
}
const accountRow=(provider)=>({connection_id:"22222222-2222-4222-8222-222222222222",credential_id:"33333333-3333-4333-8333-333333333333",granted_scopes:provider==="meta"?["ads_read"]:["https://www.googleapis.com/auth/adwords"],
  accounts:[{id:provider==="meta"?"act_123":"200",kind:"advertiser",reporting_eligible:true,currency:"USD",timezone:"UTC",login_account_id:null}],reporting_account_id:provider==="meta"?"act_123":"200"});
const database=provider=>({query:async()=>({rows:[accountRow(provider)]})});
const shopifyOptions={environment:{SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"SECRET-TOKEN",SHOPIFY_APP_GID:"gid://shopify/App/456"}};
const subscription={apiVersion:"2026-07",query:"query Safe($shopId: ID!) { activeSubscription { id } }",variables:{shopId:"gid://shopify/Shop/42"}};

test("existing Shopify client uses one shared debit per HTTP request in BOTH lanes without resolver secrets",async()=>{
  for(const lane of ["interactive","background"]) {
    const f=fixture({lane,fetchFn:async(url,init)=>{assert.equal(init.redirect,"error");assert.equal(init.headers.get("X-Shopify-Access-Token"),"SECRET-TOKEN");return json({data:{activeSubscription:null}});}});
    assert.deepEqual(await f.clients.shopify(shopifyOptions).activeSubscription(subscription),{data:{activeSubscription:null}});
    assert.equal(f.calls(),1);assert.equal(f.reservations.length,1);assert.equal(f.settles.length,1);assert.equal(f.reservations[0].lane,lane);
    assert.equal(f.metadata[0].organizationId,"123");assert.doesNotMatch(JSON.stringify([f.metadata,f.reservations]),/SECRET|shopId|activeSubscription|graphql.json/);
  }
});
test("existing Meta runtime charges Channel and product HTTP calls separately and preserves authority",async()=>{
  const f=fixture({fetchFn:async()=>json({data:[]})});
  const api=f.clients.meta({database:database("meta"),tokenVault:{loadProviderTokenSet:async()=>({access_token:"SECRET-TOKEN"})},appSecret:"SECRET-PROOF"});
  const result=await api.readDailyEvidencePages({installationAuthority:owner,dateWindow:window});
  assert.equal(result.provider,"meta");assert.equal(f.calls(),2);assert.equal(f.reservations.length,2);
  assert.deepEqual(f.metadata.map(d=>d.family),["insights","product_insights"]);assert.ok(f.metadata.every(d=>d.accountId==="act_123"));
  assert.doesNotMatch(JSON.stringify(f.metadata),/SECRET|appsecret_proof|date_start|time_range/);
});
test("existing Google runtime charges refresh + EACH reporting page, not once per report",async()=>{
  const f=fixture({fetchFn:async url=>url.includes("oauth2")?json({access_token:"SECRET-ACCESS",token_type:"Bearer",expires_in:3600}):json({results:[]})});
  const api=f.clients.google({database:database("google_ads"),tokenVault:{loadProviderTokenSet:async()=>({refresh_token:"SECRET-REFRESH"})},
    environment:{GOOGLE_ADS_OAUTH_CLIENT_ID:"client",GOOGLE_ADS_OAUTH_CLIENT_SECRET:"SECRET-CLIENT",GOOGLE_ADS_OAUTH_REDIRECT_URI:"https://embedded.adstable.app/auth/google-ads/callback"}});
  await api.readEvidencePage({installationAuthority:owner,queryFamily:"cart_data_product_sales_daily",dateWindow:window});
  await api.readEvidencePage({installationAuthority:owner,queryFamily:"cart_data_product_sales_daily",dateWindow:window,pageToken:"SECRET-CURSOR"});
  assert.equal(f.calls(),3);assert.equal(f.reservations.length,3);assert.deepEqual(f.metadata.map(d=>d.family),["token","reporting_query","reporting_query"]);
  assert.doesNotMatch(JSON.stringify(f.metadata),/SECRET|cart_data|SELECT|pageToken/);
});
function klaviyo(f) {
  return f.clients.klaviyo({accountAuthority:{load:async()=>({connectionId:"c",credentialId:"v",grantedScopes:["campaigns:read","events:read","flows:read","metrics:read"],
    accounts:[{id:"k",kind:"account",status:"active",currency:"USD",timezone:"UTC"}]})},credentialAuthority:{prepareCredential:async()=>({tokenSet:{access_token:"SECRET-K"}})},
    config:{},lifecycle:{load:async()=>({status:"connected",version:1}),markReauthorizationRequired:async()=>{}}});
}
test("existing Klaviyo runtime charges four native families, preserves include modifiers, no invented cursor",async()=>{
  const f=fixture({fetchFn:async url=>{
    if(url.includes("/metrics")) return json({data:[{type:"metric",id:"m1",attributes:{name:"Placed Order",integration:{name:"Shopify"}}},{type:"metric",id:"m2",attributes:{name:"Ordered Product",integration:{name:"Shopify"}}}]});
    return url.includes("reports")?json({data:{attributes:{results:[]}}}):json({data:[]});
  }});
  const r=await klaviyo(f).readDailyEvidenceSnapshot({installationAuthority:owner,businessDate:"2026-10-19"});
  assert.equal(r.status,"completed");assert.equal(f.calls(),4);assert.equal(f.reservations.length,4);
  assert.deepEqual(f.metadata.map(d=>d.family),["metrics","campaign_values","flow_values","events"]);assert.deepEqual(f.metadata[3].includes,["attributions","metric"]);
});
test("native Klaviyo preserves local quota wait instead of converting it to provider/network failure",async()=>{
  const f=fixture();f.store.reserve=async()=>({status:"waiting"});
  await assert.rejects(klaviyo(f).readDailyEvidenceSnapshot({installationAuthority:owner,businessDate:"2026-10-19"}),e=>quotaBoundaryControl(e)?.status==="waiting");
  assert.equal(f.calls(),0);assert.equal(f.stops.length,0);assert.equal(quotaBoundaryControl({message:"SHARED_QUOTA_WAITING"}),null,"provider JSON cannot forge a local wait");
});
test("HTTP errors persist a stop and keep native handlers; HTTP200 errors cannot masquerade as data",async()=>{
  const f=fixture({fetchFn:async()=>json({errors:[{message:"RAW-SECRET",extensions:{code:"429"}}]})});
  await assert.rejects(f.clients.shopify(shopifyOptions).activeSubscription(subscription),/QUOTA_NATIVE_PROVIDER_REJECTED/);
  assert.equal(f.stops.length,1);assert.doesNotMatch(JSON.stringify(f.stops),/RAW-SECRET/);
  const g=fixture({fetchFn:async()=>json({error:{status:"PERMISSION_DENIED"}},403)});
  const fetchFn=createQuotaManagedFetch({provider:"google_ads",...g.options});
  const client=createGoogleAdsRestClient({accessToken:"secret",fetchFn});
  await assert.rejects(client.search({customerId:"200",query:"SELECT customer.id FROM customer"}),e=>e.code==="GOOGLE_ADS_REST_REQUEST_FAILED"&&e.details.status===403);
  assert.equal(g.stops.length,1);assert.equal(g.calls(),1);
  const h=fixture({fetchFn:async()=>json({error:{status:"PERMISSION_DENIED"},results:[]})});
  const guarded=createQuotaManagedFetch({provider:"google_ads",...h.options});
  await assert.rejects(createGoogleAdsRestClient({accessToken:"secret",fetchFn:guarded}).search({customerId:"200",query:"SELECT customer.id FROM customer"}),/QUOTA_NATIVE_PROVIDER_REJECTED/);
  assert.equal(h.stops.length,1);
});
test("Klaviyo OAuth refresh also goes through the same guarded HTTP boundary",async()=>{
  const f=fixture({fetchFn:async()=>json({access_token:"access",refresh_token:"refresh",token_type:"Bearer",expires_in:3600,scope:"accounts:read campaigns:read events:read flows:read metrics:read"})});
  const fetchFn=createQuotaManagedFetch({provider:"klaviyo",...f.options});
  await refreshKlaviyoAccessToken({config:{clientId:"client",clientSecret:"secret"},refreshToken:"refresh",fetchFn});
  assert.equal(f.calls(),1);assert.equal(f.metadata[0].family,"token");
});
test("missing scope, external origin, unknown endpoint, duplicate include or nested transport never bypass quota",async()=>{
  const f=fixture(),fetchFn=createQuotaManagedFetch({provider:"klaviyo",...f.options});
  for(const url of ["https://evil.example/api/metrics","http://a.klaviyo.com/api/metrics","https://a.klaviyo.com/api/unknown","https://a.klaviyo.com/api/events?include=metric&include=attributions","https://a.klaviyo.com/api/events?additional-fields[profile]=x"]) {
    await assert.rejects(fetchFn(url),e=>quotaBoundaryControl(e)?.status==="not_configured");
  }
  assert.equal(f.calls(),0);assert.equal(f.reservations.length,0);
  await assert.rejects(fetchFn("https://a.klaviyo.com/v26.0/debug_token"),e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.throws(()=>createQuotaManagedFetch({provider:"klaviyo",...f.options,fetchFn}),/INPUT_INVALID/);
  assert.throws(()=>f.clients.shopify({...shopifyOptions,fetchImpl:async()=>json({})}),/OVERRIDE_FORBIDDEN/);
  const missing=createQuotaManagedFetch({provider:"klaviyo",...f.options,resolveOperation:async()=>null});
  await assert.rejects(missing("https://a.klaviyo.com/api/metrics"),e=>quotaBoundaryControl(e)?.status==="not_configured");assert.equal(f.calls(),0);
});
test("URL and headers cannot be mutated while quota resolution is awaited; failed stop never becomes native success",async()=>{
  const f=fixture();const url=new URL("https://a.klaviyo.com/api/metrics"),headers=new Headers({authorization:"original"});
  let release;const ready=new Promise(resolve=>{release=resolve;});
  const fetchFn=createQuotaManagedFetch({provider:"klaviyo",...f.options,resolveOperation:async()=>{await ready;return "a".repeat(64);},fetchFn:async(u,i)=>{assert.equal(u,"https://a.klaviyo.com/api/metrics");assert.equal(i.headers.get("authorization"),"original");return json({data:[]});}});
  const result=fetchFn(url,{headers});url.hostname="evil.example";headers.set("authorization","changed");release();await result;
  const g=fixture({fetchFn:async()=>json({error:"private"},403)});g.store.stop=async()=>false;
  await assert.rejects(g.clients.shopify(shopifyOptions).activeSubscription(subscription),/QUOTA_NATIVE_TRANSPORT_STOPPED/);assert.equal(g.calls(),1);
});
test("transport delivery is inactive, does not decide Dataset or requeue unknown requests",()=>{
  const c=JSON.parse(readFileSync(new URL("../contracts/eo-05a-quota-native-transport-v1.json",import.meta.url),"utf8"));
  assert.equal(c.live_activation,false);assert.equal(c.Dataset_or_product_decision,false);assert.equal(c.native_calls,false);assert.equal(c.native_scheduler_activated,false);
});
