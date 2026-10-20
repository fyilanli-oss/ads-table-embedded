import test from "node:test";
import assert from "node:assert/strict";
import {googleQuotaObservation} from "../app/lib/refresh/google-quota-observation.server.js";
import {createQuotaManagedFetch} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";

const metadata={provider:"google_ads",family:"reporting_query",version:"v25"};
const error=(scope="DEVELOPER",code="RESOURCE_EXHAUSTED")=>({errorCode:{quotaError:code},message:"SECRET",details:{quotaErrorDetails:{rateScope:scope,rateName:"SECRET-BUCKET",retryDelay:"5s"}}});
const payload=(errors=[error()],version="v25")=>({error:{code:429,status:"RESOURCE_EXHAUSTED",message:"SECRET",details:[{"@type":`type.googleapis.com/google.ads.googleads.${version}.errors.GoogleAdsFailure`,errors}]}});
test("reviewed Google quota enums are diagnostic only, never raw rate bucket text or retry policy",()=>{
  for(const version of ["v24","v25"]) for(const scope of ["ACCOUNT","DEVELOPER"]) {
    const value=googleQuotaObservation({...metadata,version},429,payload([error(scope)],version));
    assert.deepEqual(value,{scope,code:"RESOURCE_EXHAUSTED"});assert.doesNotMatch(JSON.stringify(value),/SECRET|retry|bucket/);
  }
});
test("generic 429, message-size errors, wrong version, mixed scopes or nonquota errors cannot invent scope",()=>{
  for(const p of [{error:{code:429,status:"RESOURCE_EXHAUSTED",message:"DEVELOPER quota exceeded"}},payload([error("UNKNOWN")]),payload([error("ACCOUNT"),error("DEVELOPER")]),
    payload([error(),{errorCode:{authorizationError:"USER_PERMISSION_DENIED"}}]),payload([error("DEVELOPER","UNKNOWN")]),payload([error()],"v26")])
    assert.equal(googleQuotaObservation(metadata,429,p),null);
  for(const patch of [{version:"v26"},{provider:"meta"},{family:"token"}]) assert.equal(googleQuotaObservation({...metadata,...patch},429,payload()),null);
  for(const status of [200,401,403,500]) assert.equal(googleQuotaObservation(metadata,status,payload()),null);
});
test("native Google rejection passes fixed diagnostic separately from shared-quota signal",async()=>{
  const stops=[];let calls=0;
  const store={reserve:async x=>({...x,status:"reserved",dispatchBeforeMs:1000,dispatchBudgetMs:1000}),stop:async x=>{stops.push(x);return true;},settle:async()=>true};
  const fetch=createQuotaManagedFetch({provider:"google_ads",lane:"background",guard:createSharedQuotaGuard({store,now:()=>0}),resolveOperation:async()=>"a".repeat(64),
    fetchFn:async()=>{calls++;return new Response(JSON.stringify(payload()),{status:429,headers:{"content-type":"application/json"}});}});
  assert.equal((await fetch("https://googleads.googleapis.com/v25/customers/123/googleAds:search",{method:"POST"})).status,429);
  assert.equal(calls,1);assert.equal(stops[0].quotaSignal,null);assert.deepEqual(stops[0].quotaObservation,{scope:"DEVELOPER",code:"RESOURCE_EXHAUSTED"});assert.doesNotMatch(JSON.stringify(stops),/SECRET/);
});
test("repository uses narrow typed Google observation only on known non-permission rejection",async()=>{
  const queries=[],store=createSharedQuotaRepository({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{result:true}]};}});
  const input={operationKey:"a".repeat(64),attemptId:"00000000-0000-4000-8000-000000000001",knownResponse:true,quotaObservation:{scope:"ACCOUNT",code:"RESOURCE_EXHAUSTED"}};
  assert.equal(await store.stop(input),true);assert.match(queries[0].sql,/stop_shared_api_quota_google_observed/);assert.equal(queries[0].args.length,4);
  for(const patch of [{knownResponse:false},{connectionFailure:true},{quotaSignal:"shopify_partner_throttled"},{quotaObservation:{...input.quotaObservation,policyId:"SECRET"}}])
    await assert.rejects(store.stop({...input,...patch}),/INPUT_INVALID/);
});
