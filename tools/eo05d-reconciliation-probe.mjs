import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {storedBindingFixture} from "./eo05b-source-dataset-binding-probe.mjs";
import {datasetServerProbe} from "./eo05b-dataset-server-probe.mjs";
import {reconcileStoredDatasetSources, inspectDatasetReconciliation, DATASET_RECONCILE_SQL} from "../app/lib/database/dataset-reconciliation.server.js";
import {storeMaturityConfiguration, recordMaturityDecision, inspectMaturityDecision} from "../app/lib/database/maturity-store.server.js";
import {maturityObservationFixture} from "../tests/fixtures/maturity-fixture.js";

async function rejected(client, action) {
  await client.query("savepoint reconciliation_expected_failure"); let error;
  try {await action();} catch (e) {error = e;}
  await client.query("rollback to savepoint reconciliation_expected_failure");await client.query("release savepoint reconciliation_expected_failure");
  assert.ok(error, "invalid reconciliation must fail");
}

/** Existing F01 rollback transaction. Owners, native pages, clocks and keys below
 * are explicitly synthetic; SQL, AEAD, physical facts/CAS/ACL are actual. */
export async function reconciliationProbe(client, {ownerFixture}) {
  assert.equal(process.env.GITHUB_ACTIONS, "true"); let scenarios = 0;
  const database = {async query(sql, args) {try {return await client.query(sql, args);} catch (e) {
    if (/dataset_reconciliation/.test(sql)) console.error("EO05D_SQL_DIAGNOSTIC", JSON.stringify({code: e.code, message: e.message, where: e.where}));throw e;
  }}};
  async function source(owner, options = {}, stale = false) {
    // A second synthetic read reuses the SAME immutable admitted day context.
    const adapter = {query(sql, args) {return client.query(sql.startsWith("insert into operations.refresh_work_bindings") ? sql + " on conflict do nothing" : sql, args);}};
    const f = await storedBindingFixture(adapter, owner, options), key = owner.provider === "google_ads" ? "googleDatasetRead" : owner.provider === "meta" ? "metaDatasetRead" : "klaviyoDatasetRead";
    const stamp = new Date(Date.now() - (stale ? 60000 : 1000)).toISOString();
    for (const b of f.batches) await client.query("update evidence.source_batches set manifest=jsonb_set(jsonb_set(manifest,$3::text[],to_jsonb($4::text)),$5::text[],to_jsonb($4::text)) where authority=$1::jsonb and attempt_id=$2::uuid",
      [JSON.stringify(owner), b.attemptId, [key, "observedAt"], stamp, [key, "completedAt"]]);
    return {...f, database, expectedRevision: 0, limits: {...f.limits, deadlineAt: Date.now() + 60000}};
  }
  for (const provider of ["google_ads", "meta", "klaviyo"]) {
    const owner = await ownerFixture(client, provider), nonempty = provider !== "meta";
    const first = await source(owner, {nonempty, googlePurchase: "3"});
    const initial = await reconcileStoredDatasetSources(first);
    assert.equal(initial.revision, 1);assert.equal(initial.consumerReceipt, true);scenarios++;
    assert.equal((await client.query("select count(*)::int n from evidence.source_batches where authority=$1::jsonb and handoff_state='consumed'", [JSON.stringify(owner)])).rows[0].n, first.batches.length);
    await rejected(client, () => reconcileStoredDatasetSources(first));scenarios++;
    const rowBefore = (await client.query("select id,purchase::text from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0];
    if (provider === "google_ads") assert.equal(rowBefore.purchase, "3");
    if (provider === "google_ads") {
      const observation = maturityObservationFixture(provider, {owner, clickDays: "0"});
      const cfg = await storeMaturityConfiguration({database, cipher: first.cipher, owner, observation: await observation.read(),
        policy: first.envelopes.values().next().value.sourceWrite.body.policy,
        limits: {maxBytes: 1000000, maxRows: 1000, maxObservationAgeMs: 60000, deadlineAt: Date.now() + 60000}});
      const maturity = await recordMaturityDecision({...first, configurationAttemptId: cfg.attemptId, anchorAttemptId: first.batches[0].attemptId,
        reportOperationId: initial.operationId, expectedRevision: 0});
      assert.equal(maturity.state, "final");assert.equal(maturity.reportVerified, true);scenarios++;
    }
    const second = await source(owner, {nonempty, googlePurchase: "5"});
    await rejected(client, () => reconcileStoredDatasetSources(second));scenarios++;
    const corrected = await reconcileStoredDatasetSources({...second, expectedRevision: 1});
    assert.equal(corrected.revision, 2);assert.equal(corrected.comparison, "matched");scenarios++;
    const rowAfter = (await client.query("select id,purchase::text from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0];
    if (provider === "google_ads") {assert.equal(rowAfter.purchase, "5");assert.equal(rowAfter.id, rowBefore.id);}
    const old = await inspectDatasetReconciliation({database, owner, operationId: initial.operationId});
    assert.equal(old.status, "superseded");assert.equal(old.checkpointAdvanced, false);scenarios++;
    if (provider === "google_ads") {
      const previousFinal = await inspectMaturityDecision({database, owner, anchorAttemptId: first.batches[0].attemptId});
      assert.equal(previousFinal.state, "provisional");assert.equal(previousFinal.reason, "report_receipt_unavailable");scenarios++;
    }
    const stale = await source(owner, {nonempty}, true);
    await rejected(client, () => reconcileStoredDatasetSources({...stale, expectedRevision: 2}));scenarios++;
    const empty = await source(owner, {nonempty: false});
    const zero = await reconcileStoredDatasetSources({...empty, expectedRevision: 2});
    assert.equal(zero.rowCount, 0);assert.equal(zero.revision, 3);scenarios++;
    for (const t of ["pd_facts", "cpd_product_performance_facts", "cpd_product_sales_facts"]) assert.equal((await client.query("select count(*)::int n from analytics." + t + " where installation_id=$1", [owner.installationId])).rows[0].n, 0);
    // Native source bytes remain available even when the canonical day's rows disappear.
    assert.ok((await client.query("select count(*)::int n from evidence.source_pages where installation_id=$1 and ciphertext is not null", [owner.installationId])).rows[0].n > 0);
    const next = await source(owner, {nonempty: false});let lost = false, after = 0;
    const unknown = {async query(sql, args) {if (lost) after++; const r = await database.query(sql, args);if (sql === DATASET_RECONCILE_SQL) {lost = true;throw Error("SYNTHETIC_LOST_ACK");}return r;}};
    await assert.rejects(reconcileStoredDatasetSources({...next, expectedRevision: 3, database: unknown}), /WRITE_UNCONFIRMED/);
    assert.equal(after, 0);scenarios++;
    await rejected(client, () => inspectDatasetReconciliation({database, owner: {...owner, generation: "999"}, operationId: zero.operationId}));scenarios++;
  }
  // Deliberate corruption AFTER the normal validator proves that readback uses
  // physical values, and that facts/consumption/head rollback before mismatch audit.
  const owner = await ownerFixture(client, "google_ads"), first = await source(owner, {googlePurchase: "3"});
  await reconcileStoredDatasetSources(first);
  const changed = await source(owner, {googlePurchase: "5"});
  await client.query(`create function analytics.synthetic_reconciliation_corrupt() returns trigger language plpgsql set search_path='' as $f$ begin
    if pg_trigger_depth()=1 and new.workspace_id='${owner.workspaceId}'::uuid then update analytics.pd_facts set purchase=purchase+1 where id=new.id;end if;return new;end $f$;
    create trigger synthetic_reconciliation_corrupt after insert or update on analytics.pd_facts for each row execute function analytics.synthetic_reconciliation_corrupt()`);
  const mismatch = await reconcileStoredDatasetSources({...changed, expectedRevision: 1});
  assert.equal(mismatch.status, "mismatch");assert.equal(mismatch.checkpointAdvanced, false);scenarios++;
  await client.query("drop trigger synthetic_reconciliation_corrupt on analytics.pd_facts; drop function analytics.synthetic_reconciliation_corrupt()");
  assert.equal((await client.query("select purchase::text from analytics.pd_facts where installation_id=$1", [owner.installationId])).rows[0].purchase, "3");
  assert.equal((await client.query("select count(*)::int n from evidence.source_batches where authority=$1::jsonb and handoff_state='pending' and manifest ? 'datasetReconciliationMismatch'", [JSON.stringify(owner)])).rows[0].n, 1);
  for (const role of ["anon", "authenticated", "service_role", "adstable_runtime", "adstable_refresh_coordinator"]) {
    assert.equal((await client.query("select has_function_privilege($1,'analytics.commit_dataset_reconciliation(jsonb,jsonb,jsonb,timestamptz)','EXECUTE') allowed", [role])).rows[0].allowed, false);scenarios++;
  }
  await datasetServerProbe(client, {ownerFixture, reconciliation: true});
  console.log("EO05D_RECONCILIATION_PROBE", JSON.stringify({scenarios, rollbackOnly: true, synthetic: true, actualAEAD: true, physicalReadback: true,
    replacement3to5: true, emptyRemovesOldFacts: true, mismatchRollbackAndLedger: true, unknownStops: true, liveAcceptance: false}));
}
