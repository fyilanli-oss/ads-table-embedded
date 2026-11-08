import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {datasetDecimal, datasetNativeKey, prepareDatasetWrite, prepareDatasetFx, createDatasetStorageRepository} from "../app/lib/database/dataset-storage.server.js";
import {datasetStorageFixture} from "./fixtures/dataset-storage-fixture.js";

test("lossless metric transport preserves more precision than JavaScript Number and fractional quantities", () => {
  for (const value of ["0", "0.0000000000000000000000000001", "9007199254740993.1234567890123456789", "0.25"]) assert.equal(datasetDecimal(value), value);
  for (const value of [0, 0.1, Number.NaN, Infinity, "NaN", "Infinity", "1e9", "-1", "01", "1.", "1.00", " ", "9".repeat(129)]) assert.throws(() => datasetDecimal(value), /DECIMAL/);
});

test("NULL, observed zero, unsupported and unknown remain different and inconsistent combinations are rejected", () => {
  const x = datasetStorageFixture(), row = x.rows[0].row;
  assert.equal(prepareDatasetWrite(x).body.rows[0].row.spend_value, "0");
  row.spend_value = null; row.observation_state.spend_value = "missing";
  assert.equal(prepareDatasetWrite(x).body.rows[0].row.spend_value, null);
  row.metric_support.spend_value = "unsupported"; row.observation_state.spend_value = "unsupported"; prepareDatasetWrite(x);
  row.metric_support.spend_value = "unknown"; row.observation_state.spend_value = "unknown"; prepareDatasetWrite(x);
  row.spend_value = "0"; assert.throws(() => prepareDatasetWrite(x), /METRIC_STATE/);
});

test("native identity excludes enrichment, names, connection rotation and optional metric versions, but keeps real daily scope", () => {
  const x = datasetStorageFixture(), row = x.rows[0].row, key = () => datasetNativeKey({owner: x.owner, table: x.rows[0].table, row}).hash;
  const initial = key(); row.spend_value = "123.25"; row.entity_name = "Renamed"; row.metric_extensions = {future: "1"};
  row.target_currency = "EUR"; row.fx_state = "missing"; x.owner.connectionVersion = "2"; x.owner.connectionId = randomUUID();
  assert.equal(key(), initial);
  row.business_date = "2026-11-02"; assert.notEqual(key(), initial);
  row.business_date = "2026-11-01"; row.reporting_scope.attribution = "different"; assert.notEqual(key(), initial);
});

test("Ordered Product event key does not duplicate an event when day, Channel or role is resolved later", () => {
  const x = datasetStorageFixture({table: "cpd_product_sales_facts"}), r = x.rows[0].row;
  r.provider_event_id = "ordered-1"; r.source_identity = {kind: "event", namespace: "ordered_product", native: {event_id: "ordered-1"}};
  r.business_date = null; const first = datasetNativeKey({owner: x.owner, table: x.rows[0].table, row: r});
  r.business_date = "2026-11-02"; r.sales_role = "Assisted"; r.channel_id = "late-channel";
  assert.equal(datasetNativeKey({owner: x.owner, table: x.rows[0].table, row: r}).hash, first.hash);
  r.provider_event_id = "other"; assert.throws(() => datasetNativeKey({owner: x.owner, table: x.rows[0].table, row: r}), /EVENT_IDENTITY/);
});

test("unregistered extensions, PII keys, new ownership fields and missing retention cannot pass the storage boundary", () => {
  for (const mutate of [
    x => {x.rows[0].row.metric_extensions = {"meta.example_optional_metric": {value: "1"}};},
    x => {x.rows[0].row.provenance.sources[0].customer_email = "private";},
    x => {x.rows[0].row.reporting_scope.customer_id = "private";},
    x => {x.rows[0].row.workspace_id = randomUUID();},
    x => {x.policy.until = "infinity";},
    x => {x.policy.until = "2020-01-01T00:00:00Z";},
    x => {x.rows[0].row.impression = 9007199254740992;},
  ]) {const x = datasetStorageFixture(); mutate(x); assert.throws(() => prepareDatasetWrite(x));}
});

test("no fake FX identity, guessed product grain or dummy Klaviyo performance", () => {
  const x = datasetStorageFixture(); x.rows[0].row.target_currency = "EUR";
  assert.throws(() => prepareDatasetWrite(x), /FX/);
  x.rows[0].row.fx_state = "missing"; prepareDatasetWrite(x);
  x.rows[0].row.fx_state = "verified"; assert.throws(() => prepareDatasetWrite(x), /FX/);
  const y = datasetStorageFixture({table: "cpd_product_performance_facts"}); y.owner.provider = "klaviyo"; y.owner.selectionEpoch = null;
  assert.throws(() => prepareDatasetWrite(y), /PRODUCT_GRAIN/);
});

test("same native row twice in one write is rejected; original caller mutations do not change a sealed write", () => {
  const x = datasetStorageFixture(), write = prepareDatasetWrite(x);
  x.rows[0].row.spend_value = "42"; assert.equal(write.body.rows[0].row.spend_value, "0");
  x.rows.push(structuredClone(x.rows[0])); assert.throws(() => prepareDatasetWrite(x), /DUPLICATE_NATIVE_KEY/);
});

test("lost acknowledgement is unknown: a write is not retried or inspected automatically, and forged capabilities fail", async () => {
  let calls = 0; const repo = createDatasetStorageRepository({async query() {calls++; throw Error("synthetic lost reply");}});
  const write = prepareDatasetWrite(datasetStorageFixture());
  await assert.rejects(repo.commit(structuredClone(write)), /CAPABILITY_REQUIRED/);
  await assert.rejects(repo.commit(write), /WRITE_UNCONFIRMED/);
  await assert.rejects(repo.commit(write), /CAPABILITY_REQUIRED/); assert.equal(calls, 1);
});

test("successful storage receipt is checked per row and explicitly never a report consumer receipt", async () => {
  for (const bad of [false, true]) {
    const write = prepareDatasetWrite(datasetStorageFixture());
    const repo = createDatasetStorageRepository({async query() {return {rows: [{result: {status: "stored", operationId: write.body.operationId, digest: "a".repeat(64),
      consumerReceipt: bad, rows: write.body.rows.map(x => ({table: x.table, id: "9007199254740993", nativeKeyHash: x.row.native_key_hash}))}}]};}});
    if (bad) await assert.rejects(repo.commit(write), /WRITE_UNCONFIRMED/);
    else assert.equal((await repo.commit(write)).consumerReceipt, false);
  }
});

test("FX proof uses an exact decimal and immutable source revision, without inventing same-currency external rates", async () => {
  const rate = {source_currency: "USD", target_currency: "EUR", fx_rate_date: "2026-11-01", fx_rate: "0.9234567890123456789",
    fx_provider: "synthetic-only", rate_version: "synthetic-v1", source_reference: {digest: "a".repeat(64)}, fetched_at: new Date().toISOString(), fx_schema_version: "synthetic-v1"};
  const write = prepareDatasetFx(rate);
  let calls = 0; const repo = createDatasetStorageRepository({async query() {calls++; return {rows: [{result: {...rate, id: "9007199254740993"}}]};}});
  assert.equal((await repo.recordFx(write)).fx_rate, rate.fx_rate);
  await assert.rejects(repo.recordFx(write), /CAPABILITY_REQUIRED/); assert.equal(calls, 1);
  for (const patch of [{fx_rate: 0.1}, {fx_rate: "0"}, {target_currency: "USD"}, {source_reference: {}}, {source_reference: {token: "private"}}]) assert.throws(() => prepareDatasetFx({...rate, ...patch}));
});
