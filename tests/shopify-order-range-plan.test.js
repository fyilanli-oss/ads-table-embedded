import test,{after} from "node:test";
import assert from "node:assert/strict";
import {createShopifyOrderRangePlanner as planner,reviewShopifyOrderRangeInterruption as review} from "../app/lib/refresh/shopify-order-range-plan.server.js";
import {shopifyOrderReadFamily} from "../app/lib/shopify/order-read-protocol.server.js";
import {fixture,prewriteOwner,restoreShopifyOrderFixtureFetch} from "./helpers/shopify-order-fixture.js";
after(restoreShopifyOrderFixtureFetch);
const hour=3600000,day=24*hour;
const policy=()=>({anchorAt:"2026-10-01T00:00:00Z",cadenceMs:hour,sliceMs:day,settleDelayMs:0,maxRanges:10,pageSize:1,includeOrderHistory:false});
const now=()=>new Date("2026-10-02T00:00:00Z");
function setup(extra={}){
  const f=fixture(),p=policy();return {f,p,create:(overrides={})=>planner({expected:prewriteOwner(),database:f.config.database,policy:p,now,...extra,...overrides})};
}
test("independent ranges use two SQL owner reads, no provider or queue identity, and existing native filter",async()=>{
  const h=setup(),plan=await h.create().plan({fromInclusive:"2026-10-01T00:00:00Z"});
  assert.equal(h.f.q.ownerReads,2);assert.equal(h.f.calls.length,0);assert.equal(plan.source,"shopify_orders");
  assert.equal(plan.status,"proposed");assert.equal(plan.owner.installationId,"42");assert.equal(plan.ranges.length,1);
  assert.equal(plan.ranges[0].headerRequest.variables.after,null);
  assert.equal(plan.ranges[0].headerRequest.variables.query,"updated_at:>='2026-10-01T00:00:00.000Z' updated_at:<'2026-10-02T00:00:00.000Z'");
  const {query,variables}=plan.ranges[0].headerRequest;
  assert.equal(shopifyOrderReadFamily(JSON.stringify({query,variables})),"order_headers");
  for(const k of ["checkpointAdvanced","queueAdmitted","authorizesDispatch","persistable","DatasetWritePerformed","nativePermissionVerified","historicalCoverageVerified"])assert.equal(plan[k],false);
  assert.ok(Object.isFrozen(plan.ranges[0].range));assert.doesNotMatch(JSON.stringify(plan),/act_|connectionId|fence|providerAccount/);
});
test("cadence and settle delay close only the explicit safe upper bound",async()=>{
  const h=setup();h.p.settleDelayMs=15*60000;h.p.sliceMs=hour;
  const r=await h.create({now:()=>new Date("2026-10-01T03:44:00Z")}).plan({fromInclusive:"2026-10-01T00:00:00Z"});
  assert.equal(r.scheduledAt,"2026-10-01T03:00:00.000Z");assert.equal(r.closedBefore,"2026-10-01T02:45:00.000Z");
  assert.equal(r.ranges.length,3);assert.equal(r.ranges[2].range.toExclusive,r.closedBefore);
  assert.equal(r.nextCheckAt,"2026-10-01T04:00:00.000Z");
  for(let i=1;i<r.ranges.length;i++)assert.equal(r.ranges[i].range.fromInclusive,r.ranges[i-1].range.toExclusive);
});
test("range cap preserves the exact unplanned remainder without advancing a checkpoint",async()=>{
  const h=setup();h.p.maxRanges=2;h.p.sliceMs=hour;
  const r=await h.create().plan({fromInclusive:"2026-10-01T00:00:00Z"});
  assert.equal(r.ranges.length,2);assert.deepEqual(r.remainingRange,{fromInclusive:"2026-10-01T02:00:00.000Z",toExclusive:"2026-10-02T00:00:00.000Z"});
  assert.equal(r.checkpointAdvanced,false);
});
test("equivalent UTC instants yield deterministic work keys and explicit history remains a separate policy",async()=>{
  const h=setup(),p=h.create();const a=await p.plan({fromInclusive:"2026-10-01T00:00:00Z"}),b=await p.plan({fromInclusive:"2026-10-01T00:00:00.000Z"});
  assert.equal(a.ranges[0].key,b.ranges[0].key);h.p.includeOrderHistory=true;
  const c=await h.create().plan({fromInclusive:"2026-10-01T00:00:00Z"});assert.notEqual(c.ranges[0].key,a.ranges[0].key);
  assert.equal(c.historicalCoverageVerified,false);
});
test("before anchor or already beyond cutoff means not due, never zero sales or completed sync",async()=>{
  for(const fromInclusive of ["2026-10-02T00:00:00Z","2026-10-03T00:00:00Z"]){
    const h=setup(),r=await h.create().plan({fromInclusive});assert.equal(r.status,"not_due");assert.deepEqual(r.ranges,[]);assert.equal(r.checkpointAdvanced,false);
  }
  const h=setup(),r=await h.create({now:()=>new Date("2026-09-30T23:59:00Z")}).plan({fromInclusive:"2026-09-30T00:00:00Z"});
  assert.equal(r.closedBefore,null);assert.equal(r.nextCheckAt,"2026-10-01T00:00:00.000Z");assert.equal(r.status,"not_due");
});
for(const change of [{cadenceMs:0},{sliceMs:1.5},{maxRanges:1001},{pageSize:101},{settleDelayMs:-1},{includeOrderHistory:1},{window:{}}])
  test(`missing/invalid scheduling policy is not invented ${Object.keys(change)[0]}`,()=>{
    const h=setup();Object.assign(h.p,change);assert.throws(h.create,/POLICY_REQUIRED/);assert.equal(h.f.calls.length,0);
  });
