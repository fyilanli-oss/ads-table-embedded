import test from "node:test";
import assert from "node:assert/strict";
import {createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {createShopifyPartnerApi} from "../app/lib/shopify/partner-api.server.js";

const claim={workspaceId:"w",installGeneration:"1",provider:"klaviyo",accountId:"a",id:"job",fence:1};
function setup() {
  let reads=0,writes=0,permits=0;
  const installation={workspaceId:"w",installGeneration:"1",shopId:"gid://shopify/Shop/123",shopDomain:"test.myshopify.com",status:"active",observedAt:"2026-10-20T12:00:00.000Z"};
  const payload={data:{activeSubscription:{shop:{id:installation.shopId,myshopifyDomain:installation.shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:true,
    trialEndsAt:null,currentBillingCycle:{startTime:"2026-10-01T00:00:00Z",endTime:"2026-11-01T00:00:00Z"},items:[{handle:"monthly",price:{active:false}}],pendingUpdate:null}}};
  const input={appId:"gid://shopify/App/456",now:()=>0,limits:{requestTimeoutMs:100,finishReserveMs:10,deadlineAt:1000},
    authorizeRead:async()=>{permits++;return true;},partnerApi:{appId:"gid://shopify/App/456",activeSubscription:async()=>{reads++;return payload;}},
    store:{loadRefreshInstallation:async()=>installation,isEntitlementCurrent:async()=>true,
      applyEntitlementSnapshot:async({claim:owner,snapshot})=>{writes++;assert.deepEqual(owner,claim);return {...snapshot,entitlementStatus:snapshot.entitlementStatus,sourceObservedAt:snapshot.observedAt};}}};
  return {input,installation,payload,reads:()=>reads,writes:()=>writes,permits:()=>permits};
}
test("background verifier freshly queries Shopify and persists existing projection without a merchant session",async()=>{
  const f=setup(),v=createRefreshEntitlementVerifier(f.input);
  const r=await v.verify({claim});assert.equal(r.status,"verified");assert.equal(f.reads(),1);assert.equal(f.writes(),1);
  await v.verify({claim});assert.equal(f.reads(),2,"a prior active result is not a fallback cache");
  assert.equal(await v.isCurrent({claim,receipt:r.receipt}),true);
});
test("trial and no active subscription are different; cancellation at cycle end is not immediate cancellation",async()=>{
  const f=setup();f.payload.data.activeSubscription.trialEndsAt="2026-10-25T00:00:00Z";f.payload.data.activeSubscription.currentBillingCycle=null;
  assert.equal((await createRefreshEntitlementVerifier(f.input).verify({claim})).status,"verified");
  f.payload.data.activeSubscription=null;
  assert.equal((await createRefreshEntitlementVerifier(f.input).verify({claim})).status,"denied");assert.equal(f.writes(),2);
});
test("wrong shop, GraphQL errors and failed persistence cannot unlock work or overwrite through a fallback",async()=>{
  for(const mutate of [f=>f.payload.data.activeSubscription.shop.id="gid://shopify/Shop/999",f=>f.payload.errors=[{message:"sensitive"}],
    f=>f.input.store.applyEntitlementSnapshot=async()=>{throw Error("sensitive DB detail");},f=>f.input.store.isEntitlementCurrent=async()=>false]) {
    const f=setup();mutate(f);const result=await createRefreshEntitlementVerifier(f.input).verify({claim});
    assert.equal(result.status,"unavailable");assert.equal(f.reads(),1);assert.doesNotMatch(JSON.stringify(result),/sensitive/);
  }
});
test("missing ownership, unavailable shared quota and insufficient time make zero Shopify requests",async()=>{
  for(const mutate of [f=>f.input.store.loadRefreshInstallation=async()=>null,f=>f.installation.workspaceId="other",
    f=>f.input.authorizeRead=async()=>false,f=>f.input.limits.deadlineAt=50]) {
    const f=setup();mutate(f);assert.notEqual((await createRefreshEntitlementVerifier(f.input).verify({claim})).status,"verified");
    assert.equal(f.reads(),0);assert.equal(f.writes(),0);
  }
});
test("timeout keeps request outcome unknown and late success can never persist or authorize a provider read",async()=>{
  const f=setup();let resolve;
  f.input.limits.requestTimeoutMs=5;f.input.partnerApi.activeSubscription=()=>new Promise(r=>{resolve=r;});
  const r=await createRefreshEntitlementVerifier(f.input).verify({claim});
  assert.deepEqual(r,{status:"unavailable",externalOutcome:"unknown"});
  resolve(f.payload);await new Promise(r=>setImmediate(r));assert.equal(f.writes(),0);
});
test("native Partner adapter forwards cancellation without changing existing API/version/auth",async()=>{
  const controller=new AbortController();let request;
  const api=createShopifyPartnerApi({environment:{SHOPIFY_PARTNER_ORG_ID:"1",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"test-secret",SHOPIFY_APP_GID:"gid://shopify/App/456"},
    fetchImpl:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({data:{activeSubscription:null}})};}});
  await api.activeSubscription({apiVersion:"2026-07",query:"query Test { activeSubscription }",variables:{},signal:controller.signal});
  assert.equal(request.options.signal,controller.signal);assert.match(request.url,/2026-07\/graphql.json$/);
});
