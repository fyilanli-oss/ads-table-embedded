import assert from "node:assert/strict";
import test from "node:test";
import {createShopifyOrderReconciliation} from "../app/lib/refresh/shopify-order-reconciliation.server.js";

const attemptId="11111111-1111-4111-8111-111111111111";
function fixture(){
  const s={reads:0,writes:0,row:{attemptId,rangeKey:"a".repeat(64),fence:7,
    owner:{installationId:"42",workspaceId:attemptId,installGeneration:3,shopId:"gid://shopify/Shop/12",shopDomain:"test.myshopify.com"},
    reservationStatus:"reserved",phase:"pre_request",entitlementRequests:0,adminRequests:0,countsAreDispatchMarkers:true,entitlementReceiptRecorded:false,orderObservationRecorded:false,
    classification:"no_provider_dispatch",reconciliationVersion:0,reconciliationState:"unreviewed",reconciliationActionId:null,reconciledAt:null,priorPhase:null,snapshotHash:"b".repeat(64)}};
  const database={async query(sql,args){
    if(sql.includes("read_shopify_order_reconciliation")){
      s.reads++;assert.deepEqual(args,[attemptId]);if(s.readError)throw Error("SECRET SQL DETAIL");return {rows:[{result:s.missing?null:structuredClone(s.row)}]};
    }
    assert.match(sql,/reconcile_shopify_order_work/);s.writes++;s.args=args;
    if(s.stale)return {rows:[{result:{status:"stale_observation"}}]};
    if(s.row.phase==="reconciled")return {rows:[{result:{status:"already_recorded",review:structuredClone(s.row)}}]};
    if(s.row.reservationStatus==="released")return {rows:[{result:{status:"already_released",review:structuredClone(s.row)}}]};
    s.row={...s.row,phase:"reconciled",priorPhase:s.row.phase,reservationStatus:s.hold?"reserved":"released",
      reconciliationState:s.hold?"held_unknown":"released_before_provider",reconciliationVersion:1,
      reconciliationActionId:args[3],reconciledAt:"2026-10-29T10:00:00Z",snapshotHash:"c".repeat(64)};
    if(s.writeError)throw Error("SECRET LOST ACK");
    return {rows:[{result:{status:"recorded",review:structuredClone(s.row)}}]};
  }};
  return {s,database,create:()=>createShopifyOrderReconciliation({database})};
}

