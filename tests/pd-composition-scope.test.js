import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {checkPdCompositionCompatibility as check} from "../app/lib/providers/pd-composition-scope.server.js";

const uuid = "11111111-1111-4111-8111-111111111111";
const otherUuid = "22222222-2222-4222-8222-222222222222";
function scope() {
  return {
    workspace_id: uuid, installation_id: "9223372036854775807", installation_generation: 1,
    provider: "google_ads", provider_connection_id: uuid, platform_account_id: "account",
    canonical_reporting_account_id: "verified-account", flow: "search", entity_type: "ad", entity_id: "ad-1",
    ancestors: [{entity_type: "campaign", entity_id: "campaign-1"}, {entity_type: "ad_group", entity_id: "group-1"}],
    business_date: "2026-10-01", source_timezone: "Europe/Istanbul", reporting_time_basis: "interaction_date",
    source_currency: "TRY", metric_units_fingerprint: "a".repeat(64), attribution_fingerprint: "b".repeat(64),
    conversion_scope: "normal", job_or_run_id: "run-1", composition_attempt_id: uuid,
    snapshot_id: "snapshot-1", completeness: "complete", bounded: true,
  };
}
function sources(expected = scope()) {
  return ["performance", "conversions"].map(source_family => ({source_family, source_reference: "row-1", scope: structuredClone(expected)}));
}

test("complementary families can match one trusted scope without authorizing publication", () => {
  const expected = scope();
  const input = sources(expected);
  input[0].raw_metrics = {spend_value: 0, purchase: null};
  input[1].raw_metrics = {purchase: 2};
  const before = JSON.stringify({expected, input});
  const result = check(expected, input);
  assert.equal(result.compatible, true);
  assert.equal(result.publishable, false);
  assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify({expected, input}), before);
  assert.equal("rows" in result, false);
});

const mismatches = {
  workspace_id: otherUuid, installation_id: "2", installation_generation: 2,
  provider_connection_id: otherUuid, platform_account_id: "another-account", canonical_reporting_account_id: "other-account",
  entity_id: "ad-2", ancestors: [{entity_type: "campaign", entity_id: "campaign-2"}, {entity_type: "ad_group", entity_id: "group-1"}],
  business_date: "2026-10-02", source_timezone: "UTC", reporting_time_basis: "conversion_date",
  source_currency: "USD", metric_units_fingerprint: "c".repeat(64), attribution_fingerprint: "d".repeat(64),
  conversion_scope: "all", job_or_run_id: "run-2", composition_attempt_id: otherUuid, snapshot_id: "snapshot-2",
};
for (const [field, value] of Object.entries(mismatches)) {
  test(`rejects cross-scope composition: ${field}`, () => {
    const input = sources();
    input[1].scope[field] = value;
    const result = check(scope(), input);
    assert.deepEqual(result, {compatible: false, reason: "incompatible_scope", source_index: 1, field, publishable: false});
    assert.ok(!JSON.stringify(result).includes(String(value)));
  });
}

test("two sources agreeing with each other cannot override the expected orchestration scope", () => {
  const input = sources();
  for (const source of input) source.scope.workspace_id = otherUuid;
  assert.equal(check(scope(), input).field, "workspace_id");
});

test("different valid provider or flow scopes cannot be composed", () => {
  const expected = scope();
  const input = sources(expected);
  input[0].scope = {...scope(), provider: "meta", flow: "ads",
    ancestors: [{entity_type: "campaign", entity_id: "campaign-1"}, {entity_type: "adset", entity_id: "adset-1"}]};
  assert.equal(check(expected, input).field, "provider");
  input[0].scope = {...scope(), flow: "shopping", entity_type: "ad_group",
    ancestors: [{entity_type: "campaign", entity_id: "campaign-1"}]};
  assert.equal(check(expected, input).field, "flow");
});

