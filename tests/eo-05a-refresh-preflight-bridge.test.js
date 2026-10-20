import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dispatchRefreshPreflight} from "../app/lib/refresh/preflight-bridge.server.js";
import {planRefreshAdmissions,planRefreshPreflightAdmissions} from "../app/lib/refresh/admission-policy.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";

function fixture() {
  const vector={requests:10,dbWrites:10,connections:10,rows:100,bytes:10000};
  const source={workspaceId:"w",installGeneration:"1",provider:"meta",accountId:"act_1",connectionId:"c",connectionVersion:1,selectionId:"1",queuedAt:0,scheduledHour:0};
  const snapshot={configured:true,queueRevision:2,state:{revision:3,nextFence:1,nextTurn:1,claims:[],lastServed:[]},
    bounds:{maxCandidates:5,maxClaims:5,maxAdmissions:5,maxWorkspaces:5},
    budget:{global:vector,interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},providers:[{provider:"meta",limit:vector}],
      workspaces:[{workspaceId:"w",limit:vector}],accounts:[{provider:"meta",accountId:"act_1",limit:vector}]},candidates:[source]};
  const plan={partitionId:"one-page",workClass:"hourly_hot_window",window:{from:"2026-10-19",to:"2026-10-19"},
    cost:{requests:2,dbWrites:5,connections:1,rows:5,bytes:1000},limits:{deadlineAt:3601000,requestTimeoutMs:100,finishReserveMs:10,maxRows:5,maxBytes:1000}};
  let calls=0,checks=0,commits=0;const stages=[];
  const store={readPreflightSnapshot:async()=>snapshot,commitPreflight:async args=>{commits++;assert.equal(args.expectedRevision,3);assert.equal(args.queueRevision,2);return true;},
    loadBoundAuthority:async()=>({...source,installationVerified:true,connected:true,setupComplete:true,allowedWindow:true}),
    advanceStage:async e=>{stages.push(e.stage);return true;},isClaimCurrent:async()=>true,readAdmissionSnapshot:async()=>snapshot,
    recordStop:async()=>({recorded:true})};
  const args={store,buildWorkPlan:async()=>plan,now:()=>3600000,entitlementVerifier:{verify:async()=>{checks++;return {status:"verified",receipt:{}};},isCurrent:async()=>true},
    readPage:async()=>{calls++;return {kind:"complete",payload:{}};},validatePage:()=>({complete:true,rows:[]})};
  return {args,snapshot,plan,source,stages,calls:()=>calls,checks:()=>checks,commits:()=>commits};
}

test("preflight reserves at most one without pretending a cached subscription is entitled",()=>{
  const f=fixture(),candidate={...f.source,id:"job",cost:f.plan.cost,workClass:"hourly_hot_window",
    authority:{installationVerified:true,connected:true,setupComplete:true,allowedWindow:true,entitled:false}};
  const input={...f.snapshot,candidates:[candidate,{...candidate,id:"other",accountId:"act_2"}],now:3600000};
  assert.equal(planRefreshAdmissions(input).admitted.length,0);
  assert.equal(planRefreshPreflightAdmissions(input).admitted.length,1);
  candidate.authority.connected=false;assert.equal(planRefreshPreflightAdmissions({...input,candidates:[candidate]}).admitted.length,0);
  candidate.authority.connected=true;input.budget.interactiveReserve={...input.budget.global};
  assert.equal(planRefreshPreflightAdmissions(input).admitted.length,0,"interactive reserve is not consumed");
});

test("native reservation precedes mandatory fresh billing and bounded worker; no Dataset completion",async()=>{
  const f=fixture(),r=await dispatchRefreshPreflight(f.args);
  assert.equal(r.status,"awaiting_dataset");assert.equal(f.commits(),1);assert.equal(f.checks(),1);assert.equal(f.calls(),1);
  assert.equal(r.reservationRetained,true);assert.equal(r.claim.id.length,64);
  assert.deepEqual(f.stages,["checking_authority","request_intent","response_received","ready_for_dataset"]);
});

test("missing configuration, missing plan, invalid bounds, conflicts and unknown commits never execute or retry",async()=>{
  const a=fixture();a.snapshot.configured=false;assert.equal((await dispatchRefreshPreflight(a.args)).status,"not_configured");assert.equal(a.commits(),0);
  const b=fixture();b.args.buildWorkPlan=async()=>null;assert.equal((await dispatchRefreshPreflight(b.args)).status,"waiting");assert.equal(b.commits(),0);
  for(const mutate of [p=>p.cost.requests=1,p=>p.limits.maxRows=6,p=>p.window.from="2026-02-30",p=>p.limits.deadlineAt=1]) {
    const f=fixture();mutate(f.plan);assert.equal((await dispatchRefreshPreflight(f.args)).status,"work_plan_required");assert.equal(f.commits(),0);assert.equal(f.calls(),0);
  }
  for(const thrown of [false,true]) {
    const f=fixture();let attempts=0;f.args.store.commitPreflight=async()=>{attempts++;if(thrown) throw Error("secret");return false;};
    const r=await dispatchRefreshPreflight(f.args);assert.equal(r.status,thrown?"needs_attention":"conflict");
    assert.equal(attempts,1);assert.equal(f.checks(),0);assert.equal(f.calls(),0);assert.ok(!JSON.stringify(r).includes("secret"));
  }
});

test("denied fresh billing or changed source stops before ad data; errors never automatically repeat",async()=>{
  const f=fixture();f.args.entitlementVerifier.verify=async()=>({status:"denied"});
  assert.equal((await dispatchRefreshPreflight(f.args)).reason,"entitlement_required");assert.equal(f.calls(),0);
  const g=fixture();g.args.store.loadBoundAuthority=async()=>null;
  assert.equal((await dispatchRefreshPreflight(g.args)).reason,"authority_required");assert.equal(g.checks(),0);assert.equal(g.calls(),0);
  const h=fixture();h.args.entitlementVerifier.verify=async()=>({status:"unavailable",externalOutcome:"unknown"});
  assert.equal((await dispatchRefreshPreflight(h.args)).status,"uncertain");assert.equal(h.calls(),0);
});

test("database bridge uses parameterized narrow functions; generic native bypass remains denied by SQL",async()=>{
  const queries=[],store=createRefreshWorkRepository({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{result:true}]};}});
  const f=fixture();await store.readPreflightSnapshot();await store.commitPreflight({expectedRevision:1,queueRevision:2,nextState:{},source:{},window:{},partitionId:"p"});
  await store.loadBoundAuthority({claim:{workspaceId:"w",installGeneration:"1",provider:"meta",accountId:"a",id:"i",fence:1},window:f.plan.window});
  assert.equal(queries[0].sql,"select operations.read_refresh_preflight_snapshot() as result");assert.equal(queries[1].args[0],1);assert.equal(queries[1].args[1],2);
  assert.equal(queries[2].args.length,8);
  const c=JSON.parse(readFileSync(new URL("../contracts/eo-05a-refresh-preflight-bridge-v1.json",import.meta.url),"utf8"));
  assert.equal(c.live_activation,false);assert.equal(c.Dataset_write,false);assert.equal(c.native_provider_calls,false);
});