for(const value of [undefined,"2026-10-01","2026-02-30T00:00:00Z","2026-10-01T00:00:00+03:00","2026-10-01T25:00:00Z"])
  test(`invalid lower bound rejected without IO ${value}`,async()=>{
    const h=setup();await assert.rejects(h.create().plan({fromInclusive:value}),/TIME_INVALID/);assert.equal(h.f.q.ownerReads??0,0);
  });
for(const key of ["provider","accountId","window","cursor","checkpoint","attempts"])
  test(`caller cannot inject provider progress or native continuation ${key}`,async()=>{
    const h=setup();await assert.rejects(h.create().plan({fromInclusive:"2026-10-01T00:00:00Z",[key]:"invented"}),/INPUT_INVALID/);
  });
test("policy and owner are captured before awaits, including lossless bigint identity",async()=>{
  const h=setup();h.f.q.installationId="9007199254740993";const expected={...prewriteOwner(),installationId:h.f.q.installationId},p=h.create({expected});
  h.p.sliceMs=1;expected.installationId="99";const r=await p.plan({fromInclusive:"2026-10-01T00:00:00Z"});
  assert.equal(r.owner.installationId,"9007199254740993");assert.equal(r.ranges.length,1);
});
test("owner drift, SQL failure, cancellation and clock regression prevent a proposal without retry",async()=>{
  const h=setup();h.f.q.ownerLoading=()=>{if(h.f.q.ownerReads===2)h.f.q.installationId="99";};
  await assert.rejects(h.create().plan({fromInclusive:"2026-10-01T00:00:00Z"}),/OWNER_CHANGED/);
  const bad=setup();bad.f.q.ownerError=true;await assert.rejects(bad.create().plan({fromInclusive:"2026-10-01T00:00:00Z"}),/^ShopifyOrderRangePlanError: SHOPIFY_ORDER_RANGE_PLAN_OWNER_READ_FAILED$/);assert.equal(bad.f.q.ownerReads,1);
  const c=new AbortController();c.abort();const stopped=setup({signal:c.signal});await assert.rejects(stopped.create().plan({fromInclusive:"2026-10-01T00:00:00Z"}),/ABORTED/);assert.equal(stopped.f.q.ownerReads??0,0);
  let calls=0;const backward=setup({now:()=>new Date(calls++?"2026-10-01T23:00:00Z":"2026-10-02T00:00:00Z")});
  await assert.rejects(backward.create().plan({fromInclusive:"2026-10-01T00:00:00Z"}),/CLOCK_REGRESSED/);
});
test("completed real collection still cannot advance or manufacture a durable checkpoint",async()=>{
  const h=setup(),plan=await h.create().plan({fromInclusive:"2026-10-01T00:00:00Z"}),current=await h.f.create().readEvidence();
  const r=review({plan,rangeKey:plan.ranges[0].key,current});assert.equal(r.status,"collected_not_durably_committed");assert.equal(r.resumeAuthorized,false);
  assert.equal(r.reloadFirstPageAuthorized,false);assert.equal(r.checkpointAdvanced,false);
  assert.throws(()=>review({plan:{...plan},rangeKey:plan.ranges[0].key,current}),/PROVENANCE_REQUIRED/);
  assert.throws(()=>review({plan,rangeKey:plan.ranges[0].key,current:structuredClone(current)}),/COLLECTION_REQUIRED/);
});
for(const waitAt of [1,2,4])test(`genuine quota wait cannot authorize prefix replay at boundary ${waitAt}`,async()=>{
  const h=setup(),plan=await h.create().plan({fromInclusive:"2026-10-01T00:00:00Z"});h.f.q.waitAt=waitAt;let error;
  try{await h.f.create().readEvidence();}catch(e){error=e;}assert.ok(error);
  const r=review({plan,rangeKey:plan.ranges[0].key,error});assert.equal(r.status,waitAt===1?"waiting_before_first_attempt":"partial_read_not_durable");
  assert.equal(r.resumeAuthorized,false);assert.equal(r.reloadFirstPageAuthorized,false);assert.equal(r.checkpointAdvanced,false);
});
test("unknown/forged error details, wrong range and invented stored checkpoint cannot authorize continuation",async()=>{
  const h=setup(),plan=await h.create().plan({fromInclusive:"2026-10-01T00:00:00Z"}),rangeKey=plan.ranges[0].key;
  const r=review({plan,rangeKey,error:{priorBoundaryAttempts:0,status:"waiting"}});assert.equal(r.status,"outcome_not_established");
  assert.throws(()=>review({plan,rangeKey,error:Error(),checkpoint:{persisted:true}}),/PROVENANCE_REQUIRED/);
  assert.throws(()=>review({plan,rangeKey:"not-planned",error:Error()}),/PROVENANCE_REQUIRED/);
  const current=await h.f.create().readEvidence(),p=h.create();
  const different=await p.plan({fromInclusive:"2026-10-01T01:00:00Z"});
  assert.throws(()=>review({plan:different,rangeKey:different.ranges[0].key,current}),/OWNER_OR_RANGE_MISMATCH/);
});
