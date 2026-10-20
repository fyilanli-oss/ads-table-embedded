import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {prepareRefreshInventory,runRefreshQueueCheck} from "../app/lib/refresh/queue-check.server.js";

export async function refreshQueueCheckProbe(client,connection,environment=process.env) {
  assert.equal(environment.GITHUB_ACTIONS,"true");assert.ok(environment.RUNNER_TEMP);
  assert.equal(connection.host,"127.0.0.1");assert.equal(connection.port,54322);
  const other=new pg.Client(connection),workspace=randomUUID(),emptyShop=randomUUID();
  try {
    await other.connect();await client.query("set role adstable_owner");await other.query("set role adstable_owner");
    await client.query("insert into app.workspaces(id) values ($1),($2)",[workspace,emptyShop]);
    const store=createRefreshWorkRepository(client),second=createRefreshWorkRepository(other);
    assert.equal((await store.readQueueCheck()).configured,false);
    await client.query("update operations.refresh_queue_control set max_workspaces=4,max_accounts=4,max_snapshot_bytes=10000,max_snapshot_age_ms=60000 where singleton");
    const now=()=>Date.now();
    const account={installGeneration:"1",provider:"klaviyo",accountId:"synthetic-a",connectionId:"connection-a",connectionVersion:1,eligibleFromMs:now()-5*3600000,eligible:true,connectionOpen:true};
    const fixture=()=>({complete:true,observedAtMs:now(),expectedWorkspaces:2,expectedAccounts:1,
      workspaces:[{workspaceId:workspace,accounts:[{...account}]},{workspaceId:emptyShop,accounts:[]}]});
    const revision=(await store.readQueueCheck()).revision;
    const inventory=prepareRefreshInventory(fixture());
    const race=await Promise.all([store.commitQueueCheck({expectedRevision:revision,inventory}),second.commitQueueCheck({expectedRevision:revision,inventory})]);
    assert.equal(race.filter(r=>r.committed).length,1,"two queue checkers cannot both commit same revision");
    let state=await store.readQueueCheck();assert.equal(state.checkedWorkspaces,2);assert.equal(state.checkedAccounts,1);
    assert.equal(state.accounts.length,1);assert.equal(state.accounts[0].state,"pending");
    const firstQueued=state.accounts[0].firstQueuedAtMs,firstDue=state.accounts[0].firstDueHourMs;
    assert.ok(state.accounts[0].latestDueHourMs-firstDue>=3*3600000,"missed hours coalesced visibly, not discarded");
    assert.equal((await runRefreshQueueCheck({store,loadInventory:async()=>fixture()})).status,"checked");
    state=await store.readQueueCheck();assert.equal(state.accounts.length,1);assert.equal(state.accounts[0].firstQueuedAtMs,firstQueued);
    assert.equal(state.accounts[0].firstDueHourMs,firstDue);
    const unchanged=JSON.stringify(state);
    const partial=fixture();partial.complete=false;
    assert.equal((await runRefreshQueueCheck({store,loadInventory:async()=>partial})).status,"needs_attention");
    assert.equal(JSON.stringify(await store.readQueueCheck()),unchanged,"partial inventory cannot advance heartbeat");
    for(const mutate of [i=>i.observedAtMs=now()+3600000,i=>i.observedAtMs=0,i=>i.accounts[0].offsetMs++,
      i=>i.accounts.push(i.accounts[0]),i=>i.workspaces.push(i.workspaces[0]),i=>i.accounts[0].unexpected="payload"]) {
      const bad=prepareRefreshInventory(fixture());mutate(bad);
      await assert.rejects(store.commitQueueCheck({expectedRevision:state.revision,inventory:bad}));
      assert.equal(JSON.stringify(await store.readQueueCheck()),unchanged,"failed transaction cannot bless check or mutate pending rows");
    }
    // Hold is trusted synthetic evidence, not a new provider call or retry.
    await client.query("insert into operations.refresh_work_stops(workspace_id,install_generation,provider,account_id,job_id,version,state,reason,call_state,source,action) values($1,1,'klaviyo','synthetic-a','synthetic-held',1,'uncertain','worker_lost','unknown','unknown','verify_execution_stopped')",[workspace]);
    assert.equal((await runRefreshQueueCheck({store,loadInventory:async()=>fixture()})).status,"checked");
    state=await store.readQueueCheck();assert.equal(state.accounts[0].state,"held");assert.equal(state.accounts[0].firstQueuedAtMs,firstQueued);
    await client.query("delete from operations.refresh_work_stops where workspace_id=$1",[workspace]);
    account.eligible=false;
    await runRefreshQueueCheck({store,loadInventory:async()=>fixture()});state=await store.readQueueCheck();
    assert.equal(state.accounts[0].state,"ineligible");assert.equal(state.accounts[0].firstDueHourMs,null);
    account.eligible=true;
    assert.equal((await runRefreshQueueCheck({store,loadInventory:async()=>fixture()})).status,"checked","entitlement eligibility recovery is not a new OAuth connection");
    account.eligible=false;account.connectionOpen=false;
    await runRefreshQueueCheck({store,loadInventory:async()=>fixture()});
    account.eligible=true;account.connectionOpen=true;
    assert.equal((await runRefreshQueueCheck({store,loadInventory:async()=>fixture()})).status,"needs_attention","same connection cannot silently reopen disconnected history");
    account.connectionVersion=2;account.connectionId="connection-b";
    assert.equal((await runRefreshQueueCheck({store,loadInventory:async()=>fixture()})).status,"needs_attention","new version cannot reuse eligibility from before the closed window");
    account.eligibleFromMs=now()+3600000;
    await runRefreshQueueCheck({store,loadInventory:async()=>fixture()});state=await store.readQueueCheck();
    assert.equal(state.accounts[0].state,"not_due");assert.equal(state.accounts[0].firstDueHourMs,null);
    account.connectionVersion=1;
    assert.equal((await runRefreshQueueCheck({store,loadInventory:async()=>fixture()})).status,"needs_attention");
    const empty={complete:true,observedAtMs:now(),expectedWorkspaces:1,expectedAccounts:0,workspaces:[{workspaceId:emptyShop,accounts:[]}]};
    assert.equal((await runRefreshQueueCheck({store,loadInventory:async()=>empty})).status,"checked");
    assert.equal((await store.readQueueCheck()).accounts.length,0,"complete retirement invalidates old metadata");
    for(const role of ["anon","authenticated","service_role","adstable_runtime"]) {
      for(const table of ["refresh_queue_control","refresh_queue_accounts"])
        assert.equal((await client.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as allowed",[role,`operations.${table}`])).rows[0].allowed,false);
      for(const fn of ["operations.read_refresh_queue_check()","operations.commit_refresh_queue_check(bigint,jsonb)"])
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,fn])).rows[0].allowed,false);
    }
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.commit_refresh_queue_check(bigint,jsonb)','EXECUTE') as allowed")).rows[0].allowed,true);
    console.log("EO05_REFRESH_QUEUE_PASS complete_inventory=true atomic_heartbeat=true duplicate_wakeup_safe=true missed_hours_coalesced=true account_wait_age_preserved=true stale_connection_denied=true no_provider_or_Dataset=true synthetic_only=true live_changes=false");
  } finally {
    try {
      await client.query("delete from app.workspaces where id=any($1::uuid[])",[[workspace,emptyShop]]);
      await client.query("update operations.refresh_queue_control set revision=0,max_workspaces=null,max_accounts=null,max_snapshot_bytes=null,max_snapshot_age_ms=null,activated_at_ms=null,last_success_at_ms=null,last_observed_at_ms=null,checked_workspaces=null,checked_accounts=null where singleton");
      await client.query("reset role");
    } finally {await other.end();}
  }
}
