import assert from "node:assert/strict";
import test from "node:test";
import {bridgePdSourceToCanonical as bridge} from "../app/lib/providers/pd-canonical-bridge.server.js";
import {composeGooglePdLeaf} from "../app/lib/providers/google-pd-composition.server.js";
import {composeKlaviyoPdMessage} from "../app/lib/providers/klaviyo-pd-composition.server.js";
import {buildKlaviyoPdValuesRequest} from "../app/lib/providers/klaviyo-reporting.server.js";
import {validateCanonicalFunnelFact, canonicalFactKey} from "../app/lib/providers/common-adapter.server.js";

const uuid = "11111111-1111-4111-8111-111111111111";
function scope(provider = "google_ads") {
  return {workspace_id: uuid, installation_id: "9223372036854775807", installation_generation: 2,
    provider, provider_connection_id: uuid, platform_account_id: "200", canonical_reporting_account_id: provider === "klaviyo" ? null : "200",
    flow: provider === "klaviyo" ? "campaign" : "search", entity_type: provider === "klaviyo" ? "campaign_message" : "ad", entity_id: "300",
    ancestors: [{entity_type: "campaign", entity_id: "100"}, ...(provider === "klaviyo" ? [] : [{entity_type: "ad_group", entity_id: "250"}])],
    business_date: "2026-10-01", source_timezone: "UTC", reporting_time_basis: provider === "klaviyo" ? "send_date" : "interaction_date",
    source_currency: "USD", metric_units_fingerprint: "a".repeat(64), attribution_fingerprint: "b".repeat(64),
    conversion_scope: "normal", job_or_run_id: "run-1", composition_attempt_id: uuid, snapshot_id: "snapshot-1", completeness: "complete", bounded: true};
}
function googleSource(expected) {
  const identity = {customer: {id: "200"}, campaign: {id: "100", advertisingChannelType: "SEARCH"}, adGroup: {id: "250"}, adGroupAd: {ad: {id: "300"}}};
  const performance = {source_family: "search_ad_channel_daily", source_reference: "perf", scope: structuredClone(expected),
    rows: [{...identity, segments: {date: expected.business_date}, metrics: {impressions: "100", clicks: "0", costMicros: "300000000"}}]};
  const conversions = {source_family: "search_ad_conversion_action_daily", source_reference: "conv", scope: structuredClone(expected),
    rows: ["ADD_TO_CART", "BEGIN_CHECKOUT", "PURCHASE"].map((category, index) => ({...identity,
      segments: {date: expected.business_date, conversionActionCategory: category, conversionAction: `customers/200/conversionActions/${index + 1}`},
      metrics: {conversions: "2", conversionsValue: "3900"}}))};
  return composeGooglePdLeaf({expected_scope: expected, performance, conversions}).rows[0];
}
function klaviyoSource(expected) {
  const names = ["Placed Order", "Added to Cart", "Checkout Started"];
  const selection = Object.fromEntries(names.map((name, index) => [name, {metric_id: `metric-${index}`, state: "present"}]));
  const projections = names.map(name => ({source_family: `campaign:${name}`, source_reference: name, scope: structuredClone(expected),
    source: "campaign", conversion_metric_name: name, conversion_metric_id: selection[name].metric_id, observation: "observed",
    rows: [{groupings: {campaign_id: "100", campaign_message_id: "300", campaign_message_name: "Message", send_channel: "email", variation: null, variation_name: null},
      statistics: {delivered: 100, clicks: 0, conversions: 2, conversion_value: 3900}}],
    evidence: {revision: "2026-10-15", request_body: JSON.parse(buildKlaviyoPdValuesRequest({kind: "campaign", conversionMetricName: name,
      conversionMetricId: selection[name].metric_id, businessDate: expected.business_date, timeZone: expected.source_timezone, accessToken: "synthetic"}).body)}}));
  return composeKlaviyoPdMessage({expected_scope: expected, metric_selection: selection, projections}).rows[0];
}
function fixture(provider = "google_ads") {
  const expected = scope(provider);
  const source = provider === "klaviyo" ? klaviyoSource(expected) : googleSource(expected);
  const parent = expected.ancestors.at(-1);
  return {expected_scope: expected, source_fact: structuredClone(source), expected_target_currency: "TRY", enrichment: {
    scope: structuredClone(expected), entity: {campaign_type: "standard", root_entity_type: "campaign", root_entity_id: "100", root_entity_name: "Campaign",
      parent_entity_type: parent.entity_type === "ad_group" ? "adgroup" : parent.entity_type, parent_entity_id: parent.entity_id,
      parent_entity_name: parent.entity_id === "100" ? "Campaign" : "Ad group", entity_type: expected.entity_type, entity_id: "300", entity_name: "Leaf"},
    currency: {source_currency: "USD", target_currency: "TRY", fx_rate: 42, fx_rate_date: "2026-10-01", fx_provider: "synthetic-engine", fx_engine_version: "fixture-v1"},
    fx_for_business_date: expected.business_date,
    time: {source_timezone: "UTC", business_date: expected.business_date, time_engine_version: "fixture-v1"},
    references: {entity: "synthetic-entity-evidence", time: "synthetic-time-evidence", fx: "synthetic-fx-evidence", reporting_currency: "synthetic-workspace-currency"},
    provenance: {source_system: provider, adapter_version: "fixture-v1", source_confidence: "real", synthetic: true},
  }};
}