test("explicit read does not mutate, and genuine one-shot reconciliation sends exact SQL fence/hash and generated action",async()=>{
  const f=fixture(),r=f.create(),i=await r.inspect({attemptId});assert.equal(i.status,"observed");assert.equal(f.s.writes,0);
  const result=await r.reconcile({inspection:i});assert.equal(result.status,"recorded");assert.equal(result.changed,true);
  assert.equal(result.workerFenced,true);assert.equal(result.reservationRetained,false);assert.equal(f.s.reads,1);assert.equal(f.s.writes,1);
  assert.deepEqual(f.s.args.slice(0,3),[attemptId,7,"b".repeat(64)]);assert.match(result.actionId,/^[a-f0-9-]{36}$/);
  for(const k of ["authorizesDispatch","authorizesActivation","checkpointAdvanced","persistable","DatasetWritePerformed","resumeAuthorized","reloadFirstPageAuthorized","absenceProvesRollback"])assert.equal(result[k],false);
});
test("legacy unknown dispatch remains null and held, never normalized to zero",async()=>{
  const f=fixture();f.s.hold=true;f.s.row.phase="stopped";f.s.row.entitlementRequests=null;f.s.row.classification="unknown_legacy_dispatch";
  const r=f.create(),i=await r.inspect({attemptId});assert.equal(i.review.entitlementRequests,null);
  const result=await r.reconcile({inspection:i});assert.equal(result.reservationRetained,true);assert.equal(result.review.reconciliationState,"held_unknown");
});
test("an already released reservation is not falsely reported as a newly recorded reconciliation audit",async()=>{
  const f=fixture();f.s.row.reservationStatus="released";f.s.row.classification="already_released";
  const r=f.create(),i=await r.inspect({attemptId}),result=await r.reconcile({inspection:i});
  assert.equal(result.status,"already_released");assert.equal(result.recorded,false);assert.equal(result.changed,false);
  assert.equal(result.actionId,null);assert.equal(result.review.reconciliationVersion,0);assert.equal(result.reservationRetained,false);
});
test("unknown write reply consumes capability and requires a separate explicit read, without automatic retry",async()=>{
  const f=fixture(),r=f.create(),i=await r.inspect({attemptId});f.s.writeError=true;
  const result=await r.reconcile({inspection:i});assert.equal(result.reason,"reconciliation_write_unconfirmed");assert.equal(result.reservationMayBeHeld,true);
  assert.equal(f.s.reads,1);assert.equal(f.s.writes,1);assert.doesNotMatch(JSON.stringify(result),/SECRET/);
  await assert.rejects(r.reconcile({inspection:i}),/INPUT_INVALID/);assert.equal(f.s.writes,1);
  const observed=await r.inspect({attemptId});assert.equal(observed.review.reservationStatus,"released");assert.equal(f.s.writes,1);
  f.s.writeError=false;const again=await r.reconcile({inspection:observed});assert.equal(again.status,"already_recorded");assert.equal(again.changed,false);
  assert.equal(again.actionId,result.actionId);assert.notEqual(again.attemptedActionId,again.actionId);
});
test("stale observation cannot change reservation or trigger an automatic fresh read",async()=>{
  const f=fixture(),r=f.create(),i=await r.inspect({attemptId});f.s.stale=true;
  const result=await r.reconcile({inspection:i});assert.equal(result.status,"stale_observation");assert.equal(result.recorded,false);
  assert.equal(f.s.row.phase,"pre_request");assert.equal(f.s.reads,1);assert.equal(f.s.writes,1);
});
test("absent row and failed read are not proof of rollback, do not authorize release, and perform no follow-up",async()=>{
  for(const mode of ["missing","readError"]){
    const f=fixture();f.s[mode]=true;const r=f.create(),i=await r.inspect({attemptId});
    assert.equal(i.absenceProvesRollback,false);assert.equal(i.reservationMayBeHeld,true);assert.equal(f.s.reads,1);assert.equal(f.s.writes,0);
    await assert.rejects(r.reconcile({inspection:i}),/INPUT_INVALID/);
  }
});
test("serialized, foreign and forged inspections cannot mint mutation authority",async()=>{
  const f=fixture(),a=f.create(),b=f.create(),i=await a.inspect({attemptId});
  for(const inspection of [{...i},JSON.parse(JSON.stringify(i)),i.review,{review:i.review,recorded:true}])await assert.rejects(a.reconcile({inspection}),/INPUT_INVALID/);
  await assert.rejects(b.reconcile({inspection:i}),/INPUT_INVALID/);assert.equal(f.s.writes,0);
});
test("concurrent use of the same genuine inspection sends at most one mutation",async()=>{
  const f=fixture(),r=f.create(),i=await r.inspect({attemptId});
  const result=await Promise.allSettled([r.reconcile({inspection:i}),r.reconcile({inspection:i})]);
  assert.equal(result.filter(x=>x.status==="fulfilled").length,1);assert.equal(f.s.writes,1);
});
test("caller termination, force release, timestamp and provider callbacks are never accepted",async()=>{
  const f=fixture();for(const key of ["fetchFn","now","terminateWorker","forceRelease","provider","timeoutMs"])
    assert.throws(()=>createShopifyOrderReconciliation({database:f.database,[key]:()=>{}}),/INPUT_INVALID/);
  const r=f.create();for(const key of ["owner","fence","phase","executionTerminated","force","snapshotHash"])
    await assert.rejects(r.inspect({attemptId,[key]:true}),/INPUT_INVALID/);
  const i=await r.inspect({attemptId});for(const key of ["decision","executionTerminated","forceRelease","fence","nativeRequests"])
    await assert.rejects(r.reconcile({inspection:i,[key]:true}),/INPUT_INVALID/);
  assert.equal(f.s.writes,0);
});
test("malformed SQL observation cannot become a genuine inspection",async()=>{
  for(const change of [{fence:0},{snapshotHash:"bad"},{entitlementRequests:2},{adminRequests:-1},{classification:"safe_to_force"},{owner:{installationId:42}}]){
    const f=fixture();Object.assign(f.s.row,change);const r=f.create(),i=await r.inspect({attemptId});assert.equal(i.status,"needs_attention");
    await assert.rejects(r.reconcile({inspection:i}),/INPUT_INVALID/);assert.equal(f.s.writes,0);
  }
});
