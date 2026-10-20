import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaManagedFetch,quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";

export async function quotaFeedbackProbe(client) {
  await client.query("begin");
  try {
    const op=createHash("sha256").update(randomUUID()).digest("hex"),policy=randomUUID(),store=createSharedQuotaRepository(client);
    await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'klaviyo',60000,100,0,1000,8)",[policy]);
    await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled) values($1,'klaviyo',true)",[op]);
    await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[op,policy]);
    let calls=0,status=200;
    const fetch=createQuotaManagedFetch({provider:"klaviyo",lane:"background",guard:createSharedQuotaGuard({store,now:Date.now}),resolveOperation:async()=>op,
      fetchFn:async()=>{calls++;return new Response("{}",{status,headers:status===429?{"content-type":"application/json","retry-after":"60"}:
        {"content-type":"application/json","ratelimit-limit":"150","ratelimit-remaining":"0","ratelimit-reset":"60",authorization:"DO-NOT-STORE"}});}});
    const send=()=>fetch("https://a.klaviyo.com/api/events",{headers:{revision:"2026-10-15"}});
    await send();assert.equal(calls,1);
    const row=(await client.query("select * from operations.api_quota_feedback where operation_key=$1",[op])).rows[0];
    assert.equal(row.feedback.kind,"steady");assert.equal(row.feedback.remaining,0);assert.doesNotMatch(JSON.stringify(row),/DO-NOT-STORE/);
    await assert.rejects(send(),e=>quotaBoundaryControl(e)?.status==="waiting");assert.equal(calls,1);
    assert.equal((await store.reserve({operationKey:op,attemptId:randomUUID(),lane:"interactive"})).status,"waiting","both lanes obey the same observation");
    assert.equal((await client.query("select count(*)::int n from operations.api_quota_debits where operation_key=$1",[op])).rows[0].n,1);
    assert.equal((await client.query("select stopped from operations.api_quota_policies where id=$1",[policy])).rows[0].stopped,false,"normal zero header is not shared error");
    const independent=createHash("sha256").update(randomUUID()).digest("hex");
    await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled) values($1,'klaviyo',true)",[independent]);
    await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[independent,policy]);
    const unrelated={operationKey:independent,attemptId:randomUUID(),lane:"background"};
    assert.equal((await store.reserve(unrelated)).status,"reserved","header does not guess a shared policy scope");await store.settle(unrelated);
    // A later positive/missing observation cannot shorten an existing wait.
    const hold=row.hold_until.toISOString();
    await store.recordFeedback({operationKey:op,attemptId:row.attempt_id,feedback:{kind:"missing",httpStatus:200,limit:null,remaining:null,resetSeconds:null,retryAfterSeconds:null}});
    assert.equal((await client.query("select hold_until from operations.api_quota_feedback where operation_key=$1",[op])).rows[0].hold_until.toISOString(),hold);
    assert.equal(await store.recordFeedback({operationKey:op,attemptId:randomUUID(),feedback:row.feedback}),false,"invented attempt cannot create feedback");
    // Owner-only fixture clock move, NOT a production reset or sleep/retry policy.
    await client.query("update operations.api_quota_feedback set hold_until=clock_timestamp()-interval '1 second' where operation_key=$1",[op]);
    status=429;
    // A separate execution uses a fresh transport; this is not an automatic provider retry.
    const fresh=createQuotaManagedFetch({provider:"klaviyo",lane:"background",guard:createSharedQuotaGuard({store,now:Date.now}),resolveOperation:async()=>op,
      fetchFn:async()=>{calls++;return new Response("{}",{status:429,headers:{"content-type":"application/json","retry-after":"60"}});}});
    assert.equal((await fresh("https://a.klaviyo.com/api/events")).status,429);assert.equal(calls,2);
    assert.equal((await client.query("select feedback->>'kind' k from operations.api_quota_feedback where operation_key=$1",[op])).rows[0].k,"retry_after");
    await client.query("update operations.api_quota_feedback set hold_until=clock_timestamp()-interval '1 day' where operation_key=$1",[op]);
    assert.equal((await store.reserve({operationKey:op,attemptId:randomUUID(),lane:"background"})).status,"stopped","Retry-After expiry never clears provider error");
    assert.equal((await client.query("select count(*)::int n from operations.api_quota_feedback where operation_key=$1",[op])).rows[0].n,1);
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
      assert.equal((await client.query("select has_table_privilege($1,'operations.api_quota_feedback','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.reserve_shared_api_quota_before_feedback(text,uuid,text)','EXECUTE') allowed")).rows[0].allowed,false);
    for(const role of ["anon","authenticated","service_role","adstable_runtime"])
      assert.equal((await client.query("select has_function_privilege($1,'operations.record_shared_api_quota_feedback(text,uuid,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    console.log("EO05_QUOTA_FEEDBACK_PASS sanitized_numeric_headers=true both_lanes_wait=true no_extra_HTTP=true no_shared_scope_guess=true Retry_After_not_retry_permission=true private_bounded_latest_row=true real_SQL_and_synthetic_HTTP=true actual_provider_calls=0");
  } finally {await client.query("rollback");}
}