for (const provider of ["google_ads", "klaviyo"]) {
  test(`${provider} actual composer output crosses existing canonical validation without changing source metrics`, () => {
    const input = fixture(provider), before = structuredClone(input);
    const result = bridge(input), row = result.rows[0];
    assert.equal(result.status, "validated");
    assert.equal(result.canonical_validated, true);
    assert.equal(result.publishable, false);
    assert.equal(validateCanonicalFunnelFact(row), row);
    assert.equal(result.fact_key, canonicalFactKey(row));
    assert.equal(row.identity.installation_id, "9223372036854775807");
    assert.deepEqual(row.raw_metrics, input.source_fact.raw_metrics);
    assert.deepEqual(row.metric_support, input.source_fact.metric_support);
    assert.deepEqual(row.observation_state, input.source_fact.observation_state);
    assert.deepEqual(row.provenance.raw_reference.source_fact, input.source_fact);
    assert.deepEqual(input, before);
    assert.ok(Object.isFrozen(row.provenance.raw_reference.source_fact.raw_metrics));
    assert.equal(row.raw_metrics.ad_click, 0);
    assert.equal(row.observation_state.ad_click, "zero");
    if (provider === "google_ads") assert.equal(row.raw_metrics.spend_value, 300);
    else assert.equal(row.raw_metrics.spend_value, null);
  });
}

test("unknown and configuration states survive enrichment without becoming zero", () => {
  const input = fixture("klaviyo");
  input.source_fact.raw_metrics.add_to_cart = null;
  input.source_fact.metric_support.add_to_cart = "unknown";
  input.source_fact.observation_state.add_to_cart = "account_configuration_missing";
  input.source_fact.metric_evidence.add_to_cart = [];
  const result = bridge(input);
  assert.equal(result.status, "validated");
  assert.equal(result.rows[0].raw_metrics.add_to_cart, null);
  assert.equal(result.rows[0].observation_state.add_to_cart, "account_configuration_missing");
});

test("FX observation date and requested business date are distinct; the bridge chooses no fallback policy", () => {
  const input = fixture();
  input.enrichment.currency.fx_rate_date = "2026-09-30";
  assert.equal(bridge(input).status, "validated");
  assert.equal(bridge(input).rows[0].currency.fx_rate_date, "2026-09-30");
  assert.equal(bridge(input).rows[0].provenance.raw_reference.fx_for_business_date, "2026-10-01");
});

test("same-currency conversion still needs explicit complete metadata and rate one", () => {
  const input = fixture();
  input.expected_target_currency = "USD";
  input.enrichment.currency.target_currency = "USD";
  assert.equal(bridge(input).reason, "same_currency_rate_invalid");
  input.enrichment.currency.fx_rate = 1;
  assert.equal(bridge(input).status, "validated");
  delete input.enrichment.currency.fx_provider;
  assert.equal(bridge(input).reason, "fx_metadata_missing_or_conflicting");
});

