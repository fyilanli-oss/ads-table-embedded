import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {planRefreshAdmissions} from "../app/lib/refresh/admission-policy.server.js";

// Called only after replay on the existing ephemeral CI databases. No live URL is accepted.
export async function refreshWorkTrackingProbe(client, connection, environment = process.env) {
  assert.equal(environment.GITHUB_ACTIONS, "true");
  assert.ok(environment.RUNNER_TEMP);
  assert.equal(connection.host, "127.0.0.1");
  assert.equal(connection.port, 54322);
  const other = new pg.Client(connection);
  const workspace = randomUUID();
  let installed = false;
  const vector = n => ({requests:n,dbWrites:n,connections:n,rows:n,bytes:n});
  const bounds = {maxCandidates:4,maxClaims:4,maxAdmissions:4,maxWorkspaces:4};
  const budget = {global:vector(1),interactiveReserve:vector(0),
    providers:[{provider:"google_ads",limit:vector(4)}],
    workspaces:[{workspaceId:workspace,limit:vector(4)}],
    accounts:[{provider:"google_ads",accountId:"synthetic-account",limit:vector(4)},
      {provider:"google_ads",accountId:"other-account",limit:vector(4)}]};
  const candidate = (id, accountId="synthetic-account") => ({id,workspaceId:workspace,installGeneration:"1",provider:"google_ads",accountId,
    scheduledHour:0,queuedAt:0,workClass:"hourly_hot_window",cost:vector(1),
    authority:{installationVerified:true,entitled:true,connected:true,setupComplete:true,allowedWindow:true}});
  const proposal = (snapshot, candidates=[candidate("work")], override={}) => planRefreshAdmissions({state:snapshot.state,budget:snapshot.budget,bounds:snapshot.bounds,candidates,now:3_600_000,...override});
  try {
    await other.connect();
    await client.query("set role adstable_owner");
    await other.query("set role adstable_owner");
    const store = createRefreshWorkRepository(client);
    const otherStore = createRefreshWorkRepository(other);
    await assert.rejects(store.readAdmissionSnapshot(), /REFRESH_WORK_NOT_CONFIGURED/);
    await client.query("insert into app.workspaces(id) values ($1)",[workspace]);
    installed = true;
    await client.query(`insert into shopify.installations(shop_id,shop_domain,workspace_id)
      values ('gid://shopify/Shop/99999999','refresh-synthetic.myshopify.com',$1)`,[workspace]);
    await client.query("update operations.refresh_control set budget=$1::jsonb,bounds=$2::jsonb where singleton",[JSON.stringify(budget),JSON.stringify(bounds)]);
    const snapshot = await store.readAdmissionSnapshot();
    const plan = proposal(snapshot);
    const race = await Promise.all([store.compareAndSwap({expectedRevision:snapshot.state.revision,nextState:plan.nextState}),
      otherStore.compareAndSwap({expectedRevision:snapshot.state.revision,nextState:plan.nextState})]);
    assert.deepEqual(race.sort(),[false,true],"only one actual PostgreSQL claimant may win");
    const running = await otherStore.readAdmissionSnapshot();
    assert.equal(running.state.claims.length,1,"other connection sees durable reservation");
    assert.equal(proposal(running,[candidate("other","other-account")]).deferred[0].reason,"budget_full");
    const spoofed = proposal(running,[candidate("other","other-account")],{budget:{...budget,global:vector(4)}});
    await assert.rejects(store.compareAndSwap({expectedRevision:running.state.revision,nextState:spoofed.nextState}),/REFRESH_WORK_REPOSITORY_UNAVAILABLE/);
    assert.equal((await store.readState()).revision,running.state.revision,"budget failure rolls back everything");
    const old = running.state.claims[0];
    assert.equal(await store.finishClaim({claim:{...old,fence:old.fence+1},outcome:"completed"}),false);
    assert.equal(await store.finishClaim({claim:{...old,installGeneration:"2"},outcome:"paused"}),false);
    assert.equal(await store.finishClaim({claim:old,outcome:"paused"}),true);
    const paused = await store.readAdmissionSnapshot();
    assert.equal(paused.state.claims.length,0);
    assert.equal((await client.query("select status from operations.refresh_runs where workspace_id=$1",[workspace])).rows[0].status,"paused");
    const resumed = proposal(paused);
    assert.equal(await store.compareAndSwap({expectedRevision:paused.state.revision,nextState:resumed.nextState}),true);
    assert.ok(resumed.admitted[0].fence>old.fence);
    assert.equal(await store.finishClaim({claim:old,outcome:"completed"}),false,"old owner cannot finish new owner's job");
    assert.equal(await otherStore.finishClaim({claim:resumed.admitted[0],outcome:"completed"}),true);
    const completed = await store.readAdmissionSnapshot();
    assert.equal(completed.state.claims.length,0);
    const duplicate = proposal(completed);
    await assert.rejects(store.compareAndSwap({expectedRevision:completed.state.revision,nextState:duplicate.nextState}),/REFRESH_WORK_REPOSITORY_UNAVAILABLE/);
    assert.equal((await store.readState()).revision,completed.state.revision,"completed job cannot be replayed as new work");
    const lateFailure = proposal(completed,[candidate("late")]);
    lateFailure.nextState.lastServed.push({workspaceId:randomUUID(),turn:1});
    await assert.rejects(store.compareAndSwap({expectedRevision:completed.state.revision,nextState:lateFailure.nextState}),/REFRESH_WORK_REPOSITORY_UNAVAILABLE/);
    assert.equal((await store.readState()).claims.length,0,"late FK error undoes earlier job insert");
    for (const role of ["anon","authenticated","service_role","adstable_runtime"]) {
      assert.equal((await client.query("select has_function_privilege($1,'operations.read_refresh_admission_snapshot()','EXECUTE') as allowed",[role])).rows[0].allowed,false);
      assert.equal((await client.query("select has_table_privilege($1,'operations.refresh_runs','SELECT,INSERT,UPDATE,DELETE') as allowed",[role])).rows[0].allowed,false);
    }
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.commit_refresh_admissions(bigint,jsonb)','EXECUTE') as allowed")).rows[0].allowed,true);
    console.log("EO05_REFRESH_WORK_PROBE_PASS synthetic_only=true production_mutation=false real_capacity=false");
  } finally {
    try {
      if (installed) {
        await client.query("delete from shopify.installations where workspace_id=$1",[workspace]);
        await client.query("delete from app.workspaces where id=$1",[workspace]);
        await client.query("update operations.refresh_control set budget=null,bounds=null where singleton");
      }
      await client.query("reset role");
    } finally { await other.end(); }
  }
}
