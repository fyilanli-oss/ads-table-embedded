import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runScheduledRefreshCheck} from "../app/lib/refresh/scheduled-queue-check.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";

const generation="44444444-4444-4444-4444-444444444444";
const receipt={status:"checked",generation,sequence:1,queueRevision:2,checkedAtMs:3600000};

test("scheduled check needs a durable current receipt; inactive, duplicate and bad clock never dispatch",async()=>{
  let reads=0;
  for(const status of ["not_configured","duplicate","not_current_generation","clock_invalid"]) {
    const store={checkScheduledQueue:async()=>({status,secret:"not for output"}),readPreflightSnapshot:async()=>{reads++;}};
    assert.deepEqual(await runScheduledRefreshCheck({store,generation,work:{}}),{status});
  }
  assert.equal(reads,0);
});

test("lost commit response or malformed receipt cannot report a check or retry",async()=>{
  for(const value of [null,{}, {...receipt,generation:"old"},{...receipt,sequence:0},{...receipt,queueRevision:Infinity},{...receipt,checkedAtMs:-1},"throw"]) {
    let calls=0;
    const store={checkScheduledQueue:async()=>{calls++;if(value==="throw")throw Error("secret");return value;}};
    assert.deepEqual(await runScheduledRefreshCheck({store,generation}),{status:"needs_attention",reason:"queue_check_unavailable"});
    assert.equal(calls,1);
  }
});

test("a healthy queue check without the approved data policy does no work and is not a successful refresh",async()=>{
  let reads=0;
  const store={checkScheduledQueue:async args=>{assert.deepEqual(args,{generation});return receipt;},readPreflightSnapshot:async()=>{reads++;}};
  const result=await runScheduledRefreshCheck({store,generation});
  assert.equal(result.status,"queue_checked");assert.deepEqual(result.work,{status:"work_policy_required"});assert.equal(reads,0);
  assert.equal(Object.hasOwn(result,"refreshSuccess"),false);
  const invalid=await runScheduledRefreshCheck({store,generation,work:{}});
  assert.equal(invalid.queue.sequence,1);assert.equal(invalid.work.reason,"work_policy_invalid");
});

test("an explicitly supplied internal plan uses the existing fenced preflight once and mandatory fresh billing",async()=>{
  const vector={requests:10,dbWrites:10,connections:10,rows:100,bytes:10000};
  const source={workspaceId:"w",installGeneration:"1",provider:"meta",accountId:"act_1",connectionId:"c",connectionVersion:1,selectionId:"1",queuedAt:0,scheduledHour:0};
  const snapshot={configured:true,queueRevision:2,state:{revision:3,nextFence:1,nextTurn:1,claims:[],lastServed:[]},
    bounds:{maxCandidates:5,maxClaims:5,maxAdmissions:5,maxWorkspaces:5},
    budget:{global:vector,interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},providers:[{provider:"meta",limit:vector}],
      workspaces:[{workspaceId:"w",limit:vector}],accounts:[{provider:"meta",accountId:"act_1",limit:vector}]},candidates:[source]};
  let checks=0,commits=0,billing=0,pages=0;
  const store={checkScheduledQueue:async()=>{checks++;return receipt;},readPreflightSnapshot:async()=>snapshot,
    commitPreflight:async()=>{commits++;return true;},loadBoundAuthority:async()=>({...source,installationVerified:true,connected:true,setupComplete:true,allowedWindow:true}),
    advanceStage:async()=>true,isClaimCurrent:async()=>true,readAdmissionSnapshot:async()=>snapshot,recordStop:async()=>({recorded:true})};
  const work={buildWorkPlan:async()=>({partitionId:"explicit-one-page",workClass:"hourly_hot_window",window:{from:"2026-10-19",to:"2026-10-19"},
    cost:{requests:2,dbWrites:5,connections:1,rows:5,bytes:1000},limits:{deadlineAt:3601000,requestTimeoutMs:100,finishReserveMs:10,maxRows:5,maxBytes:1000}}),
    entitlementVerifier:{verify:async()=>{billing++;return {status:"verified",receipt:{}};},isCurrent:async()=>true},
    readPage:async()=>{pages++;return {kind:"complete",payload:{}};},validatePage:()=>({complete:true,rows:[]}),now:()=>3600000,
    store:{readPreflightSnapshot:()=>{throw Error("store must not be replaced");}}};
  const r=await runScheduledRefreshCheck({store,generation,work});
  assert.equal(r.status,"queue_checked");assert.equal(r.work.status,"awaiting_dataset");assert.equal(r.work.reservationRetained,true);
  assert.deepEqual([checks,commits,billing,pages],[1,1,1,1]);
  store.commitPreflight=async()=>false;
  const conflict=await runScheduledRefreshCheck({store,generation,work});
  assert.equal(conflict.work.status,"conflict");assert.equal(pages,1);assert.equal(billing,1);
});

test("database boundary accepts only generation, no injected clock, inventory or tick number",async()=>{
  const queries=[],store=createRefreshWorkRepository({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{result:receipt}]};}});
  await store.checkScheduledQueue({generation,now:999,inventory:{},sequence:50});
  assert.deepEqual(queries,[{sql:"select operations.check_refresh_queue_on_tick($1::uuid) as result",args:[generation]}]);
  await assert.rejects(store.checkScheduledQueue({generation:"injected'"}),/REFRESH_WORK_INPUT_INVALID/);
  await assert.rejects(runScheduledRefreshCheck({store,generation:"bad"}),/REFRESH_TICK_INPUT_INVALID/);
  assert.equal(queries.length,1);
});

test("contract keeps cron activation, alarms, Dataset and hourly policy outside this connection",()=>{
  const c=JSON.parse(readFileSync(new URL("../contracts/eo-05a-refresh-scheduled-queue-check-v1.json",import.meta.url),"utf8"));
  for(const key of ["live_activation","live_migration_apply","native_provider_calls","Dataset_write","automatic_retry","independent_alarm_active","production_work_policy_selected"]) assert.equal(c[key],false);
  const sql=readFileSync(new URL(`../${c.migration}`,import.meta.url),"utf8");
  assert.match(sql,/force row level security/);assert.match(sql,/set search_path = ''/);
  assert.match(sql,/check_refresh_queue_from_authority\(q.revision\)/);
});
