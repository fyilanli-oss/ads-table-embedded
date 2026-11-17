import assert from "node:assert/strict";
import pg from "pg";
import {setTimeout as delay} from "node:timers/promises";
import {datasetSourceBindingFixture} from "../tests/fixtures/dataset-source-binding-fixture.js";
import {createSourceEvidenceRepository} from "../app/lib/database/source-evidence-store.server.js";
import {bindStoredDatasetSources} from "../app/lib/database/dataset-source-binding.server.js";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {projectStoredGoogleDataset} from "../app/lib/providers/stored-dataset-projection.server.js";
import {prepareDatasetWrite, createDatasetStorageRepository} from "../app/lib/database/dataset-storage.server.js";
import {resolveReportRetentionPolicy} from "../app/lib/database/report-retention-policy.server.js";

export async function storedBindingFixture(client, owner, options = {}) {
  const fixture = await datasetSourceBindingFixture(owner.provider, {owner, ...options});
  for (const envelope of fixture.envelopes.values()) {
    const receipt = await createSourceEvidenceRepository(client).commit(envelope.sourceWrite);
    const metadata = Object.fromEntries(Object.entries(envelope.receipt.manifest).filter(([key]) => key !== "counts"));
    // Synthetic admission only, never native HTTP acceptance.
    await client.query("update evidence.source_batches set manifest=manifest || $2::jsonb where id=$1", [receipt.batchId, JSON.stringify(metadata)]);
  }
  await client.query(`insert into operations.refresh_work_bindings(workspace_id,install_generation,provider,account_id,job_id,fence,source,from_date,to_date,partition_id)
    values($1,$2,$3,$4,'synthetic-binding-job',1,$5::jsonb,'2026-11-01','2026-11-01','synthetic-only')`,
  [owner.workspaceId, owner.generation, owner.provider, owner.accountId, JSON.stringify(fixture.source)]);
  return {...fixture, database: client};
}

/** Called only inside the existing F01 localhost rollback transaction. Native
 * HTTP bodies and admission metadata below are SYNTHETIC, not live acceptance. */
