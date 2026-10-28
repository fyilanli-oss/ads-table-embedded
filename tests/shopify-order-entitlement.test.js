import test,{after} from "node:test";
import assert from "node:assert/strict";
import {createShopifyOrderEntitlementCheck} from "../app/lib/refresh/shopify-order-entitlement.server.js";
import {createShopifyOrderWorkReservations} from "../app/lib/refresh/shopify-order-work-reservation.server.js";
import {createShopifyOrderRangePlanner} from "../app/lib/refresh/shopify-order-range-plan.server.js";
import {fixture,prewriteOwner,restoreShopifyOrderFixtureFetch} from "./helpers/shopify-order-fixture.js";
after(restoreShopifyOrderFixtureFetch);
const flags=r=>{for(const k of ["workerAdmitted","authorizesDispatch","authorizesActivation","checkpointAdvanced","persistable","DatasetWritePerformed"])assert.equal(r[k],false);};
async function setup(){
  const f=fixture(),owner=prewriteOwner(),plan=await createShopifyOrderRangePlanner({expected:owner,database:f.config.database,
    policy:{anchorAt:"2026-10-01T00:00:00Z",cadenceMs:3600000,sliceMs:86400000,settleDelayMs:0,maxRanges:1,pageSize:100,includeOrderHistory:false},now:()=>new Date("2026-10-02T00:00:00Z")}).plan({fromInclusive:"2026-10-01T00:00:00Z"});
  const s={now:Date.now(),calls:[],http:0,phase:"pre_request",current:true,permits:0,stops:0,contextReads:0};
  const context={provider:"shopify_partner",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:1,accountId:null,organizationId:"123",apiVersion:"2026-07"};
  const database={async query(sql,args){s.calls.push({sql,args});
    if(sql.includes("reserve_shopify_order_work")){s.attempt=args[6];return {rows:[{result:{status:"reserved",attemptId:s.attempt,rangeKey:args[5],fence:5,cost:{requests:2,dbWrites:1,connections:1,rows:100,bytes:1000}}}]};}
    if(sql.includes("begin_shopify_order_entitlement")){s.phase="entitlement_intent";if(s.intentError)throw Error("private");return {rows:[{result:s.beginNull?null:{observedAt:new Date(s.now).toISOString(),quotaContext:{...context}}}]};}
    if(sql.includes("load_shopify_order_entitlement_context")){s.contextReads++;return {rows:[{result:s.contextMissing?null:{...context}}]};}
    if(sql.includes("dispatch_shopify_order_entitlement")){if(s.dispatchFalse)return {rows:[{result:false}]};s.phase="entitlement_dispatched";if(s.dispatchError)throw Error("unknown dispatch ack");return {rows:[{result:true}]};}
    if(sql.includes("apply_shopify_order_entitlement")){const value=JSON.parse(args[8]);s.snapshot=value;s.phase=value.active?"entitlement_observed":"entitlement_denied";
      if(s.applyError)throw Error("secret");return {rows:[{result:{...value,sourceObservedAt:value.observedAt}}]};}
    if(sql.includes("shopify_order_entitlement_is_current")){s.onCurrent?.();return {rows:[{result:s.current}]};}
    if(sql.includes("stop_shopify_order_entitlement")){s.stops++;s.reason=args[8];if(s.stopError)throw Error("private");
      const retained=!["entitlement_not_dispatched","entitlement_denied"].includes(s.reason);s.phase="stopped";return {rows:[{result:{recorded:true,reservationRetained:retained}}]};}
    if(sql.includes("release_shopify_order_work"))return {rows:[{result:s.phase==="pre_request"}]};
    throw Error("unexpected SQL");
  }};
  const reservations=createShopifyOrderWorkReservations({database}),reservation=await reservations.reserve({plan,rangeKey:plan.ranges[0].key});s.calls=[];
  const payload={data:{activeSubscription:{shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:true,trialEndsAt:null,
    currentBillingCycle:{startTime:new Date(s.now-100000).toISOString(),endTime:new Date(s.now+86400000).toISOString()},items:[{handle:"monthly",price:{active:false}}],pendingUpdate:null}}};
  const quotaStore={async resolveRoute(r){return r.routeKey;},async reserve(v){s.permits++;s.afterPermit?.();return s.wait?{status:"waiting"}:{status:"reserved",...v,dispatchBeforeMs:s.now+5000,dispatchBudgetMs:5000};},async settle(){return true;},async stop(){return true;},async recordFeedback(){return true;}};
  const options={reservations,quotaStore,environment:{SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"synthetic-secret"},
    now:()=>s.now,limits:{requestTimeoutMs:200,finishReserveMs:10,deadlineAt:s.now+10000},fetchFn:async(_input,init)=>{
      s.http++;s.request=JSON.parse(init.body);assert.equal(s.phase,"entitlement_dispatched");s.onHTTP?.();
      if(s.fetchError)throw Error("secret transport");if(s.pending)return new Promise(resolve=>{s.resolveHTTP=()=>resolve(new Response(JSON.stringify(payload),{headers:{"content-type":"application/json"}}));});
      return new Response(JSON.stringify(payload),{headers:{"content-type":"application/json"}});
    }};
  return {s,context,options,payload,reservations,reservation,check:()=>createShopifyOrderEntitlementCheck(options)};
}
test("fresh fixed Partner query is quota managed and exact reservation receipt never authorizes Admin dispatch",async()=>{
  const h=await setup(),c=h.check(),r=await c.verify({reservation:h.reservation});assert.equal(r.status,"verified");assert.equal(r.entitlementVerified,true);flags(r);
  assert.equal(h.s.http,1);assert.equal(h.s.permits,1);assert.equal(h.s.stops,0);assert.equal(h.s.contextReads,2);
  assert.deepEqual(h.s.request.variables,{appId:"gid://shopify/App/456",shopId:prewriteOwner().shopId});
  assert.match(h.s.request.query,/activeSubscription/);assert.equal(h.s.snapshot.installGeneration,3);assert.ok(Object.isFrozen(r.receipt));
  assert.equal(await c.isCurrent({verification:r}),true);h.s.current=false;assert.equal(await c.isCurrent({verification:r}),false);
  await assert.rejects(c.isCurrent({verification:structuredClone(r)}),/INPUT_INVALID/);
  await assert.rejects(h.reservations.releaseBeforeRequest({reservation:h.reservation}),/INPUT_INVALID/);
  await assert.rejects(c.verify({reservation:h.reservation}),/INPUT_INVALID/);assert.equal(h.s.http,1);
});
test("trial reuses existing normalizer; null subscription persists denial and controlled release",async()=>{
  const h=await setup();h.payload.data.activeSubscription.trialEndsAt=new Date(h.s.now+86400000).toISOString();h.payload.data.activeSubscription.currentBillingCycle=null;
  const r=await h.check().verify({reservation:h.reservation});assert.equal(r.status,"verified");assert.equal(h.s.snapshot.entitlementStatus,"trial");
  const n=await setup();n.payload.data.activeSubscription=null;const denied=await n.check().verify({reservation:n.reservation});assert.equal(denied.status,"denied");assert.equal(denied.reservationRetained,false);assert.equal(n.s.snapshot.entitlementStatus,"subscription_required");flags(denied);
});
test("quota wait and authority change after quota reservation send no HTTP and release only through controlled stop",async()=>{
  for(const mode of ["wait","contextMissing"]){const h=await setup();if(mode==="wait")h.s.wait=true;else h.s.afterPermit=()=>{h.s.contextMissing=true;};
    const r=await h.check().verify({reservation:h.reservation});assert.equal(r.status,"not_dispatched");assert.equal(r.reservationRetained,false);assert.equal(h.s.http,0);assert.equal(h.s.stops,1);flags(r);
  }
});
for(const mode of ["fetchError","wrongShop","graphqlError","applyError","staleAfterApply"])
  test(`first failure stops with held capacity and no cache/retry ${mode}`,async()=>{
    const h=await setup();if(mode==="fetchError")h.s.fetchError=true;if(mode==="wrongShop")h.payload.data.activeSubscription.shop.id="gid://shopify/Shop/999";
    if(mode==="graphqlError")h.payload.errors=[{message:"secret"}];if(mode==="applyError")h.s.applyError=true;if(mode==="staleAfterApply")h.s.current=false;
    const r=await h.check().verify({reservation:h.reservation});assert.notEqual(r.status,"verified");assert.equal(r.reservationRetained,true);assert.equal(h.s.http,1);assert.equal(h.s.stops,1);flags(r);assert.doesNotMatch(JSON.stringify(r),/secret/);
  });
