import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {REFRESH_STOP_REASONS, refreshStopInput} from "../app/lib/refresh/work-stop-policy.server.js";
import {planRefreshAdmissions} from "../app/lib/refresh/admission-policy.server.js";

const job={workspaceId:"w",installGeneration:"1",provider:"meta",accountId:"a",id:"j"};
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration="supabase/migrations/20261020100851_eo05a_refresh_stop_records.sql";
const sql=read(migration);
const vector=n=>({requests:n,dbWrites:n,connections:n,rows:n,bytes:n});

test("only allowlisted observations enter persistence; external payloads never become reasons",()=>{
  for (const reason of REFRESH_STOP_REASONS) {
    const values=refreshStopInput({job:{...job,fence:3},reason,expectedRevision:2});
    assert.equal(values[6],reason);
    assert.equal(values[7],2);
    assert.ok(sql.includes(`('${reason}',`),`SQL classification missing: ${reason}`);
  }
  for (const reason of ["secret-token",null,"provider_response_raw","timeout_retry"]) {
    assert.throws(()=>refreshStopInput({job,reason,expectedRevision:2}),/REFRESH_WORK_INPUT_INVALID/);
  }
  for (const reason of ["provider_rejected","worker_lost","worker_stopped","stopped_before_call"]) {
    assert.throws(()=>refreshStopInput({job,reason,expectedRevision:2}),/REFRESH_WORK_INPUT_INVALID/);
  }
  assert.throws(()=>refreshStopInput({job:{...job,installGeneration:"x"},reason:"authority_required",expectedRevision:2}),/REFRESH_WORK_INPUT_INVALID/);
});

test("repository binds stop/read/resolve/current checks and never retries failed observations",async()=>{
  const queries=[];
  const repo=createRefreshWorkRepository({query:async(text,values)=>{queries.push({text,values});return {rows:[{result:true}]};}});
  const quoted={...job,id:"job'; select secret"};
  await repo.recordStop({job:quoted,reason:"configuration_missing",expectedRevision:2});
  await repo.readStop({job:quoted});
  await repo.resolveStop({job:quoted,expectedVersion:3});
  await repo.isClaimCurrent({claim:{...quoted,fence:4}});
  assert.equal(queries.length,4);
  for(const query of queries) {assert.ok(!query.text.includes(quoted.id));assert.equal(query.values[4],quoted.id);}
  let calls=0;
  const unavailable=createRefreshWorkRepository({query:async()=>{calls++;throw Error("PRIVATE_DATABASE_DETAIL");}});
  await assert.rejects(unavailable.recordStop({job,reason:"authority_required",expectedRevision:2}),/^Error: REFRESH_WORK_REPOSITORY_UNAVAILABLE$/);
  assert.equal(calls,1);
  await assert.rejects(repo.resolveStop({job,expectedVersion:0}),/REFRESH_WORK_INPUT_INVALID/);
  await assert.rejects(repo.isClaimCurrent({claim:job}),/REFRESH_WORK_INPUT_INVALID/);
});

test("held account waits without preventing an unrelated workspace getting its turn",()=>{
  const candidates=[job,{...job,workspaceId:"other",accountId:"b",id:"other-job"}].map(j=>({...j,scheduledHour:0,queuedAt:0,
    workClass:"hourly_hot_window",cost:vector(1),authority:{installationVerified:true,entitled:true,connected:true,setupComplete:true,allowedWindow:true}}));
  const state={revision:0,nextFence:1,nextTurn:1,claims:[],lastServed:[],holds:[job]};
  const input={state,candidates,now:3_600_000,bounds:{maxCandidates:2,maxClaims:2,maxAdmissions:2,maxWorkspaces:2},
    budget:{global:vector(2),interactiveReserve:vector(0),providers:[{provider:"meta",limit:vector(2)}],
      workspaces:[{workspaceId:"w",limit:vector(2)},{workspaceId:"other",limit:vector(2)}],
      accounts:[{provider:"meta",accountId:"a",limit:vector(2)},{provider:"meta",accountId:"b",limit:vector(2)}]}};
  const result=planRefreshAdmissions(input);
  assert.deepEqual(result.admitted.map(c=>c.id),["other-job"]);
  assert.deepEqual(result.deferred,[{id:"j",reason:"account_held"}]);
  assert.throws(()=>planRefreshAdmissions({...input,state:{...state,holds:Array(5).fill(job)}}),/REFRESH_POLICY_INPUT_INVALID/);
});

test("pending stop schema denies bypasses and never releases unknown external work on elapsed time",()=>{
  assert.match(sql,/force row level security/);
  assert.match(sql,/where state in \('blocked','paused','uncertain'\)/);
  assert.match(sql,/classification->>'state'<>'uncertain'/);
  assert.match(sql,/state in \('blocked','paused'\) and call_state<>'unknown'/);
  assert.match(sql,/p_version and state in/);
  assert.match(sql,/read_refresh_admission_snapshot_before_stops\(\) from public,anon,authenticated,service_role,adstable_runtime,adstable_refresh_coordinator/);
  assert.doesNotMatch(sql,/cron\.schedule|pg_net|grant .* to adstable_runtime|interval '\d|raw_payload|error_message/);
  const entry=JSON.parse(read("contracts/a6-tech-01-f01-migration-lineage-v1.json")).pending_migrations.find(e=>e.file===migration);
  assert.equal(entry.applied,false);
  assert.equal(entry.live_apply_authorized,false);
  assert.match(read("tools/f01-database-replay.mjs"),/await refreshWorkStopsProbe\(client, replayConnection\)/);
});