async function klaviyoControlLockProbe(client, {ownerFixture, connection, reuseSourceProof}) {
  const observer = new pg.Client(connection);
  await observer.connect();
  let observerWait, validatedProofs;
  const onNotice = ({message}) => {
    const prefix = "EO05_KLAVIYO_TEST_SQL ";
    if (message.startsWith(prefix)) validatedProofs = Number(message.slice(prefix.length));
  };
  await client.query("savepoint klaviyo_control_lock");
  try {
    await observer.query("set statement_timeout = '25s'");
    await observer.query("set role adstable_owner");
    const {rows: [{pid}]} = await observer.query("select pg_backend_pid() as pid");
    const owner = await ownerFixture(client, "klaviyo");
    const input = await storedBindingFixture(client, owner, {klaviyoProductEvents: 200});
    await observer.query("select 1 from operations.refresh_control where singleton for update nowait");
    const readDefinition = async () => (await client.query(
      "select pg_get_functiondef('analytics.commit_dataset_storage(jsonb,jsonb)'::regprocedure) as definition",
    )).rows[0].definition;
    const definition = await readDefinition();
    let instrumented = definition;
    const instrument = (anchor, replacement) => {
      assert.equal(instrumented.split(anchor).length, 2, "SQL timing anchor must be unique");
      instrumented = instrumented.replace(anchor, replacement);
    };
    if (reuseSourceProof) {
      instrument("begin\n perform 1 from operations.refresh_control", `test_proof jsonb; test_verified_proofs jsonb:='[]';
begin
 perform 1 from operations.refresh_control`);
      const context = "perform analytics.assert_report_source_context(o,r->'provenance'->'source_context',(p->'policy'->>'until')::timestamptz,r->'provenance'->'sources');";
      instrument(context, `test_proof:=jsonb_build_array(r->'provenance'->'source_context', r->'provenance'->'sources');
   if not exists (select 1 from jsonb_array_elements(test_verified_proofs) as proof(value) where proof.value = test_proof) then
    ${context}
    test_verified_proofs:=test_verified_proofs || jsonb_build_array(test_proof);
   end if;`);
      instrument(" return result;", ` raise notice 'EO05_KLAVIYO_TEST_SQL %', jsonb_array_length(test_verified_proofs);
 return result;`);
      await client.query(instrumented);
      client.on("notice", onNotice);
    }
    let databaseMs = 0, writeMs = 0, readbackMs = 0, writes = 0, readbacks = 0, payloadBytes = 0;
    const database = {async query(sql, args) {
      const startedAt = performance.now();
      const writing = sql.includes("analytics.commit_dataset_storage(");
      if (writing) observerWait = delay(100).then(async () => {
        const started = performance.now();
        await observer.query("select 1 from operations.refresh_control where singleton for update");
        return {ms: performance.now() - started};
      }).catch(error => ({error}));
      try {return await client.query(sql, args);}
      finally {
        const elapsed = performance.now() - startedAt;
        databaseMs += elapsed;
        if (writing) {
          writes++;
          writeMs += elapsed;
          payloadBytes = Buffer.byteLength(args[1]);
        }
        if (sql.includes("analytics.inspect_dataset_storage(")) {
          readbacks++;
          readbackMs += elapsed;
        }
      }
    }};
    const startedAt = performance.now();
    const result = await bindStoredDatasetSources({...input, database});
    const totalMs = performance.now() - startedAt;
    const {rows: [{count, facts, proofs}]} = await client.query(`
      select count(*)::int as count,
        jsonb_agg(jsonb_build_array(provider_event_id, native_sold_product_id, sales_quantity, sales_value, sales_role)
          order by provider_event_id) as facts,
        count(distinct jsonb_build_array(provenance->'source_context', provenance->'sources'))::int as proofs
      from analytics.cpd_product_sales_facts where installation_id=$1`, [owner.installationId]);
    assert.equal(result.status, "stored");
    assert.equal(result.rowsStored, 200);
    assert.equal(result.storageReceipt.rows.length, 200);
    assert.deepEqual({count, writes, readbacks}, {count: 200, writes: 1, readbacks: 1});
    assert.equal(proofs, 5);
    if (reuseSourceProof) assert.equal(validatedProofs, proofs);
    const {rows: [{blocked}]} = await client.query("select pg_backend_pid() = any(pg_blocking_pids($1)) as blocked", [pid]);
    assert.equal(blocked, true, "the write transaction must block the second connection");
    await client.query("rollback to savepoint klaviyo_control_lock");
    const wait = await observerWait;
    if (wait.error) throw wait.error;
    assert.equal(await readDefinition(), definition);
    const timing = {
      rows: count, payloadBytes, writes, readbacks, writeMs, readbackMs, databaseMs, adsTableMs: totalMs - databaseMs, totalMs,
      competingLockWaitMs: wait.ms, sourceVerifications: reuseSourceProof ? validatedProofs : count,
    };
    return {facts, timing};
  } finally {
    client.off("notice", onNotice);
    try {
      await client.query("rollback to savepoint klaviyo_control_lock");
      await client.query("release savepoint klaviyo_control_lock");
    } finally {
      await observerWait;
      await observer.end();
    }
  }
}

