import assert from "node:assert/strict";
import test from "node:test";
import {composeKlaviyoPdMessage as compose} from "../app/lib/providers/klaviyo-pd-composition.server.js";
import {buildKlaviyoPdValuesRequest, selectKlaviyoPdShopifyMetrics, runKlaviyoPdReportingFamilies,
  KLAVIYO_PD_CONVERSION_METRICS as NAMES} from "../app/lib/providers/klaviyo-reporting.server.js";

const uuid = "11111111-1111-4111-8111-111111111111";
function fixture(kind = "campaign", date = "2026-10-01", timezone = "Europe/Istanbul") {
  const expected = {workspace_id: uuid, installation_id: "1", installation_generation: 2,
    provider: "klaviyo", provider_connection_id: uuid, platform_account_id: "company-1", canonical_reporting_account_id: null,
    flow: kind, entity_type: `${kind}_message`, entity_id: "message-1", ancestors: [{entity_type: kind, entity_id: "parent-1"}],
    business_date: date, source_timezone: timezone, reporting_time_basis: "send_date", source_currency: "TRY",
    metric_units_fingerprint: "a".repeat(64), attribution_fingerprint: "b".repeat(64), conversion_scope: "normal",
    job_or_run_id: "run-1", composition_attempt_id: uuid, snapshot_id: "snapshot-1", completeness: "complete", bounded: true};
  const selection = selectKlaviyoPdShopifyMetrics(NAMES.map((name, index) => ({type: "metric", id: `metric-${index}`,
    attributes: {name, integration: {name: "Shopify"}}})));
  const native = (variation = null, send_channel = "email", multiplier = 1) => ({
    groupings: {[`${kind}_id`]: "parent-1", [`${kind}_message_id`]: "message-1", [`${kind}_message_name`]: "Message",
      ...(kind === "flow" ? {flow_name: "Flow"} : {}), send_channel, variation,
      variation_name: variation === null ? null : `Name ${variation}`},
    statistics: {delivered: 100 * multiplier, clicks: 10 * multiplier, conversions: 2 * multiplier,
      conversion_value: 300 * multiplier, recipients: 9999, opens: 9999, clicks_unique: 9999, conversion_uniques: 9999}});
  const projections = NAMES.map(name => ({source_family: `${kind}:${name}`, source_reference: `snapshot-${name}-message-slice`,
    scope: structuredClone(expected), source: kind, conversion_metric_name: name, conversion_metric_id: selection[name].metric_id,
    observation: "observed", rows: [native()], evidence: {revision: "2026-10-15", request_body: JSON.parse(buildKlaviyoPdValuesRequest({
      kind, conversionMetricName: name, conversionMetricId: selection[name].metric_id,
      businessDate: date, timeZone: timezone, accessToken: "synthetic-secret"}).body)}}));
  return {input: {expected_scope: expected, metric_selection: selection, projections}, native};
}

for (const kind of ["campaign", "flow"]) {
  test(`${kind} message joins the three existing reports with delivery once and Spend open`, () => {
    const {input} = fixture(kind), before = structuredClone(input);
    const result = compose(input), fact = result.rows[0];
    assert.equal(result.status, "composed");
    assert.equal(result.publishable, false);
    assert.deepEqual(fact.raw_metrics, {impression: 100, ad_click: 10, spend_value: null, add_to_cart: 2,
      add_to_cart_value: 300, checkout: 2, checkout_value: 300, purchase: 2, purchase_value: 300});
    assert.equal(fact.spend_state, "open_no_calculation");
    assert.equal(fact.observation_state.spend_value, "not_requested");
    assert.equal(fact.details.length, 1);
    assert.equal(fact.scope.entity_type, `${kind}_message`);
    assert.deepEqual(fact.metric_evidence.purchase.map(r => [r.source_family, r.source_row_index, r.native_field]),
      [[`${kind}:Placed Order`, 0, "conversions"]]);
    assert.ok(Object.isFrozen(fact.source_projections[0].rows[0].statistics));
    assert.deepEqual(input, before);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/);
    assert.equal("sales_role" in fact, false);
  });
}

