import test from "node:test";
import assert from "node:assert/strict";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaManagedFetch} from "../app/lib/refresh/quota-native-fetch.server.js";
import {shopifyAdminCostFeedback} from "../app/lib/refresh/shopify-admin-identity-quota.server.js";
import {SHOPIFY_PRODUCT_CANDIDATE_QUERIES} from "../app/lib/shopify/product-identity-verification.server.js";
const cost={requestedQueryCost:8,actualQueryCost:0,throttleStatus:{maximumAvailable:1000,currentlyAvailable:0,restoreRate:0.5}};
const input={operationKey:"a".repeat(64),attemptId:"00000000-0000-4000-8000-000000000001"};
test("Admin feedback repository stores exact observed/partial/missing/invalid shapes separately from Klaviyo",async()=>{
  const calls=[],store=createSharedQuotaRepository({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{result:true}]};}});
  for(const payload of [{extensions:{cost}},{extensions:{cost:{...cost,actualQueryCost:null}}},{},{extensions:{cost:{}}}]){
    const feedback=shopifyAdminCostFeedback(200,payload);
    assert.equal(await store.recordFeedback({...input,feedback}),true);
    assert.match(calls.at(-1).sql,/record_shopify_admin_quota_feedback/);assert.deepEqual(JSON.parse(calls.at(-1).args[2]),feedback);
  }
  assert.equal(calls.length,4);
});
for(const [name,patch] of Object.entries({extra:{secret:"SECRET"},unknown:{kind:"shopify_admin_cost_fake"},status:{httpStatus:null},
  negative:{actualQueryCost:-1},over:{actualQueryCost:9},fraction:{requestedQueryCost:8.1},unsafe:{requestedQueryCost:Number.MAX_SAFE_INTEGER+1},
  nan:{restoreRate:NaN},infinite:{maximumAvailable:Infinity},remaining:{currentlyAvailable:1001},string:{restoreRate:"50"},
  missingActual:{kind:"shopify_admin_cost_observed",actualQueryCost:null},partialActual:{kind:"shopify_admin_cost_partial",actualQueryCost:0},
  missingNumbers:{kind:"shopify_admin_cost_missing"},invalidNumbers:{kind:"shopify_admin_cost_invalid"}}))test(`Admin feedback repository rejects ${name} before SQL`,async()=>{
  let calls=0;const store=createSharedQuotaRepository({query:async()=>{calls++;}});
  await assert.rejects(store.recordFeedback({...input,feedback:{...shopifyAdminCostFeedback(200,{extensions:{cost}}),...patch}}),/INPUT_INVALID/);assert.equal(calls,0);
});
test("Admin stop signal requires known non-connection response and cannot carry Google scope",async()=>{
  const calls=[],store=createSharedQuotaRepository({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{result:true}]};}});
  const stop={...input,knownResponse:true,quotaSignal:"shopify_admin_throttled"};
  assert.equal(await store.stop(stop),true);assert.equal(calls[0].args[4],"shopify_admin_throttled");
  for(const change of [{knownResponse:false},{connectionFailure:true},{quotaObservation:{scope:"ACCOUNT",code:"RESOURCE_EXHAUSTED"}}])
    await assert.rejects(store.stop({...stop,...change}),/INPUT_INVALID/);
  assert.equal(calls.length,1);
});
for(const [name,status,errors,expected] of [
  ["native",200,[{extensions:{code:"THROTTLED"}}],"shopify_admin_throttled"],
  ["native429",429,[{extensions:{code:"THROTTLED"}}],"shopify_admin_throttled"],
  ["mixed",200,[{extensions:{code:"THROTTLED"}},{extensions:{code:"ACCESS_DENIED"}}],null],
  ["statusOnly",429,[],null],["wrongStatus",500,[{extensions:{code:"THROTTLED"}}],null],
  ["partnerCode",200,[{extensions:{code:"429"}}],null],
])test(`Admin ${name} native error passes only its exact signal; failed feedback still attempts stop`,async()=>{
  let calls=0;const stops=[];
  const store={reserve:async x=>({...x,status:"reserved",dispatchBeforeMs:100,dispatchBudgetMs:1000,costBudget:{unit:"shopify_admin_query_points",reservedRequestedCost:8}}),
    recordFeedback:async()=>{throw Error("SECRET");},settle:async()=>{throw Error("unexpected settlement");},stop:async x=>{stops.push(x);return true;}};
  const fetch=createQuotaManagedFetch({provider:"shopify_admin",lane:"background",guard:createSharedQuotaGuard({store,now:()=>0}),resolveOperation:async()=>input.operationKey,
    fetchFn:async()=>{calls++;return new Response(JSON.stringify({errors,extensions:{cost}}),{status,headers:{"content-type":"application/json"}});}});
  await assert.rejects(fetch("https://test.myshopify.com/admin/api/2026-07/graphql.json",{method:"POST",body:JSON.stringify({query:SHOPIFY_PRODUCT_CANDIDATE_QUERIES.identity_product,variables:{productId:"gid://shopify/Product/10"}})}));
  assert.equal(calls,1);assert.equal(stops.length,1);assert.equal(stops[0].quotaSignal,expected);assert.doesNotMatch(JSON.stringify(stops),/SECRET/);
});
