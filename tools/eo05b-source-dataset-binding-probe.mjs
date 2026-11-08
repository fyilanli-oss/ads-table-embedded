import assert from "node:assert/strict";
import {datasetSourceBindingFixture} from "../tests/fixtures/dataset-source-binding-fixture.js";
import {createSourceEvidenceRepository} from "../app/lib/database/source-evidence-store.server.js";
import {bindStoredDatasetSources} from "../app/lib/database/dataset-source-binding.server.js";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {projectStoredGoogleDataset} from "../app/lib/providers/stored-dataset-projection.server.js";
import {prepareDatasetWrite, createDatasetStorageRepository} from "../app/lib/database/dataset-storage.server.js";

/** Called only inside the existing F01 localhost rollback transaction. Native
 * HTTP bodies and admission metadata below are SYNTHETIC, not live acceptance. */
export async function sourceDatasetBindingProbe(client, {ownerFixture}) {
  for (const provider of ["google_ads", "meta", "klaviyo"]) {
    const owner = await ownerFixture(client, provider), fixture = await datasetSourceBindingFixture(provider, {owner, mixedMetrics: provider === "klaviyo"});
    const repository = createSourceEvidenceRepository(client);
    for (const envelope of fixture.envelopes.values()) {
      const receipt = await repository.commit(envelope.sourceWrite);
      const metadata = Object.fromEntries(Object.entries(envelope.receipt.manifest).filter(([key]) => key !== "counts"));
      // Fixture setup only: production metadata is written by the existing
      // native dataset admission RPC, never by this private reader/binder.
      await client.query("update evidence.source_batches set manifest=manifest || $2::jsonb where id=$1", [receipt.batchId, JSON.stringify(metadata)]);
    }
    await client.query(`insert into operations.refresh_work_bindings(workspace_id,install_generation,provider,account_id,job_id,fence,source,from_date,to_date,partition_id)
      values($1,$2,$3,$4,'synthetic-binding-job',1,$5::jsonb,'2026-11-01','2026-11-01','synthetic-only')`,
    [owner.workspaceId, owner.generation, provider, owner.accountId, JSON.stringify(fixture.source)]);
    const input = {...fixture, database: client};
    const result = await bindStoredDatasetSources(input);
    assert.equal(result.rowsStored, provider === "google_ads" ? 3 : 2);
    assert.equal(result.consumerReceipt, false); assert.equal(result.publishable, false);
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
  }
  console.log("EO05B_SOURCE_DATASET_BINDING_PASS synthetic_only=true native_acceptance=false consumer_receipt=false live_mutation=false");
}
