import test from "node:test";
import assert from "node:assert/strict";
import {createQuotaManagedFetch,createQuotaReadExecution,quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaScopeResolver} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {refreshQuotaWait} from "../app/lib/refresh/quota-work-wait.server.js";
import {SHOPIFY_PRODUCT_CANDIDATE_QUERIES as queries} from "../app/lib/shopify/product-identity-verification.server.js";

const claim={workspaceId:"w",installGeneration:"1",provider:"meta",accountId:"act_1",id:"j",fence:1};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(provider,readExecution) {
  const calls=[],reservations=[],settles=[],stops=[],feedback=[],lookups=[],q={};
  const admin=provider==="shopify_admin";
  const context={provider,clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:3,
    accountId:admin?"test.myshopify.com":provider==="meta"?"act_1":provider==="google_ads"?"123":"account1",
    organizationId:null,apiVersion:admin?"2026-07":provider==="meta"?"v24.0":provider==="google_ads"?"v23":"2026-10-15"};
  const store={resolveRoute:async x=>{lookups.push(x);return q.missing?null:x.routeKey;},
    reserve:async x=>{reservations.push(x);await q.reserving?.();if(q.wait)return {status:"waiting"};
      return {...x,status:"reserved",dispatchBeforeMs:Date.now()+10000,dispatchBudgetMs:10000,
        // Synthetic test receipt, not a selected native limit or real SQL issuance.
        ...admin?{costBudget:{unit:"shopify_admin_query_points",reservedRequestedCost:10}}:{}};},
    settle:async x=>{settles.push(x);return q.settlementFailure!==true;},
    stop:async x=>{stops.push(x);await q.stopping?.();return true;},recordFeedback:async x=>{feedback.push(x);return q.feedbackFailure!==true;}};
  const resolver=createQuotaScopeResolver({store,loadContext:async()=>{await q.loading?.();return context;}});
  const fetch=createQuotaManagedFetch({provider,readExecution,lane:"background",guard:createSharedQuotaGuard({store,now:Date.now}),
    resolveOperation:resolver,isDispatchCurrent:async(d,k)=>{await q.checking?.();return await resolver(d)===k;},
    fetchFn:async(...args)=>{calls.push(args);await q.sending?.();if(q.throw)throw Error("SECRET");
      if(q.malformed)return {};
      return Response.json(q.payload??(admin?{data:{},extensions:{cost:{requestedQueryCost:8,actualQueryCost:5,
        throttleStatus:{maximumAvailable:1000,currentlyAvailable:995,restoreRate:50}}}}:{}),{status:q.status??200});}});
  const address=admin?"https://test.myshopify.com/admin/api/2026-07/graphql.json":provider==="meta"?
    "https://graph.facebook.com/v24.0/act_1/insights":provider==="google_ads"?
    "https://googleads.googleapis.com/v23/customers/123/googleAds:search":"https://a.klaviyo.com/api/events/";
  const init=admin?{method:"POST",body:JSON.stringify({query:queries.identity_product,variables:{productId:"gid://shopify/Product/10"}})}:
    provider==="google_ads"?{method:"POST",body:"{}"}:provider==="klaviyo"?{headers:{revision:context.apiVersion}}:{};
  return {q,calls,reservations,settles,stops,feedback,lookups,fetch,read:(options={})=>fetch(address,{...init,...options})};
}
async function failure(read) {try{await read();}catch(e){return e;}assert.fail("must fail");}

for(const provider of ["meta","google_ads","klaviyo"])test(`${provider} HTTP before separate Admin wait prevents whole-read first-page replay`,async()=>{
  const execution=createQuotaReadExecution(),source=fixture(provider,execution),admin=fixture("shopify_admin",execution);
  await source.read();admin.q.wait=true;
  const error=await failure(admin.read);
  assert.deepEqual(quotaBoundaryControl(error),{status:"waiting",boundaryExternalOutcome:"not_sent",priorBoundaryAttempts:1});
  assert.equal(refreshQuotaWait(error,"provider_page",claim),null);
  assert.equal(source.calls.length,1);assert.equal(admin.calls.length,0);
  await failure(source.read);await failure(admin.read);
  assert.equal(source.reservations.length,1);assert.equal(admin.reservations.length,1);
});

