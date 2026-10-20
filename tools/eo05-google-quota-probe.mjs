import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaManagedFetch} from "../app/lib/refresh/quota-native-fetch.server.js";

export async function googleQuotaProbe(client) {
  await client.query("begin");
  try {
    const ops=Array.from({length:5},()=>createHash("sha256").update(randomUUID()).digest("hex")),policy=randomUUID(),store=createSharedQuotaRepository(client);
    await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'google_ads',60000,100,0,1000,8)",[policy]);
    for(const op of ops) {await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled) values($1,'google_ads',true)",[op]);await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[op,policy]);}
    let calls=0;
    for(const [i,scope] of ["ACCOUNT","DEVELOPER"].entries()) {
      const data={error:{code:429,status:"RESOURCE_EXHAUSTED",message:"SECRET",details:[{"@type":"type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure",
        errors:[{errorCode:{quotaError:"RESOURCE_EXHAUSTED"},details:{quotaErrorDetails:{rateScope:scope,rateName:"SECRET",retryDelay:"60s"}}}]}]}};
      const fetch=createQuotaManagedFetch({provider:"google_ads",lane:"background",guard:createSharedQuotaGuard({store,now:Date.now}),resolveOperation:async()=>ops[i],
        fetchFn:async()=>{calls++;return new Response(JSON.stringify(data),{status:429,headers:{"content-type":"application/json"}});}});
      assert.equal((await fetch("https://googleads.googleapis.com/v25/customers/123/googleAds:search",{method:"POST"})).status,429);
      const row=(await client.query("select stopped,stop_kind,stop_signal,google_quota_scope,google_quota_code from operations.api_quota_operations where operation_key=$1",[ops[i]])).rows[0];
      assert.equal(row.stopped,true);assert.equal(row.stop_signal,null);assert.equal(row.google_quota_scope,scope);assert.equal(row.google_quota_code,"RESOURCE_EXHAUSTED");assert.doesNotMatch(JSON.stringify(row),/SECRET/);
      assert.equal((await client.query("select bool_and(settled) ok from operations.api_quota_debits where operation_key=$1",[ops[i]])).rows[0].ok,true);
      const attempt=(await client.query("select attempt_id from operations.api_quota_debits where operation_key=$1 limit 1",[ops[i]])).rows[0].attempt_id;
      await store.stop({operationKey:ops[i],attemptId:attempt,knownResponse:true,quotaObservation:{scope:scope==="ACCOUNT"?"DEVELOPER":"ACCOUNT",code:"RESOURCE_TEMPORARILY_EXHAUSTED"}});
      assert.equal((await client.query("select google_quota_scope from operations.api_quota_operations where operation_key=$1",[ops[i]])).rows[0].google_quota_scope,scope,"first error observation stays immutable");
    }
    assert.equal(calls,2);assert.equal((await client.query("select stopped from operations.api_quota_policies where id=$1",[policy])).rows[0].stopped,false);
    const healthy={operationKey:ops[2],attemptId:randomUUID(),lane:"background"};assert.equal((await store.reserve(healthy)).status,"reserved");await store.settle(healthy);
    const generic=createQuotaManagedFetch({provider:"google_ads",lane:"background",guard:createSharedQuotaGuard({store,now:Date.now}),resolveOperation:async()=>ops[3],
      fetchFn:async()=>{calls++;return new Response(JSON.stringify({error:{code:429,status:"RESOURCE_EXHAUSTED",message:"SECRET message too large"}}),{status:429,headers:{"content-type":"application/json"}});}});
    await generic("https://googleads.googleapis.com/v25/customers/123/googleAds:search",{method:"POST"});
    assert.equal(calls,3);assert.equal((await client.query("select google_quota_scope from operations.api_quota_operations where operation_key=$1",[ops[3]])).rows[0].google_quota_scope,null);
    assert.equal(await store.stop({operationKey:ops[4],attemptId:randomUUID(),knownResponse:true,quotaObservation:{scope:"ACCOUNT",code:"RESOURCE_EXHAUSTED"}}),false,"invented attempt cannot persist observation or stop");
    for(const role of ["anon","authenticated","service_role","adstable_runtime"])
      assert.equal((await client.query("select has_function_privilege($1,'operations.stop_shared_api_quota_google_observed(text,uuid,text,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    console.log("EO05_GOOGLE_QUOTA_DIAGNOSTIC_PASS typed_scope_and_code_only=true exact_operation_stop=true shared_budget_not_guessed=true other_operation_can_continue=true fake_attempt_rejected=true private_access=true real_SQL_synthetic_HTTP_only=true actual_provider_calls=0");
  } finally {await client.query("rollback");}
}
