import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {OBSERVABILITY_VERSION,OBSERVABILITY_SQL,readRefreshObservation,createResourceMeter,costMeasurementInputs,
 observeQueueWitness,runIndependentObservation,evaluateRefreshHealth,alarmSignal,recordAlarm,transitionAlarm} from "../app/lib/refresh/observability.server.js";
const generation="11111111-1111-4111-8111-111111111111",scopeRef="22222222-2222-4222-8222-222222222222",other="33333333-3333-4333-8333-333333333333";
const state=()=>({environment:"test",generation,activatedAtMs:1000,sequence:0,checkedAtMs:null,queueRevision:0,lastObserverAtMs:1000});
const receipt=(time=2000)=>({environment:"test",generation,sequence:1,queueRevision:1,checkedAtMs:time});
const signal=(rule="AL01",nowMs=1000)=>alarmSignal({rule,environment:"test",generation,scopeRef,nowMs});
const limits={waitMs:5000,stageMs:{checking_authority:10000,request_intent:15000,response_received:20000,ready_for_dataset:25000},freshnessMs:20000,reconciliationMs:30000};
const observation=()=>({scopeRef,eligible:true,dueAtMs:1000,stage:"checking_authority",stageAtMs:1000,datasetVerifiedAtMs:1000,oldestNonfinalAtMs:null,condition:null});

