import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import pg from "pg";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {planRefreshAdmissions} from "../app/lib/refresh/admission-policy.server.js";

// Fixed, small test matrix. These numbers are NOT production limits or provider workloads.
export const SMALL_REFRESH_BASELINE = Object.freeze({
  workspaces:100, largeWorkspaces:10, largeChunks:5,
  workers:Object.freeze([1,2,4]), historyRows:Object.freeze([0,10_000]),
  maxCaseMs:60_000, maxAttempts:10_000,
});

export function durationSummary(samples) {
  assert.ok(samples.every(value => Number.isFinite(value) && value >= 0));
  if (samples.length === 0) return null;
  const ordered=[...samples].sort((a,b)=>a-b);
  const rounded=value=>Math.round(value*1000)/1000;
  const percentile=p=>rounded(ordered[Math.ceil(ordered.length*p)-1]);
  return {samples:ordered.length,p50_ms:percentile(0.5),p95_ms:percentile(0.95),max_ms:rounded(ordered.at(-1))};
}

export function baselineJobs(workspaces,label) {
  assert.equal(workspaces.length,SMALL_REFRESH_BASELINE.workspaces);
  return workspaces.flatMap((workspaceId,index)=>Array.from({length:index<10?5:1},(_,chunk)=>({
    id:`${label}-${index}-${chunk}`,workspaceId,installGeneration:"1",provider:"google_ads",accountId:`account-${index}`,
    queuedAt:0,scheduledHour:0,workClass:"hourly_hot_window",
    cost:{requests:1,dbWrites:1,connections:1,rows:index<10?10:1,bytes:index<10?1280:128},
    authority:{installationVerified:true,entitled:true,connected:true,setupComplete:true,allowedWindow:true},
  })));
}

export function assertBaselineEnvironment(connection,environment) {
  assert.equal(environment.GITHUB_ACTIONS,"true");
  assert.ok(environment.RUNNER_TEMP);
  assert.equal(connection.host,"127.0.0.1");
  assert.equal(connection.port,54322);
  assert.equal(connection.database,"postgres");
}

async function timed(samples,operation) {
  const start=performance.now();
  const result=await operation();
  samples.push(performance.now()-start);
  return result;
}

function planNodes(node) {
  return [{type:node["Node Type"],index:node["Index Name"]??null,rows:node["Actual Rows"]},...(node.Plans??[]).flatMap(planNodes)];
}

