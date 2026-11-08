import test from "node:test";
import assert from "node:assert/strict";
import {datasetSourceBindingFixture} from "./fixtures/dataset-source-binding-fixture.js";
import {bindStoredDatasetSources} from "../app/lib/database/dataset-source-binding.server.js";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {sourceDecimal, addSourceDecimals} from "../app/lib/database/dataset-source-values.server.js";
import {projectStoredGoogleDataset} from "../app/lib/providers/stored-dataset-projection.server.js";

test("lossless native decimal tokens normalize exponent/scale and micros without a floating point conversion", () => {
  assert.equal(sourceDecimal({jsonNumber: "9007199254740993.123456789"}), "9007199254740993.123456789");
  assert.equal(sourceDecimal("1.2500e1"), "12.5");
  assert.equal(sourceDecimal("1234567", {micros: true}), "1.234567");
  assert.equal(addSourceDecimals("9007199254740993.000000001", "0.000000009"), "9007199254740993.00000001");
  assert.equal(sourceDecimal("-0.000"), "0");
  for (const v of [0.1, "-1", "NaN", "Infinity", "1e9999", {jsonNumber: "1", forged: true}]) assert.throws(() => sourceDecimal(v));
});

test("Google encrypted envelopes become PD/performance/sale rows, with exact amounts and no overlapping cart-family duplicate", async () => {
  const f = await datasetSourceBindingFixture("google_ads"), result = await bindStoredDatasetSources(f);
  assert.equal(result.status, "stored"); assert.equal(result.rowsStored, 3); assert.equal(result.consumerReceipt, false); assert.equal(result.publishable, false);
  const rows = f.writes[0].rows, pd = rows.find(r => r.table === "pd_facts").row, sales = rows.find(r => r.table === "cpd_product_sales_facts").row;
  assert.equal(pd.impression, "9007199254740993"); assert.equal(pd.spend_value, "1.234567"); assert.equal(pd.purchase, "2.5"); assert.equal(pd.purchase_value, "12.250000000000000001");
  assert.equal(pd.checkout, null); assert.equal(pd.observation_state.checkout, "missing"); assert.equal(pd.target_currency, null); assert.equal(pd.fx_state, "missing");
  assert.equal(sales.sales_quantity, "2"); assert.equal(sales.sales_value, "12.5"); assert.equal(sales.sales_role, "Advertised");
  assert.ok(result.auxiliary.includes("cart_data_product_sales_daily"));
  assert.equal(pd.provenance.source_context.snapshot.currency, "USD");
  assert.ok(f.queries.every(q => !/handoff_state\s*=|complete.*refresh|token|grant/i.test(q)));
});

test("Meta preserves exact PD and product performance, while holding the unproved conversion-field sales interpretation", async () => {
  const f = await datasetSourceBindingFixture("meta"), r = await bindStoredDatasetSources(f);
  assert.equal(r.status, "partially_stored"); assert.equal(r.rowsStored, 2); assert.ok(r.holds.some(h => h.reason === "meta_sales_semantics_unproven"));
  assert.equal(f.writes[0].rows.find(x => x.table === "pd_facts").row.ad_click, "4");
  assert.equal(f.writes[0].rows.find(x => x.table === "pd_facts").row.spend_value, "1.234567890123456789");
  assert.equal(f.writes[0].rows.some(x => x.table === "cpd_product_sales_facts"), false);
});

test("Klaviyo composes only matching native message/variation/medium fragments and keeps Ordered Product separate", async () => {
  const f = await datasetSourceBindingFixture("klaviyo"), r = await bindStoredDatasetSources(f);
  assert.equal(r.status, "stored"); assert.equal(r.rowsStored, 2);
  const pd = f.writes[0].rows.find(x => x.table === "pd_facts").row, sale = f.writes[0].rows.find(x => x.table === "cpd_product_sales_facts").row;
  assert.equal(pd.impression, "9007199254740993"); assert.equal(pd.purchase_value, "12.500000000000000001");
  assert.equal(pd.spend_value, null); assert.equal(pd.metric_support.spend_value, "unsupported");
  assert.equal(sale.provider_event_id, "event-1"); assert.equal(sale.sales_quantity, "2.5"); assert.equal(sale.sales_role, "Assisted"); assert.equal(sale.channel_id, "message-1");
  assert.equal(f.writes[0].rows.some(x => x.table === "cpd_product_performance_facts"), false);
});

