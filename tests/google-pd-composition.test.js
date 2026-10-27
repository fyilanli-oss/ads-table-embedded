import assert from "node:assert/strict";
import test from "node:test";
import {composeGooglePdLeaf as compose} from "../app/lib/providers/google-pd-composition.server.js";
import {validateCanonicalFunnelFact} from "../app/lib/providers/common-adapter.server.js";
import {fetchGoogleReportingPage} from "../app/lib/providers/google-reporting.server.js";

const uuid = "11111111-1111-4111-8111-111111111111";
const PAIRS = {
  search: ["search_ad_channel_daily", "search_ad_conversion_action_daily"],
  shopping: ["ad_group_channel_daily", "shopping_ad_group_conversion_action_daily"],
  retail_pmax: ["pmax_asset_group_channel_daily", "pmax_asset_group_conversion_action_daily"],
};
function fixture(flow = "search") {
  const scope = {
    workspace_id: uuid, installation_id: "1", installation_generation: 2, provider: "google_ads",
    provider_connection_id: uuid, platform_account_id: "200", canonical_reporting_account_id: "200",
    flow, entity_type: {search: "ad", shopping: "ad_group", retail_pmax: "asset_group"}[flow], entity_id: "300",
    ancestors: [{entity_type: "campaign", entity_id: "100"}, ...(flow === "search" ? [{entity_type: "ad_group", entity_id: "250"}] : [])],
    business_date: "2026-10-01", source_timezone: "UTC", reporting_time_basis: "interaction_date",
    source_currency: "USD", metric_units_fingerprint: "a".repeat(64), attribution_fingerprint: "b".repeat(64),
    conversion_scope: "normal", job_or_run_id: "run-1", composition_attempt_id: uuid,
    snapshot_id: "snapshot-1", completeness: "complete", bounded: true,
  };
  const identity = {customer: {id: "200"}, campaign: {id: "100", advertisingChannelType: {search: "SEARCH", shopping: "SHOPPING", retail_pmax: "PERFORMANCE_MAX"}[flow]},
    ...(flow === "search" ? {adGroup: {id: "250"}, adGroupAd: {ad: {id: "300"}}} :
      flow === "shopping" ? {adGroup: {id: "300"}} : {assetGroup: {id: "300"}})};
  const native = (metrics, category = null, action = "1") => ({...structuredClone(identity),
    segments: {date: "2026-10-01", ...(category ? {conversionActionCategory: category, conversionAction: `customers/200/conversionActions/${action}`} : {})}, metrics});
  return {input: {expected_scope: scope,
    performance: {source_family: PAIRS[flow][0], source_reference: "performance-leaf-slice", scope: structuredClone(scope),
      rows: [native({impressions: "100", clicks: "10", costMicros: "300000000", conversions: "999", conversionsValue: "9999"})]},
    conversions: {source_family: PAIRS[flow][1], source_reference: "conversions-leaf-slice", scope: structuredClone(scope), rows: [
      native({conversions: "5", conversionsValue: "500"}, "ADD_TO_CART", "1"),
      native({conversions: "3", conversionsValue: "300"}, "BEGIN_CHECKOUT", "2"),
      native({conversions: "1.5", conversionsValue: "3000", allConversions: "999", allConversionsValue: "99999"}, "PURCHASE", "3"),
      native({conversions: "0.5", conversionsValue: "900"}, "PURCHASE", "4"),
    ]}}, native};
}

