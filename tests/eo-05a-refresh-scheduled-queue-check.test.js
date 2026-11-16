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
  const store={reviewInterruptedWork:async()=>({status:"reviewed",stopped:0,uncertain:0}),checkScheduledQueue:async args=>{assert.deepEqual(args,{generation});return receipt;},readPreflightSnapshot:async()=>{reads++;}};
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
  const store={reviewInterruptedWork:async()=>({status:"reviewed",stopped:0,uncertain:0}),checkScheduledQueue:async()=>{checks++;return receipt;},readPreflightSnapshot:async()=>snapshot,
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

test("one confirmed tick drains ready work until time, queue revision or eligible jobs run out",async()=>{
  for (const stop of ["waiting","conflict","tick_budget_elapsed","new_holds","no_entitlement_time"]) {
    const tick=Date.parse("2026-11-16T22:00:00.000Z");
    const vector={requests:100,dbWrites:100,connections:100,rows:100,bytes:10000};
    const candidates=Array.from({length:12},(_,i)=>({workspaceId:"w",installGeneration:"1",provider:"klaviyo",
      accountId:`account-${i}`,connectionId:`connection-${i}`,connectionVersion:1,selectionId:null,
      timezone:"UTC",scheduledHour:tick-3_600_000,queuedAt:tick-3_600_000+i}));
    const snapshot={configured:true,queueRevision:receipt.queueRevision,state:{revision:3,nextFence:1,nextTurn:1,claims:[],lastServed:[]},
      bounds:{maxCandidates:12,maxClaims:12,maxAdmissions:1,maxWorkspaces:12},
      budget:{global:vector,interactiveReserve:{requests:0,dbWrites:0,connections:0,rows:0,bytes:0},
        providers:[{provider:"klaviyo",limit:vector}],workspaces:[{workspaceId:"w",limit:vector}],
        accounts:candidates.map(({accountId})=>({provider:"klaviyo",accountId,limit:vector}))},candidates};
    let now=tick+1_000, checks=0, read=0, bound, candidateReads=0, admissionReads=0;
    const admitted=[];
    const store={
      checkScheduledQueue:async()=>{checks++;return {...receipt,checkedAtMs:tick};},
      reviewInterruptedWork:async()=>({status:"reviewed",stopped:0,uncertain:0}),
      readPreflightSnapshot:async()=>{candidateReads++;return snapshot;},
      commitPreflight:async({source,deadlineAt,queueRevision,expectedRevision})=>{
        assert.equal(expectedRevision,snapshot.state.revision);
        if (queueRevision!==snapshot.queueRevision) return false;
        admitted.push(source.accountId);
        bound=source;
        assert.equal(deadlineAt,tick+60_000);
        return true;
      },
      loadBoundAuthority:async()=>({...bound,installationVerified:true,connected:true,setupComplete:true,allowedWindow:true}),
      advanceStage:async()=>true,isClaimCurrent:async()=>true,
      readAdmissionSnapshot:async()=>{admissionReads++;return {state:snapshot.state,bounds:snapshot.bounds,budget:snapshot.budget};},
      recordStop:async()=>({recorded:true}),
    };
    const result=await runScheduledRefreshCheck({store,generation,work:{
      drainReadyWork:true,now:()=>now,
      buildWorkPlan:async()=>({workClass:"hourly_hot_window",cost:{requests:2,dbWrites:5,connections:1,rows:5,bytes:1000},
        limits:{deadlineAt:tick+120_000,requestTimeoutMs:100,finishReserveMs:10,maxRows:5,maxBytes:1000}}),
      entitlementVerifier:{requestTimeoutMs:200,verify:async()=>({status:"verified",receipt:{}}),isCurrent:async()=>true},
      readPage:async()=>{read++;return {kind:"complete",payload:{}};},
      validatePage:()=>({complete:true,rows:[]}),
      loadCompletedKlaviyoHourlyJobs:async()=>[],
      finishKlaviyoHourlyReport:async()=>{
        snapshot.state.revision++;
        if (stop==="conflict") snapshot.queueRevision++;
        if (stop==="tick_budget_elapsed") now=tick+60_000;
        // The provider and finish still fit, but the entitlement check does not.
        if (stop==="no_entitlement_time") now=tick+59_800;
        if (stop==="new_holds") snapshot.state.holds=candidates.map(({workspaceId,installGeneration,provider,accountId})=>
          ({workspaceId,installGeneration,provider,accountId}));
        return true;
      },
    }});
    const expected=stop==="waiting"?12:1;
    assert.equal(result.completedThisTick,expected,JSON.stringify(result.work));
    assert.equal(result.work.status,["new_holds","no_entitlement_time"].includes(stop)?"waiting":stop);
    assert.equal(checks,1);
    assert.equal(candidateReads,1);
    assert.equal(admissionReads,stop==="waiting"?12:stop==="tick_budget_elapsed"?0:1);
    assert.equal(read,expected);
    assert.equal(new Set(admitted).size,expected);
  }
});

test("database boundary accepts only generation, no injected clock, inventory or tick number",async()=>{
  const queries=[],store=createRefreshWorkRepository({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{result:receipt}]};}});
  await store.checkScheduledQueue({generation,now:999,inventory:{},sequence:50});
  assert.deepEqual(queries,[{sql:"select operations.check_refresh_queue_on_tick($1::uuid) as result",args:[generation]}]);
  await assert.rejects(store.checkScheduledQueue({generation:"injected'"}),/REFRESH_WORK_INPUT_INVALID/);
  await assert.rejects(runScheduledRefreshCheck({store,generation:"bad"}),/REFRESH_TICK_INPUT_INVALID/);
  assert.equal(queries.length,1);
});