test("queue silence is strictly over120s, including startup; HTTP or arbitrary objects are not receipts",()=>{
 assert.equal(observeQueueWitness({state:state(),nowMs:121000}).status,"within_window");
 assert.equal(observeQueueWitness({state:state(),nowMs:121001}).status,"critical");
 assert.equal(observeQueueWitness({state:state(),receipt:{status:200},nowMs:121001}).accepted,false);
 const accepted=observeQueueWitness({state:state(),receipt:receipt(),nowMs:2000});
 assert.equal(accepted.accepted,true);assert.equal(accepted.datasetFreshness,"not_proven");assert.equal(accepted.durableWitness,false);
 assert.equal(observeQueueWitness({state:accepted.state,nowMs:122001}).status,"critical");
});
test("duplicate/future/foreign/replayed receipts cannot move the durable reference or reset generation",()=>{
 const accepted=observeQueueWitness({state:state(),receipt:receipt(),nowMs:2000});
 for(const r of [receipt(),receipt(999999),{...receipt(3000),sequence:0},{...receipt(3000),generation:other},{...receipt(3000),environment:"production"},{...receipt(3000),sequence:2,queueRevision:1}]) {
  const next=observeQueueWitness({state:accepted.state,receipt:r,nowMs:122001});assert.equal(next.accepted,false);assert.equal(next.status,"critical");assert.equal(next.state.activatedAtMs,1000);
 }
 assert.throws(()=>observeQueueWitness({state:accepted.state,nowMs:1999}));
 assert.throws(()=>observeQueueWitness({state:{...state(),sequence:1},nowMs:2000}));
});
test("primaryDB outage remains observable from independent store; unknown witness commit is never retried",async()=>{
 let reads=0,commits=0;
 const store={async read(){reads++;return {revision:7,state:state()};},async commit(v){commits++;assert.equal(v.expectedRevision,7);return {committed:true,revision:8};}};
 const result=await runIndependentObservation({store,readReceipt:async()=>{throw Error("secret raw transport error");},nowMs:121001});
 assert.equal(result.durableWitness,true);assert.deepEqual(result.rules,["AL01","AL10"]);assert.equal(reads,1);assert.equal(commits,1);
 const failed=await runIndependentObservation({store:{...store,async commit(){commits++;throw Error("unknown write");}},readReceipt:async()=>receipt(),nowMs:3000});
 assert.deepEqual(failed,{status:"unavailable",rule:"AL15",durableWitness:false});assert.equal(commits,2);
});
test("missing durable independent activation never manufactures a startup grace or reads primary",async()=>{
 let calls=0;const result=await runIndependentObservation({store:{async read(){return null;},async commit(){calls++;}},readReceipt:async()=>{calls++;},nowMs:1000});
 assert.equal(result.rule,"AL15");assert.equal(calls,0);
});
test("one healthy partition cannot hide an omitted eligible partition or staleDataset",()=>{
 let results=evaluateRefreshHealth({nowMs:2000,expected:[scopeRef,other],observations:[observation()],limits});
 assert.deepEqual(results[0].rules,[]);assert.deepEqual(results[1].rules,["AL02"]);
 results=evaluateRefreshHealth({nowMs:40001,expected:[scopeRef],observations:[{...observation(),oldestNonfinalAtMs:1000}],limits});
 assert.deepEqual(results[0].rules,["AL02","AL13"]);assert.equal(results[0].freshness,"stale");assert.equal(results[0].reconciliationAgeMs,39001);
});
test("known stops, validempty and unknown are distinct and never mutate work or capacity",()=>{
 const conditions={provider_error:"AL05",partial_response:"AL07",authority_lost:"AL04",unknown_outcome:"AL06",integrity_mismatch:"AL11",checkpoint_invalid:"AL12",valid_empty:"AL08",budget_wait:"AL08",disconnected:"AL08"};
 for(const [condition,rule] of Object.entries(conditions)) {
  const o={...observation(),condition};const before=JSON.stringify(o);
  const [result]=evaluateRefreshHealth({nowMs:2000,expected:[scopeRef],observations:[o],limits});assert.ok(result.rules.includes(rule));assert.equal(JSON.stringify(o),before);
 }
 const [missing]=evaluateRefreshHealth({nowMs:2000,expected:[scopeRef],observations:[{...observation(),datasetVerifiedAtMs:null}],limits});assert.equal(missing.freshness,"unknown");assert.ok(missing.rules.includes("AL13"));
});
test("explicit measured limits required; duplicate/malformed/foreign partition observations fail closed",()=>{
 for(const args of [{limits:{...limits,stageMs:0}},{observations:[observation(),observation()]},{expected:[scopeRef,scopeRef]},
 {observations:[{...observation(),scopeRef:other}]},{observations:[{...observation(),rawError:"token"}]},{observations:[{...observation(),stageAtMs:5000}]}]) {
  assert.throws(()=>evaluateRefreshHealth({nowMs:2000,expected:[scopeRef],observations:[observation()],limits,...args}));
 }
});
test("all16 accepted alarm classes keep severity/stage and isolate environment/generation/scope",()=>{
 const matrix=JSON.parse(readFileSync(new URL("../contracts/eo-05-refresh-alarm-matrix-v1.json",import.meta.url)));
 for(const rule of matrix.matrix){const s=signal(rule.id);assert.equal(s.severity,rule.severity);assert.equal(s.stage,rule.stage);}
 const s=signal();for(const change of [{environment:"production"},{generation:other},{scopeRef:other}]) assert.notEqual(alarmSignal({...s,nowMs:1000,...change}).fingerprint,s.fingerprint);
 assert.throws(()=>signal("AL17"));
});
test("incident repeats retain first/last/count and expiry without duplicate dispatch or data leakage",()=>{
 const first=recordAlarm(null,signal(),{expiresAtMs:10000});
 let pending=transitionAlarm(first,"dispatch_pending");pending=recordAlarm(pending,signal("AL01",2000),{expiresAtMs:99000});
 assert.equal(pending.state,"dispatch_pending");assert.equal(pending.count,2);assert.equal(pending.firstAtMs,1000);assert.equal(pending.lastAtMs,2000);assert.equal(pending.expiresAtMs,10000);
 assert.throws(()=>recordAlarm(pending,{...signal(),rawPayload:"secret"},{expiresAtMs:10000}));
 assert.throws(()=>transitionAlarm({...pending,rawError:"secret"},"notification_accepted"));
 assert.throws(()=>recordAlarm(pending,signal("AL01",10000),{expiresAtMs:99000}));
});
test("notification acceptance is not delivery/ACK/recovery; resolution needs verified recovery plus authority",()=>{
 let i=recordAlarm(null,signal(),{expiresAtMs:10000});i=transitionAlarm(i,"dispatch_pending");i=transitionAlarm(i,"notification_accepted");assert.equal(i.acknowledged,false);
 i=transitionAlarm(i,"delivery_verified_or_unknown");assert.equal(i.delivery,"unknown");assert.equal(i.acknowledged,false);
 assert.throws(()=>transitionAlarm(i,"human_acknowledged"));i=transitionAlarm(i,"human_acknowledged",{verified:true,authorized:true});
 assert.equal(i.state,"human_acknowledged");assert.throws(()=>transitionAlarm(i,"resolve",{authorized:true}));
 assert.equal(transitionAlarm(i,"resolve",{verified:true,authorized:true}).state,"resolved");
});
test("process counters preserve shared scope, use monotonic time and never turn unknown into success",()=>{
 let time=1n,calls=0;const meter=createResourceMeter({clock:()=>time++,cpu:()=>({user:100+calls++*5,system:10}),memory:()=>({rss:1024})});
 meter.count("databaseQueries");meter.count("bytes",9);const m=meter.finish("unknown");assert.equal(m.outcome,"unknown");assert.equal(m.processCpuUserMicroseconds,5);assert.equal(m.elapsedNanoseconds,"1");
 assert.match(m.processScope,/shared/);assert.equal(m.cloudCost,"unknown");assert.equal(m.poolerConnections,"unknown");assert.throws(()=>meter.finish("verified"));assert.throws(()=>meter.count("bytes"));
 const second=createResourceMeter();assert.throws(()=>second.count("token",1));assert.throws(()=>second.count("bytes",-1));
});
test("cost inputs sum unique hourly/deep records once; budgets, CPU attribution and cloudbill never fabricated",()=>{
 const measurement=createResourceMeter().finish("held");const sample={measurementId:generation,workClass:"today_yesterday_hourly",measurement};
 const result=costMeasurementInputs([sample],1);assert.equal(result.status,"measurement_inputs_only");assert.equal(result.capacityCertified,false);assert.match(result.costPerActiveWorkspace,/unknown/);
 assert.throws(()=>costMeasurementInputs([sample,sample],1));assert.throws(()=>costMeasurementInputs([{...sample,measurement:{...measurement,counters:{bytes:-1}}}],1));
 assert.equal(costMeasurementInputs([],0).totals.bytes,"0");
});
test("SQL observation is one scoped read and failed reads do not retry, recover, log or send",async()=>{
 let calls=0;const input={owner:{},businessDate:"2026-11-10",timeZone:"UTC"};
 const result=await readRefreshObservation({...input,database:{async query(sql){calls++;assert.equal(sql,OBSERVABILITY_SQL);throw Error("secret");}}});
 assert.deepEqual(result,{status:"unavailable",reason:"durable_tracking_unavailable"});assert.equal(calls,1);
 const ok=await readRefreshObservation({...input,database:{async query(){return {rows:[{result:{version:OBSERVABILITY_VERSION,observedAtMs:1000,freshness:{status:"missing"}}}]};}}});assert.equal(ok.status,"observed");assert.equal(ok.snapshot.freshness.status,"missing");
});
