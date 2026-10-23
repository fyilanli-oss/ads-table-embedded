import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {buildGoogleReportingQueries, fetchGoogleReportingPage} from "../app/lib/providers/google-reporting.server.js";
import {GOOGLE_LIVE_EVIDENCE_QUERY_FAMILIES} from "../app/lib/providers/google-live-evidence.server.js";

const window = {start: "2026-10-01", end: "2026-10-02"};
const productFields = [
  "customer.id", "campaign.id", "campaign.name", "campaign.advertising_channel_type",
  "segments.date", "segments.product_merchant_id", "segments.product_feed_label",
  "segments.product_item_id", "segments.product_brand",
  ...Array.from({length: 5}, (_, i) => `segments.product_category_level${i + 1}`),
  ...Array.from({length: 5}, (_, i) => `segments.product_type_l${i + 1}`),
  ...Array.from({length: 5}, (_, i) => `segments.product_custom_attribute${i}`),
  "metrics.impressions", "metrics.clicks", "metrics.cost_micros", "metrics.conversions", "metrics.conversions_value",
];
const selectedFields = query => query.split("\nFROM ")[0].replace(/^SELECT\n/, "")
  .split(",").map(field => field.trim());

test("Shopping and PMax retain every product field with disjoint campaign filters", () => {
  const queries = buildGoogleReportingQueries({dateWindow: window});
  assert.deepEqual(selectedFields(queries.shopping_product_daily), [
    ...productFields.slice(0, 4), "ad_group.id", "ad_group.name", ...productFields.slice(4),
  ]);
  assert.deepEqual(selectedFields(queries.pmax_product_daily), productFields);
  for (const [family, type] of [["shopping_product_daily", "SHOPPING"], ["pmax_product_daily", "PERFORMANCE_MAX"]]) {
    assert.equal(queries[family].split("\nFROM ")[1],
      `shopping_performance_view\nWHERE segments.date BETWEEN '2026-10-01' AND '2026-10-02'\n  AND campaign.advertising_channel_type = '${type}'`);
  }
  assert.doesNotMatch(queries.pmax_product_daily, /ad_group|asset_group|product_sold|units_sold|revenue_micros/);
  assert.notEqual(queries.shopping_product_daily, queries.pmax_product_daily);
  // Preparing a query does not schedule or activate it in the old live trigger.
  assert.equal(GOOGLE_LIVE_EVIDENCE_QUERY_FAMILIES.includes("pmax_product_daily"), false);
});

test("PMax product pages preserve native rows and exact query evidence without Channel or PD projection", async () => {
  const row = {customer: {id: "100"}, campaign: {id: "200", advertisingChannelType: "PERFORMANCE_MAX"},
    segments: {date: "2026-10-01", productMerchantId: "300", productFeedLabel: "IS", productItemId: "native-item"},
    metrics: {impressions: "0", clicks: "0", costMicros: "0"}};
  const calls = [];
  const client = {search: async input => {
    calls.push(input);
    return {results: input.pageToken ? [] : [row], next_page_token: input.pageToken ? null : "opaque-page-2",
      request_id: input.pageToken ? "request-2" : "request-1"};
  }};
  const first = await fetchGoogleReportingPage({client, customerId: "100", queryFamily: "pmax_product_daily", dateWindow: window});
  const second = await fetchGoogleReportingPage({client, customerId: "100", queryFamily: "pmax_product_daily",
    dateWindow: window, pageToken: first.next_cursor});
  assert.deepEqual(first.rows, [row]);
  assert.equal(first.fact_family, "pmax_product_daily");
  assert.equal(first.observation_state, "present");
  assert.equal(first.provider_request_id, "request-1");
  assert.equal(first.evidence.query, buildGoogleReportingQueries({dateWindow: window}).pmax_product_daily);
  assert.equal(first.evidence.query_fingerprint.length, 64);
  assert.equal(first.evidence.api_version, "v25");
  assert.equal(Object.hasOwn(first, "pd_metric_rows"), false);
  assert.equal(Object.hasOwn(first.rows[0], "assetGroup"), false);
  assert.equal(Object.hasOwn(first.rows[0].metrics, "conversions"), false);
  assert.equal(second.observation_state, "not_observed_in_this_execution");
  assert.equal(second.next_cursor, null);
  assert.equal(calls[1].pageToken, "opaque-page-2");
  assert.equal(calls[0].query, calls[1].query);
});

test("PMax product query rejects invalid dates before transport and never retries a provider error", async () => {
  let calls = 0;
  const failure = new Error("synthetic provider failure");
  const client = {search: async () => {calls++; throw failure;}};
  await assert.rejects(fetchGoogleReportingPage({client, customerId: "100", queryFamily: "pmax_product_daily",
    dateWindow: {start: "2026-02-31", end: "2026-03-01"}}), {code: "GOOGLE_REPORTING_DATE_INVALID"});
  assert.equal(calls, 0);
  await assert.rejects(fetchGoogleReportingPage({client, customerId: "100", queryFamily: "pmax_product_daily",
    dateWindow: window}), error => error === failure);
  assert.equal(calls, 1);
});

test("query split contracts preserve Asset Group target, paused history and the unchanged live family list", async () => {
  const runtime = JSON.parse(await readFile("contracts/eo-04c-google-reporting-runtime-v1.json", "utf8"));
  const standard = JSON.parse(await readFile("contracts/pd-cpd-query-standard-v1.json", "utf8"));
  const live = JSON.parse(await readFile("contracts/eo-04c-google-live-evidence-trigger-v1.json", "utf8"));
  assert.equal(runtime.product_performance_query_split.pmax_family, "pmax_product_daily");
  assert.equal(runtime.product_performance_query_split.campaign_context_is_cpd_channel_decision, false);
  assert.equal(runtime.product_performance_query_split.pmax_asset_group_fields_or_assignment_added, false);
  assert.equal(runtime.product_performance_query_split.historical_11_reopened, false);
  assert.equal(runtime.product_performance_query_split.live_call_or_deployment_authorized, false);
  assert.equal(runtime.channels.performance_max_retail, "asset_group");
  assert.equal(runtime.pmax_next_work.historical_work_reopened, false);
  assert.equal(standard.hierarchy_targets.find(row => row.flow === "retail_pmax").channel_key, "asset_group_id");
  assert.equal(standard.source_link_design.google_ads.product_performance_query_split.product_asset_group_link_complete, false);
  assert.deepEqual(live.execution.query_families_in_order, [...GOOGLE_LIVE_EVIDENCE_QUERY_FAMILIES]);
  assert.equal(live.execution.product_query_scope_correction_2026_10_23.pmax_product_daily_in_trigger, false);
});
