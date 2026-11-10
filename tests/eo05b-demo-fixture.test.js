import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createGolden, projectRolling, projectMetrics, validateFixture, validateArchive, validateSchema, extractSource, SOURCE, VERSION, DIRECTORY, METRICS, sha256} from "../tools/eo05b-demo-fixture.mjs";

const read = name => fs.readFileSync(`${DIRECTORY}/${name}`, "utf8");
const archive = read("source-rows.json"), source = validateArchive(archive);
const golden = JSON.parse(read("golden.json")), rolling = JSON.parse(read("rolling-2026-11-10.json"));
const schema = JSON.parse(read("schema.json"));
const copy = value => JSON.parse(JSON.stringify(value));

test("pins all 1,000 original rows and their exact JSON bytes, including excluded platforms", () => {
  assert.equal(Buffer.byteLength(archive), 458500);
  assert.equal(sha256(archive), SOURCE.source_json_sha256);
  assert.equal(source.length, 1000);
  assert.deepEqual(Object.fromEntries([...new Set(source.map(r => r.dimensions.platform))].sort().map(p => [p, source.filter(r => r.dimensions.platform === p).length])),
    {Direct: 50, Google: 250, Klaviyo: 150, Meta: 250, Others: 50, TikTok: 250});
  assert.equal(source[0].dimensions.date, "2026-06-01");
  assert.equal(source.at(-1).dimensions.date, "2026-07-20");
  assert.equal(source[0].raw_metrics.purchase_value, 228.85);
  assert.equal(source[0].calculated_metrics.profit, 228.85);
  assert.throws(() => validateArchive(archive + "\n"), /ARCHIVE_HASH/);
  assert.throws(() => validateArchive(archive.replace("228.85", "228.86")), /ARCHIVE_HASH/);
});

test("never evaluates an untrusted HTML/JS source or accepts a different pinned file", () => {
  assert.throws(() => extractSource(Buffer.from('globalThis.demoExecuted=true;const SOURCE_ROWS=[]')), /SOURCE_HASH/);
  assert.equal(globalThis.demoExecuted, undefined);
  assert.throws(() => extractSource("not a buffer"), /SOURCE_HASH/);
});

test("recreates the reviewed golden and rolling artifacts byte for byte", () => {
  const regenerated = createGolden(archive);
  assert.equal(JSON.stringify(regenerated, null, 2) + "\n", read("golden.json"));
  assert.equal(JSON.stringify(projectRolling(regenerated, "2026-11-10", archive), null, 2) + "\n", read("rolling-2026-11-10.json"));
  assert.deepEqual(validateFixture(golden, archive), {rows: 500, google_ads: 200, meta: 200, klaviyo: 100, provider_truth: false});
  validateFixture(rolling, archive);
});

test("projects only the 500 active-provider paid rows; organic and TikTok never become paid facts", () => {
  assert.deepEqual(Object.fromEntries(["google_ads", "meta", "klaviyo"].map(provider => [provider, golden.rows.filter(r => r.provider === provider).length])),
    {google_ads: 200, meta: 200, klaviyo: 100});
  for (const row of golden.rows) {
    assert.equal(source[row.source.archive_row_index].dimensions.traffic_type, "paid");
    assert.equal(row.provider_truth, false);
    assert.equal(row.data_origin, "synthetic_demo");
    assert.equal(row.workspace_kind, "demo");
    assert.equal(row.fixture_version, VERSION);
  }
});

test("binds every normalized value to the immutable original and preserves formula expectations only in the archive", () => {
  for (const row of golden.rows) {
    const original = source[row.source.archive_row_index];
    assert.equal(row.source.row_sha256, sha256(JSON.stringify(original)));
    assert.equal(row.source.original_business_date, original.dimensions.date);
    for (const metric of METRICS) {
      if (row.metric_support_state[metric] === "supported") assert.equal(row.raw_metrics[metric], original.raw_metrics[metric]);
      else assert.equal(row.raw_metrics[metric], null);
    }
    assert.equal(Object.hasOwn(row, "calculated_metrics"), false);
    assert.equal(Object.hasOwn(row.raw_metrics, "session"), false);
    assert.equal(Object.hasOwn(row, "product_id"), false);
  }
  assert.equal(golden.product_evidence, false);
  assert.match(golden.calculated_metrics, /recompute_in_EO06A/);
  assert.match(golden.numeric_semantics, /not_native_decimal_precision_evidence/);
});

