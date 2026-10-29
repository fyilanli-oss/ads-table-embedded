import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createShopifyOrderReconciliation} from "../app/lib/refresh/shopify-order-reconciliation.server.js";
import {createShopifyOrderWorkReservations} from "../app/lib/refresh/shopify-order-work-reservation.server.js";
import {createShopifyOrderEntitlementCheck} from "../app/lib/refresh/shopify-order-entitlement.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";

// Actual SQL role/locks/dispatch/receipt/CAS/rollback; Partner HTTP is synthetic.
// No live source, process-termination assertion, Order facts or Dataset writer.
export async function shopifyOrderReconciliationProbe(client,{database,inputs}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const owner=inputs[0].plan.owner;
  async function scenario(mode){
    await client.query("savepoint order_reconciliation_case");
    try{
      const work=createShopifyOrderWorkReservations({database}),reservation=await work.reserve(inputs[0]);assert.equal(reservation.status,"reserved",mode);
      const args=[owner.installationId,owner.workspaceId,owner.installGeneration,owner.shopId,owner.shopDomain,inputs[0].rangeKey,reservation.attemptId,reservation.fence];
      const types=["bigint","uuid","bigint","text","text","text","uuid","bigint"];
      const rpc=async(name,tail=[])=>{
        const all=[...types,...tail.map(x=>x.type)];return (await database.query(`select operations.${name}(${all.map((t,i)=>`$${i+1}::${t}`).join(",")}) as result`,[...args,...tail.map(x=>x.value)])).rows[0].result;
      };
      const row=async()=>(await client.query("select * from operations.shopify_order_work_reservations where attempt_id=$1",[reservation.attemptId])).rows[0];
      let receipt;
      if(["entitlement_settled","order_intent","admin_prefix","observed_uncommitted","metadata_conflict"].includes(mode)){
        const now=Date.now(),checker=createShopifyOrderEntitlementCheck({reservations:work,quotaStore:createSharedQuotaRepository(database),now:Date.now,
          environment:{SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"synthetic"},
          limits:{requestTimeoutMs:2000,finishReserveMs:10,deadlineAt:now+20000},fetchFn:async()=>Response.json({data:{activeSubscription:{shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},
            billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,trialEndsAt:null,currentBillingCycle:{startTime:new Date(now-100000).toISOString(),endTime:new Date(now+86400000).toISOString()},
            items:[{handle:"monthly",price:{active:false}}],pendingUpdate:null}}})});
        const verification=await checker.verify({reservation});assert.equal(verification.status,"verified",mode);
        receipt=[{type:"timestamptz",value:verification.receipt.observedAt},{type:"text",value:verification.receipt.sourceHash}];
        assert.equal((await row()).entitlement_request_count,1,"durable Partner marker survives phase change");
        if(mode!=="entitlement_settled"){
          assert.ok(await rpc("begin_shopify_order_read",[...receipt,{type:"jsonb",value:JSON.stringify({maxElapsedMs:10000,maxRequests:10,maxRows:1,maxBytes:1,pageSize:inputs[0].plan.policy.pageSize})},
            {type:"timestamptz",value:new Date(now+10000).toISOString()}]));
          if(mode!=="order_intent")assert.equal(await rpc("dispatch_shopify_order_read",receipt),true);
          if(mode==="observed_uncommitted")assert.equal(await rpc("observe_shopify_order_read",[...receipt,{type:"jsonb",value:'{"requests":1,"rows":0,"SDKResponseBytes":0}'}]),true);
          if(mode==="metadata_conflict")await client.query("update operations.shopify_order_work_reservations set entitlement_request_count=0 where attempt_id=$1",[reservation.attemptId]);
        }
      }else if(["intent_no_dispatch","partner_unknown","stopped_no_dispatch"].includes(mode)){
        assert.ok(await rpc("begin_shopify_order_entitlement"));
        if(mode==="partner_unknown")assert.equal(await rpc("dispatch_shopify_order_entitlement"),true);
        if(mode==="stopped_no_dispatch")assert.equal((await rpc("stop_shopify_order_entitlement",[{type:"text",value:"entitlement_unknown"}])).reservationRetained,true);
      }else if(mode==="legacy_unknown"){
        await client.query("update operations.shopify_order_work_reservations set phase='stopped',entitlement_request_count=null,stop_reason='entitlement_unknown' where attempt_id=$1",[reservation.attemptId]);
      }
      if(mode==="already_released")assert.equal((await work.releaseBeforeRequest({reservation})).status,"released");
      let db=database;
      if(mode==="lost_reply")db={async query(sql,params){const r=await database.query(sql,params);if(sql.includes("reconcile_shopify_order_work"))throw Error("synthetic lost reconciliation reply");return r;}};
      const review=createShopifyOrderReconciliation({database:db}),inspection=await review.inspect({attemptId:reservation.attemptId});assert.equal(inspection.status,"observed",mode);
      assert.equal(inspection.review.owner.installationId,owner.installationId);assert.equal(inspection.review.owner.workspaceId,owner.workspaceId);
      if(mode==="already_released"){
        const before=await row(),result=await review.reconcile({inspection});assert.equal(result.status,"already_released");assert.equal(result.recorded,false);
        assert.deepEqual(await row(),before);return;
      }
      if(mode==="stale_snapshot"){
        assert.ok(await rpc("begin_shopify_order_entitlement"));
        const result=await review.reconcile({inspection});assert.equal(result.status,"stale_observation");
        assert.equal((await row()).phase,"entitlement_intent");assert.equal(Number((await row()).reconciliation_version),0);return;
      }
      if(mode==="late_failure"){
        await client.query("create function pg_temp.reject_order_reconciliation_revision() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_RECONCILIATION_FAILURE';end$$");
        await client.query("create trigger reject_order_reconciliation_revision before update of revision on operations.refresh_control for each row execute function pg_temp.reject_order_reconciliation_revision()");
        const before=await row(),result=await review.reconcile({inspection});assert.equal(result.reason,"reconciliation_write_unconfirmed");
        assert.deepEqual(await row(),before,"audit, terminal phase, capacity release and revision roll back together");return;
      }
      const result=await review.reconcile({inspection});
      if(mode==="lost_reply")assert.equal(result.reason,"reconciliation_write_unconfirmed");else assert.equal(result.status,"recorded",mode);
      const final=await row();assert.equal(final.phase,"reconciled");assert.equal(Number(final.reconciliation_version),1);
      const released=["pre_request","intent_no_dispatch","stopped_no_dispatch","entitlement_settled","order_intent","lost_reply"].includes(mode);
      assert.equal(final.status,released?"released":"reserved",mode);
      const expected={pre_request:"released_before_provider",intent_no_dispatch:"released_before_provider",stopped_no_dispatch:"released_before_provider",
        entitlement_settled:"released_before_admin",order_intent:"released_before_admin",lost_reply:"released_before_provider",
        partner_unknown:"held_unknown",legacy_unknown:"held_unknown",admin_prefix:"held_admin_prefix",observed_uncommitted:"held_uncommitted",metadata_conflict:"held_metadata_conflict"};
      assert.equal(final.reconciliation_state,expected[mode],mode);
      const snapshot=(await database.query("select operations.read_refresh_admission_snapshot() as result")).rows[0].result;
      assert.equal((snapshot.state.externalClaims??[]).some(c=>c.id===reservation.attemptId),!released,"held work keeps its full shared capacity reservation");
      if(mode==="legacy_unknown")assert.equal(final.entitlement_request_count,null,"legacy uncertainty cannot become zero");
      if(mode==="admin_prefix"||mode==="observed_uncommitted")assert.equal(final.order_request_count,1);
      // None of the previous handles, begins, sends or final callbacks can change the reconciled attempt.
      assert.equal(await rpc("begin_shopify_order_entitlement"),null);assert.equal(await rpc("dispatch_shopify_order_entitlement"),false);
      assert.equal(await rpc("release_shopify_order_work"),false);
      await assert.rejects(rpc("apply_shopify_order_entitlement",[{type:"jsonb",value:"{}"}]),/NOT_CURRENT/);
      if(receipt){
        assert.equal(await rpc("dispatch_shopify_order_read",receipt),false);
        assert.equal(await rpc("observe_shopify_order_read",[...receipt,{type:"jsonb",value:'{"requests":1,"rows":0,"SDKResponseBytes":0}'}]),false);
      }
      assert.deepEqual(await row(),final,"late callbacks cannot overwrite the audit or release a retained prefix");
      const current=await review.inspect({attemptId:reservation.attemptId}),revision=(await client.query("select revision from operations.refresh_control")).rows[0].revision;
      assert.equal(current.review.workerFenced,true);
      const again=await review.reconcile({inspection:current});
      if(mode==="lost_reply")assert.equal(again.reason,"reconciliation_write_unconfirmed");else assert.equal(again.status,"already_recorded");
      assert.equal((await client.query("select revision from operations.refresh_control")).rows[0].revision,revision,"explicit duplicate observation does not grow revisions");
    }finally{await client.query("rollback to savepoint order_reconciliation_case");await client.query("release savepoint order_reconciliation_case");}
  }
  for(const mode of ["pre_request","already_released","intent_no_dispatch","stopped_no_dispatch","partner_unknown","legacy_unknown","entitlement_settled","order_intent","admin_prefix","observed_uncommitted","metadata_conflict","lost_reply","stale_snapshot","late_failure"])await scenario(mode);
  const empty=await createShopifyOrderReconciliation({database}).inspect({attemptId:randomUUID()});assert.equal(empty.status,"not_observed");assert.equal(empty.absenceProvesRollback,false);
  for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"]){
    for(const signature of ["operations.read_shopify_order_reconciliation(uuid)","operations.reconcile_shopify_order_work(uuid,bigint,text,uuid)"])
      assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).rows[0].ok,role==="adstable_refresh_coordinator");
    for(const signature of ["operations.shopify_order_reconciliation_owner(uuid)","operations.shopify_order_reconciliation_view(jsonb,jsonb)"])
      assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).rows[0].ok,false);
  }
  console.log("EO05_SHOPIFY_ORDER_RECONCILIATION_PASS real_SQL=true immutable_dispatch_marker=true legacy_unknown_not_zero=true explicit_inspect_then_CAS=true known_zero_release=true unknown_partial_uncommitted_held=true stale_and_late_callbacks_fenced=true lost_reply_no_retry=true atomic_audit_capacity=true no_Dataset_or_checkpoint=true");
}