test("Klaviyo missing metric remains unknown/partial rather than zero", async () => {
  const f = await datasetSourceBindingFixture("klaviyo", {missingMetric: true}), r = await bindStoredDatasetSources(f);
  assert.equal(r.status, "partially_stored");
  const pd = f.writes[0].rows.find(x => x.table === "pd_facts").row;
  assert.equal(pd.checkout, null); assert.equal(pd.metric_support.checkout, "unknown"); assert.equal(pd.observation_state.checkout, "unknown");
  assert.equal(pd.source_completeness, "partial");
});

for (const provider of ["google_ads", "meta", "klaviyo"]) test(`${provider}: successful empty physical families write no placeholder fact or consumer receipt`, async () => {
  const f = await datasetSourceBindingFixture(provider, {nonempty: false}), r = await bindStoredDatasetSources(f);
  assert.equal(r.status, "empty"); assert.equal(r.empty, true); assert.equal(f.writes.length, 0); assert.equal(r.consumerReceipt, false);
});

test("caller JSON cannot manufacture a verified projection observation", async () => {
  const f = await datasetSourceBindingFixture("google_ads"), proof = await readStoredDatasetSources(f);
  assert.throws(() => projectStoredGoogleDataset(structuredClone(proof)), /VERIFIED_SOURCE_REQUIRED/);
});

for (const mode of ["cipher", "hash", "expired", "extra_page", "missing_page", "wrong_schema", "context", "read_scope", "receipt_changed", "stale_owner", "cancel", "deadline"]) {
  test(`source ${mode} fails before any Dataset write`, async () => {
    const f = await datasetSourceBindingFixture("google_ads"), first = f.envelopes.get(f.batches[0].attemptId);
    if (mode === "cipher") first.pages[0].ciphertext = "00".repeat(first.pages[0].ciphertext.length / 2);
    if (mode === "hash") first.pages[0].payloadHash = "f".repeat(64);
    if (mode === "expired") first.pages[0].expired = true;
    if (mode === "wrong_schema") first.pages[0].schemaVersion = "forged";
    if (mode === "extra_page") first.pages.push({...first.pages.at(-1), id: "999999"});
    if (mode === "missing_page") first.pages.pop();
    if (mode === "context") f.source.currency = "FORGED";
    if (mode === "read_scope") f.envelopes.get(f.batches[1].attemptId).receipt.manifest.googleDatasetRead.operationId = "different";
    if (mode === "receipt_changed") {let n = 0; f.hooks.query = (sql, args) => {
      if (sql.includes("read_source_receipt") && args[1] === f.batches[0].attemptId && ++n === 2) return {rows: [{result: {...first.receipt, digest: "f".repeat(64)}}]};
    };}
    if (mode === "stale_owner") f.hooks.query = sql => {if (sql.includes("assert_source_owner")) throw Error("SYNTHETIC_OWNER_CHANGED");};
    if (mode === "cancel") f.signal = AbortSignal.abort();
    if (mode === "deadline") f.limits.deadlineAt = Date.now() - 1;
    await assert.rejects(bindStoredDatasetSources(f)); assert.equal(f.writes.length, 0);
  });
}

test("a raw first-day envelope containing pre-connection hours cannot authorize a Dataset day", async () => {
  const f = await datasetSourceBindingFixture("meta"); f.source.eligibleFromMs = Date.parse("2026-11-01T12:00:00Z");
  await assert.rejects(bindStoredDatasetSources(f), /PRE_CONNECTION_HOURS/); assert.equal(f.writes.length, 0);
});

test("lost Dataset write acknowledgement never triggers readback or a retry", async () => {
  const f = await datasetSourceBindingFixture("google_ads"); let sent = 0;
  f.hooks.query = sql => {if (sql.includes("commit_dataset_storage")) {sent++; throw Error("synthetic lost acknowledgement");}};
  await assert.rejects(bindStoredDatasetSources(f), /WRITE_UNCONFIRMED/);
  assert.equal(sent, 1); assert.equal(f.queries.some(q => q.includes("inspect_dataset_storage")), false);
});