for (const flow of Object.keys(PAIRS)) {
  test(`${flow} composes its own PD leaf once with metric lineage, not product sales or helper totals`, () => {
    const {input} = fixture(flow);
    const before = structuredClone(input);
    const result = compose(input);
    assert.equal(result.status, "composed");
    assert.equal(result.publishable, false);
    assert.deepEqual(result.rows[0].raw_metrics, {impression: 100, ad_click: 10, spend_value: 300,
      add_to_cart: 5, add_to_cart_value: 500, checkout: 3, checkout_value: 300, purchase: 2, purchase_value: 3900});
    assert.equal(result.rows[0].metric_evidence.purchase.length, 2);
    assert.deepEqual(result.rows[0].metric_evidence.purchase.map(r => [r.source_family, r.source_row_index, r.native_field]),
      [[PAIRS[flow][1], 2, "conversions"], [PAIRS[flow][1], 3, "conversions"]]);
    assert.equal(result.rows[0].metric_evidence.spend_value.length, 1);
    assert.equal(result.rows[0].conversion_details.length, 4);
    assert.deepEqual(result.rows[0].source_projections[1].rows, input.conversions.rows);
    assert.ok(Object.isFrozen(result.rows[0].source_projections[1].rows[0].metrics));
    assert.deepEqual(input, before);
    assert.ok(Object.isFrozen(result.rows[0].scope.ancestors[0]));
    assert.throws(() => validateCanonicalFunnelFact(result.rows[0]));
  });
}

test("empty conversion projection preserves spend and unknown funnel, never inventing zero", () => {
  const {input} = fixture();
  input.conversions.rows = [];
  const result = compose(input);
  assert.equal(result.status, "partial");
  assert.equal(result.rows[0].raw_metrics.spend_value, 300);
  assert.equal(result.rows[0].raw_metrics.purchase, null);
  assert.equal(result.rows[0].observation_state.purchase, "absent");
  assert.equal(result.rows[0].metric_support.purchase, "unknown");
});

test("existing Google reporting page and metric mapper feed the guarded composer without a new query", async () => {
  const {input} = fixture();
  const queries = [];
  for (const [source, name] of [[input.performance, "performance"], [input.conversions, "conversions"]]) {
    const originalRows = structuredClone(source.rows);
    const page = await fetchGoogleReportingPage({customerId: "200", queryFamily: source.source_family,
      dateWindow: {start: "2026-10-01", end: "2026-10-01"},
      client: {async search({query}) {queries.push(query); return {results: originalRows, next_page_token: null, request_id: `synthetic-${name}`};}}});
    source.rows = page.rows;
    assert.equal(page.pd_metric_rows.length, originalRows.length);
  }
  const result = compose(input);
  assert.equal(result.rows[0].raw_metrics.spend_value, 300);
  assert.equal(result.rows[0].raw_metrics.purchase_value, 3900);
  assert.match(queries[0], /FROM ad_group_ad/);
  assert.match(queries[1], /segments.conversion_action_category/);
  assert.doesNotMatch(queries.join("\n"), /cart_data|shopping_performance|metrics.all_/);
});

test("missing purchase value does not erase purchase count, ATC or observed source details", () => {
  const {input} = fixture();
  delete input.conversions.rows[3].metrics.conversionsValue;
  const fact = compose(input).rows[0];
  assert.equal(fact.raw_metrics.purchase, 2);
  assert.equal(fact.raw_metrics.purchase_value, null);
  assert.equal(fact.observation_state.purchase_value, "partial");
  assert.equal(fact.raw_metrics.add_to_cart_value, 500);
  assert.equal(fact.conversion_details[2].raw_metrics.purchase_value, 3000);
  assert.equal(fact.metric_evidence.purchase_value.length, 2);
});

test("explicit zeros stay zero and categories with no rows stay absent", () => {
  const {input, native} = fixture();
  input.conversions.rows = [native({conversions: "0", conversionsValue: "0"}, "PURCHASE", "3")];
  const fact = compose(input).rows[0];
  assert.equal(fact.raw_metrics.purchase, 0);
  assert.equal(fact.observation_state.purchase, "zero");
  assert.equal(fact.raw_metrics.add_to_cart, null);
  assert.equal(fact.observation_state.add_to_cart, "absent");
});

