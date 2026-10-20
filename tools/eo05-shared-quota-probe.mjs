import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import pg from "pg";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";

export async function sharedQuotaProbe(client,connection,environment=process.env) {
  assert.equal(environment.GITHUB_ACTIONS,"true");assert.ok(environment.RUNNER_TEMP);assert.equal(connection.host,"127.0.0.1");assert.equal(connection.port,54322);
  const second=new pg.Client(connection),policy=randomUUID(),otherPolicy=randomUUID(),hash=s=>createHash("sha256").update(s).digest("hex");
  const a=hash(randomUUID()),b=hash(randomUUID()),unrelated=hash(randomUUID());
  const input=(operationKey,lane="background")=>({operationKey,lane,attemptId:randomUUID()});
  try {
    await second.connect();await client.query("set role adstable_owner");await second.query("set role adstable_owner");
    await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'shopify_partner',60000,2,1,1000,8),($2,'shopify_partner',60000,4,0,1000,8)",[policy,otherPolicy]);
    for(const op of [a,b,unrelated]) await client.query("insert into operations.api_quota_operations values($1,'shopify_partner',true)",[op]);
    await client.query("insert into operations.api_quota_bindings values($1,$3,1),($2,$3,1),($4,$5,1)",[a,b,policy,unrelated,otherPolicy]);
    const store=createSharedQuotaRepository(client),other=createSharedQuotaRepository(second);
    const first=input(a),next=input(b),r=await Promise.all([store.reserve(first),other.reserve(next)]);
    assert.equal(r.filter(v=>v.status==="reserved").length,1,"two independent callers share one background headroom");
    assert.equal(r.filter(v=>v.status==="waiting").length,1);
    const winner=r[0].status==="reserved"?first:next;
    assert.equal((await store.reserve(winner)).status,"already_reserved","receipt replay never authorizes another send");
    assert.equal((await store.reserve(input(b,"interactive"))).status,"reserved","foreground headroom survived background race");
    assert.equal((await store.reserve(input(a,"interactive"))).status,"waiting","foreground shares total rather than a second independent bucket");
    assert.equal((await store.reserve(input(unrelated))).status,"reserved","unrelated quota scope remains independent");
    assert.equal((await store.reserve(input(hash("missing")))).status,"not_configured");
    // All-or-nothing multiple scope accounting: one full policy cannot debit the other.
    await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[a,otherPolicy]);
    const before=(await client.query("select count(*)::int n from operations.api_quota_debits where policy_id=$1",[otherPolicy])).rows[0].n;
    assert.equal((await store.reserve(input(a))).status,"waiting");
    assert.equal((await client.query("select count(*)::int n from operations.api_quota_debits where policy_id=$1",[otherPolicy])).rows[0].n,before);
    // Expiry alone cannot erase an unsettled/unknown call or release its outstanding limit.
    await client.query("update operations.api_quota_debits set reserved_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where policy_id=$1",[policy]);
    await client.query("update operations.api_quota_policies set max_outstanding=1 where id=$1",[policy]);
    assert.equal(await store.cleanup({limit:1000}),0);assert.equal((await store.reserve(input(b))).status,"waiting");
    assert.equal(await store.settle(winner),true);assert.equal(await store.cleanup({limit:1}),1);
    assert.equal(await store.stop(input(a)),false,"invented attempt cannot stop another scope");
    // An old expired reservation can still record a provider stop; elapsed time cannot clear it.
    const remaining=(await client.query("select operation_key,attempt_id from operations.api_quota_debits where policy_id=$1 limit 1",[policy])).rows[0];
    assert.equal(await store.stop({operationKey:remaining.operation_key,attemptId:remaining.attempt_id}),true);
    assert.equal((await store.reserve(input(b))).status,"stopped");
    assert.equal((await client.query("select stopped from operations.api_quota_policies where id=$1",[policy])).rows[0].stopped,true);
    // Guard executes against real SQL with a fake provider response, no network.
    let calls=0;
    const guard=createSharedQuotaGuard({store,now:Date.now});
    assert.equal((await guard.execute({operationKey:unrelated,lane:"interactive",run:async()=>{calls++;return {outcome:"success",value:[]};}})).status,"returned");
    assert.equal(calls,1);
    await client.query("update operations.api_quota_policies set last_observed_at=clock_timestamp()+interval '1 hour' where id=$1",[otherPolicy]);
    assert.equal((await store.reserve(input(unrelated))).status,"clock_invalid");
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
      for(const table of ["api_quota_policies","api_quota_operations","api_quota_bindings","api_quota_debits"])
        assert.equal((await client.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,`operations.${table}`])).rows[0].allowed,false);
    for(const role of ["anon","authenticated","service_role","adstable_runtime"])
      for(const fn of ["reserve_shared_api_quota(text,uuid,text)","stop_shared_api_quota(text,uuid)","settle_shared_api_quota(text,uuid)","cleanup_shared_api_quota(integer)"])
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,`operations.${fn}`])).rows[0].allowed,false);
    console.log("EO05_SHARED_QUOTA_PASS concurrent_shared_scope=true interactive_reserve=true atomic_multi_scope=true unknown_not_expired=true persistent_stop=true bounded_cleanup=true no_live_configuration=true actual_provider_calls=0");
  } finally {
    try {
      await client.query("delete from operations.api_quota_operations where operation_key=any($1::text[])",[[a,b,unrelated]]);
      await client.query("delete from operations.api_quota_policies where id=any($1::uuid[])",[[policy,otherPolicy]]);
      await client.query("reset role");
    } finally {await second.end();}
  }
}
