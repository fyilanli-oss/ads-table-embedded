import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {commitRefreshAdmissions} from "../app/lib/refresh/admission-policy.server.js";

const read = path => readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration = "supabase/migrations/20261020092429_eo05a_refresh_work_tracking.sql";
const sql = read(migration);
const vector = n => ({requests:n,dbWrites:n,connections:n,rows:n,bytes:n});
const snapshot = () => ({state:{revision:0,nextFence:1,nextTurn:1,claims:[],lastServed:[]},
  bounds:{maxCandidates:2,maxClaims:2,maxAdmissions:2,maxWorkspaces:2},
  budget:{global:vector(0),interactiveReserve:vector(0),providers:[{provider:"google_ads",limit:vector(1)}],
    workspaces:[{workspaceId:"w",limit:vector(1)}],accounts:[{provider:"google_ads",accountId:"a",limit:vector(1)}]}});

test("repository reads one coherent snapshot and never uses caller limits instead of stored limits", async () => {
  const queries=[];
  const repo=createRefreshWorkRepository({query:async (text,values) => {queries.push({text,values}); return {rows:[{result:snapshot()}]};}});
  const candidate={id:"job",workspaceId:"w",installGeneration:"1",provider:"google_ads",accountId:"a",scheduledHour:0,queuedAt:0,
    workClass:"bootstrap",cost:vector(1),authority:{installationVerified:true,entitled:true,connected:true,setupComplete:true,allowedWindow:true}};
  const result=await commitRefreshAdmissions({store:repo,candidates:[candidate],now:3_600_000,budget:{global:vector(999)},bounds:{maxAdmissions:999}});
  assert.equal(result.status,"waiting");
  assert.equal(result.deferred[0].reason,"budget_full");
  assert.equal(queries.length,1);
  assert.equal(queries[0].text,"select operations.read_refresh_admission_snapshot() as result");
});

test("commit and finish use bound SQL parameters, no open client transaction or dynamic identifier", async () => {
  const queries=[];
  const repo=createRefreshWorkRepository({query:async (text,values) => {queries.push({text,values});return {rows:[{result:true}]};}});
  const state={revision:2};
  assert.equal(await repo.compareAndSwap({expectedRevision:1,nextState:state}),true);
  assert.deepEqual(queries[0].values,[1,JSON.stringify(state)]);
  const claim={workspaceId:"w",installGeneration:"1",provider:"google_ads",accountId:"a",id:"job'; select 1",fence:2};
  assert.equal(await repo.finishClaim({claim,outcome:"paused"}),true);
  assert.equal(queries[1].values[4],claim.id);
  assert.ok(!queries[1].text.includes(claim.id));
  assert.equal(queries.length,2);
});

test("missing configuration, invalid response and database errors fail closed without retries or raw details", async () => {
  for (const response of [undefined,{rows:[]},{rows:[{result:null}]},{rows:[{result:{state:{}}}]}]) {
    let calls=0;
    const repo=createRefreshWorkRepository({query:async () => {calls++;return response;}});
    await assert.rejects(repo.readAdmissionSnapshot(),/REFRESH_WORK_(?:REPOSITORY_UNAVAILABLE|NOT_CONFIGURED)/);
    assert.equal(calls,1);
  }
  const repo=createRefreshWorkRepository({query:async () => {throw new Error("SECRET_CREDENTIAL");}});
  await assert.rejects(repo.readState(),/^Error: REFRESH_WORK_REPOSITORY_UNAVAILABLE$/);
  await assert.rejects(repo.finishClaim({claim:{fence:1},outcome:"failed_and_retry"}),/REFRESH_WORK_INPUT_INVALID/);
});

test("tracking tables are forced-RLS, function-only and not granted to the web runtime", () => {
  for (const table of ["refresh_control","refresh_runs","refresh_service_order"]) {
    assert.ok(sql.includes(`alter table operations.${table} enable row level security`));
    assert.ok(sql.includes(`alter table operations.${table} force row level security`));
  }
  assert.match(sql,/create role adstable_refresh_coordinator nologin noinherit nosuperuser/);
  assert.doesNotMatch(sql,/grant adstable_refresh_coordinator to|grant .* to adstable_runtime/);
  assert.equal((sql.match(/security definer set search_path = ''/g)??[]).length,3);
  assert.match(sql,/where status = 'running'/);
  assert.match(sql,/from public,anon,authenticated,service_role,adstable_runtime/);
});

test("ownership, stored budget and durable completion share a short database boundary", () => {
  assert.match(sql,/control\.revision <> expected_revision then return false/);
  assert.match(sql,/where singleton for update/);
  assert.match(sql,/REFRESH_EXISTING_CLAIM_CHANGED/);
  assert.match(sql,/REFRESH_BUDGET_EXCEEDED/);
  assert.match(sql,/REFRESH_BUDGET_SCOPE_MISSING/);
  assert.match(sql,/REFRESH_JOB_ALREADY_COMPLETED/);
  assert.match(sql,/job_id=p_job and fence=p_fence and status='running'/);
  assert.match(sql,/where operations\.refresh_runs\.status='paused'/);
  assert.doesNotMatch(sql,/pg_net|http\(|cron\.schedule|password\s+'|grant all/);
});

test("migration stays pending and both isolated replay paths run the real SQL regression probe", () => {
  const manifest=JSON.parse(read("contracts/a6-tech-01-f01-migration-lineage-v1.json"));
  const entry=manifest.pending_migrations.find(item => item.file===migration);
  assert.equal(entry.applied,false);
  assert.equal(entry.live_apply_authorized,false);
  const runner=read("tools/f01-database-replay.mjs");
  assert.match(runner,/await refreshWorkTrackingProbe\(client, replayConnection\)/);
  const probe=read("tools/eo05-refresh-work-probe.mjs");
  assert.match(probe,/connection\.host, "127\.0\.0\.1"/);
  assert.match(probe,/environment\.GITHUB_ACTIONS, "true"/);
  assert.match(probe,/Promise\.all/);
  assert.match(probe,/old owner cannot finish new owner's job/);
});