test("conversion-only PD observation retains its metrics without guessing performance", () => {
  const {input} = fixture();
  input.performance.rows = [];
  const result = compose(input);
  assert.equal(result.status, "partial");
  assert.equal(result.rows[0].raw_metrics.purchase_value, 3900);
  assert.equal(result.rows[0].raw_metrics.spend_value, null);
  input.conversions.rows = [];
  assert.equal(compose(input).reason, "leaf_not_observed");
});

for (const [label, mutate, reason] of [
  ["old generation", i => {i.conversions.scope.installation_generation++;}, "scope_incompatible"],
  ["different attribution", i => {i.conversions.scope.attribution_fingerprint = "c".repeat(64);}, "scope_incompatible"],
  ["late retry snapshot", i => {i.performance.scope.snapshot_id = "other";}, "scope_incompatible"],
  ["partial projection", i => {i.conversions.scope.completeness = "partial";}, "scope_incompatible"],
  ["all scope fallback", i => {for (const s of [i.expected_scope, i.performance.scope, i.conversions.scope]) s.conversion_scope = "all";}, "google_normal_interaction_scope_required"],
  ["campaign conversion helper", i => {i.conversions.source_family = "conversion_action_daily";}, "source_family_mismatch"],
  ["cart fallback", i => {i.conversions.source_family = "cart_data_product_sales_daily";}, "source_family_mismatch"],
  ["wrong account", i => {i.conversions.rows[0].customer.id = "201";}, "native_identity_or_grain_mismatch"],
  ["wrong day", i => {i.conversions.rows[0].segments.date = "2026-10-02";}, "native_identity_or_grain_mismatch"],
  ["wrong parent", i => {i.conversions.rows[0].adGroup.id = "251";}, "native_identity_or_grain_mismatch"],
  ["wrong campaign", i => {i.conversions.rows[0].campaign.id = "101";}, "native_identity_or_grain_mismatch"],
  ["wrong leaf", i => {i.conversions.rows[0].adGroupAd.ad.id = "301";}, "native_identity_or_grain_mismatch"],
  ["action in other account", i => {i.conversions.rows[0].segments.conversionAction = "customers/201/conversionActions/1";}, "native_identity_or_grain_mismatch"],
  ["extra device detail", i => {i.conversions.rows[0].segments.device = "MOBILE";}, "native_identity_or_grain_mismatch"],
  ["unexpected category", i => {i.conversions.rows[0].segments.conversionActionCategory = "OTHER";}, "native_identity_or_grain_mismatch"],
  ["duplicate action", i => {i.conversions.rows.push(structuredClone(i.conversions.rows[0]));}, "duplicate_or_conflicting_conversion_action"],
  ["action category conflict", i => {i.conversions.rows[1].segments.conversionAction = i.conversions.rows[0].segments.conversionAction;}, "duplicate_or_conflicting_conversion_action"],
  ["duplicate performance", i => {i.performance.rows.push(structuredClone(i.performance.rows[0]));}, "source_grain_or_bound_invalid"],
  ["malformed number", i => {i.conversions.rows[0].metrics.conversions = "bad";}, "native_metric_invalid_or_unsafe"],
  ["unsafe micros", i => {i.performance.rows[0].metrics.costMicros = "9223372036854775807";}, "native_metric_invalid_or_unsafe"],
  ["unsafe sum", i => {i.conversions.rows[2].metrics.conversions = Number.MAX_SAFE_INTEGER; i.conversions.rows[3].metrics.conversions = 2;}, "metric_sum_unsafe"],
]) {
  test(`rejects ${label} without partial rows or automatic fallback`, () => {
    const {input} = fixture();
    mutate(input);
    const result = compose(input);
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, reason);
    assert.deepEqual(result.rows, []);
    assert.equal(result.publishable, false);
  });
}

test("provider adjustments stay source evidence and are not made canonical by composition", () => {
  const {input} = fixture();
  input.conversions.rows[2].metrics.conversionsValue = "-3000";
  const result = compose(input);
  assert.equal(result.rows[0].raw_metrics.purchase_value, -2100);
  assert.equal(result.publishable, false);
});