test("disjoint variation details reduce once to message and preserve each native report", () => {
  const {input, native} = fixture();
  for (const source of input.projections) source.rows = [native("A"), native("B", "email", 2)];
  const fact = compose(input).rows[0];
  assert.equal(fact.raw_metrics.impression, 300);
  assert.equal(fact.raw_metrics.purchase, 6);
  assert.equal(fact.raw_metrics.purchase_value, 900);
  assert.deepEqual(fact.details.map(row => row.variation_id), ["A", "B"]);
  assert.equal(fact.source_projections[0].rows.length, 2);
  assert.equal(fact.metric_evidence.impression.length, 2);
});

for (const medium of ["email", "sms", "whatsapp", "push", "push-notification"]) {
  test(`preserves native ${medium} detail without changing message hierarchy`, () => {
    const {input, native} = fixture();
    for (const source of input.projections) source.rows = [native(null, medium)];
    const result = compose(input);
    assert.equal(result.status, "composed");
    assert.equal(result.rows[0].source_projections[0].rows[0].groupings.send_channel, medium);
    assert.equal(result.rows[0].scope.entity_type, "campaign_message");
  });
}

test("different send channels stay distinct before a single message reduction", () => {
  const {input, native} = fixture();
  for (const source of input.projections) source.rows = [native("A", "email"), native(null, "sms", 2)];
  const fact = compose(input).rows[0];
  assert.equal(fact.raw_metrics.impression, 300);
  assert.equal(fact.details.length, 2);
});

test("a missing variation in one metric report is not a zero or a place to copy totals", () => {
  const {input, native} = fixture();
  for (const source of input.projections) source.rows = [native("A"), native("B", "email", 2)];
  input.projections[1].rows.pop();
  const result = compose(input), fact = result.rows[0];
  assert.equal(result.status, "partial");
  assert.equal(fact.raw_metrics.add_to_cart, null);
  assert.equal(fact.observation_state.add_to_cart, "partial");
  assert.equal(fact.raw_metrics.purchase, 6);
  assert.equal(fact.details.find(row => row.variation_id === "A").raw_metrics.add_to_cart, 2);
});

test("missing value does not erase count, observed delivery or zero", () => {
  const {input} = fixture();
  input.projections[1].rows[0].statistics = {conversions: 0};
  const fact = compose(input).rows[0];
  assert.equal(fact.raw_metrics.add_to_cart, 0);
  assert.equal(fact.observation_state.add_to_cart, "zero");
  assert.equal(fact.raw_metrics.add_to_cart_value, null);
  assert.equal(fact.raw_metrics.impression, 100);
});

test("configuration missing remains explicit while observed report metrics survive", () => {
  const {input} = fixture();
  input.metric_selection = {...input.metric_selection, "Added to Cart": {metric_id: null, state: "account_configuration_missing"}};
  Object.assign(input.projections[1], {conversion_metric_id: null, observation: "account_configuration_missing", rows: []});
  delete input.projections[1].evidence;
  const fact = compose(input).rows[0];
  assert.equal(fact.raw_metrics.add_to_cart, null);
  assert.equal(fact.observation_state.add_to_cart, "account_configuration_missing");
  assert.equal(fact.raw_metrics.impression, 100);
});

test("empty report remains absent, not configuration missing or zero", () => {
  const {input} = fixture();
  input.projections[1].rows = [];
  input.projections[1].observation = "not_observed_in_this_execution";
  const fact = compose(input).rows[0];
  assert.equal(fact.observation_state.add_to_cart, "absent");
  assert.equal(fact.raw_metrics.add_to_cart, null);
  for (const projection of input.projections) {projection.rows = []; projection.observation = "not_observed_in_this_execution";}
  assert.equal(compose(input).reason, "message_not_observed");
});

