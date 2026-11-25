import assert from "node:assert/strict";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {reconcileStoredDatasetSources, DATASET_RECONCILE_READ_SQL} from "../app/lib/database/dataset-reconciliation.server.js";
import {META_PACKAGED_REPORT_SQL} from "../app/lib/database/dataset-rpc.server.js";

export async function metaPackagedCorrectionProbe(client, {ownerFixture}) {
  assert.equal(client.connectionParameters.host, "127.0.0.1");
  assert.equal(Number(client.connectionParameters.port), 54322);
  await client.query("savepoint meta_packaged_correction");
  try {
    await client.query("set local role postgres");
    await client.query("grant adstable_refresh_dataset_runner to adstable_owner with inherit false,set true,admin false");
    await client.query("set local role adstable_owner");
    const day = "2026-11-01", owner = await ownerFixture(client, "meta"), ownerJson = JSON.stringify(owner);
    await client.query("update integrations.provider_connections set connected_at='2026-10-31' where id=$1", [owner.connectionId]);
    await client.query("update integrations.reporting_account_bindings set effective_from='2026-10-31' where connection_id=$1", [owner.connectionId]);
    const facts = async () => (await client.query(`
      select 'pd_facts' as table_name,id::text,payload_digest,revision from analytics.pd_facts where installation_id=$1 and platform='meta'
      union all
      select 'cpd_product_performance_facts',id::text,payload_digest,revision from analytics.cpd_product_performance_facts where installation_id=$1 and platform='meta'
      order by table_name,id`, [owner.installationId])).rows;
    const inspect = async operation => (await client.query(DATASET_RECONCILE_READ_SQL, [ownerJson,operation])).rows[0].result;
    const rpc = async (sql, args) => {
      await client.query("set local role adstable_refresh_dataset_runner");
      const result = await client.query(sql, args);
      await client.query("set local role adstable_owner");
      return result;
    };
    const assertClosed = async job => {
      assert.equal((await client.query("select status from operations.refresh_runs where workspace_id=$1 and job_id=$2",
        [owner.workspaceId, job])).rows[0].status, "completed");
    };
    async function publish(expectedRevision, impressions, checkMissingPackages) {
      const job = "synthetic-meta-publication-"+expectedRevision;
      const input = await storedBindingFixture(client,owner,{jobId:job,metaPackedImpressions:impressions});
      const deadlineAt = Date.now()+120000, observedAt = new Date().toISOString();
      const fence = (await client.query("select (coalesce(max(fence),0)+1)::text as n from operations.refresh_runs")).rows[0].n;
      const scope = [owner.workspaceId,owner.generation,owner.provider,owner.accountId,job,fence];
      await client.query(`update operations.refresh_work_bindings set fence=$6,deadline_at_ms=$7,source=operations.refresh_preflight_source($1,$2,$3,$4)
        where workspace_id=$1 and install_generation=$2 and provider=$3 and account_id=$4 and job_id=$5`, [...scope,deadlineAt]);
      for (const {attemptId} of input.batches) await client.query(`
        update evidence.source_batches set manifest=jsonb_set(jsonb_set(jsonb_set(manifest,
        '{metaDatasetRead,fence}',to_jsonb($3::text)),'{metaDatasetRead,observedAt}',to_jsonb($4::text)),'{metaDatasetRead,completedAt}',to_jsonb($4::text))
        where authority=$1::jsonb and attempt_id=$2`, [ownerJson,attemptId,fence,observedAt]);
      await client.query(`insert into operations.refresh_runs(workspace_id,install_generation,provider,account_id,job_id,fence,cost,status)
        values($1,$2,$3,$4,$5,$6,'{"requests":12,"rows":1000,"bytes":4000000,"connections":1,"dbWrites":20}'::jsonb,'running')`, scope);
      await client.query(`insert into operations.refresh_work_progress(workspace_id,install_generation,provider,account_id,job_id,fence,stage,from_date,to_date)
        values($1,$2,$3,$4,$5,$6,'ready_for_dataset',$7,$7)`, [...scope,day]);
      const database = {async query(sql,args) {
        if (sql===META_PACKAGED_REPORT_SQL && checkMissingPackages) await checkMissingPackages(args);
        try {return await rpc(sql,args);} catch(error) {
          console.error("EO06D_META_SQL", JSON.stringify({message:error.message,code:error.code,where:error.where}));
          throw error;
        }
      }};
      const result = await reconcileStoredDatasetSources({...input,database,limits:{...input.limits,deadlineAt,maxBytes:4000000},
        expectedRevision,scheduled:true,admittedScope:{jobId:job,fence,from:day,to:day}});
      assert.equal(result.revision,expectedRevision+1);
      assert.equal(result.rowCount,1000);
      assert.deepEqual(result.packages.map(pack=>pack.rowCount),[200,200,200,200,200]);
      assert.equal(result.jobCompleted,true);
      await assertClosed(job);
      return result;
    }
    const first = await publish(0,"42");
    const {rows:[scheduled]} = await client.query(`select r.business_date::text as day,r.first_digest,
      r.due_at=w.finished_at+interval '7 days' as on_time,r.admitted_at
      from operations.refresh_historical_rereads r join operations.refresh_runs w
        on w.workspace_id=r.workspace_id and w.install_generation=r.install_generation and w.provider=r.provider
        and w.account_id=r.account_id and w.job_id=r.first_job_id and w.fence=r.first_fence
      where r.workspace_id=$1 and r.provider='meta'`,[owner.workspaceId]);
    assert.deepEqual(scheduled,{day,first_digest:first.digest,on_time:true,admitted_at:null});
    const before = await facts();
    assert.equal(before.length,1000);
    const saved = await inspect(first.operationId);
    const second = await publish(1,"43",async args => {
      const packages = JSON.parse(args[1]), truncated = structuredClone(packages);
      truncated[4].rows.pop();
      for (const [invalid,reason] of [[packages.slice(0,4),/META_REPORT_PACKAGE_COUNT/],[truncated,/META_REPORT_PACKAGE_INVALID/]]) {
        await client.query("savepoint meta_correction_missing_package");
        try {
          await assert.rejects(rpc(META_PACKAGED_REPORT_SQL,[args[0],JSON.stringify(invalid),...args.slice(2)]),reason);
        } finally {
          await client.query("rollback to savepoint meta_correction_missing_package");
          await client.query("release savepoint meta_correction_missing_package");
        }
        assert.deepEqual(await inspect(first.operationId),saved);
        assert.deepEqual(await facts(),before);
        const {rows:[state]} = await client.query(`select count(*) filter(where handoff_state='pending')::int as pending,
          count(*) filter(where manifest ? 'datasetReconciliation')::int as receipts
          from evidence.source_batches where authority=$1::jsonb and id in
            (select value::bigint from jsonb_array_elements_text($2::jsonb->'batchIds'))`, [ownerJson,args[2]]);
        assert.deepEqual(state,{pending:2,receipts:0});
      }
    });
    const after = await facts();
    assert.deepEqual(after.map(row=>row.id),before.map(row=>row.id));
    assert.ok(after.every((row,i)=>row.payload_digest!==before[i].payload_digest && Number(row.revision)===Number(before[i].revision)+1));
    assert.equal(second.replaced,1000);
    assert.equal((await inspect(first.operationId)).status,"superseded");
    assert.equal((await inspect(second.operationId)).digest,second.digest);
    const {rows:[queue]} = await client.query(`select count(*)::int as entries from operations.refresh_historical_rereads
      where workspace_id=$1 and provider='meta' and business_date=$2`,[owner.workspaceId,day]);
    assert.equal(queue.entries,1);
    const {rows:[state]}=await client.query(`select count(*) filter(where manifest ? 'datasetReconciliation')::int as receipts,
      count(*) filter(where manifest ? 'metaDailyRevisionPermits')::int as permits
      from evidence.source_batches where authority=$1::jsonb`,[ownerJson]);
    assert.deepEqual(state,{receipts:2,permits:0});
    return {rows:1000,packages:5,incompletePreservedPrevious:true,revised:1000,closed:true};
  } finally {
    await client.query("rollback to savepoint meta_packaged_correction");
    await client.query("release savepoint meta_packaged_correction");
  }
}