test("a true first composite wait stays zero and seals siblings before their first reservation",async()=>{
  const execution=createQuotaReadExecution(),source=fixture("meta",execution),admin=fixture("shopify_admin",execution);
  admin.q.wait=true;const error=await failure(admin.read);
  assert.equal(quotaBoundaryControl(error).priorBoundaryAttempts,0);
  assert.ok(refreshQuotaWait(error,"provider_page",claim));
  await failure(source.read);assert.equal(source.lookups.length,0);assert.equal(source.calls.length,0);
});

test("sequential calls on multiple transports count physical HTTP once, not resolver or quota operations",async()=>{
  const execution=createQuotaReadExecution(),source=fixture("meta",execution),admin=fixture("shopify_admin",execution),last=fixture("klaviyo",execution);
  await source.read();await admin.read();await source.read();last.q.wait=true;
  assert.equal(quotaBoundaryControl(await failure(last.read)).priorBoundaryAttempts,3);
  assert.equal(source.lookups.length,4);assert.equal(admin.lookups.length,2);
  assert.equal(source.settles.length+admin.settles.length,3);assert.equal(last.calls.length,0);
});

test("sibling waiting in resolver cannot dispatch after a zero-call composite wait",async()=>{
  const execution=createQuotaReadExecution(),a=fixture("meta",execution),b=fixture("shopify_admin",execution),gate=deferred(),entered=deferred();
  b.q.loading=async()=>{entered.resolve();await gate.promise;};
  const pending=failure(b.read);await entered.promise;a.q.wait=true;
  assert.ok(refreshQuotaWait(await failure(a.read),"provider_page",claim));gate.resolve();
  assert.equal(quotaBoundaryControl(await pending).priorBoundaryAttempts,0);
  assert.equal(b.calls.length,0);assert.equal(b.reservations.length,0);
});

for(const phase of ["reserving","checking"])test(`sibling blocked in ${phase} settles not-sent after shared wait without HTTP or refund`,async()=>{
  const execution=createQuotaReadExecution(),a=fixture("meta",execution),b=fixture("shopify_admin",execution),gate=deferred(),entered=deferred();
  b.q[phase]=async()=>{entered.resolve();await gate.promise;};
  const pending=failure(b.read);await entered.promise;a.q.wait=true;
  assert.ok(refreshQuotaWait(await failure(a.read),"provider_page",claim));gate.resolve();
  const error=await pending;
  assert.equal(quotaBoundaryControl(error).status,"not_sent");
  assert.equal(b.calls.length,0);assert.equal(b.reservations.length,1);assert.equal(b.settles.length,1);assert.equal(b.stops.length,0);
});

test("already dispatched concurrent HTTP remains counted and cannot publish after sibling wait",async()=>{
  const execution=createQuotaReadExecution(),a=fixture("meta",execution),b=fixture("shopify_admin",execution),gate=deferred(),entered=deferred();
  a.q.sending=async()=>{entered.resolve();await gate.promise;};
  const pending=failure(a.read);await entered.promise;b.q.wait=true;
  const wait=await failure(b.read);assert.equal(quotaBoundaryControl(wait).priorBoundaryAttempts,1);
  assert.equal(refreshQuotaWait(wait,"provider_page",claim),null);gate.resolve();
  assert.match((await pending).message,/TRANSPORT_STOPPED/);
  assert.equal(a.calls.length,1);assert.equal(a.settles.length,1,"actual completed HTTP is settled, never rolled back");
});

test("two concurrent native calls are both counted before another transport waits",async()=>{
  const execution=createQuotaReadExecution(),a=fixture("meta",execution),b=fixture("shopify_admin",execution),c=fixture("klaviyo",execution);
  await Promise.all([a.read(),b.read()]);c.q.wait=true;
  assert.equal(quotaBoundaryControl(await failure(c.read)).priorBoundaryAttempts,2);
});

for(const fault of ["throw","malformed","feedbackFailure","settlementFailure"])test(`${fault} seals all sibling transports after an attempted HTTP`,async()=>{
  const execution=createQuotaReadExecution(),a=fixture("shopify_admin",execution),b=fixture("meta",execution);
  a.q[fault]=true;await failure(a.read);b.q.wait=true;
  const error=await failure(b.read);assert.equal(quotaBoundaryControl(error).priorBoundaryAttempts,1);
  assert.equal(refreshQuotaWait(error,"provider_page",claim),null);assert.equal(b.reservations.length,0);
});

test("native HTTP rejection stays available to its existing handler after stop and seals sibling dispatch",async()=>{
  const execution=createQuotaReadExecution(),a=fixture("meta",execution),b=fixture("shopify_admin",execution);
  a.q.status=429;assert.equal((await a.read()).status,429);assert.equal(a.stops.length,1);
  assert.equal(quotaBoundaryControl(await failure(b.read)).priorBoundaryAttempts,1);assert.equal(b.calls.length,0);
});

