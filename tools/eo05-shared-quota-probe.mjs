import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import pg from "pg";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaManagedClients} from "../app/lib/providers/quota-managed-clients.server.js";
import {quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {quotaScopeResolverProbe} from "./eo05-quota-scope-resolver-probe.mjs";

export async function sharedQuotaProbe(client,connection,environment=process.env) {
  assert.equal(environment.GITHUB_ACTIONS,"true");assert.ok(environment.RUNNER_TEMP);assert.equal(connection.host,"127.0.0.1");assert.equal(connection.port,54322);
  const second=new pg.Client(connection),policy=randomUUID(),otherPolicy=randomUUID(),hash=s=>createHash("sha256").update(s).digest("hex");
  const a=hash(randomUUID()),b=hash(randomUUID()),unrelated=hash(randomUUID()),domain=hash(randomUUID());
  const input=(operationKey,lane="background")=>({operationKey,lane,attemptId:randomUUID()});
  try {
    await second.connect();await client.query("set role adstable_owner");await second.query("set role adstable_owner");
    await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'shopify_partner',60000,2,1,1000,8),($2,'shopify_partner',60000,4,0,1000,8)",[policy,otherPolicy]);
    for(const op of [a,b,unrelated]) await client.query("insert into operations.api_quota_operations values($1,'shopify_partner',true)",[op]);
    await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,'shopify_partner')",[domain]);
    await client.query("insert into operations.api_quota_failure_bindings values($1,$3),($2,$3)",[a,b,domain]);
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
    assert.equal((await store.reserve(input(remaining.operation_key))).status,"stopped");
    assert.equal((await client.query("select stopped from operations.api_quota_policies where id=$1",[policy])).rows[0].stopped,false,"a local/unknown stop is not a shared quota exhaustion claim");
    assert.equal((await client.query("select stopped from operations.api_quota_failure_domains where id=$1",[domain])).rows[0].stopped,false,"unknown is local, not a proved connection failure");
    // Guard executes against real SQL with a fake provider response, no network.
    let calls=0;
    const guard=createSharedQuotaGuard({store,now:Date.now});
    assert.equal((await guard.execute({operationKey:unrelated,lane:"interactive",run:async()=>{calls++;return {outcome:"success",value:[]};}})).status,"returned");
    assert.equal(calls,1);
    let nativeCalls=0;
    const clients=createQuotaManagedClients({guard,lane:"interactive",resolveOperation:async()=>unrelated,
      fetchFn:async()=>{nativeCalls++;return new Response(JSON.stringify({data:{activeSubscription:null}}),{headers:{"content-type":"application/json"}});}});
    const partner=clients.shopify({environment:{SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"SYNTHETIC-ONLY"}});
    const request={apiVersion:"2026-07",query:"query { activeSubscription { id } }",variables:{shopId:"gid://shopify/Shop/1"}};
    assert.deepEqual(await partner.activeSubscription(request),{data:{activeSubscription:null}});
    assert.equal(nativeCalls,1);
    assert.equal((await client.query("select count(*)::int n from operations.api_quota_debits where policy_id=$1",[otherPolicy])).rows[0].n,3,"one actual native HTTP attempt consumed exactly one additional debit");
    await client.query("update operations.api_quota_policies set max_units=3 where id=$1",[otherPolicy]);
    await assert.rejects(partner.activeSubscription(request),e=>quotaBoundaryControl(e)?.status==="waiting");assert.equal(nativeCalls,1,"normal wait is not an HTTP attempt");
    console.log("EO05_QUOTA_NATIVE_TRANSPORT_PASS real_SQL_to_existing_Shopify_client=true one_debit_per_HTTP=true normal_wait_no_call=true synthetic_only=true actual_provider_calls=0");
    await client.query("update operations.api_quota_policies set last_observed_at=clock_timestamp()+interval '1 hour' where id=$1",[otherPolicy]);
    assert.equal((await store.reserve(input(unrelated))).status,"clock_invalid");
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
      for(const table of ["api_quota_policies","api_quota_operations","api_quota_bindings","api_quota_debits","api_quota_failure_domains","api_quota_failure_bindings","api_quota_stop_rules"])
        assert.equal((await client.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,`operations.${table}`])).rows[0].allowed,false);
    for(const role of ["anon","authenticated","service_role","adstable_runtime"])
      for(const fn of ["reserve_shared_api_quota(text,uuid,text)","stop_shared_api_quota(text,uuid)","settle_shared_api_quota(text,uuid)","cleanup_shared_api_quota(integer)","stop_shared_api_quota_scoped(text,uuid,boolean,boolean,text)","reserve_shared_api_quota_before_stop_scope(text,uuid,text)"])
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,`operations.${fn}`])).rows[0].allowed,false);
    console.log("EO05_SHARED_QUOTA_PASS concurrent_shared_scope=true interactive_reserve=true atomic_multi_scope=true unknown_not_expired=true persistent_stop=true bounded_cleanup=true no_live_configuration=true actual_provider_calls=0");
    await quotaStopScopeProbe(client,second);
    await quotaScopeResolverProbe(client);
  } finally {
    try {
      await client.query("delete from operations.api_quota_operations where operation_key=any($1::text[])",[[a,b,unrelated]]);
      await client.query("delete from operations.api_quota_failure_domains where id=$1",[domain]);
      await client.query("delete from operations.api_quota_policies where id=any($1::uuid[])",[[policy,otherPolicy]]);
      await client.query("reset role");
    } finally {await second.end();}
  }
}

