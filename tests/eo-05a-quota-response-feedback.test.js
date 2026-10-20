import test from "node:test";
import assert from "node:assert/strict";
import {quotaResponseFeedback} from "../app/lib/refresh/quota-response-feedback.server.js";
import {createQuotaManagedFetch,quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";

const meta={provider:"klaviyo",family:"events"};
const headers={"ratelimit-limit":"150","ratelimit-remaining":"0","ratelimit-reset":"30"};
const response=(h=headers,status=200)=>new Response("{}",{status,headers:{"content-type":"application/json",...h}});
test("only documented numeric Klaviyo API feedback is retained; zero is not missing",()=>{
  assert.deepEqual(quotaResponseFeedback(meta,response()),{kind:"steady",httpStatus:200,limit:150,remaining:0,resetSeconds:30,retryAfterSeconds:null});
  assert.equal(quotaResponseFeedback(meta,response({})).kind,"missing");
  for(const patch of [{"ratelimit-limit":"SECRET"},{"ratelimit-remaining":"151"},{"ratelimit-reset":"61"},{"ratelimit-limit":"1e3"},{"ratelimit-reset":"-1"},{"ratelimit-remaining":"0, 1"}])
    assert.deepEqual(quotaResponseFeedback(meta,response({...headers,...patch})),{kind:"invalid",httpStatus:200,limit:null,remaining:null,resetSeconds:null,retryAfterSeconds:null});
  for(const provider of ["meta","google_ads","shopify_partner"]) assert.equal(quotaResponseFeedback({...meta,provider},response()),null);
  assert.equal(quotaResponseFeedback({...meta,family:"token"},response()),null);
});
test("429 keeps Retry-After separately, never as a steady budget or permission to retry",()=>{
  assert.deepEqual(quotaResponseFeedback(meta,response({"retry-after":"42",...headers},429)),{kind:"retry_after",httpStatus:429,limit:null,remaining:null,resetSeconds:null,retryAfterSeconds:42});
  assert.equal(quotaResponseFeedback(meta,response({"retry-after":"Wed, 21 Oct 2026 07:28:00 GMT"},429)).kind,"invalid");
});
test("native transport persists sanitized feedback before publishing success and never persists arbitrary headers",async()=>{
  const events=[];let calls=0;
  const store={reserve:async x=>({...x,status:"reserved",dispatchBeforeMs:100,dispatchBudgetMs:1000}),
    recordFeedback:async x=>{events.push(x.feedback);return true;},settle:async()=>{events.push("settled");return true;},stop:async()=>true};
  const fetch=createQuotaManagedFetch({provider:"klaviyo",lane:"background",guard:createSharedQuotaGuard({store,now:()=>0}),resolveOperation:async()=>"a".repeat(64),
    fetchFn:async()=>{calls++;return response({...headers,authorization:"SECRET","set-cookie":"SECRET"});}});
  await fetch("https://a.klaviyo.com/api/events",{headers:{revision:"2026-10-15"}});
  assert.equal(events[0].kind,"steady");assert.equal(events[1],"settled");assert.doesNotMatch(JSON.stringify(events),/SECRET|cookie|authorization/);assert.equal(calls,1);
});
test("tracking failure blocks successful publication; provider rejection still records stop without automatic retry",async()=>{
  for(const status of [200,429]) {
    let calls=0,stops=0,settles=0;
    const store={reserve:async x=>({...x,status:"reserved",dispatchBeforeMs:100,dispatchBudgetMs:1000}),recordFeedback:async()=>{throw Error("SECRET");},
      stop:async()=>{stops++;return true;},settle:async()=>{settles++;return true;}};
    const fetch=createQuotaManagedFetch({provider:"klaviyo",lane:"background",guard:createSharedQuotaGuard({store,now:()=>0}),resolveOperation:async()=>"a".repeat(64),
      fetchFn:async()=>{calls++;return response(status===429?{"retry-after":"1"}:headers,status);}});
    await assert.rejects(fetch("https://a.klaviyo.com/api/events"),e=>!e.message.includes("SECRET")&&quotaBoundaryControl(e)===null);
    assert.equal(calls,1);assert.equal(stops,status===429?1:0);assert.equal(settles,0);
  }
});
test("feedback repository accepts only exact normalized fields and binds one attempted operation",async()=>{
  const rows=[],store=createSharedQuotaRepository({query:async(sql,args)=>{rows.push({sql,args});return {rows:[{result:true}]};}});
  const input={operationKey:"a".repeat(64),attemptId:"00000000-0000-4000-8000-000000000001",feedback:quotaResponseFeedback(meta,response())};
  assert.equal(await store.recordFeedback(input),true);assert.equal(rows[0].args.length,3);assert.match(rows[0].sql,/record_shared_api_quota_feedback/);
  await assert.rejects(store.recordFeedback({...input,feedback:{...input.feedback,authorization:"SECRET"}}),/INPUT_INVALID/);
});