export async function sourceDatasetBindingProbe(client, {ownerFixture, connection}) {
  const baseline = await klaviyoControlLockProbe(client, {ownerFixture, connection, reuseSourceProof: false});
  const candidate = await klaviyoControlLockProbe(client, {ownerFixture, connection, reuseSourceProof: true});
  assert.deepEqual(candidate.facts, baseline.facts);
  console.log("EO05_KLAVIYO_200_SOURCE_VALIDATION_COMPARISON_PASS " + JSON.stringify({
    baseline: baseline.timing, candidate: candidate.timing, matchingFacts: true,
  }));
  const raw = client;
  client = {async query(sql, args) {try {return await raw.query(sql, args);} catch (error) {
    console.error("EO05B_BINDING_SQL_DIAGNOSTIC", JSON.stringify({code: error.code, message: error.message, where: error.where, position: error.position})); throw error;
  }}};
  for (const provider of ["google_ads", "meta", "klaviyo"]) {
    const owner = await ownerFixture(client, provider), input = await storedBindingFixture(client, owner, {mixedMetrics: provider === "klaviyo"}), fixture = input;
    const before = (await client.query("select id::text,request_digest,commit_id from evidence.source_batches where installation_id=$1 order by id", [owner.installationId])).rows;
    if (provider === "google_ads") {
      const observed = await readStoredDatasetSources(input), invalid = structuredClone(projectStoredGoogleDataset(observed));
      invalid.rows.at(-1).row.provenance.sources[0].payload_hash = "f".repeat(64);
      const write = prepareDatasetWrite({owner, rows: invalid.rows, policy: fixture.policy, now: new Date().toISOString()});
      await client.query("savepoint retention_atomic_failure");
      await assert.rejects(createDatasetStorageRepository(client).commit(write), /WRITE_UNCONFIRMED/);
      await client.query("rollback to savepoint retention_atomic_failure"); await client.query("release savepoint retention_atomic_failure");
      assert.equal((await client.query("select count(*)::int n from evidence.source_batches where installation_id=$1 and manifest ? 'reportRetention'", [owner.installationId])).rows[0].n, 0, "later invalid proof rolls back earlier source promotion");
      assert.equal((await client.query("select count(*)::int n from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0].n, 0);
    }
    const result = await bindStoredDatasetSources(input);
    assert.equal(result.rowsStored, provider === "google_ads" ? 3 : 2);
    assert.equal(result.consumerReceipt, false); assert.equal(result.publishable, false);
    const until = resolveReportRetentionPolicy({businessDate: "2026-11-01", timeZone: "UTC"}).until;
    const linked = (await client.query("select retain_until,retention_policy_version from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows;
    assert.ok(linked.every(r => r.retain_until.toISOString() === until && r.retention_policy_version === "report-source-3y-v1"));
    assert.deepEqual((await client.query("select id::text,request_digest,commit_id from evidence.source_batches where installation_id=$1 order by id", [owner.installationId])).rows, before);
    assert.equal((await client.query("select count(*)::int n from evidence.source_pages where installation_id=$1 and retain_until < $2::timestamptz", [owner.installationId, until])).rows[0].n, 0);
    // Extended TTL must not alter AEAD payloads or frozen native context.
    await readStoredDatasetSources(input);
    const pd = (await client.query("select impression::text,spend_value::text,source_currency,source_timezone,provenance from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows;
    assert.equal(pd.length, 1); assert.equal(pd[0].impression, "9007199254740993");
    assert.equal(pd[0].source_currency, "USD"); assert.equal(pd[0].source_timezone, "UTC");
    assert.equal(pd[0].provenance.source_context.snapshot.accountId, owner.accountId);
    if (provider === "google_ads") assert.equal(pd[0].spend_value, "1.234567");
    if (provider === "klaviyo") assert.equal(pd[0].spend_value, null);
    assert.equal((await client.query("select count(*)::int n from evidence.source_batches where installation_id=$1 and handoff_state<>'pending'", [owner.installationId])).rows[0].n, 0);
    if (provider === "google_ads") {
      const source = await readStoredDatasetSources(input), projection = projectStoredGoogleDataset(source);
      // Reader success cannot replace SQL checking the original admission at save.
      projection.rows[0].row.entity_id = "context-changed-ad";
      projection.rows[0].row.source_identity.native.entity_id = "context-changed-ad";
      const write = prepareDatasetWrite({owner, rows: projection.rows, policy: fixture.policy, now: new Date().toISOString()});
      await client.query("savepoint binding_changed_context");
      await client.query("update operations.refresh_work_bindings set source=jsonb_set(source,'{currency}','\"EUR\"'::jsonb) where workspace_id=$1", [owner.workspaceId]);
      await assert.rejects(createDatasetStorageRepository(client).commit(write), /WRITE_UNCONFIRMED/);
      await client.query("rollback to savepoint binding_changed_context"); await client.query("release savepoint binding_changed_context");
      // Known success is inspected. Lost acknowledgement is deliberately not
      // retried or inspected by bindStoredDatasetSources.
      let afterWrite = false, readsAfterLoss = 0;
      const lost = {async query(sql, args) {
        if (afterWrite) readsAfterLoss++;
        const reply = await client.query(sql, args);
        if (sql.includes("commit_dataset_storage")) {afterWrite = true; throw Error("synthetic_ack_lost");}
        return reply;
      }};
      await assert.rejects(bindStoredDatasetSources({...input, database: lost}), /WRITE_UNCONFIRMED/);
      assert.equal(readsAfterLoss, 0);
      assert.equal((await client.query("select count(*)::int n from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0].n, 1);
    }
    // Real three-year facts cannot block a verified installation erase.
    await client.query("select evidence.delete_installation_sources($1::bigint)", [owner.installationId]);
    for (const table of ["pd_facts", "cpd_product_performance_facts", "cpd_product_sales_facts"])
      assert.equal((await client.query(`select count(*)::int n from analytics.${table} where installation_id=$1`, [owner.installationId])).rows[0].n, 0);
    assert.equal((await client.query("select count(*)::int n from evidence.source_batches where installation_id=$1", [owner.installationId])).rows[0].n, 0);
  }
  console.log("EO05B_SOURCE_DATASET_BINDING_PASS synthetic_only=true native_acceptance=false consumer_receipt=false live_mutation=false");
}