for (const [label, change, reason] of [
  ["generation", i => {i.projections[1].scope.installation_generation++;}, "scope_incompatible"],
  ["attribution", i => {i.projections[1].scope.attribution_fingerprint = "c".repeat(64);}, "scope_incompatible"],
  ["partial execution", i => {i.projections[1].scope.completeness = "partial";}, "scope_incompatible"],
  ["event date basis", i => {for (const s of [i.expected_scope, ...i.projections.map(p => p.scope)]) s.reporting_time_basis = "event_date";}, "klaviyo_send_date_scope_required"],
  ["missing family", i => {i.projections.pop();}, "metric_families_required"],
  ["Ordered Product fallback", i => {i.projections[1].conversion_metric_name = "Ordered Product";}, "metric_family_mismatch"],
  ["discovery ID conflict", i => {i.projections[1].conversion_metric_id = "wrong";}, "metric_selection_or_bound_invalid"],
  ["same ID for two metrics", i => {i.metric_selection = {...i.metric_selection, "Added to Cart": {metric_id: "metric-0", state: "present"}}; i.projections[1].conversion_metric_id = "metric-0";}, "metric_identity_ambiguous"],
  ["different timeframe", i => {i.projections[1].evidence.request_body.data.attributes.timeframe.start = "2026-10-02T00:00:00+03:00";}, "report_request_or_observation_mismatch"],
  ["missing variation grouping", i => {i.projections[1].evidence.request_body.data.attributes.group_by.pop();}, "report_request_or_observation_mismatch"],
  ["wrong requested metric", i => {i.projections[1].evidence.request_body.data.attributes.conversion_metric_id = "other";}, "report_request_or_observation_mismatch"],
  ["wrong revision", i => {i.projections[1].evidence.revision = "old";}, "report_request_or_observation_mismatch"],
  ["wrong source kind", i => {i.projections[1].source = "flow";}, "metric_family_mismatch"],
  ["uncontrolled filter", i => {i.projections[1].evidence.request_body.data.attributes.filter = "extra";}, "report_request_or_observation_mismatch"],
  ["wrong message", i => {i.projections[1].rows[0].groupings.campaign_message_id = "other";}, "native_identity_or_grain_mismatch"],
  ["wrong campaign", i => {i.projections[1].rows[0].groupings.campaign_id = "other";}, "native_identity_or_grain_mismatch"],
  ["extra segment", i => {i.projections[1].rows[0].groupings.tag_id = "extra";}, "native_identity_or_grain_mismatch"],
  ["duplicate grouping", i => {i.projections[1].rows.push(structuredClone(i.projections[1].rows[0]));}, "duplicate_detail"],
  ["bad statistic", i => {i.projections[1].rows[0].statistics.conversions = "bad";}, "native_row_invalid"],
  ["unsafe value", i => {i.projections[1].rows[0].statistics.conversions = "9223372036854775807";}, "metric_number_unsafe"],
]) {
  test(`rejects ${label} with no partially composed output`, () => {
    const {input} = fixture(); change(input);
    const result = compose(input);
    assert.equal(result.status, "rejected"); assert.equal(result.reason, reason);
    assert.deepEqual(result.rows, []); assert.equal(result.publishable, false);
  });
}

test("message total cannot be joined onto variant details", () => {
  const {input, native} = fixture();
  input.projections[1].rows = [native("A"), native("B")];
  assert.equal(compose(input).reason, "mixed_message_and_variation_grain");
});

test("normalization aliases cannot duplicate one push grouping", () => {
  const {input, native} = fixture();
  input.projections[0].rows = [native(null, "push"), native(null, "push-notification")];
  assert.equal(compose(input).reason, "duplicate_detail");
});

test("unsafe sum is rejected even when individual variation values are safe", () => {
  const {input, native} = fixture();
  for (const source of input.projections) source.rows = [native("A"), native("B")];
  input.projections[1].rows[0].statistics.conversions = Number.MAX_SAFE_INTEGER;
  assert.equal(compose(input).reason, "metric_sum_unsafe");
});

test("configuration-missing declaration cannot accompany a fetched report", () => {
  const {input} = fixture();
  input.metric_selection = {...input.metric_selection, "Added to Cart": {metric_id: null, state: "account_configuration_missing"}};
  Object.assign(input.projections[1], {conversion_metric_id: null, observation: "account_configuration_missing", rows: []});
  assert.equal(compose(input).reason, "missing_configuration_contradiction");
});

for (const date of ["2026-03-29", "2026-10-25"]) {
  test(`uses verified account day across DST boundary ${date}`, () => {
    const {input} = fixture("flow", date, "Europe/Berlin");
    assert.equal(compose(input).status, "composed");
  });
}

test("existing discovery and PD family runner feed composition without new provider calls", async () => {
  const {input} = fixture();
  const result = await runKlaviyoPdReportingFamilies({discoverMetrics: async () => ({selected: input.metric_selection}),
    fetchValues: async ({kind, conversionMetricName}) => kind === "campaign"
      ? input.projections.find(p => p.conversion_metric_name === conversionMetricName)
      : {rows: [], observation: "not_observed_in_this_execution"}});
  assert.equal(result.status, "completed");
  const projections = result.results.reports.filter(p => p.source === "campaign");
  assert.equal(compose({...input, projections}).rows[0].raw_metrics.purchase_value, 300);
});
