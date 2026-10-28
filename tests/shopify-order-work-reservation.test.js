import test,{after} from "node:test";
import assert from "node:assert/strict";
import {createShopifyOrderWorkReservations} from "../app/lib/refresh/shopify-order-work-reservation.server.js";
import {createShopifyOrderRangePlanner} from "../app/lib/refresh/shopify-order-range-plan.server.js";
import {fixture,prewriteOwner,restoreShopifyOrderFixtureFetch} from "./helpers/shopify-order-fixture.js";
after(restoreShopifyOrderFixtureFetch);
const cost={requests:2,dbWrites:1,connections:1,rows:100,bytes:10000};
const check=r=>{for(const k of ["authorizesDispatch","authorizesActivation","entitlementVerified","quotaReserved","checkpointAdvanced","persistable","DatasetWritePerformed"])assert.equal(r[k],false);};
async function setup(){
  const f=fixture(),plan=await createShopifyOrderRangePlanner({expected:prewriteOwner(),database:f.config.database,
    policy:{anchorAt:"2026-10-01T00:00:00Z",cadenceMs:3600000,sliceMs:86400000,settleDelayMs:0,maxRanges:1,pageSize:100,includeOrderHistory:false},
    now:()=>new Date("2026-10-02T00:00:00Z")}).plan({fromInclusive:"2026-10-01T00:00:00Z"});
  const state={calls:[],lost:false,read:null},input={plan,rangeKey:plan.ranges[0].key};
  const database={async query(sql,args){state.calls.push({sql,args});
    if(sql.includes("reserve_shopify_order_work")){
      state.read={attemptId:args[6],rangeKey:args[5],fence:7,cost:{...cost},reservationStatus:"reserved"};
      if(state.lost)throw Error("private secret");return {rows:[{result:state.result??{status:"reserved",...state.read}}]};
    }
    if(sql.includes("read_shopify_order_work_reservation"))return {rows:[{result:state.read}]};
    if(sql.includes("release_shopify_order_work")){if(state.releaseError)throw Error("unknown");state.read.reservationStatus="released";return {rows:[{result:state.released??true}]};}
    throw Error("unexpected");
  }};
  return {f,input,state,database,worker:createShopifyOrderWorkReservations({database})};
}
test("reservation sends exact actual installation owner and generated attempt, no ad identity or native IO",async()=>{
  const h=await setup(),r=await h.worker.reserve(h.input);assert.equal(r.status,"reserved");check(r);assert.equal(r.reservationHeld,true);assert.equal(h.f.calls.length,0);
  assert.equal(h.state.calls.length,1);assert.equal(h.state.calls[0].args.length,7);assert.equal(h.state.calls[0].args[0],"42");
  assert.ok(Object.isFrozen(r.cost));assert.doesNotMatch(JSON.stringify(h.state.calls),/google_ads|meta|accountId|entitlementReceipt/);
  const released=await h.worker.releaseBeforeRequest({reservation:r});assert.equal(released.status,"released");check(released);
  await assert.rejects(h.worker.releaseBeforeRequest({reservation:r}),/INPUT_INVALID/);
});
for(const status of ["not_configured","not_current","attempt_exists","installation_busy","quota_configuration_required","budget_full","budget_unknown"])
  test(`SQL ${status} does not retry or grant execution`,async()=>{const h=await setup();h.state.result={status};const r=await h.worker.reserve(h.input);assert.equal(r.status,status);check(r);assert.equal(h.state.calls.length,1);});
test("unknown commit retains possible capacity with explicit observation only",async()=>{
  const h=await setup();h.state.lost=true;const r=await h.worker.reserve(h.input);assert.equal(r.reason,"reservation_write_unconfirmed");assert.equal(r.reservationMayBeHeld,true);check(r);
  assert.equal(h.state.calls.length,1);assert.doesNotMatch(JSON.stringify(r),/private|secret/);
  const read=await h.worker.readReservation({...h.input,attemptId:r.attemptId});assert.equal(read.status,"observed");check(read);
  await assert.rejects(h.worker.releaseBeforeRequest({reservation:read}),/INPUT_INVALID/);assert.equal(h.state.calls.length,2);
});
test("unknown release consumes the handle and never silently retries or frees capacity",async()=>{
  const h=await setup(),r=await h.worker.reserve(h.input);h.state.releaseError=true;
  const result=await h.worker.releaseBeforeRequest({reservation:r});assert.equal(result.reason,"reservation_release_unconfirmed");check(result);
  await assert.rejects(h.worker.releaseBeforeRequest({reservation:r}),/INPUT_INVALID/);assert.equal(h.state.calls.length,2);
});
test("concurrent release calls cannot both send an RPC",async()=>{
  const h=await setup(),r=await h.worker.reserve(h.input),a=h.worker.releaseBeforeRequest({reservation:r});
  await assert.rejects(h.worker.releaseBeforeRequest({reservation:r}),/INPUT_INVALID/);assert.equal((await a).status,"released");assert.equal(h.state.calls.length,2);
});
test("foreign factory, serialized handle and plan clones cannot mint authority",async()=>{
  const h=await setup(),r=await h.worker.reserve(h.input),other=createShopifyOrderWorkReservations({database:h.database});
  await assert.rejects(other.releaseBeforeRequest({reservation:r}),/INPUT_INVALID/);
  await assert.rejects(h.worker.releaseBeforeRequest({reservation:structuredClone(r)}),/INPUT_INVALID/);
  await assert.rejects(h.worker.reserve({...h.input,plan:structuredClone(h.input.plan)}),/PROVENANCE_REQUIRED/);assert.equal(h.state.calls.length,1);
});
for(const field of ["cost","fence","attemptId","entitlementReceipt","provider","cursor","deadlineAt","workerAdmitted"])
  test(`caller ${field} is rejected before SQL`,async()=>{const h=await setup();await assert.rejects(h.worker.reserve({...h.input,[field]:"injected"}),/INPUT_INVALID/);assert.equal(h.state.calls.length,0);});
test("absent read is not proof of rollback; malformed result does not yield a handle",async()=>{
  const h=await setup();const r=await h.worker.readReservation({...h.input,attemptId:"11111111-1111-1111-1111-111111111111"});assert.equal(r.status,"not_observed");check(r);
  h.state.result={status:"reserved",fence:"1"};assert.equal((await h.worker.reserve(h.input)).status,"needs_attention");
});
test("SDK/HTTP/retry/release dependencies cannot be installed on reservation factory",async()=>{
  const h=await setup();for(const field of ["fetchFn","readPage","verifyEntitlement","now","limits"])
    assert.throws(()=>createShopifyOrderWorkReservations({database:h.database,[field]:()=>{}}),/INPUT_INVALID/);
});