async function quotaStopScopeProbe(client,second) {
  const hash=s=>createHash("sha256").update(s).digest("hex"),ops=Array.from({length:8},()=>hash(randomUUID()));
  const [a,a2,b,c,d,e,f,g]=ops,domains=Array.from({length:3},()=>hash(randomUUID()));
  const [domainA,domainB,domainC]=domains,shared=randomUUID(),foreign=randomUUID();
  const store=createSharedQuotaRepository(client),other=createSharedQuotaRepository(second);
  const input=(operationKey,lane="interactive")=>({operationKey,lane,attemptId:randomUUID()});
  let nativeCalls=0;
  const nativePartner=(operation,status,payload)=>createQuotaManagedClients({guard:createSharedQuotaGuard({store,now:Date.now}),lane:"interactive",resolveOperation:async()=>operation,
    fetchFn:async()=>{nativeCalls++;return new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json"}});}})
    .shopify({environment:{SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"SYNTHETIC-ONLY"}});
  const request={apiVersion:"2026-07",query:"query { activeSubscription { id } }",variables:{}};
  try {
    await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'shopify_partner',60000,100,0,1000,100),($2,'shopify_partner',60000,100,0,1000,100)",[shared,foreign]);
    for(const op of ops) {
      await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled) values($1,'shopify_partner',true)",[op]);
      await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[op,shared]);
    }
    for(const domain of domains) await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,'shopify_partner')",[domain]);
    await client.query("insert into operations.api_quota_failure_bindings values($1,$5),($2,$5),($3,$6),($4,$7)",[a,a2,b,c,domainA,domainB,domainC]);
    await assert.rejects(nativePartner(a,403,{errors:[{message:"synthetic permission rejection"}]}).activeSubscription(request));
    const attempted={attemptId:(await client.query("select attempt_id from operations.api_quota_debits where operation_key=$1",[a])).rows[0].attempt_id};
    assert.equal((await other.reserve(input(a2,"background"))).status,"stopped","same connection's other HTTP family stops too");
    assert.equal((await other.reserve(input(b,"background"))).status,"reserved","independent connection sharing SAME quota remains available");
    assert.equal((await client.query("select settled from operations.api_quota_debits where operation_key=$1 and attempt_id=$2",[a,attempted.attemptId])).rows[0].settled,true);
    assert.equal((await client.query("select count(*)::int n from operations.api_quota_debits where operation_key=$1",[a])).rows[0].n,1,"known error never refunds rate usage");
    // Unknown outcome stops only its operation and retains outstanding capacity after expiry.
    const uncertain=input(b);assert.equal((await other.reserve(uncertain)).status,"reserved");
    assert.equal(await store.stop(uncertain),true);
    await client.query("update operations.api_quota_debits set reserved_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where operation_key=$1 and attempt_id=$2",[b,uncertain.attemptId]);
    assert.equal((await other.reserve(input(b))).status,"stopped");
    assert.equal((await other.reserve(input(c))).status,"reserved");
    assert.equal((await client.query("select stopped from operations.api_quota_failure_domains where id=$1",[domainB])).rows[0].stopped,false);
    assert.equal((await client.query("select settled from operations.api_quota_debits where operation_key=$1 and attempt_id=$2",[b,uncertain.attemptId])).rows[0].settled,false);
    const rejected=input(c);await other.reserve(rejected);await store.stop({...rejected,knownResponse:true});
    assert.equal((await client.query("select stopped from operations.api_quota_failure_domains where id=$1",[domainC])).rows[0].stopped,false,"generic rejection is not a proved connection failure");
    assert.equal((await other.reserve(input(g))).status,"reserved");
    // A recognized signal without an owner mapping must not choose a global policy by inference.
    const unmapped=input(d);await store.reserve(unmapped);
    await store.stop({...unmapped,knownResponse:true,quotaSignal:"shopify_partner_throttled"});
    assert.equal((await client.query("select stopped from operations.api_quota_policies where id=$1",[shared])).rows[0].stopped,false);
    // Invented attempt and a rule targeting a policy NOT charged to this attempt cannot broaden a stop.
    assert.equal(await store.stop({...input(e),knownResponse:true,quotaSignal:"shopify_partner_throttled"}),false);
    await client.query("insert into operations.api_quota_stop_rules values($1,'shopify_partner_throttled',$2)",[e,foreign]);
    const misbound=input(e);await store.reserve(misbound);await store.stop({...misbound,knownResponse:true,quotaSignal:"shopify_partner_throttled"});
    assert.equal((await client.query("select stopped from operations.api_quota_policies where id=$1",[foreign])).rows[0].stopped,false);
    // Explicit matching rule + native signal stops precisely the charged policy, not every provider budget.
    await client.query("insert into operations.api_quota_stop_rules values($1,'shopify_partner_throttled',$2)",[f,shared]);
    await assert.rejects(nativePartner(f,429,{errors:[{extensions:{code:"429"}}]}).activeSubscription(request));
    assert.equal((await other.reserve(input(g))).status,"stopped","a verified shared-quota stop reaches other connections using that quota");
    assert.equal((await client.query("select stopped from operations.api_quota_policies where id=$1",[foreign])).rows[0].stopped,false);
    assert.equal(nativeCalls,2);
    console.log("EO05_QUOTA_STOP_SCOPE_PASS connection_failure_not_global=true same_domain_stops=true verified_charged_rule_only=true unknown_retained=true known_error_no_refund=true unconfigured_scope_not_guessed=true real_SQL_to_native_transport=true synthetic_HTTP_only=true actual_provider_calls=0");
  } finally {
    await client.query("delete from operations.api_quota_operations where operation_key=any($1::text[])",[ops]);
    await client.query("delete from operations.api_quota_failure_domains where id=any($1::text[])",[domains]);
    await client.query("delete from operations.api_quota_policies where id=any($1::uuid[])",[[shared,foreign]]);
  }
}