test("lost intent response never triggers HTTP, automatic reconciliation or a second mutation",async()=>{
  const h=await setup();h.s.intentError=true;const r=await h.check().verify({reservation:h.reservation});assert.equal(r.reason,"entitlement_intent_unconfirmed");assert.equal(h.s.http,0);assert.equal(h.s.stops,0);assert.equal(h.s.calls.length,1);flags(r);
  await assert.rejects(h.reservations.releaseBeforeRequest({reservation:h.reservation}),/INPUT_INVALID/);
});
for(const mode of ["dispatchError","dispatchFalse"])test(`unconfirmed or refused dispatch cannot send HTTP ${mode}`,async()=>{
  const h=await setup();h.s[mode]=true;const r=await h.check().verify({reservation:h.reservation});assert.equal(h.s.http,0);assert.equal(r.reservationRetained,true);assert.notEqual(r.status,"verified");assert.equal(h.s.stops,1);flags(r);
});
test("deadline passing during final SQL ownership check cannot publish a verified receipt",async()=>{
  const h=await setup();h.s.onCurrent=()=>{h.s.now+=20000;};const r=await h.check().verify({reservation:h.reservation});assert.equal(r.status,"not_current");assert.equal(r.reservationRetained,true);flags(r);
});
test("deadline before starting preserves original pre-request release handle",async()=>{
  const h=await setup();h.options.limits.deadlineAt=h.s.now+10;assert.equal((await h.check().verify({reservation:h.reservation})).status,"not_started");assert.equal(h.s.calls.length,0);
  assert.equal((await h.reservations.releaseBeforeRequest({reservation:h.reservation})).status,"released");
});
test("timeout cannot apply a late successful response",async()=>{
  const h=await setup();h.s.pending=true;h.options.limits.requestTimeoutMs=15;const r=await h.check().verify({reservation:h.reservation});assert.equal(r.reservationRetained,true);assert.equal(h.s.http,1);assert.equal(h.s.snapshot,undefined);
  h.s.resolveHTTP();await new Promise(resolve=>setTimeout(resolve,15));assert.equal(h.s.snapshot,undefined);assert.equal(h.s.stops,1);
});
test("stop write failure is unknown, never retried or silently released",async()=>{
  const h=await setup();h.s.fetchError=true;h.s.stopError=true;const r=await h.check().verify({reservation:h.reservation});assert.equal(r.reason,"entitlement_stop_unconfirmed");assert.equal(r.reservationRetained,true);assert.equal(h.s.stops,1);
});
test("post-read clock expiry and regressing clock invalidate a genuine receipt",async()=>{
  const h=await setup(),c=h.check(),r=await c.verify({reservation:h.reservation});assert.equal(r.status,"verified");h.s.now-=1;assert.equal(await c.isCurrent({verification:r}),false);
  h.s.now+=20000;assert.equal(await c.isCurrent({verification:r}),false);
});
for(const field of ["claim","receipt","persisted","phase","provider","fence","quotaContext"])
  test(`verify cannot accept caller ${field}`,async()=>{const h=await setup();await assert.rejects(h.check().verify({reservation:h.reservation,[field]:true}),/INPUT_INVALID/);assert.equal(h.s.calls.length,0);});
test("fake factory, serialized reservation and caller resolver/guard overrides are rejected",async()=>{
  const h=await setup();assert.throws(()=>createShopifyOrderEntitlementCheck({...h.options,reservations:{}}),/INPUT_INVALID/);
  for(const field of ["database","appId","resolveOperation","guard","partnerApi","authorizeRead"])assert.throws(()=>createShopifyOrderEntitlementCheck({...h.options,[field]:()=>{}}),/INPUT_INVALID/);
  await assert.rejects(h.check().verify({reservation:structuredClone(h.reservation)}),/INPUT_INVALID/);
});