test("uses explicit synthetic native-shaped hierarchies without inventing PMax, Klaviyo campaigns or product identities", () => {
  const kinds = {google_ads: ["campaign", "ad_group", "ad"], meta: ["campaign", "ad_set", "ad"], klaviyo: ["flow", "flow_message"]};
  for (const row of golden.rows) {
    assert.deepEqual(row.hierarchy.nodes.map(n => n.kind), kinds[row.provider]);
    assert.equal(row.hierarchy.mapping_basis, "explicit_synthetic_overlay_not_native_evidence");
    assert.ok(row.hierarchy.nodes.every(n => n.id.startsWith(`${row.workspace_id}:${row.provider}:`)));
  }
  assert.deepEqual([...new Set(golden.rows.map(r => r.hierarchy.kind))].sort(), ["google_standard", "klaviyo_flow", "meta"]);
});

test("supported zero, absent and unsupported remain distinct; legacy spend never invents native Klaviyo spend", () => {
  const zeros = golden.rows.flatMap(row => METRICS.filter(m => row.observation_state[m] === "zero").map(m => [row, m]));
  assert.equal(zeros.length, 0); // Do not change the pinned data to manufacture a zero example.
  for (const [row, metric] of zeros) {
    assert.equal(row.metric_support_state[metric], "supported");
    assert.equal(row.raw_metrics[metric], 0);
  }
  for (const row of golden.rows.filter(r => r.provider === "klaviyo")) {
    for (const metric of ["spend_value"]) {
      assert.equal(row.raw_metrics[metric], null);
      assert.equal(row.metric_support_state[metric], "unsupported");
      assert.equal(row.observation_state[metric], "unsupported");
    }
    assert.equal(typeof source[row.source.archive_row_index].raw_metrics.spend_value, "number");
    for (const metric of ["impression", "ad_click"]) {
      assert.equal(row.metric_support_state[metric], "supported");
      assert.equal(row.raw_metrics[metric], source[row.source.archive_row_index].raw_metrics[metric]);
    }
  }
  const classified = projectMetrics("klaviyo", {purchase: 0, purchase_value: 12, spend_value: 0});
  assert.equal(classified.metrics.purchase, 0);
  assert.equal(classified.support.purchase, "supported");
  assert.equal(classified.observations.purchase, "zero");
  assert.equal(classified.metrics.checkout, null);
  assert.equal(classified.support.checkout, "unknown");
  assert.equal(classified.observations.checkout, "absent");
  assert.equal(classified.metrics.spend_value, null);
  assert.equal(classified.support.spend_value, "unsupported");
  assert.equal(classified.observations.spend_value, "unsupported");
  for (const value of [null, "0", -1, NaN, Infinity]) assert.throws(() => projectMetrics("meta", {purchase: value}), /METRIC_VALUE/);
  const invalid = copy(golden);
  invalid.rows[0].raw_metrics.purchase = null;
  invalid.rows[0].metric_support_state.purchase = "unknown";
  invalid.rows[0].observation_state.purchase = "absent";
  assert.throws(() => validateFixture(invalid, archive), /SOURCE_PARITY/);
});

test("rolling dates use only an explicit clock; immutable dates, relative spacing and account/entity identities survive", () => {
  const before = JSON.stringify(golden), projected = projectRolling(golden, "2028-02-29", archive);
  assert.equal(JSON.stringify(golden), before);
  assert.equal(golden.rows[0].provider_business_date, "2026-06-01");
  assert.equal(projected.rows.at(-1).provider_business_date, "2028-02-29");
  const delta = Date.parse("2028-02-29") - Date.parse("2026-07-20");
  for (let i = 0; i < golden.rows.length; i++) {
    assert.equal(Date.parse(projected.rows[i].provider_business_date) - Date.parse(golden.rows[i].provider_business_date), delta);
    assert.deepEqual(projected.rows[i].hierarchy, golden.rows[i].hierarchy);
    assert.deepEqual(projected.rows[i].raw_metrics, golden.rows[i].raw_metrics);
    assert.equal(projected.rows[i].source.original_business_date, golden.rows[i].provider_business_date);
  }
  for (const bad of [undefined, null, "2026-02-29", "2026-13-01", "now", "2026-11-10T00:00:00Z"]) assert.throws(() => projectRolling(golden, bad, archive));
  assert.throws(() => projectRolling(rolling, "2026-11-10", archive), /GOLDEN_REQUIRED/);
  assert.throws(() => createGolden(archive, {demoClock: "2026-11-10"}), /OPTIONS/);
});