async function runCase(admin,connection,workspaces,workerCount,historyRows) {
  const label=`baseline-${workerCount}-${historyRows}`;
  const jobs=baselineJobs(workspaces,label);
  const pending=new Map(jobs.map(job=>[job.id,job]));
  const bounds={maxCandidates:140,maxClaims:4,maxAdmissions:1,maxWorkspaces:100};
  const budget={global:{requests:4,dbWrites:5,connections:5,rows:40,bytes:5120},
    interactiveReserve:{requests:0,dbWrites:1,connections:1,rows:0,bytes:0},
    providers:[{provider:"google_ads",limit:{requests:4,dbWrites:4,connections:4,rows:40,bytes:5120}}],
    workspaces:workspaces.map(workspaceId=>({workspaceId,limit:{requests:1,dbWrites:1,connections:1,rows:10,bytes:1280}})),
    accounts:workspaces.map((_,index)=>({provider:"google_ads",accountId:`account-${index}`,limit:{requests:1,dbWrites:1,connections:1,rows:10,bytes:1280}}))};
  await admin.query("delete from operations.refresh_runs where workspace_id=any($1::uuid[])",[workspaces]);
  await admin.query("delete from operations.refresh_service_order where workspace_id=any($1::uuid[])",[workspaces]);
  if (historyRows>0) {
    await admin.query(`insert into operations.refresh_runs(workspace_id,install_generation,provider,account_id,job_id,fence,cost,status,finished_at)
      select $1::uuid,1,'google_ads','history-account','history-'||g::text,c.next_fence+g-1,
        '{"requests":1,"dbWrites":1,"connections":1,"rows":1,"bytes":128}'::jsonb,'completed',statement_timestamp()
      from operations.refresh_control c cross join generate_series(1,$2::integer) g where c.singleton`,[workspaces[0],historyRows]);
    await admin.query("update operations.refresh_control set next_fence=next_fence+$1::integer where singleton",[historyRows]);
  }
  await admin.query("update operations.refresh_control set budget=$1::jsonb,bounds=$2::jsonb,revision=revision+1 where singleton",[JSON.stringify(budget),JSON.stringify(bounds)]);
  // Fixture maintenance outside timed work reduces dead-row/statistics noise between cases.
  await admin.query("vacuum (analyze) operations.refresh_runs");
  const explained=(await admin.query("explain (analyze,buffers,format json) select * from operations.refresh_runs where status='running' order by fence limit 5")).rows[0]["QUERY PLAN"][0];
  const clients=[];
  const readTimes=[],planTimes=[],commitTimes=[],finishTimes=[],waitTimes=[];
  const accepted=[],completed=new Set();
  let conflicts=0,waiting=0,attempts=0,peakClaims=0,maxSnapshotBytes=0,stopped=false;
  let start;
  try {
    for (let i=0;i<workerCount;i++) {
      const client=new pg.Client(connection);
      clients.push(client);
      await client.connect();
      await client.query("set role adstable_owner");
    }
    start=performance.now();
    const results=await Promise.allSettled(clients.map(async client=>{
      const store=createRefreshWorkRepository(client);
      try {
        while (pending.size>0 && !stopped) {
          assert.ok(++attempts<=SMALL_REFRESH_BASELINE.maxAttempts,"bounded dispatch attempt limit exceeded");
          assert.ok(performance.now()-start<SMALL_REFRESH_BASELINE.maxCaseMs,"small baseline time limit exceeded");
          const snapshot=await timed(readTimes,()=>store.readAdmissionSnapshot());
          maxSnapshotBytes=Math.max(maxSnapshotBytes,Buffer.byteLength(JSON.stringify(snapshot)));
          const beforePlan=performance.now();
          const proposal=planRefreshAdmissions({state:snapshot.state,budget:snapshot.budget,bounds:snapshot.bounds,candidates:[...pending.values()],now:3_600_000});
          planTimes.push(performance.now()-beforePlan);
          if (proposal.admitted.length===0) { waiting++; continue; }
          const won=await timed(commitTimes,()=>store.compareAndSwap({expectedRevision:snapshot.state.revision,nextState:proposal.nextState}));
          if (!won) { conflicts++; continue; }
          const claim=proposal.admitted[0];
          assert.equal(pending.delete(claim.id),true,"duplicate job was claimed");
          accepted.push(claim);
          waitTimes.push(performance.now()-start);
          const active=(await timed(readTimes,()=>store.readAdmissionSnapshot())).state.claims;
          peakClaims=Math.max(peakClaims,active.length);
          assert.ok(active.length<=bounds.maxClaims);
          assert.equal(new Set(active.map(c=>JSON.stringify([c.workspaceId,c.installGeneration,c.provider,c.accountId]))).size,active.length);
          for (const resource of ["requests","dbWrites","connections","rows","bytes"]) {
            assert.ok(active.reduce((sum,c)=>sum+c.cost[resource],0)<=budget.global[resource]-budget.interactiveReserve[resource],"shared budget exceeded");
          }
          assert.equal(await timed(finishTimes,()=>store.finishClaim({claim,outcome:"completed"})),true);
          assert.equal(completed.has(claim.id),false);
          completed.add(claim.id);
        }
      } catch (error) { stopped=true; throw error; }
    }));
    const failure=results.find(result=>result.status==="rejected");
    if (failure) throw failure.reason;
    const elapsed=performance.now()-start;
    assert.equal(completed.size,jobs.length);
    assert.equal(pending.size,0);
    const order=[...accepted].sort((a,b)=>a.fence-b.fence);
    const first=new Map();
    order.forEach((claim,index)=>{if (!first.has(claim.workspaceId)) first.set(claim.workspaceId,index+1);});
    assert.equal(first.size,100);
    assert.ok(Math.max(...first.values())<=100,"a workspace took a second chunk before every workspace got a first turn");
    const counts=(await admin.query(`select count(*)::integer as total,count(*) filter(where status='running')::integer as running,
      count(*) filter(where status='completed' and account_id<>'history-account')::integer as completed
      from operations.refresh_runs where workspace_id=any($1::uuid[])`,[workspaces])).rows[0];
    assert.equal(counts.total,historyRows+jobs.length);
    assert.equal(counts.completed,jobs.length);
    assert.equal(counts.running,0);
    const evidence={workers:workerCount,workspaces:100,large_workspaces:10,jobs:jobs.length,history_rows:historyRows,
      elapsed_ms:Math.round(elapsed),metadata_jobs_per_second:Math.round(jobs.length/elapsed*1e6)/1000,
      read:durationSummary(readTimes),plan:durationSummary(planTimes),commit:durationSummary(commitTimes),finish:durationSummary(finishTimes),
      queue_wait:durationSummary(waitTimes),conflicts,waiting,attempts,peak_claims_observed:peakClaims,max_snapshot_bytes:maxSnapshotBytes,
      last_first_turn:Math.max(...first.values()),idle_query_plan:planNodes(explained.Plan),idle_query_execution_ms:explained["Execution Time"],
      synthetic_only:true,production_capacity:false,provider_calls:0,product_facts_written:0};
    console.log(`EO05_SMALL_BASELINE ${JSON.stringify(evidence)}`);
    return evidence;
  } finally { await Promise.all(clients.map(client=>client.end())); }
}

export async function refreshSmallBaseline(admin,connection,environment=process.env) {
  assertBaselineEnvironment(connection,environment);
  const workspaces=Array.from({length:100},()=>randomUUID());
  let created=false;
  try {
    await admin.query("set role adstable_owner");
    assert.equal((await admin.query("select count(*)::integer as n from operations.refresh_runs where status='running'")).rows[0].n,0);
    await admin.query("insert into app.workspaces(id) select unnest($1::uuid[])",[workspaces]);
    created=true;
    await admin.query(`insert into shopify.installations(shop_id,shop_domain,workspace_id)
      select 'gid://shopify/Shop/'||(800000000+n)::text,'baseline-'||n::text||'.myshopify.com',id
      from unnest($1::uuid[]) with ordinality as fixture(id,n)`,[workspaces]);
    for (const historyRows of SMALL_REFRESH_BASELINE.historyRows) {
      for (const workers of SMALL_REFRESH_BASELINE.workers) await runCase(admin,connection,workspaces,workers,historyRows);
    }
    console.log("EO05_SMALL_BASELINE_PASS cases=6 production_capacity=false provider_calls=0 product_facts_written=0");
  } finally {
    if (created) {
      await admin.query("delete from shopify.installations where workspace_id=any($1::uuid[])",[workspaces]);
      await admin.query("delete from app.workspaces where id=any($1::uuid[])",[workspaces]);
      await admin.query("update operations.refresh_control set budget=null,bounds=null,revision=revision+1 where singleton");
    }
    await admin.query("reset role");
  }
}
