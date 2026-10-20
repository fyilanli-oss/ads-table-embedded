import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaManagedFetch} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
function fixture(provider,response) {
  const stops=[];let calls=0;
  const store={reserve:async input=>({...input,status:"reserved",dispatchBeforeMs:1000,dispatchBudgetMs:1000}),stop:async input=>{stops.push(input);return true;},settle:async()=>true};
  const fetch=createQuotaManagedFetch({provider,lane:"background",guard:createSharedQuotaGuard({store,now:()=>0}),resolveOperation:async()=>"a".repeat(64),
    fetchFn:async()=>{calls++;if(response instanceof Error)throw response;return response;}});
  return {fetch,stops,calls:()=>calls};
}
const json=(status,payload,headers={})=>new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json",...headers}});
test("Google auth permission quota and ambiguous 429 responses never select a shared scope from raw payloads",async()=>{
  for(const status of [401,403,429,500]) {
    const response=json(status,{error:{status:status===429?"RESOURCE_EXHAUSTED":"PERMISSION_DENIED",quotaSignal:"shopify_partner_throttled",policy_id:"SECRET"}}, {"retry-after":"10"});
    const f=fixture("google_ads",response);
    assert.equal(await f.fetch("https://googleads.googleapis.com/v24/customers/123/googleAds:search",{method:"POST",body:"{}"}),response);
    assert.equal(f.calls(),1);assert.equal(f.stops.length,1);assert.equal(f.stops[0].knownResponse,true);assert.equal(f.stops[0].quotaSignal,null);
    assert.equal(f.stops[0].connectionFailure,[401,403].includes(status));
    assert.ok(!JSON.stringify(f.stops).includes("SECRET"));
  }
});
test("only documented all-throttle Partner errors at HTTP200 or429 produce the verified Partner signal",async()=>{
  for(const status of [200,429]) {
    const response=json(status,{errors:[{extensions:{code:"429"}}]}),f=fixture("shopify_partner",response);
    const call=()=>f.fetch("https://partners.shopify.com/123/api/2026-07/graphql.json",{method:"POST",body:"{}"});
    if(status===200)await assert.rejects(call(),/PROVIDER_REJECTED/);else assert.equal(await call(),response);
    assert.equal(f.stops[0].quotaSignal,"shopify_partner_throttled");assert.equal(f.stops[0].knownResponse,true);
  }
  for(const [status,payload] of [[401,{errors:[{extensions:{code:"429"}}]}],[403,{errors:[{extensions:{code:"429"}}]}],
    [200,{errors:[{extensions:{code:"429"}},{extensions:{code:"401"}}]}],[429,{error:{quotaSignal:"shopify_partner_throttled"}}]]) {
    const f=fixture("shopify_partner",json(status,payload));
    await f.fetch("https://partners.shopify.com/123/api/2026-07/graphql.json",{method:"POST"}).catch(()=>{});
    assert.equal(f.stops[0].quotaSignal,null);
  }
});
test("Klaviyo Retry-After and Meta error JSON cannot invent a shared quota mapping or auto retry",async()=>{
  for(const [provider,url] of [["klaviyo","https://a.klaviyo.com/api/metrics"],["meta","https://graph.facebook.com/v24.0/act_1/insights"]]) {
    const response=json(429,{error:{code:80000,quotaSignal:"shopify_partner_throttled"}},{"retry-after":"1","ratelimit-remaining":"0"});
    const f=fixture(provider,response);assert.equal(await f.fetch(url),response);assert.equal(f.calls(),1);assert.equal(f.stops.length,1);assert.equal(f.stops[0].quotaSignal,null);
  }
});
test("transport unknowns retain outstanding usage; malformed known JSON is not an unknown network request",async()=>{
  const f=fixture("google_ads",new Error("PRIVATE_TOKEN"));
  await assert.rejects(f.fetch("https://googleads.googleapis.com/v24/customers/123/googleAds:search",{method:"POST"}),/TRANSPORT_STOPPED/);
  assert.equal(f.stops[0].knownResponse,false);assert.equal(f.stops[0].quotaSignal,null);assert.equal(f.calls(),1);
  assert.equal(f.stops[0].connectionFailure,false);
  assert.ok(!JSON.stringify(f.stops).includes("PRIVATE"));
  const g=fixture("shopify_partner",new Response("{bad",{headers:{"content-type":"application/json"}}));
  await assert.rejects(g.fetch("https://partners.shopify.com/123/api/2026-07/graphql.json",{method:"POST"}),/PROVIDER_REJECTED/);
  assert.equal(g.stops[0].knownResponse,true);assert.equal(g.stops[0].quotaSignal,null);
});
test("repository uses narrow parameterized scoped stop; unknown scopes or caller-supplied policy IDs cannot widen it",async()=>{
  const queries=[],repo=createSharedQuotaRepository({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{result:true}]};}});
  const input={operationKey:"a".repeat(64),attemptId:randomUUID()};
  assert.equal(await repo.stop(input),true);assert.deepEqual(queries[0].args,[input.operationKey,input.attemptId,false,false,null]);
  assert.match(queries[0].sql,/stop_shared_api_quota_scoped\(\$1::text,\$2::uuid,\$3::boolean,\$4::boolean,\$5::text\)/);
  for(const extra of [{knownResponse:"yes"},{knownResponse:false,quotaSignal:"shopify_partner_throttled"},{knownResponse:true,quotaSignal:"google_global"}])
    await assert.rejects(repo.stop({...input,...extra}),/INPUT_INVALID/);
  assert.equal(queries.length,1);
});
test("schema keeps failure groups separate from budgets, closes legacy bypass and preserves private scope authority",()=>{
  const c=JSON.parse(read("contracts/eo-05a-quota-stop-scope-v1.json")),sql=read(c.migration);
  for(const flag of ["live_activation","live_apply_authorized","native_configuration_inserted","Dataset_write","hourly_data_scope_selected","listing_tree_resumed"])assert.equal(c[flag],false);
  assert.match(sql,/domain.stopped/);assert.match(sql,/op.stopped/);assert.match(sql,/order by q.id for update of q/);
  assert.match(sql,/r.policy_id=q.id and d.attempt_id=p_attempt/);assert.match(sql,/op.provider='shopify_partner'/);
  assert.match(sql,/stop_shared_api_quota_scoped\(p_operation,p_attempt,false,false,null\)/);
  assert.match(sql,/if p_known_response then update operations.api_quota_debits set settled=true/);
  assert.doesNotMatch(sql,/set stopped=false|cron\.schedule|pg_net|grant .* to adstable_runtime|insert into operations.api_quota_failure_domains/);
});
