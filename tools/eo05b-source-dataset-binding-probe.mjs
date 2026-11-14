import assert from "node:assert/strict";
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
  if (!options.claim) await client.query(`insert into operations.refresh_work_bindings(workspace_id,install_generation,provider,account_id,job_id,fence,source,from_date,to_date,partition_id)
    values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8,'synthetic-only')`,
  [owner.workspaceId, owner.generation, owner.provider, owner.accountId, fixture.jobId, fixture.fence, JSON.stringify(fixture.source), fixture.businessDate]);
  return {...fixture, database: client};
}

/** Called only inside the existing F01 localhost rollback transaction. Native
 * HTTP bodies and admission metadata below are SYNTHETIC, not live acceptance. */
export async function sourceDatasetBindingProbe(client, {ownerFixture}) {
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
