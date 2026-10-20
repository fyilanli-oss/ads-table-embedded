import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createScopeResolvedQuotaClients} from "../app/lib/providers/quota-managed-clients.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";

export async function quotaScopeResolverProbe(client) {
  const hash=s=>createHash("sha256").update(s).digest("hex"),policy=randomUUID(),extraPolicy=randomUUID();
  const contexts=Array.from({length:2},()=>({provider:"shopify_partner",clientScopeKey:hash(randomUUID()),connectionScopeKey:hash(randomUUID()),connectionEpoch:1,
    accountId:null,organizationId:"123",apiVersion:"2026-07"}));
  const descriptor={provider:"shopify_partner",family:"partner_graphql",accountId:null,organizationId:"123",version:"2026-07",includes:[]};
  const identities=contexts.map(c=>quotaRouteIdentity(c,descriptor)),ops=identities.map(i=>i.routeKey),store=createSharedQuotaRepository(client);
  let calls=0;
  const native=(index,lane="background")=>createScopeResolvedQuotaClients({store,loadContext:async()=>contexts[index],now:Date.now,lane,
    fetchFn:async()=>{calls++;return new Response('{"data":{"activeSubscription":null}}',{headers:{"content-type":"application/json"}});}})
    .shopify({environment:{SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"SYNTHETIC-ONLY"}});
  const request={apiVersion:"2026-07",query:"query { activeSubscription { id } }",variables:{}};
  const denied=async index=>assert.rejects(native(index).activeSubscription(request),e=>quotaBoundaryControl(e)?.status==="not_configured");
  await client.query("begin");
  try {
    // Synthetic shared application guard, NOT a claim that two Partner clients share a native quota.
    await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'shopify_partner',60000,100,1,1000,10),($2,'shopify_partner',60000,100,1,1000,10)",[policy,extraPolicy]);
    for(let i=0;i<ops.length;i++) {
      await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required) values($1,'shopify_partner',true,true)",[ops[i]]);
      await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[ops[i],policy]);
      await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,'shopify_partner')",[contexts[i].connectionScopeKey]);
      await client.query("insert into operations.api_quota_failure_bindings values($1,$2)",[ops[i],contexts[i].connectionScopeKey]);
      await client.query("insert into operations.api_quota_route_profiles(operation_key,domain_id,quota_fingerprint,enabled) select $1,$2,operations.shared_api_quota_fingerprint($1),true",[ops[i],contexts[i].connectionScopeKey]);
      await client.query("insert into operations.api_quota_routes values($1,$2,true)",[identities[i].routeKey,ops[i]]);
    }
    await native(0).activeSubscription(request);await native(1,"interactive").activeSubscription(request);
    assert.equal(calls,2);assert.equal((await client.query("select count(*)::int n from operations.api_quota_debits where policy_id=$1",[policy])).rows[0].n,2);
    assert.equal(await store.resolveRoute({...identities[0],connectionScopeKey:contexts[1].connectionScopeKey}),null);
    assert.equal(await store.resolveRoute({...identities[0],provider:"google_ads"}),null);
    contexts[0].connectionEpoch++;await denied(0);contexts[0].connectionEpoch--;assert.equal(calls,2);
    // Changes between lookup and reserve cannot silently downgrade to a smaller quota set.
    assert.equal(await store.resolveRoute(identities[0]),ops[0]);
    await client.query("update operations.api_quota_policies set max_units=max_units+1 where id=$1",[policy]);
    const stale=await store.reserve({operationKey:ops[0],attemptId:randomUUID(),lane:"background"});
    assert.equal(stale.status,"not_configured");await denied(0);assert.equal(calls,2);
    await client.query("update operations.api_quota_policies set max_units=max_units-1 where id=$1",[policy]);
    await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[ops[0],extraPolicy]);
    await denied(0);assert.equal(calls,2,"extra scope cannot be silently ignored");
    await client.query("delete from operations.api_quota_bindings where operation_key=$1 and policy_id=$2",[ops[0],extraPolicy]);
    await client.query("delete from operations.api_quota_bindings where operation_key=$1 and policy_id=$2",[ops[0],policy]);
    await denied(0);await client.query("insert into operations.api_quota_bindings values($1,$2,1)",[ops[0],policy]);
    await client.query("update operations.api_quota_route_profiles set enabled=false where operation_key=$1",[ops[0]]);await denied(0);
    await client.query("update operations.api_quota_route_profiles set enabled=true where operation_key=$1",[ops[0]]);
    await client.query("update operations.api_quota_failure_bindings set domain_id=$2 where operation_key=$1",[ops[0],contexts[1].connectionScopeKey]);await denied(0);
    await client.query("update operations.api_quota_failure_bindings set domain_id=$2 where operation_key=$1",[ops[0],contexts[0].connectionScopeKey]);
    await client.query("update operations.api_quota_routes set enabled=false where route_key=$1",[identities[0].routeKey]);await denied(0);
    assert.equal((await store.reserve({operationKey:ops[0],attemptId:randomUUID(),lane:"interactive"})).status,"not_configured","a cached operation cannot bypass a disabled route");
    assert.equal(calls,2);
    // Previously looked-up operation cannot bypass the profile gate by going directly to reserve.
    await client.query("delete from operations.api_quota_route_profiles where operation_key=$1",[ops[0]]);
    assert.equal((await store.reserve({operationKey:ops[0],attemptId:randomUUID(),lane:"interactive"})).status,"not_configured");
    assert.equal((await client.query("select count(*)::int n from operations.api_quota_debits where policy_id=$1",[policy])).rows[0].n,2);
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
      for(const table of ["api_quota_routes","api_quota_route_profiles"])
        assert.equal((await client.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,`operations.${table}`])).rows[0].allowed,false);
    for(const role of ["anon","authenticated","service_role","adstable_runtime"])
      assert.equal((await client.query("select has_function_privilege($1,'operations.resolve_shared_api_quota_route(text,text,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    for(const fn of ["reserve_shared_api_quota_before_scope_resolver(text,uuid,text)","shared_api_quota_fingerprint(text)","shared_api_quota_profile_valid(text)"])
      assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator',$1,'EXECUTE') allowed",[`operations.${fn}`])).rows[0].allowed,false);
    console.log("EO05_QUOTA_SCOPE_RESOLVER_PASS same_store_native_transport=true both_lanes_shared_budget=true context_epoch_checked=true complete_binding_and_limit_fingerprint=true lookup_reserve_drift_blocked=true missing_profile_no_bypass=true opaque_DB_inputs=true synthetic_HTTP_only=true actual_provider_calls=0");
  } finally {await client.query("rollback");}
}
