import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {runScheduledRefreshCheck} from "../app/lib/refresh/scheduled-queue-check.server.js";

const generation="44444444-4444-4444-4444-444444444444";
const receipt={status:"checked",generation,sequence:1,queueRevision:2,checkedAtMs:3600000};
test("interrupted review uses only persisted authority, no caller cutoff, forced release or termination boolean",async()=>{
  const calls=[],store=createRefreshWorkRepository({query:async(sql,args)=>{calls.push({sql,args});return {rows:[{result:{status:"reviewed",stopped:0,uncertain:1}}]};}});
  assert.equal((await store.reviewInterruptedWork({now:Infinity,terminated:true,forceRelease:true})).uncertain,1);
  assert.deepEqual(calls,[{sql:"select operations.review_refresh_interrupted_work() as result",args:[]}]);
});
test("preflight cannot omit a deadline or inject a non-integer deadline",async()=>{
  let calls=0;const store=createRefreshWorkRepository({query:async()=>{calls++;return {rows:[{result:true}]};}});
  const args={expectedRevision:1,queueRevision:2,nextState:{},source:{},window:{},partitionId:"one"};
  for(const deadlineAt of [undefined,null,0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1]) await assert.rejects(store.commitPreflight({...args,deadlineAt}),/REFRESH_WORK_INPUT_INVALID/);
  assert.equal(calls,0);assert.equal(await store.commitPreflight({...args,deadlineAt:3600001}),true);assert.equal(calls,1);
});
test("review failure or invalid result blocks dispatch without erasing a successful durable queue check",async()=>{
  for(const review of [undefined,null,{status:"reviewed",stopped:0,uncertain:-1},{status:"unknown"},"throw"]) {
    let reviews=0,plans=0;
    const store={checkScheduledQueue:async()=>receipt,reviewInterruptedWork:async()=>{reviews++;if(review==="throw")throw Error("sensitive");return review;}};
    const r=await runScheduledRefreshCheck({store,generation,work:{buildWorkPlan:()=>{plans++;}}});
    assert.equal(r.status,"queue_checked");assert.equal(r.queue.sequence,1);assert.equal(r.work.reason,"interrupted_work_review_unavailable");
    assert.equal(reviews,1);assert.equal(plans,0);assert.doesNotMatch(JSON.stringify(r),/sensitive/);
  }
});
test("missing review configuration is not permission to dispatch; duplicate ticks never run the detector",async()=>{
  let reviews=0;const store={checkScheduledQueue:async()=>receipt,reviewInterruptedWork:async()=>{reviews++;return {status:"not_configured"};}};
  assert.equal((await runScheduledRefreshCheck({store,generation,work:{}})).work.status,"not_configured");assert.equal(reviews,1);
  store.checkScheduledQueue=async()=>({status:"duplicate"});assert.deepEqual(await runScheduledRefreshCheck({store,generation}),{status:"duplicate"});assert.equal(reviews,1);
});
test("current interruption contract retains every uncertain execution and keeps real recovery and Dataset out of scope",()=>{
  const c=JSON.parse(readFileSync(new URL("../contracts/eo-05a-refresh-interrupted-work-v1.json",import.meta.url),"utf8"));
  for(const key of ["automatic_retry","automatic_resume","automatic_capacity_release","termination_proof_implemented","Dataset_write","live_activation","live_migration_apply"]) assert.equal(c[key],false);
  const sql=readFileSync(new URL(`../${c.migration}`,import.meta.url),"utf8");
  assert.match(sql,/refresh_stop_classification_before_deadline/);assert.match(sql,/'state','uncertain'/);
  assert.match(sql,/REFRESH_DEADLINE_MISSING/);assert.match(sql,/limit cap\+1/);
});