test("daily reconciliation uses the confirmed tick and rejects a mismatched date before admission", async () => {
  const checkedAtMs = Date.parse("2026-11-16T22:00:00.000Z");
  let admissions = 0;
  const store = {
    checkScheduledQueue: async () => ({...receipt, checkedAtMs}),
    reviewInterruptedWork: async () => ({status:"reviewed", stopped:0, uncertain:0}),
    readPreflightSnapshot: async () => ({configured:true, candidates:[{accountId:"account", timezone:"Europe/Istanbul"}]}),
    commitPreflight: async () => { admissions++; return false; },
    loadBoundAuthority: async () => { throw Error("unexpected authority read"); },
  };
  let planned = 0;
  const work = {
    loadDailyReportSchedule: async source => {
      assert.equal(source.accountId, "account");
      return {timeZone:"Europe/Istanbul", dailyWindows:{
        yesterday:{start:"2026-11-16T21:00:00.000Z", end:"2026-11-16T23:00:00.000Z"},
        today:{start:"2026-11-16T23:00:00.000Z", end:"2026-11-17T00:00:00.000Z"},
      }};
    },
    buildWorkPlan: async (source, job) => {
      planned++;
      assert.equal(source.accountId, "account");
      assert.equal(job.kind, "yesterday");
      assert.equal(job.businessDate, "2026-11-16");
      return {workClass:"deep_reconciliation", window:{from:"2026-11-17", to:"2026-11-17"}};
    },
    entitlementVerifier:{verify:async () => {}, isCurrent:async () => {}},
    readPage:async () => { throw Error("unexpected provider read"); },
    validatePage:() => {},
    loadDatasetInputs:async () => { throw Error("unexpected Dataset write"); },
    now:() => Date.parse("2026-11-17T02:00:00.000Z"),
  };
  const result = await runScheduledRefreshCheck({store, generation, work});
  assert.equal(planned, 1);
  assert.equal(admissions, 0);
  assert.equal(result.work.status, "needs_attention");
  assert.equal(result.work.reason, "preflight_unavailable");
});

test("contract keeps cron activation, alarms, Dataset and hourly policy outside this connection",()=>{
  const c=JSON.parse(readFileSync(new URL("../contracts/eo-05a-refresh-scheduled-queue-check-v1.json",import.meta.url),"utf8"));
  for(const key of ["live_activation","live_migration_apply","native_provider_calls","Dataset_write","automatic_retry","independent_alarm_active","production_work_policy_selected"]) assert.equal(c[key],false);
  const sql=readFileSync(new URL(`../${c.migration}`,import.meta.url),"utf8");
  assert.match(sql,/force row level security/);assert.match(sql,/set search_path = ''/);
  assert.match(sql,/check_refresh_queue_from_authority\(q.revision\)/);
});
