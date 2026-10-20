import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {runScheduledRefreshCheck} from "../app/lib/refresh/scheduled-queue-check.server.js";

// Only called by the existing ephemeral CI fixture, with owner-owned synthetic metadata.
export async function refreshScheduledQueueProbe(client,other) {
  const generation=randomUUID(),store=createRefreshWorkRepository(client),second=createRefreshWorkRepository(other);
  const control=async()=> (await client.query("select row_to_json(t) as value from operations.refresh_tick_control t where singleton")).rows[0].value;
  const queue=async()=>JSON.stringify(await store.readQueueCheck());
  try {
    assert.equal((await runScheduledRefreshCheck({store,generation})).status,"not_configured");
    await client.query("update operations.refresh_tick_control set enabled=true,generation=$1 where singleton",[generation]);
    const baseline=await queue();
    assert.equal((await runScheduledRefreshCheck({store,generation:randomUUID()})).status,"not_current_generation");
    assert.equal(await queue(),baseline);
    const beforeMinute=Number((await client.query("select floor(extract(epoch from clock_timestamp())/60) as minute")).rows[0].minute);
    const raced=await Promise.all([runScheduledRefreshCheck({store,generation}),runScheduledRefreshCheck({store:second,generation})]);
    const afterMinute=Number((await client.query("select floor(extract(epoch from clock_timestamp())/60) as minute")).rows[0].minute);
    const checks=raced.filter(r=>r.status==="queue_checked");
    assert.ok(checks.length>=1);assert.ok(raced.every(r=>["queue_checked","duplicate"].includes(r.status)));
    // A real wall-clock minute boundary is a legitimate second arrival bucket, not a flaky failure.
    if(beforeMinute===afterMinute) assert.equal(checks.length,1);
    for(const r of checks) assert.equal(r.work.status,"work_policy_required");
    const saved=await control();assert.equal(Number(saved.sequence),checks.length);
    const firstQueue=JSON.parse(await queue()),age=firstQueue.accounts.map(a=>[a.accountId,a.firstQueuedAtMs]);
    // Deterministic replay in the same SQL statement's minute; coordinator cannot set this fixture.
    await client.query("begin");
    await client.query("update operations.refresh_tick_control set last_minute=floor(extract(epoch from clock_timestamp())/60),last_checked_at_ms=0 where singleton");
    const duplicateBefore=await queue();
    assert.equal((await runScheduledRefreshCheck({store,generation})).status,"duplicate");
    assert.equal(await queue(),duplicateBefore);assert.equal((await control()).sequence,saved.sequence);
    await client.query("rollback");
    // Simulate missed arrivals by aging only the owner fixture receipt, not the database clock.
    await client.query("update operations.refresh_tick_control set last_minute=last_minute-10 where singleton");
    const resumed=await runScheduledRefreshCheck({store,generation});assert.equal(resumed.status,"queue_checked");
    assert.equal(resumed.queue.sequence,checks.length+1);
    assert.deepEqual(JSON.parse(await queue()).accounts.map(a=>[a.accountId,a.firstQueuedAtMs]),age,"pending age is not reset by a missed wakeup");
    await client.query("begin");
    await client.query("update operations.refresh_tick_control set last_minute=last_minute-1 where singleton");
    await client.query("update operations.refresh_queue_control set max_workspaces=1 where singleton");
    const tickBefore=await control(),queueBefore=await queue();
    // A SQL error rolls the entire function back; use a savepoint to inspect in the owner fixture.
    await client.query("savepoint failing_scan");
    assert.equal((await runScheduledRefreshCheck({store,generation})).status,"needs_attention");
    await client.query("rollback to savepoint failing_scan");
    assert.deepEqual(await control(),tickBefore);assert.equal(await queue(),queueBefore);
    await client.query("rollback");
    for(const field of ["last_checked_at_ms","last_minute"]) {
      await client.query("begin");
      await client.query(`update operations.refresh_tick_control set ${field}=9007199254740000 where singleton`);
      const before=await queue();assert.equal((await runScheduledRefreshCheck({store,generation})).status,"clock_invalid");
      assert.equal(await queue(),before);await client.query("rollback");
    }
    await client.query("begin");
    await client.query("update operations.refresh_tick_control set last_minute=last_minute-1,sequence=9007199254740991 where singleton");
    const overflowBefore=await queue();await client.query("savepoint overflow");
    assert.equal((await runScheduledRefreshCheck({store,generation})).status,"needs_attention");
    await client.query("rollback to savepoint overflow");assert.equal(await queue(),overflowBefore);await client.query("rollback");
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"]) {
      assert.equal((await client.query("select has_table_privilege($1,'operations.refresh_tick_control','SELECT,INSERT,UPDATE,DELETE') as allowed",[role])).rows[0].allowed,false);
      assert.equal((await client.query("select has_function_privilege($1,'operations.check_refresh_queue_on_tick(uuid)','EXECUTE') as allowed",[role])).rows[0].allowed,role==="adstable_refresh_coordinator");
    }
    assert.equal((await client.query("select relrowsecurity and relforcerowsecurity as secured from pg_class where oid='operations.refresh_tick_control'::regclass")).rows[0].secured,true);
    console.log("EO05_SCHEDULED_QUEUE_PASS native_inventory=true concurrent_arrivals=true duplicate_no_heartbeat=true missed_tick_coalesced=true atomic_failure=true clock_guard=true owner_only=true work_policy_required=true provider_calls=0 live_changes=false");
  } finally {
    await client.query("rollback");
    await client.query("update operations.refresh_tick_control set enabled=false,generation=null,sequence=0,last_minute=null,last_checked_at_ms=null,queue_revision=null where singleton");
  }
}
