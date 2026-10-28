import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createSharedQuotaGuard,SHOPIFY_ADMIN_COST_UNIT} from "../app/lib/refresh/shared-quota.server.js";
import {adminCostFeedbackProbe} from "./eo05-admin-cost-feedback-probe.mjs";

// Synthetic profiles in the existing isolated, rollback-only SQL scenario. No native HTTP.
export async function adminCostBudgetProbe(client){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const hash=()=>createHash("sha256").update(randomUUID()).digest("hex"),operation=hash(),domain=hash();
  const policies=[randomUUID(),randomUUID()],store=createSharedQuotaRepository(client);
  const input=(lane="interactive")=>({operationKey:operation,attemptId:randomUUID(),lane});
  const count=async()=>Number((await client.query("select count(*) n from operations.api_quota_debits where operation_key=$1",[operation])).rows[0].n);
  const reserve=async lane=>store.reserve(input(lane));
  async function changed(sql,args,check){
    await client.query("savepoint admin_budget_change");
    try{await client.query(sql,args);await check();}
    finally{await client.query("rollback to savepoint admin_budget_change");await client.query("release savepoint admin_budget_change");}
  }
  await client.query("savepoint admin_budget_probe");
  try{
    await client.query("insert into operations.api_quota_operations(operation_key,provider,route_required,reserved_requested_cost) values($1,'shopify_admin',true,37)",[operation]);
    assert.equal((await reserve()).status,"not_configured","disabled is the default");
    await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,'shopify_admin')",[domain]);
    await client.query("insert into operations.api_quota_failure_bindings(operation_key,domain_id) values($1,$2)",[operation,domain]);
    for(const id of policies){
      await client.query(`insert into operations.api_quota_policies(id,provider,cost_unit,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding)
        values($1,'shopify_admin','shopify_admin_query_points',60000,120,60,5000,10)`,[id]);
      await client.query("insert into operations.api_quota_bindings(operation_key,policy_id,units) values($1,$2,37)",[operation,id]);
    }
    await client.query("insert into operations.api_quota_route_profiles(operation_key,domain_id,quota_fingerprint,enabled) select $1,$2,operations.shared_api_quota_fingerprint($1),true",[operation,domain]);
    await client.query("insert into operations.api_quota_routes(route_key,operation_key,enabled) values($1,$1,true)",[operation]);
    await client.query("update operations.api_quota_operations set enabled=true where operation_key=$1",[operation]);
    assert.equal(await store.resolveRoute({routeKey:operation,connectionScopeKey:domain,provider:"shopify_admin"}),operation);
    await changed("update operations.api_quota_bindings set units=1 where operation_key=$1 and policy_id=$2",[operation,policies[0]],async()=>{
      assert.equal((await reserve()).status,"not_configured");assert.equal(await count(),0,"no partial debits for request-count-like profile");
    });
    await changed("delete from operations.api_quota_bindings where operation_key=$1",[operation],async()=>{
      assert.equal((await reserve()).status,"not_configured");assert.equal(await count(),0);
    });
    await changed("update operations.api_quota_operations set reserved_requested_cost=38 where operation_key=$1",[operation],async()=>{
      await client.query("update operations.api_quota_bindings set units=38 where operation_key=$1",[operation]);
      assert.equal(await store.resolveRoute({routeKey:operation,connectionScopeKey:domain,provider:"shopify_admin"}),null,"changed cost invalidates reviewed fingerprint");
      assert.equal((await reserve()).status,"not_configured");assert.equal(await count(),0);
    });
    for(const sql of [
      "update operations.api_quota_operations set reserved_requested_cost=null where operation_key=$1",
      "update operations.api_quota_operations set reserved_requested_cost=0 where operation_key=$1",
      "update operations.api_quota_operations set reserved_requested_cost=9007199254740992 where operation_key=$1",
      "update operations.api_quota_operations set route_required=false where operation_key=$1",
      "update operations.api_quota_policies set cost_unit='quota_units' where id=$1",
    ]){
      await client.query("savepoint admin_budget_constraint");
      try{await assert.rejects(client.query(sql,[sql.includes("policies")?policies[0]:operation]),e=>e.code==="23514");}
      finally{await client.query("rollback to savepoint admin_budget_constraint");await client.query("release savepoint admin_budget_constraint");}
    }
    const first=input("background"),permit=await store.reserve(first);
    assert.equal(permit.status,"reserved");assert.deepEqual(permit.costBudget,{unit:SHOPIFY_ADMIN_COST_UNIT,reservedRequestedCost:37});
    assert.equal((await store.reserve(first)).status,"already_reserved");assert.equal(await count(),2);
    assert.equal(await store.settle(first),true);
    assert.equal((await reserve("background")).status,"waiting","settlement does not refund point use or interactive headroom");
    let calls=0;
    const guard=createSharedQuotaGuard({store,now:Date.now});
    const outcome=await guard.execute({operationKey:operation,lane:"interactive",requiredCostUnit:SHOPIFY_ADMIN_COST_UNIT,
      run:async ceiling=>{calls++;assert.equal(ceiling,37);return {outcome:"success",value:"synthetic"};}});
    assert.deepEqual(outcome,{status:"returned",value:"synthetic"});assert.equal(calls,1);assert.equal(await count(),4);
    const debits=(await client.query("select units::text from operations.api_quota_debits where operation_key=$1",[operation])).rows;
    assert.ok(debits.every(d=>d.units==="37"),"every applicable scope charged the same point ceiling");
    await changed("update operations.api_quota_operations set stopped=true where operation_key=$1",[operation],async()=>{
      const result=await guard.execute({operationKey:operation,lane:"interactive",requiredCostUnit:SHOPIFY_ADMIN_COST_UNIT,run:async()=>{calls++;}});
      assert.equal(result.status,"stopped");assert.equal(calls,1);assert.equal(await count(),4);
    });
    await adminCostFeedbackProbe(client,{operation,policies,domain});
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
      for(const table of ["api_quota_operations","api_quota_policies"])
        assert.equal((await client.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,`operations.${table}`])).rows[0].allowed,false);
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.reserve_shared_api_quota_before_admin_cost(text,uuid,text)','EXECUTE') allowed")).rows[0].allowed,false);
  }finally{await client.query("rollback to savepoint admin_budget_probe");await client.query("release savepoint admin_budget_probe");}
  assert.equal(await count(),0);
  assert.equal((await reserve()).status,"not_configured");
  console.log("EO05_ADMIN_COST_BUDGET_PASS typed_SQL_receipt=true every_scope_point_debit=true stale_profile_blocked=true atomic_no_partial_debits=true interactive_headroom=true no_rate_refund=true private_inventory=true rolled_back=true native_HTTP=0");
}
