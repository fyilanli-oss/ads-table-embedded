import assert from "node:assert/strict";

// Nested in the existing real native-preflight synthetic transaction; no live access or provider calls.
export async function refreshInterruptedWorkProbe(client,{store,claim,window}) {
  const binding=(await client.query("select deadline_at_ms from operations.refresh_work_bindings where fence=$1",[claim.fence])).rows[0];
  assert.ok(Number(binding.deadline_at_ms)>Date.now());
  assert.equal((await store.reviewInterruptedWork()).status,"reviewed");
  assert.equal(await store.isClaimCurrent({claim}),true,"a healthy unexpired worker is not stopped");
  for(const stage of [null,"checking_authority","request_intent","response_received","ready_for_dataset"]) {
    await client.query("savepoint interruption_case");
    try {
      if(stage===null) await client.query("delete from operations.refresh_work_progress where fence=$1",[claim.fence]);
      else await client.query("update operations.refresh_work_progress set stage=$2,rows_observed=0,bytes_observed=0 where fence=$1",[claim.fence,stage]);
      await client.query("update operations.refresh_work_bindings set deadline_at_ms=1 where fence=$1",[claim.fence]);
      assert.equal(await store.isClaimCurrent({claim}),false,"deadline denies late ownership even before a detector run");
      const reviewed=await store.reviewInterruptedWork(),unknown=stage==="request_intent";
      assert.deepEqual(reviewed,{status:"reviewed",stopped:0,uncertain:1});
      const stop=await store.readStop({job:claim});
      assert.equal(stop.call_state,unknown?"unknown":[null,"checking_authority"].includes(stage)?"not_sent":"settled");
      assert.equal(stop.state,"uncertain");assert.equal(stop.action,"verify_execution_stopped");
      const snapshot=await store.readAdmissionSnapshot();
      assert.equal(snapshot.state.claims.some(c=>c.fence===claim.fence),true,"deadline alone never releases worker capacity even when call phase is known");
      assert.equal(snapshot.state.holds.some(h=>h.accountId===claim.accountId),true,"known stop is not automatic retry permission");
      assert.equal(await store.advanceStage({claim,window,expectedStage:"request_intent",stage:"response_received"}),false);
      assert.equal(await store.finishClaim({claim,outcome:"completed"}),false);
      assert.deepEqual(await store.reviewInterruptedWork(),{status:"reviewed",stopped:0,uncertain:0});
      assert.equal((await store.readAdmissionSnapshot()).state.revision,snapshot.state.revision,"repeat review cannot rewrite the hold or consume a turn");
      assert.equal(await store.resolveStop({job:claim,expectedVersion:stop.version}),false);
    } finally {await client.query("rollback to savepoint interruption_case");await client.query("release savepoint interruption_case");}
  }
  await client.query("savepoint missing_deadline");
  await client.query("update operations.refresh_work_bindings set deadline_at_ms=null where fence=$1",[claim.fence]);
  const before=(await store.readAdmissionSnapshot()).state;
  await client.query("savepoint missing_check");
  await assert.rejects(store.reviewInterruptedWork(),/REFRESH_WORK_REPOSITORY_UNAVAILABLE/);
  await client.query("rollback to savepoint missing_check");
  assert.deepEqual((await store.readAdmissionSnapshot()).state,before,"missing deadline is not invented and cannot release capacity");
  await client.query("rollback to savepoint missing_deadline");await client.query("release savepoint missing_deadline");
  for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"]) {
    assert.equal((await client.query("select has_function_privilege($1,'operations.review_refresh_interrupted_work()','EXECUTE') allowed",[role])).rows[0].allowed,role==="adstable_refresh_coordinator");
    assert.equal((await client.query("select has_function_privilege($1,'operations.commit_refresh_preflight_with_deadline(bigint,bigint,jsonb,jsonb,jsonb,text,bigint)','EXECUTE') allowed",[role])).rows[0].allowed,role==="adstable_refresh_coordinator");
    assert.equal((await client.query("select has_function_privilege($1,'operations.commit_refresh_preflight(bigint,bigint,jsonb,jsonb,jsonb,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  }
  console.log("EO05_INTERRUPTED_WORK_PASS deadline_atomic=true healthy_not_stopped=true late_owner_denied_before_review=true stages=5 call_phases_preserved=true ALL_interrupted_capacity_retained=true termination_not_inferred=true no_retry=true no_Dataset=true provider_calls=0 live_changes=false");
}

// Existing owner-only chunk fixture; tests two reviewers without creating coordinator membership.
export async function raceInterruptedWorkReview(client,other,claim,window) {
  await client.query("insert into operations.refresh_work_bindings(workspace_id,install_generation,provider,account_id,job_id,fence,source,from_date,to_date,partition_id,deadline_at_ms) values($1,$2,$3,$4,$5,$6,'{}',$7,$8,'synthetic-review-race',1)",
    [claim.workspaceId,claim.installGeneration,claim.provider,claim.accountId,claim.id,claim.fence,window.from,window.to]);
  // This fixture also has the existing uncertain account: do not truncate a two-claim set to one.
  await client.query("begin");
  await client.query("update operations.refresh_control set bounds=jsonb_set(bounds,'{maxClaims}','1') where singleton");
  const before=(await client.query("select revision from operations.refresh_control where singleton")).rows[0].revision;
  await client.query("savepoint over_bound_review");
  await assert.rejects(client.query("select operations.review_refresh_interrupted_work()"),/REFRESH_REVIEW_OVER_BOUND/);
  await client.query("rollback to savepoint over_bound_review");
  assert.equal((await client.query("select revision from operations.refresh_control where singleton")).rows[0].revision,before);
  await client.query("rollback");
  const results=await Promise.all([client.query("select operations.review_refresh_interrupted_work() result"),other.query("select operations.review_refresh_interrupted_work() result")]);
  assert.equal(results.reduce((sum,r)=>sum+r.rows[0].result.stopped,0),0);
  assert.equal(results.reduce((sum,r)=>sum+r.rows[0].result.uncertain,0),1,"only one reviewer may record the interruption");
  console.log("EO05_INTERRUPTED_REVIEW_RACE_PASS one_hold=true capacity_retained=true owner_fixture_only=true provider_calls=0");
}
