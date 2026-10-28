import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createShopifyOrderWorkReservations} from "../app/lib/refresh/shopify-order-work-reservation.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {planRefreshAdmissions} from "../app/lib/refresh/admission-policy.server.js";

// Shares the existing rollback-only queue fixture and its five reviewed synthetic profiles.
export async function shopifyOrderWorkProbe(client,{database,inputs,routes}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const owner=inputs[0].plan.owner,v=n=>({requests:n,dbWrites:n,connections:n,rows:n,bytes:n});
  const worker=createShopifyOrderWorkReservations({database}),ads=createRefreshWorkRepository(database);
  const count=async()=>Number((await client.query("select count(*) n from operations.shopify_order_work_reservations")).rows[0].n);
  const baseline=await count();
  const changed=async(sql,args,check)=>{
    await client.query("savepoint order_worker_change");try{await client.query(sql,args);await check();}
    finally{await client.query("rollback to savepoint order_worker_change");await client.query("release savepoint order_worker_change");}
  };
  const directRelease=(r,override={})=>database.query("select operations.release_shopify_order_work($1::bigint,$2::uuid,$3::bigint,$4::text,$5::text,$6::text,$7::uuid,$8::bigint) as result",
    [owner.installationId,owner.workspaceId,owner.installGeneration,owner.shopId,owner.shopDomain,override.rangeKey??r.rangeKey,r.attemptId,override.fence??r.fence]);
  await client.query("savepoint order_worker_probe");
  try{
    assert.equal((await worker.reserve(inputs[0])).status,"not_configured");assert.equal(await count(),baseline);
    await client.query("update operations.shopify_order_queue_control set worker_enabled=true,worker_cost=$1::jsonb,worker_epoch=worker_epoch+1",[JSON.stringify(v(1))]);
    await assert.rejects(changed("update operations.shopify_order_queue_control set worker_cost=$1::jsonb",[JSON.stringify(v(2))],async()=>{}),/WORKER_EPOCH_REQUIRED/);
    const snapshot=await ads.readAdmissionSnapshot(),sum=v(0);
    for(const claim of snapshot.state.claims)for(const k of Object.keys(sum))sum[k]+=claim.cost[k];
    const budget=structuredClone(snapshot.budget);budget.global=Object.fromEntries(Object.entries(sum).map(([k,n])=>[k,n+2]));budget.interactiveReserve=v(1);
    const local=v(0);for(const claim of snapshot.state.claims.filter(c=>c.workspaceId===owner.workspaceId))for(const k of Object.keys(local))local[k]+=claim.cost[k];
    const workspace=budget.workspaces.find(w=>w.workspaceId===owner.workspaceId);workspace.limit=Object.fromEntries(Object.entries(local).map(([k,n])=>[k,n+1]));
    budget.accounts.push({provider:"google_ads",accountId:"order-worker-probe",limit:v(10000)});
    await client.query("update operations.refresh_control set budget=$1::jsonb where singleton",[JSON.stringify(budget)]);
    const candidate={id:randomUUID(),workspaceId:owner.workspaceId,installGeneration:String(owner.installGeneration),provider:"google_ads",accountId:"order-worker-probe",queuedAt:0,scheduledHour:0,workClass:"hourly_hot_window",cost:v(1),
      authority:{installationVerified:true,entitled:true,connected:true,setupComplete:true,allowedWindow:true}};
    const plan=(s,changes={})=>planRefreshAdmissions({state:s.state,budget:s.budget,bounds:s.bounds,candidates:[candidate],now:Date.now(),...changes});
    assert.equal(plan(await ads.readAdmissionSnapshot()).status,"proposed");
    await changed("update operations.refresh_control set budget=null,bounds=null",[],async()=>{
      assert.equal((await worker.reserve(inputs[0])).status,"budget_unknown");
    });
    await changed("update operations.refresh_control set bounds=jsonb_set(bounds,'{maxClaims}',$1::jsonb)",[JSON.stringify(snapshot.state.claims.length)],async()=>{
      assert.equal((await worker.reserve(inputs[0])).status,snapshot.state.claims.length?"budget_full":"budget_unknown");
    });
    const fullWorkspace=structuredClone(budget.workspaces);fullWorkspace.find(w=>w.workspaceId===owner.workspaceId).limit=local;
    await changed("update operations.refresh_control set budget=jsonb_set(budget,'{workspaces}',$1::jsonb)",[JSON.stringify(fullWorkspace)],async()=>{
      assert.equal((await worker.reserve(inputs[0])).status,"budget_full","workspace capacity blocks independently of the global budget");
    });
    for(const resource of Object.keys(sum)){
      const limit={...budget.global,[resource]:sum[resource]+1};
      await changed("update operations.refresh_control set budget=jsonb_set(budget,'{global}',$1::jsonb)",[JSON.stringify(limit)],async()=>{
        assert.equal((await worker.reserve(inputs[0])).status,"budget_full",`${resource}: existing advertising reservations and interactive headroom consume the same global capacity`);
      });
    }
    await changed("update operations.api_quota_routes set enabled=false where route_key=$1",[routes[0].routeKey],async()=>{
      assert.equal((await worker.reserve(inputs[0])).status,"quota_configuration_required");
    });
    await changed("update operations.refresh_quota_contexts set connection_epoch=connection_epoch+1 where workspace_id=$1 and provider='shopify_admin'",[owner.workspaceId],async()=>{
      assert.equal((await worker.reserve(inputs[0])).status,"quota_configuration_required");
    });
    await changed("update shopify.installations set status='uninstall_pending_redaction' where id=$1",[owner.installationId],async()=>{
      assert.equal((await worker.reserve(inputs[0])).status,"not_current");
    });
    const before=await ads.readAdmissionSnapshot(),first=await worker.reserve(inputs[0]);assert.equal(first.status,"reserved");
    assert.equal(first.fence,before.state.nextFence);assert.equal(first.authorizesDispatch,false);assert.equal(first.entitlementVerified,false);
    const held=await ads.readAdmissionSnapshot();assert.equal(held.state.revision,before.state.revision+1);assert.equal(held.state.nextFence,before.state.nextFence+1);
    assert.equal(held.state.externalClaims.length,1);assert.equal(held.state.externalClaims[0].source,"shopify_orders");
    assert.equal(Object.hasOwn(held.state.externalClaims[0],"provider"),false);
    assert.equal(plan(held).deferred[0].reason,"budget_full");
    assert.equal((await worker.reserve(inputs[1])).status,"installation_busy");
    // Try bypassing the pure planner by deleting the external reservation from its input.
    const forged=structuredClone(held);delete forged.state.externalClaims;
    const bypass=plan(forged);assert.equal(bypass.status,"proposed");
    assert.equal(await ads.compareAndSwap({expectedRevision:held.state.revision,nextState:bypass.nextState}),false,"SQL independently counts actual Order cost");
    await changed("update operations.shopify_order_queue_control set worker_enabled=false,worker_epoch=worker_epoch+1",[],async()=>{
      assert.equal((await worker.reserve(inputs[1])).status,"not_configured");assert.equal((await ads.readAdmissionSnapshot()).state.externalClaims.length,1,"policy disable never releases unknown work");
    });
    assert.equal((await directRelease(first,{fence:first.fence+1})).rows[0].result,false);
    assert.equal((await worker.releaseBeforeRequest({reservation:first})).status,"released");
    assert.equal((await ads.readAdmissionSnapshot()).state.externalClaims,undefined);
    const available=await ads.readAdmissionSnapshot(),adPlan=plan(available);
    assert.equal(await ads.compareAndSwap({expectedRevision:available.state.revision,nextState:adPlan.nextState}),true);
    assert.equal((await worker.reserve(inputs[1])).status,"budget_full","advertising admission wins the same last capacity slot");
    assert.equal(await ads.finishClaim({claim:adPlan.admitted[0],outcome:"paused"}),true);
    const second=await worker.reserve(inputs[1]);assert.equal(second.status,"reserved");assert.ok(second.fence>first.fence);
    assert.equal((await directRelease(first)).rows[0].result,false,"old fence/attempt cannot release newer owner");
    assert.equal((await worker.releaseBeforeRequest({reservation:second})).status,"released");
    let writes=0;
    const uncertain=createShopifyOrderWorkReservations({database:{async query(sql,args){const r=await database.query(sql,args);
      if(sql.includes("reserve_shopify_order_work")){writes++;throw Error("synthetic response loss");}return r;}}});
    const unknown=await uncertain.reserve(inputs[0]);assert.equal(unknown.reason,"reservation_write_unconfirmed");assert.equal(writes,1);
    const observed=await uncertain.readReservation({...inputs[0],attemptId:unknown.attemptId});assert.equal(observed.reservationStatus,"reserved");assert.equal(writes,1);
    await assert.rejects(uncertain.releaseBeforeRequest({reservation:observed}),/INPUT_INVALID/);
    assert.equal((await ads.readAdmissionSnapshot()).state.externalClaims.length,1);
    assert.equal((await directRelease(observed)).rows[0].result,true,"explicit trusted fixture reconciliation only, not observation authority");
    const preFailure=await ads.readAdmissionSnapshot(),preCount=await count();
    await client.query("create function pg_temp.reject_order_worker_revision() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_WORK_FAILURE';end$$");
    await client.query("savepoint worker_late_insert");
    await client.query("create trigger reject_order_worker_revision before update of revision on operations.refresh_control for each row execute function pg_temp.reject_order_worker_revision()");
    const failure=await worker.reserve(inputs[0]);assert.equal(failure.reason,"reservation_write_unconfirmed");assert.equal(await count(),preCount);
    assert.deepEqual((await ads.readAdmissionSnapshot()).state,preFailure.state,"claim insert and shared fence/revision roll back together");
    await client.query("rollback to savepoint worker_late_insert");await client.query("release savepoint worker_late_insert");
    const releaseCase=await worker.reserve(inputs[0]);assert.equal(releaseCase.status,"reserved");
    await client.query("create trigger reject_order_worker_revision before update of revision on operations.refresh_control for each row execute function pg_temp.reject_order_worker_revision()");
    const unknownRelease=await worker.releaseBeforeRequest({reservation:releaseCase});assert.equal(unknownRelease.reason,"reservation_release_unconfirmed");
    assert.equal((await worker.readReservation({...inputs[0],attemptId:releaseCase.attemptId})).reservationStatus,"reserved","failed final counter update rolls release back as well");
    await assert.rejects(worker.releaseBeforeRequest({reservation:releaseCase}),/INPUT_INVALID/);
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"]){
      assert.equal((await client.query("select has_table_privilege($1,'operations.shopify_order_work_reservations','SELECT,INSERT,UPDATE,DELETE') ok",[role])).rows[0].ok,false);
      for(const signature of ["operations.shopify_order_combined_capacity(jsonb,uuid,jsonb)","operations.commit_refresh_admissions_before_shopify_orders(bigint,jsonb)","operations.read_refresh_admission_snapshot_before_shopify_orders()"])
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).rows[0].ok,false);
      for(const signature of ["operations.reserve_shopify_order_work(bigint,uuid,bigint,text,text,text,uuid)","operations.release_shopify_order_work(bigint,uuid,bigint,text,text,text,uuid,bigint)","operations.read_shopify_order_work_reservation(bigint,uuid,bigint,text,text,text,uuid)"])
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).rows[0].ok,role==="adstable_refresh_coordinator");
    }
  }finally{await client.query("rollback to savepoint order_worker_probe");await client.query("release savepoint order_worker_probe");}
  assert.equal(await count(),baseline);
  console.log("EO05_SHOPIFY_ORDER_WORK_RESERVATION_PASS real_SQL=true provider_independent=true shared_global_workspace_capacity_both_directions=true shared_fence_revision=true single_flight=true retained_unknown_no_timeout_release=true late_failure_atomic=true no_native_HTTP_no_dispatch=true");
}