test("contract records helper implementation separately from composers, canonical validation and Dataset", async () => {
  const contract = JSON.parse(await readFile("contracts/pd-cpd-query-standard-v1.json", "utf8"));
  const guard = contract.pd_composition_review.scope_guard_2026_10_27;
  assert.equal(guard.entrypoint, "checkPdCompositionCompatibility");
  assert.equal(guard.provider_composers_connected, false);
  assert.equal(guard.canonical_FX_validation_bypassed, false);
  assert.equal(guard.dataset_writer_or_migration, false);
  assert.equal(guard.publishable, false);
  assert.equal(contract.pd_composition_review.runtime_composer_implemented, false);
});

for (const [provider, flow, entity_type, ancestorTypes] of [
  ["meta", "ads", "ad", ["campaign", "adset"]],
  ["google_ads", "search", "ad", ["campaign", "ad_group"]],
  ["google_ads", "shopping", "ad_group", ["campaign"]],
  ["google_ads", "retail_pmax", "asset_group", ["campaign"]],
  ["klaviyo", "campaign", "campaign_message", ["campaign"]],
  ["klaviyo", "flow", "flow_message", ["flow"]],
]) {
  test(`accepts only declared leaf scope for ${provider}/${flow}`, () => {
    const expected = {...scope(), provider, flow, entity_type,
      canonical_reporting_account_id: provider === "klaviyo" ? null : "account",
      ancestors: ancestorTypes.map(type => ({entity_type: type, entity_id: `${type}-1`}))};
    assert.equal(check(expected, sources(expected)).compatible, true);
    const wrongLeaf = sources(expected);
    wrongLeaf[0].scope.entity_type = "campaign";
    assert.equal(check(expected, wrongLeaf).field, "entity_type");
  });
}

const invalidScopes = [
  ["completeness", "partial"], ["completeness", "failed"], ["completeness", "empty"], ["bounded", false],
  ["workspace_id", null], ["provider_connection_id", "unknown"], ["installation_id", "9223372036854775808"],
  ["installation_id", 1], ["installation_generation", 0], ["provider", "constructor"], ["flow", "toString"],
  ["canonical_reporting_account_id", null], ["entity_id", ""], ["ancestors", []],
  ["business_date", "2026-02-30"], ["source_timezone", "invalid-zone"], ["source_currency", null],
  ["metric_units_fingerprint", "unknown"], ["attribution_fingerprint", null], ["conversion_scope", "unknown"],
  ["job_or_run_id", null], ["composition_attempt_id", null], ["snapshot_id", ""], ["reporting_time_basis", ""],
];
for (const [field, value] of invalidScopes) {
  test(`missing or invalid metadata fails closed: ${field}=${value}`, () => {
    const expected = scope();
    const input = sources(expected);
    input[0].scope[field] = value;
    assert.deepEqual(check(expected, input), {compatible: false, reason: "invalid_source_scope", source_index: 0, field, publishable: false});
    expected[field] = value;
    assert.equal(check(expected, input).reason, "invalid_expected_scope");
  });
}

test("requires source references and rejects duplicate evidence without summing it", () => {
  assert.equal(check(scope(), []).reason, "missing_sources");
  assert.equal(check(scope(), null).reason, "missing_sources");
  const input = sources();
  input.push(structuredClone(input[0]));
  assert.equal(check(scope(), input).reason, "duplicate_source_reference");
  input[0].source_reference = null;
  assert.equal(check(scope(), input).reason, "invalid_source_reference");
});

test("uses ancestor IDs, ignoring names and object property order", () => {
  const input = sources();
  input[0].scope.ancestors = input[0].scope.ancestors.map(a => ({entity_id: a.entity_id, entity_type: a.entity_type, name: "renamed"}));
  assert.equal(check(scope(), input).compatible, true);
  input[0].scope.ancestors[1].entity_id = "different-parent";
  assert.equal(check(scope(), input).field, "ancestors");
});

test("Klaviyo null account selector is explicit and is not a missing-value fallback", () => {
  const expected = {...scope(), provider: "klaviyo", flow: "flow", entity_type: "flow_message",
    canonical_reporting_account_id: null, ancestors: [{entity_type: "flow", entity_id: "flow-1"}]};
  const input = sources(expected);
  delete input[0].scope.canonical_reporting_account_id;
  assert.equal(check(expected, input).field, "canonical_reporting_account_id");
});
