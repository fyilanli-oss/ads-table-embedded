import assert from "node:assert/strict";
import {createShopifyOrderWorkReservations} from "../app/lib/refresh/shopify-order-work-reservation.server.js";
import {createShopifyOrderEntitlementCheck} from "../app/lib/refresh/shopify-order-entitlement.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";

// Real SQL/quotas/billing normalizer in the existing rollback-only F01 fixture.
// Physical HTTP is synthetic and confined to this fixture; no live credentials or requests.
export async function shopifyOrderEntitlementProbe(client,{database,inputs,routes}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const owner=inputs[0].plan.owner;
  const sourceArgs=r=>[owner.installationId,owner.workspaceId,owner.installGeneration,owner.shopId,owner.shopDomain,inputs[0].rangeKey,r.attemptId,r.fence];
  const directRelease=r=>database.query("select operations.release_shopify_order_work($1::bigint,$2::uuid,$3::bigint,$4::text,$5::text,$6::text,$7::uuid,$8::bigint) as result",sourceArgs(r));
  async function scenario(mode){
    await client.query("savepoint order_entitlement_case");
    try{
      let calls=0;const now=Date.now();
      const work=createShopifyOrderWorkReservations({database}),reservation=await work.reserve(inputs[0]);assert.equal(reservation.status,"reserved");
      let activeReservation=reservation;
      const payload={data:{activeSubscription:{shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:true,
        trialEndsAt:null,currentBillingCycle:{startTime:new Date(now-100000).toISOString(),endTime:new Date(now+86400000).toISOString()},items:[{handle:"monthly",price:{active:false}}],pendingUpdate:null}}};
      const row=async()=> (await client.query("select phase,status,stop_reason,entitlement_source_hash from operations.shopify_order_work_reservations where attempt_id=$1",[activeReservation.attemptId])).rows[0];
      const base={reservations:work,quotaStore:createSharedQuotaRepository(database),environment:{SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"synthetic-only"},
        now:Date.now,limits:{requestTimeoutMs:2000,finishReserveMs:10,deadlineAt:now+20000},fetchFn:async()=>{
          calls++;assert.equal((await row()).phase,"entitlement_dispatched","durable dispatch marker precedes first physical request");
          assert.equal((await directRelease(activeReservation)).rows[0].result,false,"SQL closes old pre-request release after intent");
          if(mode==="unknown")throw Error("synthetic unknown response");
          if(mode==="owner_changed")await client.query("update shopify.installations set status='uninstall_pending_redaction' where id=$1",[owner.installationId]);
          if(mode==="false_not_sent"){
            const stopped=await database.query("select operations.stop_shopify_order_entitlement($1::bigint,$2::uuid,$3::bigint,$4::text,$5::text,$6::text,$7::uuid,$8::bigint,'entitlement_not_dispatched') as result",sourceArgs(activeReservation));
            assert.equal(stopped.rows[0].result.reservationRetained,true,"a not-sent label cannot release a dispatch-marked reservation");
          }
          if(mode==="denied")payload.data.activeSubscription=null;
          return new Response(JSON.stringify(payload),{headers:{"content-type":"application/json"}});
        }};
      if(mode==="quota_wait")await client.query("update operations.api_quota_policies set max_units=interactive_reserve where id in (select policy_id from operations.api_quota_bindings where operation_key=$1)",[routes[0].routeKey]);
      // Re-fingerprint a synthetic zero-background profile: known waiting, not a stale route.
      if(mode==="quota_wait")await client.query("update operations.api_quota_route_profiles set quota_fingerprint=operations.shared_api_quota_fingerprint(operation_key) where operation_key=$1",[routes[0].routeKey]);
      let db=database;
      if(mode==="lost_intent"||mode==="lost_apply"){
        db={async query(sql,args){const result=await database.query(sql,args);
          if(sql.includes(mode==="lost_intent"?"begin_shopify_order_entitlement":"apply_shopify_order_entitlement"))throw Error("synthetic lost reply");return result;}};
        // Factory and checker share the very same scoped database binding.
        assert.equal((await work.releaseBeforeRequest({reservation})).status,"released");
        const boundWork=createShopifyOrderWorkReservations({database:db}),boundReservation=await boundWork.reserve(inputs[0]);
        activeReservation=boundReservation;
        base.reservations=boundWork;base.boundReservation=boundReservation;
      }
      const chosen=base.boundReservation??reservation;delete base.boundReservation;
      const billingBefore=(await client.query("select * from billing.workspace_subscriptions where workspace_id=$1",[owner.workspaceId])).rows;
      if(mode==="late_apply"){
        await client.query("create function pg_temp.reject_order_entitlement_receipt() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_ENTITLEMENT_RECEIPT_FAILURE';end$$");
        await client.query("create trigger reject_order_entitlement_receipt before update of phase on operations.shopify_order_work_reservations for each row when (new.phase='entitlement_observed') execute function pg_temp.reject_order_entitlement_receipt()");
      }
      const checker=createShopifyOrderEntitlementCheck(base),result=await checker.verify({reservation:chosen});
      assert.equal(result.authorizesDispatch,false);assert.equal(result.DatasetWritePerformed,false);
      const actual=(await client.query("select phase,status,stop_reason from operations.shopify_order_work_reservations where attempt_id=$1",[chosen.attemptId])).rows[0];
      if(mode==="success"){
        assert.equal(result.status,"verified");assert.equal(result.entitlementVerified,true);assert.equal(calls,1);assert.equal(actual.phase,"entitlement_observed");
        assert.equal(await checker.isCurrent({verification:result}),true);
        await assert.rejects(checker.isCurrent({verification:structuredClone(result)}),/INPUT_INVALID/);
        await client.query("update billing.workspace_entitlements set entitlement_status='subscription_required' where workspace_id=$1",[owner.workspaceId]);
        assert.equal(await checker.isCurrent({verification:result}),false,"new billing denial invalidates old receipt");
        assert.equal((await directRelease(chosen)).rows[0].result,false);
        await assert.rejects(work.releaseBeforeRequest({reservation}),/INPUT_INVALID/);
      }else if(mode==="denied"){
        assert.equal(result.status,"denied");assert.equal(result.reservationRetained,false);assert.equal(actual.status,"released");assert.equal(calls,1);
        assert.equal((await client.query("select entitlement_status from billing.workspace_entitlements where workspace_id=$1",[owner.workspaceId])).rows[0].entitlement_status,"subscription_required");
      }else if(mode==="quota_wait"){
        assert.equal(result.status,"not_dispatched");assert.equal(calls,0);assert.equal(actual.status,"released");
      }else if(mode==="lost_intent"){
        assert.equal(result.reason,"entitlement_intent_unconfirmed");assert.equal(actual.phase,"entitlement_intent");assert.equal(actual.status,"reserved");assert.equal(calls,0);
        assert.equal((await directRelease(chosen)).rows[0].result,false);
      }else{
        assert.equal(result.reservationRetained,true);assert.equal(result.status,"needs_attention");assert.equal(actual.phase,"stopped");assert.equal(actual.status,"reserved");assert.equal(calls,1);
        assert.equal((await directRelease(chosen)).rows[0].result,false);
        if(mode==="late_apply")assert.deepEqual((await client.query("select * from billing.workspace_subscriptions where workspace_id=$1",[owner.workspaceId])).rows,billingBefore,"billing projection and work receipt roll back atomically");
        if(mode==="lost_apply")assert.equal(actual.stop_reason,"entitlement_write_unconfirmed");
      }
    }finally{await client.query("rollback to savepoint order_entitlement_case");await client.query("release savepoint order_entitlement_case");}
  }
  for(const mode of ["success","denied","quota_wait","unknown","owner_changed","lost_intent","lost_apply","late_apply","false_not_sent"])await scenario(mode);
  const signatures=["operations.begin_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint)",
    "operations.load_shopify_order_entitlement_context(bigint,uuid,bigint,text,text,text,uuid,bigint)",
    "operations.dispatch_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint)",
    "operations.apply_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint,jsonb)",
    "operations.shopify_order_entitlement_is_current(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text)",
    "operations.stop_shopify_order_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint,text)"];
  for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"]){
    for(const signature of signatures)assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).rows[0].ok,role==="adstable_refresh_coordinator");
    for(const signature of ["operations.shopify_order_work_is_current(bigint,uuid,bigint,text,text,text,uuid,bigint)","operations.release_shopify_order_work_before_entitlement(bigint,uuid,bigint,text,text,text,uuid,bigint)"])
      assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).rows[0].ok,false);
  }
  console.log("EO05_SHOPIFY_ORDER_ENTITLEMENT_PASS real_SQL_shared_quota_synthetic_HTTP=true intent_before_HTTP=true old_release_closed=true exact_fresh_receipt=true newer_denial_blocks=true controlled_denial_wait_release=true unknown_retains_capacity=true lost_reply_no_retry=true private_RPC=true");
}
