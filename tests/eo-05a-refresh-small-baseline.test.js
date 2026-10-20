import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {SMALL_REFRESH_BASELINE,assertBaselineEnvironment,baselineJobs,durationSummary} from "../tools/eo05-refresh-small-baseline.mjs";

test("small baseline is exactly the approved 100-workspace 1/2/4-worker matrix, not full capacity acceptance",()=>{
  assert.equal(SMALL_REFRESH_BASELINE.workspaces,100);
  assert.deepEqual(SMALL_REFRESH_BASELINE.workers,[1,2,4]);
  assert.deepEqual(SMALL_REFRESH_BASELINE.historyRows,[0,10_000]);
  assert.equal(SMALL_REFRESH_BASELINE.maxCaseMs,60_000);
  assert.equal(SMALL_REFRESH_BASELINE.maxAttempts,10_000);
  const design=JSON.parse(readFileSync(new URL("../contracts/eo-05a-global-refresh-design-v1.json",import.meta.url),"utf8")).small_baseline;
  assert.deepEqual(design.workers,SMALL_REFRESH_BASELINE.workers);
  assert.deepEqual(design.completed_history_rows,SMALL_REFRESH_BASELINE.historyRows);
  assert.equal(design.production_capacity_certified,false);
  assert.equal(design.product_or_Dataset_write_capacity_measured,false);
  assert.equal(design.full_2000_4000_or_24_hour_acceptance_authorized,false);
});

test("small and large workspace fixture sizes are bounded chunks, never provider product-data claims",()=>{
  const workspaces=Array.from({length:100},(_,i)=>`workspace-${i}`);
  const jobs=baselineJobs(workspaces,"case");
  assert.equal(jobs.length,140);
  assert.equal(new Set(jobs.map(job=>job.id)).size,140);
  assert.equal(jobs.filter(job=>job.workspaceId===workspaces[0]).length,5);
  assert.equal(jobs.filter(job=>job.workspaceId===workspaces[99]).length,1);
  assert.ok(jobs.every(job=>job.cost.requests===1 && job.cost.rows<=10));
  assert.throws(()=>baselineJobs([],"case"));
});

test("duration summaries use sorted nearest-rank observations and never turn absent measurements into zero",()=>{
  assert.deepEqual(durationSummary([4,1,3,2]),{samples:4,p50_ms:2,p95_ms:4,max_ms:4});
  assert.equal(durationSummary([]),null);
  assert.deepEqual(durationSummary([0]),{samples:1,p50_ms:0,p95_ms:0,max_ms:0});
  for (const samples of [[-1],[NaN],[Infinity]]) assert.throws(()=>durationSummary(samples));
});

test("baseline refuses non-runner, remote and foreign database targets before SQL or connection creation",()=>{
  const connection={host:"127.0.0.1",port:54322,database:"postgres"};
  const environment={GITHUB_ACTIONS:"true",RUNNER_TEMP:"ephemeral"};
  assertBaselineEnvironment(connection,environment);
  for (const bad of [{...connection,host:"live.supabase.co"},{...connection,port:5432},{...connection,database:"other"}]) {
    assert.throws(()=>assertBaselineEnvironment(bad,environment));
  }
  assert.throws(()=>assertBaselineEnvironment(connection,{}));
});

test("baseline is test-only, measures actual calls and validates fairness/budgets without forcing query plans",()=>{
  const source=readFileSync(new URL("../tools/eo05-refresh-small-baseline.mjs",import.meta.url),"utf8");
  assert.match(source,/explain \(analyze,buffers,format json\)/);
  assert.ok(source.includes("Math.max(...first.values())<=100"));
  assert.match(source,/shared budget exceeded/);
  assert.match(source,/stopped=true; throw error/);
  assert.match(source,/Promise\.allSettled/);
  assert.match(source,/production_capacity:false,provider_calls:0,product_facts_written:0/);
  assert.doesNotMatch(source,/enable_seqscan|process\.env\.[A-Z_]*(?:URL|TOKEN|SECRET)|fetch\(/);
  const runner=readFileSync(new URL("../tools/f01-database-replay.mjs",import.meta.url),"utf8");
  assert.match(runner,/await refreshSmallBaseline\(client, replayConnection\)/);
});