for(const fault of ["throw","rejection"])test(`${fault} closes siblings before asynchronous persistent stop finishes`,async()=>{
  const execution=createQuotaReadExecution(),a=fixture("meta",execution),b=fixture("shopify_admin",execution),gate=deferred(),entered=deferred();
  if(fault==="throw")a.q.throw=true;else a.q.status=429;
  a.q.stopping=async()=>{entered.resolve();await gate.promise;};
  const pending=a.read().catch(e=>e);await entered.promise;
  assert.equal(quotaBoundaryControl(await failure(b.read)).priorBoundaryAttempts,1);assert.equal(b.reservations.length,0);
  gate.resolve();await pending;assert.equal(a.stops.length,1);
});

test("Admin cost overrun seals earlier provider transport and keeps both physical attempts",async()=>{
  const execution=createQuotaReadExecution(),a=fixture("meta",execution),b=fixture("shopify_admin",execution);
  await a.read();b.q.payload={data:{},extensions:{cost:{requestedQueryCost:11,actualQueryCost:1,
    throttleStatus:{maximumAvailable:1000,currentlyAvailable:999,restoreRate:50}}}};
  assert.match((await failure(b.read)).message,/COST_BUDGET_EXCEEDED/);
  assert.equal(quotaBoundaryControl(await failure(a.read)).priorBoundaryAttempts,2);
  assert.equal(b.stops.length,1);assert.equal(a.calls.length+b.calls.length,2);
});

for(const phase of ["loading","sending"])test(`cancellation during ${phase} immediately seals siblings even when dependency ignores signal`,async()=>{
  const execution=createQuotaReadExecution(),a=fixture("meta",execution),b=fixture("shopify_admin",execution),gate=deferred(),entered=deferred();
  const controller=new AbortController();a.q[phase]=async()=>{entered.resolve();await gate.promise;};
  const pending=failure(()=>a.read({signal:controller.signal}));await entered.promise;controller.abort();
  assert.equal(quotaBoundaryControl(await failure(b.read)).priorBoundaryAttempts,phase==="sending"?1:0);
  assert.equal(b.calls.length,0);assert.equal(b.reservations.length,0);gate.resolve();
  await pending;assert.equal(a.calls.length,phase==="sending"?1:0);
});

for(const fault of ["missing","invalid_request","aborted"])test(`${fault} before first HTTP seals execution without manufacturing a waiting receipt`,async()=>{
  const execution=createQuotaReadExecution(),a=fixture("meta",execution),b=fixture("shopify_admin",execution);a.q.missing=fault==="missing";
  const read=fault==="invalid_request"?()=>a.fetch("http://invalid.example/"):fault==="aborted"?
    ()=>a.fetch("https://graph.facebook.com/v24.0/act_1/insights",{signal:AbortSignal.abort()}):a.read;
  const error=await failure(read);assert.equal(quotaBoundaryControl(error).priorBoundaryAttempts,0);
  assert.equal(refreshQuotaWait(error,"provider_page",claim),null);await failure(b.read);assert.equal(b.calls.length,0);
});

test("opaque execution cannot be copied, JSON-restored, mutated, or attached to Partner entitlement",()=>{
  const handle=createQuotaReadExecution();assert.ok(Object.isFrozen(handle));assert.deepEqual(Object.keys(handle),[]);
  assert.throws(()=>{handle.attempts=0;},TypeError);
  for(const input of [null,{}, {...handle},JSON.parse(JSON.stringify(handle)),{attempts:0,closed:false}])
    assert.throws(()=>fixture("meta",input),/INPUT_INVALID/);
  assert.throws(()=>createQuotaManagedFetch({provider:"shopify_partner",readExecution:handle,lane:"background",
    guard:{execute(){}},resolveOperation(){}}),/INPUT_INVALID/);
});

test("independent read handles and ordinary transport counters do not mix",async()=>{
  const a=fixture("meta",createQuotaReadExecution()),b=fixture("shopify_admin",createQuotaReadExecution()),c=fixture("meta");
  await a.read();b.q.wait=true;c.q.wait=true;
  for(const f of [b,c])assert.equal(quotaBoundaryControl(await failure(f.read)).priorBoundaryAttempts,0);
  await a.read();assert.equal(a.calls.length,2);
});