test("synthetic identities cannot collide across demo workspaces or providers and cannot impersonate live owners", () => {
  const other = createGolden(archive, {workspace: "second"});
  validateFixture(other, archive);
  const ids = new Set(golden.rows.flatMap(r => [r.workspace_id, r.installed_shop_id, r.provider_account_id, ...r.hierarchy.nodes.map(n => n.id)]));
  for (const row of other.rows) for (const id of [row.workspace_id, row.installed_shop_id, row.provider_account_id, ...row.hierarchy.nodes.map(n => n.id)]) assert.equal(ids.has(id), false);
  for (const workspace of [null, 123, "", "live/shop", "../real", "PRODUCTION", "a".repeat(49)]) assert.throws(() => createGolden(archive, {workspace}), /WORKSPACE/);
  assert.equal(golden.runtime_seed_authorized, false);
});

test("rejects changed truth labels, missing labels, extra payloads, owner tampering, changed hierarchy and duplicate grains", () => {
  const mutations = [
    value => {value.provider_truth = true;},
    value => {delete value.rows[0].data_origin;},
    value => {value.rows[0].provider_truth = true;},
    value => {value.rows[0].credential = "forbidden";},
    value => {value.rows[0].provider_account_id = "real-account";},
    value => {value.rows[0].hierarchy.nodes[1].kind = "ad_set";},
    value => {value.rows[1] = copy(value.rows[0]);},
    value => {value.rows[0].source.archive_row_index++;},
    value => {value.rows[0].raw_metrics.purchase = -1;},
    value => {value.rows[0].raw_metrics.purchase = Infinity;},
    value => {value.rows[0].raw_metrics.purchase = "0";},
    value => {value.rows.pop();},
  ];
  for (const mutate of mutations) { const value = copy(golden); mutate(value); assert.throws(() => validateFixture(value, archive)); }
});

test("does not permit cross-currency identity rates or infer unsupported fixture variants", () => {
  const changed = copy(golden);
  changed.rows[0].reporting_currency = "TRY";
  assert.throws(() => validateFixture(changed, archive));
  changed.rows[0].fx = {kind: "synthetic_exchange", rate: "1", provider: "invented"};
  assert.throws(() => validateFixture(changed, archive));
});

test("strict schema rejects unimplemented validation keywords instead of silently skipping constraints", () => {
  assert.equal(validateSchema(golden, schema), true);
  assert.throws(() => validateSchema({}, {type: "object", allOf: []}), /SCHEMA_KEYWORD/);
  assert.throws(() => validateSchema(1, {$ref: "https://untrusted.invalid/schema"}), /SCHEMA_REF/);
  assert.throws(() => validateSchema(1, {type: "integer", minimum: 2}), /SCHEMA_MINIMUM/);
  assert.throws(() => validateSchema([], {type: "array", minItems: 1}), /SCHEMA_LENGTH/);
});

test("closure records truthful empty/held acceptance without claiming live nonempty FX, consumption or new authority", () => {
  const contract = JSON.parse(fs.readFileSync("contracts/eo-05b-demo-closure-v1.json", "utf8"));
  const live = JSON.parse(fs.readFileSync(contract.live_evidence, "utf8"));
  const master = JSON.parse(fs.readFileSync("contracts/a6-eo-implementation-master-v1.json", "utf8"));
  assert.equal(master.EO05B_demo_and_current_closure_2026_11_10.contract, "contracts/eo-05b-demo-closure-v1.json");
  for (const provider of ["google", "meta"]) {
    assert.equal(live[provider].status, "empty");
    assert.equal(live[provider].source_verified, true);
    assert.equal(live[provider].empty_receipt_verified, true);
  }
  assert.equal(live.klaviyo.metric_records, 0);
  assert.equal(live.klaviyo.native_status, "partial");
  assert.equal(live.klaviyo.dataset_result.body.status, "held");
  assert.equal(live.klaviyo.dataset_result.body.empty, null);
  assert.equal(live.klaviyo.storage_receipt_created, false);
  assert.equal(live.klaviyo.report_retention_extended, false);
  for (const key of ["nonempty_live_fact_write_proven", "live_cross_currency_FX_proven", "merchant_currency_selected", "consumer_receipt", "publishable", "hourly_refresh", "full_EO05_complete"]) assert.equal(contract.current_acceptance[key], false);
  assert.equal(live.closed_state.mode, "false/closed");
  assert.deepEqual(contract.scope, {runtime_code: false, live_provider: false, live_database: false, merge: false, deploy: false});
  for (const [key, name] of Object.entries(contract.fixtures)) {
    if (typeof name === "string" && /^(contracts|tools|tests)\//.test(name)) assert.ok(fs.existsSync(name), key);
  }
});
