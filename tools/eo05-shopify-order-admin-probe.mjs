import assert from "node:assert/strict";
import {fixture,restoreShopifyOrderFixtureFetch} from "../tests/helpers/shopify-order-fixture.js";
import {createShopifyOrderWorkReservations} from "../app/lib/refresh/shopify-order-work-reservation.server.js";
import {createShopifyOrderEntitlementCheck} from "../app/lib/refresh/shopify-order-entitlement.server.js";
import {createIndependentShopifyOrderReader} from "../app/lib/refresh/shopify-order-admin-reader.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {isShopifyOrderCollectionObservation} from "../app/lib/shopify/order-collection.server.js";
import {sourceStoreFixture} from "../tests/fixtures/source-store-fixture.js";
import {createSourceEvidenceRepository} from "../app/lib/database/source-evidence-store.server.js";

// Existing real F01 SQL fixture + actual SDK hook/client + synthetic physical HTTP.
// All hook/profile/policy/data mutations are test-only and rolled back/restored.
export async function shopifyIndependentAdminProbe(client,{database,inputs,routes}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const owner=inputs[0].plan.owner,v=n=>({requests:n,dbWrites:n,connections:n,rows:n,bytes:n});
  const costs={requests:1,dbWrites:1,connections:1,rows:1000,bytes:1000000};
  async function scenario(mode){
    await client.query("savepoint independent_admin_case");
    const f=fixture({shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},updatedAt:"2026-10-01T00:30:00Z"});
    const sourceMode=mode.startsWith("source_"),{input:sourceConfig}=sourceStoreFixture();let sourceCalls=0,sourceArgs;
    try{
      await client.query("update operations.shopify_order_queue_control set worker_cost=$1::jsonb,worker_epoch=worker_epoch+1",[JSON.stringify(costs)]);
      const budget=(await client.query("select budget from operations.refresh_control")).rows[0].budget;
      budget.global=v(10000000);budget.interactiveReserve=v(1);budget.workspaces.find(w=>w.workspaceId===owner.workspaceId).limit=v(10000000);
      await client.query("update operations.refresh_control set budget=$1::jsonb",[JSON.stringify(budget)]);
      await client.query("update operations.api_quota_policies set max_units=1000000,interactive_reserve=0 where id in (select policy_id from operations.api_quota_bindings where operation_key=any($1::text[]))",[routes.map(r=>r.routeKey)]);
      await client.query("update operations.api_quota_route_profiles set quota_fingerprint=operations.shared_api_quota_fingerprint(operation_key) where operation_key=any($1::text[])",[routes.map(r=>r.routeKey)]);
      const db={async query(sql,args){
        if(sql.includes("evidence.commit_shopify_order_source")){
          sourceCalls++;sourceArgs=args;
          if(mode==="source_fence")await client.query("update operations.shopify_order_work_reservations set fence=fence+1 where attempt_id=$1",[args[1]]);
          await client.query("savepoint source_commit_call");let result;
          try{result=await client.query(sql,args);await client.query("release savepoint source_commit_call");}
          catch(error){await client.query("rollback to savepoint source_commit_call");await client.query("release savepoint source_commit_call");throw error;}
          if(mode==="source_lost")throw Error("synthetic lost source acknowledgement");return result;
        }
        const r=await database.query(sql,args);
        if(mode==="lost_dispatch"&&sql.includes("dispatch_shopify_order_read"))throw Error("synthetic lost dispatch reply");
        if(mode==="lost_handoff"&&sql.includes("observe_shopify_order_read"))throw Error("synthetic lost handoff reply");return r;}};
      const work=createShopifyOrderWorkReservations({database:db}),reservation=await work.reserve(inputs[0]);assert.equal(reservation.status,"reserved");
      const quotaStore=createSharedQuotaRepository(db),now=Date.now();
      const entitlementCheck=createShopifyOrderEntitlementCheck({reservations:work,quotaStore,now:Date.now,
        environment:{SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"synthetic"},
        limits:{requestTimeoutMs:2000,finishReserveMs:10,deadlineAt:now+20000},fetchFn:async()=>Response.json({data:{activeSubscription:{shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},
          billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,trialEndsAt:null,currentBillingCycle:{startTime:new Date(now-100000).toISOString(),endTime:new Date(now+86400000).toISOString()},items:[{handle:"monthly",price:{active:false}}],pendingUpdate:null}}})});
      const verification=await entitlementCheck.verify({reservation});assert.equal(verification.status,"verified");
      if(["wait_first","wait_prefix"].includes(mode)){
        const family=mode==="wait_first"?"permission_scopes":"order_lines",key=routes.find(r=>r.family===family).routeKey;
        await client.query("update operations.api_quota_policies set max_units=37,interactive_reserve=37 where id in (select policy_id from operations.api_quota_bindings where operation_key=$1)",[key]);
        await client.query("update operations.api_quota_route_profiles set quota_fingerprint=operations.shared_api_quota_fingerprint(operation_key) where operation_key=$1",[key]);
      }
      if(mode==="billing_changed")f.q.native=async()=>{await client.query("update billing.workspace_entitlements set entitlement_status='subscription_required' where workspace_id=$1",[owner.workspaceId]);};
      if(mode==="native_unknown")f.q.throw=true;
      if(mode==="source_partial")f.q.native=({family,payload})=>{if(family==="order_journey")payload.data.order.customerJourneySummary=null;};
      if(mode==="source_late_failure"){
        await client.query("create function pg_temp.reject_source_links() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_SOURCE_LINK_FAILURE';end$$");
        await client.query("create trigger reject_source_links before insert on evidence.source_reference_links for each row execute function pg_temp.reject_source_links()");
      }
      if(mode==="late_handoff"){
        await client.query("create function pg_temp.reject_order_observation() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_ORDER_HANDOFF_FAILURE';end$$");
        await client.query("create trigger reject_order_observation before update of phase on operations.shopify_order_work_reservations for each row when (new.phase='order_observed') execute function pg_temp.reject_order_observation()");
      }
      const reader=createIndependentShopifyOrderReader({entitlementCheck,verification,admin:f.config.verified.context.admin,sdkBridge:f.config.sdkBridge,quotaStore,
        ...sourceMode?{sourceStorage:{cipher:sourceConfig.cipher,policy:sourceConfig.policy,limits:{maxBytes:1000000,maxRows:1000}}}:{},
        limits:{maxElapsedMs:10000,maxRequests:100,maxRows:1000,maxBytes:1000000,pageSize:inputs[0].plan.policy.pageSize},timeoutMs:2000,
        fetchFn:async(input,init)=>{
          const r=(await client.query("select phase,order_request_count from operations.shopify_order_work_reservations where attempt_id=$1",[reservation.attemptId])).rows[0];
          assert.equal(r.phase,"order_reading");assert.equal(r.order_request_count,f.calls.length+1);return f.config.fetchFn(input,init);
        }});
      const result=await reader.readEvidence(),row=(await client.query("select phase,status,order_request_count,order_stats from operations.shopify_order_work_reservations where attempt_id=$1",[reservation.attemptId])).rows[0];
      assert.equal(result.DatasetWritePerformed,false);assert.equal(result.checkpointAdvanced,false);assert.equal(result.resumeAuthorized,false);assert.equal(result.reloadFirstPageAuthorized,false);
      if(sourceMode){
        assert.equal(sourceCalls,1,JSON.stringify({mode,reason:result.reason,preparationCode:result.preparationCode}));assert.equal(row.phase,"order_observed");assert.equal(row.status,"reserved");
        const stored=(await client.query("select * from evidence.source_batches where attempt_id=$1",[reservation.attemptId])).rows;
        if(["source_success","source_partial","source_lost"].includes(mode)){
          assert.equal(stored.length,1);assert.equal(stored[0].handoff_state,"pending");
          const w=JSON.parse(sourceArgs[0]),repo=createSourceEvidenceRepository(client);
          const pages=await repo.readPages({owner:w,attemptId:reservation.attemptId,ordinal:0,limit:100});assert.ok(pages.length>0);
          const payloads=pages.map(page=>sourceConfig.cipher.open({owner:w,attemptId:reservation.attemptId,ordinal:0,page}));
          assert.ok(payloads.some(p=>p.records.some(r=>r.id==="gid://shopify/Order/10")));
          assert.equal(stored[0].source_state,mode==="source_partial"?"partial":"complete");
          if(mode==="source_lost"){
            assert.equal(result.reason,"source_write_unconfirmed");assert.equal(result.collection,null);
            assert.equal((await repo.inspect({owner:w,attemptId:reservation.attemptId,ordinal:0})).status,"committed");
          }else{
            assert.equal(result.status,mode==="source_partial"?"partial_source_committed":"source_committed");
            assert.equal(result.sourceStored,true);assert.equal(result.sourceReceipt.manifest.counts.ordersInserted,1);
            const replay=(await client.query("select evidence.commit_shopify_order_source($1::jsonb,$2::uuid,$3::integer,$4::jsonb,$5::jsonb) as result",sourceArgs)).rows[0].result;
            assert.equal(replay.commitId,result.sourceReceipt.commitId);
          }
        }else{
          assert.equal(result.reason,"source_write_unconfirmed");assert.equal(stored.length,0);
          assert.equal((await client.query("select count(*)::int n from source.shopify_order_versions where installation_id=$1",[owner.installationId])).rows[0].n,0);
        }
        await assert.rejects(reader.readEvidence(),/INPUT_INVALID/);
      }else if(mode==="success"){
        assert.equal(result.status,"collected_not_durably_committed");assert.ok(isShopifyOrderCollectionObservation(result.collection));assert.equal(result.collection.orders.length,1);
        assert.equal(result.collection.scope.installation_id,owner.installationId);assert.equal(result.collection.scope.job.source,"shopify_orders");assert.equal(result.collection.scope.job.provider,undefined);
        assert.equal(row.phase,"order_observed");assert.equal(row.status,"reserved");assert.equal(row.order_request_count,f.calls.length);assert.deepEqual(row.order_stats,result.collection.stats);
        assert.equal(await entitlementCheck.isCurrent({verification}),true);
        await client.query("update operations.shopify_order_work_reservations set order_deadline_at=statement_timestamp()-interval '1 second' where attempt_id=$1",[reservation.attemptId]);
        assert.equal(await entitlementCheck.isCurrent({verification}),false,"expired read deadline cannot keep the work receipt current");
        await assert.rejects(reader.readEvidence(),/INPUT_INVALID/);
      }else if(mode.startsWith("wait_")){
        assert.equal(result.status,"quota_waiting");assert.equal(result.collection,null);
        const first=mode==="wait_first";assert.equal(row.status,first?"released":"reserved");assert.equal(f.calls.length,first?0:2);
      }else{
        assert.equal(result.status,"needs_attention");assert.equal(result.collection,null);assert.equal(row.phase,"stopped");assert.equal(row.status,"reserved");
        if(mode==="lost_dispatch"){assert.equal(f.calls.length,0);assert.equal(row.order_request_count,1);}
        if(mode==="billing_changed"||mode==="native_unknown")assert.equal(f.calls.length,1);
        if(mode==="late_handoff")assert.equal(row.order_stats,null);
      }
      assert.equal((await database.query("select operations.release_shopify_order_work($1::bigint,$2::uuid,$3::bigint,$4::text,$5::text,$6::text,$7::uuid,$8::bigint) as result",
        [owner.installationId,owner.workspaceId,owner.installGeneration,owner.shopId,owner.shopDomain,inputs[0].rangeKey,reservation.attemptId,reservation.fence])).rows[0].result,false);
    }finally{restoreShopifyOrderFixtureFetch();await client.query("rollback to savepoint independent_admin_case");await client.query("release savepoint independent_admin_case");}
  }
  for(const mode of ["success","wait_first","wait_prefix","billing_changed","native_unknown","lost_dispatch","lost_handoff","late_handoff",
    "source_success","source_partial","source_lost","source_fence","source_late_failure"])await scenario(mode);
  for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"]){
    for(const signature of ["operations.begin_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text,jsonb,timestamptz)",
      "operations.load_shopify_order_read_owner(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text)",
      "operations.dispatch_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text)",
      "operations.observe_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,timestamptz,text,jsonb)",
      "operations.stop_shopify_order_read(bigint,uuid,bigint,text,text,text,uuid,bigint,text)"])
      assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).rows[0].ok,role==="adstable_refresh_coordinator");
  }
  for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
    assert.equal((await client.query("select has_function_privilege($1,'evidence.commit_shopify_order_source(jsonb,uuid,integer,jsonb,jsonb)','EXECUTE') ok",[role])).rows[0].ok,false);
  console.log("EO05_SHOPIFY_SOURCE_CAPTURE_PASS real_SQL_actual_SDK_synthetic_HTTP=true encrypted_pages_and_links=true fenced_atomic_write=true lost_ack_readback=true late_failure_rollback=true no_runtime_grants=true");
  console.log("EO05_INDEPENDENT_SHOPIFY_ADMIN_PASS real_SQL_actual_SDK_synthetic_HTTP=true no_ad_identity=true fresh_billing_and_owner_each_boundary=true SQL_dispatch_before_HTTP=true permissions_pagination_consistency=true first_wait_release_prefix_wait_hold=true lost_reply_and_unknown_hold=true no_Dataset_or_checkpoint=true");
}