for (const [label, mutate, reason] of [
  ["missing source", i => {delete i.source_fact;}, "scope_incompatible"],
  ["missing enrichment", i => {delete i.enrichment;}, "scope_incompatible"],
  ["wrong source account", i => {i.source_fact.scope.platform_account_id = "other";}, "scope_incompatible"],
  ["wrong metadata generation", i => {i.enrichment.scope.installation_generation++;}, "scope_incompatible"],
  ["wrong metadata day", i => {i.enrichment.scope.business_date = "2026-10-02";}, "scope_incompatible"],
  ["stale snapshot", i => {i.enrichment.scope.snapshot_id = "old";}, "scope_incompatible"],
  ["different attribution", i => {i.enrichment.scope.attribution_fingerprint = "c".repeat(64);}, "scope_incompatible"],
  ["missing name", i => {delete i.enrichment.entity.entity_name;}, "entity_metadata_missing_or_conflicting"],
  ["wrong entity", i => {i.enrichment.entity.entity_id = "other";}, "entity_metadata_missing_or_conflicting"],
  ["wrong parent", i => {i.enrichment.entity.parent_entity_id = "other";}, "entity_metadata_missing_or_conflicting"],
  ["missing root name", i => {i.enrichment.entity.root_entity_name = "";}, "entity_metadata_missing_or_conflicting"],
  ["wrong campaign type", i => {i.enrichment.entity.campaign_type = "performance_max";}, "entity_metadata_missing_or_conflicting"],
  ["missing FX reference", i => {delete i.enrichment.references.fx;}, "enrichment_references_missing"],
  ["missing currency lock reference", i => {delete i.enrichment.references.reporting_currency;}, "enrichment_references_missing"],
  ["wrong source currency", i => {i.enrichment.currency.source_currency = "EUR";}, "fx_metadata_missing_or_conflicting"],
  ["wrong target currency", i => {i.enrichment.currency.target_currency = "EUR";}, "fx_metadata_missing_or_conflicting"],
  ["missing rate", i => {delete i.enrichment.currency.fx_rate;}, "fx_metadata_missing_or_conflicting"],
  ["zero rate", i => {i.enrichment.currency.fx_rate = 0;}, "fx_metadata_missing_or_conflicting"],
  ["negative rate", i => {i.enrichment.currency.fx_rate = -1;}, "fx_metadata_missing_or_conflicting"],
  ["infinite rate", i => {i.enrichment.currency.fx_rate = Infinity;}, "fx_metadata_missing_or_conflicting"],
  ["invalid rate date", i => {i.enrichment.currency.fx_rate_date = "2026-02-30";}, "fx_metadata_missing_or_conflicting"],
  ["wrong requested FX day", i => {i.enrichment.fx_for_business_date = "2026-10-02";}, "fx_metadata_missing_or_conflicting"],
  ["missing FX engine", i => {delete i.enrichment.currency.fx_engine_version;}, "fx_metadata_missing_or_conflicting"],
  ["wrong timezone", i => {i.enrichment.time.source_timezone = "Europe/Istanbul";}, "time_metadata_missing_or_conflicting"],
  ["missing time engine", i => {delete i.enrichment.time.time_engine_version;}, "time_metadata_missing_or_conflicting"],
  ["missing synthetic marker", i => {delete i.enrichment.provenance.synthetic;}, "provenance_missing"],
  ["missing adapter version", i => {delete i.enrichment.provenance.adapter_version;}, "provenance_missing"],
  ["missing metric reference", i => {i.source_fact.metric_evidence.purchase = [];}, "source_lineage_invalid"],
  ["dangling source reference", i => {i.source_fact.metric_evidence.purchase[0].source_reference = "other";}, "source_lineage_invalid"],
  ["invalid row index", i => {i.source_fact.metric_evidence.purchase[0].source_row_index = 900;}, "source_lineage_invalid"],
  ["missing native field", i => {i.source_fact.metric_evidence.purchase[0].native_field = "not_a_field";}, "source_lineage_invalid"],
  ["duplicate reference", i => {i.source_fact.metric_evidence.purchase.push({...i.source_fact.metric_evidence.purchase[0]});}, "source_lineage_invalid"],
  ["contradictory state", i => {i.source_fact.metric_support.purchase = "unknown"; i.source_fact.raw_metrics.purchase = null;}, "metric_state_inconsistent"],
  ["negative canonical metric", i => {i.source_fact.raw_metrics.purchase_value = -1;}, "canonical_validation_failed"],
  ["zero with present state", i => {i.source_fact.raw_metrics.purchase = 0;}, "canonical_validation_failed"],
  ["extra metric", i => {i.source_fact.raw_metrics.extra_metric = 123;}, "canonical_validation_failed"],
]) {
  test(`blocks ${label} and preserves original source for later resolution`, () => {
    const input = fixture(); mutate(input);
    const before = structuredClone(input.source_fact ?? null), result = bridge(input);
    assert.equal(result.status, "blocked"); assert.equal(result.reason, reason);
    assert.equal(result.canonical_validated, false); assert.equal(result.publishable, false);
    assert.deepEqual(result.rows, []); assert.deepEqual(result.source_fact, before);
  });
}

test("unrelated enrichment fields cannot replace identity, metrics or canonical provenance", () => {
  const input = fixture();
  input.enrichment.entity.raw_metrics = {purchase: 999};
  input.enrichment.currency.extra = "unrelated-sensitive-envelope";
  input.enrichment.time.extra = "unrelated-sensitive-envelope";
  input.enrichment.references.extra = "unrelated-sensitive-envelope";
  input.enrichment.provenance.raw_reference = {overwrite: true};
  const result = bridge(input);
  assert.equal(result.status, "validated");
  assert.equal(result.rows[0].raw_metrics.purchase, 2);
  assert.equal("overwrite" in result.rows[0].provenance.raw_reference, false);
  assert.doesNotMatch(JSON.stringify(result.rows), /unrelated-sensitive-envelope/);
});
