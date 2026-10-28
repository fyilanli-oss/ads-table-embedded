import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaManagedFetch} from "../app/lib/refresh/quota-native-fetch.server.js";
import {shopifyAdminCostFeedback} from "../app/lib/refresh/shopify-admin-identity-quota.server.js";
import {SHOPIFY_PRODUCT_CANDIDATE_QUERIES} from "../app/lib/shopify/product-identity-verification.server.js";

// Existing isolated F01 transaction; native responses are synthetic and all rows roll back.
export async function adminCostFeedbackProbe(client,{operation,policies,domain}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const store=createSharedQuotaRepository(client),input=()=>({operationKey:operation,attemptId:randomUUID(),lane:"interactive"});
  const cost={requestedQueryCost:8,actualQueryCost:0,throttleStatus:{maximumAvailable:1000,currentlyAvailable:0,restoreRate:0.5}};
  const observed=shopifyAdminCostFeedback(200,{extensions:{cost}});
  const row=async()=> (await client.query("select feedback,attempt_id,hold_until from operations.api_quota_feedback where operation_key=$1",[operation])).rows[0];
  const stopped=async()=> (await client.query("select stopped,stop_kind,stop_signal from operations.api_quota_operations where operation_key=$1",[operation])).rows[0];
  async function scenario(run){await client.query("savepoint admin_feedback_case");try{await run();}finally{await client.query("rollback to savepoint admin_feedback_case");await client.query("release savepoint admin_feedback_case");}}
  async function native(payload,status=200,options={}){
    let calls=0;
    const activeStore=options.failFeedback?{...store,recordFeedback:async()=>{throw Error("SYNTHETIC-DB-FAILURE");}}:store;
    const fetch=createQuotaManagedFetch({provider:"shopify_admin",lane:"interactive",guard:createSharedQuotaGuard({store:activeStore,now:Date.now}),resolveOperation:async()=>operation,
      fetchFn:async()=>{calls++;if(options.unknown)throw Error("SYNTHETIC-NETWORK");return new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json"}});}});
    let response,error;try{response=await fetch("https://test.myshopify.com/admin/api/2026-07/graphql.json",{method:"POST",body:JSON.stringify({query:SHOPIFY_PRODUCT_CANDIDATE_QUERIES.identity_product,variables:{productId:"gid://shopify/Product/10"}})});}catch(e){error=e;}
    assert.equal(calls,1);return {response,error};
  }
  await client.query("savepoint admin_feedback_probe");
  try{
    await client.query("delete from operations.api_quota_debits where operation_key=$1",[operation]);
    await scenario(async()=>{
      const r=await native({data:{private:"SYNTHETIC-SECRET"},extensions:{cost}});assert.equal(r.error,undefined);assert.equal(r.response.status,200);
      assert.deepEqual((await row()).feedback,observed);assert.equal((await row()).hold_until,null);assert.equal((await stopped()).stopped,false);
      const d=(await client.query("select units::text,settled from operations.api_quota_debits where operation_key=$1",[operation])).rows;
      assert.equal(d.length,2);assert.ok(d.every(x=>x.units==="37"&&x.settled),"actual zero does not refund reserved points");
      assert.doesNotMatch(JSON.stringify(await row()),/SYNTHETIC-SECRET|private/);
    });
    for(const [kind,payload] of [["partial",{extensions:{cost:{...cost,actualQueryCost:null}}}],["missing",{}],["invalid",{extensions:{cost:{}}}]])await scenario(async()=>{
      assert.ok((await native(payload)).error);assert.equal((await row()).feedback.kind,`shopify_admin_cost_${kind}`);
      assert.equal((await row()).feedback.actualQueryCost,null);assert.equal((await stopped()).stopped,true);
      assert.equal((await client.query("select count(*)::int n from operations.api_quota_policies where id=any($1::uuid[]) and stopped",[policies])).rows[0].n,0);
    });
    await scenario(async()=>{
      assert.equal(await store.recordFeedback({...input(),feedback:observed}),false,"no feedback without an actually reserved attempt");
      const first=input(),second=input();assert.equal((await store.reserve(first)).status,"reserved");assert.equal((await store.reserve(second)).status,"reserved");
      assert.equal(await store.recordFeedback({...second,feedback:observed}),true);
      assert.equal(await store.recordFeedback({...second,feedback:observed}),true,"same-attempt exact replay is idempotent");
      assert.equal(await store.recordFeedback({...second,feedback:{...observed,actualQueryCost:1}}),false,"same-attempt conflict cannot overwrite observation");
      assert.equal(await store.recordFeedback({...first,feedback:{...observed,currentlyAvailable:1}}),true);
      assert.equal((await row()).attempt_id,second.attemptId,"older reservation cannot replace latest observation");
      const malformed=[{...observed,secret:"SECRET"},{...observed,restoreRate:"0.5"},{...observed,actualQueryCost:9},
        {...observed,requestedQueryCost:0.5},{...observed,currentlyAvailable:1001},{...observed,restoreRate:-1},
        {...observed,requestedQueryCost:9007199254740992},{...observed,kind:"shopify_admin_cost_missing"}];
      for(const feedback of malformed){
        await client.query("savepoint admin_feedback_bad");
        try{await assert.rejects(client.query("select operations.record_shopify_admin_quota_feedback($1,$2,$3::jsonb)",[operation,second.attemptId,JSON.stringify(feedback)]),e=>e.code==="P0001");}
        finally{await client.query("rollback to savepoint admin_feedback_bad");await client.query("release savepoint admin_feedback_bad");}
      }
    });
    await scenario(async()=>{
      assert.ok((await native({errors:[{extensions:{code:"THROTTLED"}}],extensions:{cost:{...cost,actualQueryCost:null}}})).error);
      assert.equal((await stopped()).stop_signal,"shopify_admin_throttled");
      assert.equal((await client.query("select count(*)::int n from operations.api_quota_policies where id=any($1::uuid[]) and stopped",[policies])).rows[0].n,0,"native throttle without an owner rule stops only the operation");
    });
    await scenario(async()=>{
      const foreign=createHash("sha256").update(randomUUID()).digest("hex");
      await client.query("insert into operations.api_quota_operations(operation_key,provider) values($1,'klaviyo')",[foreign]);
      assert.equal(await store.recordFeedback({...input(),operationKey:foreign,feedback:observed}),false);
      assert.equal(await store.stop({...input(),operationKey:foreign,knownResponse:true,quotaSignal:"shopify_admin_throttled"}),false,"Admin signal cannot stop another provider");
    });
    // Owner rules may mention a policy not charged to this attempt; it must remain unaffected.
    const unrelated=randomUUID();
    await client.query("insert into operations.api_quota_policies(id,provider,cost_unit,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'shopify_admin','shopify_admin_query_points',60000,120,0,5000,10)",[unrelated]);
    for(const id of [policies[0],unrelated])await client.query("insert into operations.api_quota_stop_rules(operation_key,signal,policy_id) values($1,'shopify_admin_throttled',$2)",[operation,id]);
    const sibling=createHash("sha256").update(randomUUID()).digest("hex");
    await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required,reserved_requested_cost) values($1,'shopify_admin',true,true,37)",[sibling]);
    await client.query("insert into operations.api_quota_failure_bindings(operation_key,domain_id) values($1,$2)",[sibling,domain]);
    await client.query("insert into operations.api_quota_bindings(operation_key,policy_id,units) values($1,$2,37)",[sibling,policies[0]]);
    await client.query("insert into operations.api_quota_route_profiles(operation_key,domain_id,quota_fingerprint,enabled) select $1,$2,operations.shared_api_quota_fingerprint($1),true",[sibling,domain]);
    await client.query("insert into operations.api_quota_routes(route_key,operation_key,enabled) values($1,$1,true)",[sibling]);
    for(const failFeedback of [false,true])await scenario(async()=>{
      assert.ok((await native({errors:[{message:"SECRET",extensions:{code:"THROTTLED"}}],extensions:{cost:{...cost,actualQueryCost:null}}},200,{failFeedback})).error);
      assert.equal((await stopped()).stop_signal,"shopify_admin_throttled");
      const flags=(await client.query("select id,stopped from operations.api_quota_policies where id=any($1::uuid[])",[[...policies,unrelated]])).rows;
      assert.equal(flags.find(x=>x.id===policies[0]).stopped,true);
      assert.equal(flags.find(x=>x.id===policies[1]).stopped,false);assert.equal(flags.find(x=>x.id===unrelated).stopped,false);
      assert.equal((await store.reserve({operationKey:sibling,attemptId:randomUUID(),lane:"interactive"})).status,"stopped","shared charged policy blocks sibling operation");
      assert.equal((await client.query("select stopped from operations.api_quota_failure_domains where id=$1",[domain])).rows[0].stopped,false,"throttle is not credential failure");
    });
    for(const errors of [[],[{extensions:{code:"THROTTLED"}},{extensions:{code:"ACCESS_DENIED"}}],[{extensions:{code:"MAX_COST_EXCEEDED"}}]])await scenario(async()=>{
      await native({errors,extensions:{cost}},errors.length?200:429);
      assert.equal((await stopped()).stop_signal,null);
      assert.equal((await client.query("select count(*)::int n from operations.api_quota_policies where id=any($1::uuid[]) and stopped",[policies])).rows[0].n,0);
    });
    await scenario(async()=>{
      await native({},401);assert.equal((await stopped()).stop_kind,"connection");
      assert.equal((await client.query("select stopped from operations.api_quota_failure_domains where id=$1",[domain])).rows[0].stopped,true);
      assert.equal((await client.query("select count(*)::int n from operations.api_quota_policies where id=any($1::uuid[]) and stopped",[policies])).rows[0].n,0);
    });
    await scenario(async()=>{
      const r=await native({extensions:{cost:{...cost,requestedQueryCost:38}}});assert.equal(r.error?.message,"QUOTA_NATIVE_COST_BUDGET_EXCEEDED");
      assert.equal((await row()).feedback.requestedQueryCost,38);assert.equal((await stopped()).stop_signal,null);
      assert.equal((await client.query("select count(*)::int n from operations.api_quota_policies where id=any($1::uuid[]) and stopped",[policies])).rows[0].n,0,"budget overrun is not a native throttle signal");
    });
    await scenario(async()=>{
      assert.ok((await native({},200,{unknown:true})).error);assert.equal(await row(),undefined);assert.equal((await stopped()).stop_kind,"unknown");
      assert.equal((await client.query("select count(*)::int n from operations.api_quota_debits where operation_key=$1 and not settled",[operation])).rows[0].n,2);
    });
    for(const role of ["anon","authenticated","service_role","adstable_runtime"])
      assert.equal((await client.query("select has_function_privilege($1,'operations.record_shopify_admin_quota_feedback(text,uuid,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.stop_shared_api_quota_scoped_before_admin(text,uuid,boolean,boolean,text)','EXECUTE') allowed")).rows[0].allowed,false);
  }finally{await client.query("rollback to savepoint admin_feedback_probe");await client.query("release savepoint admin_feedback_probe");}
  assert.equal(await row(),undefined);
  console.log("EO05_ADMIN_COST_FEEDBACK_PASS real_SQL_transport_guard=true zero_partial_missing_invalid=true bound_attempt_and_latest_observation=true exact_native_throttle_owner_charged_rule_only=true shared_sibling_stopped=true unknown_unsettled=true no_refund_or_grant=true private_and_rolled_back=true native_HTTP=0");
}
