import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {RAW_METRICS} from "../app/lib/providers/common-adapter.server.js";
import {mapMetaPdMetrics, META_PD_METRIC_SOURCES, fetchMetaAdChannelInsightsPage,
  fetchMetaProductBreakdownInsightsPage} from "../app/lib/providers/meta-reporting.server.js";

const event = (action_type, value, extra = {}) => ({action_type, value, ...extra});
const web = {
  cart: "offsite_conversion.fb_pixel_add_to_cart",
  checkout: "offsite_conversion.fb_pixel_initiate_checkout",
  purchase: "offsite_conversion.fb_pixel_purchase",
};
const input = {accessToken: "fixture-token", appSecret: "fixture-secret", adAccountId: "act_123",
  dateWindow: {start: "2026-10-01", end: "2026-10-01"}};
const json = payload => new Response(JSON.stringify(payload), {status: 200});

test("03 maps exactly nine metrics and matching website counts and values without grouped double count", () => {
  const row = {impressions: "100", spend: "12.50", clicks: "90", inline_link_clicks: "80",
    outbound_clicks: [event("outbound_click", "7")],
    actions: [event(web.cart, "4"), event(web.checkout, "3"), event(web.purchase, "2"), event("omni_purchase", "200")],
    action_values: [event(web.cart, "400"), event(web.checkout, "300"), event(web.purchase, "250"), event("omni_purchase", "25000")]};
  const before = JSON.stringify(row);
  const mapped = mapMetaPdMetrics(row);
  assert.deepEqual(Object.keys(mapped.raw_metrics), RAW_METRICS);
  assert.deepEqual(mapped.raw_metrics, {impression: 100, ad_click: 7, spend_value: 12.5,
    add_to_cart: 4, add_to_cart_value: 400, checkout: 3, checkout_value: 300, purchase: 2, purchase_value: 250});
  assert.equal(JSON.stringify(row), before);
  assert.deepEqual(Object.keys(META_PD_METRIC_SOURCES), RAW_METRICS);
});

test("03 has no Click or omni fallback and never sums attribution windows", () => {
  const mapped = mapMetaPdMetrics({clicks: "50", inline_link_clicks: "40",
    actions: [event("omni_purchase", "8")], action_values: [event("omni_purchase", "900")]});
  assert.equal(mapped.raw_metrics.ad_click, null);
  assert.equal(mapped.raw_metrics.purchase, null);
  assert.equal(mapped.raw_metrics.purchase_value, null);
  const windows = mapMetaPdMetrics({actions: [event(web.purchase, "2", {"1d_click": "1", "7d_click": "2"})]});
  assert.equal(windows.raw_metrics.purchase, 2);
  assert.equal(mapMetaPdMetrics({actions: [{action_type: web.purchase, "7d_click": "2"}]}).raw_metrics.purchase, null);
});

test("03 preserves missing, null, empty, explicit zero and independent value availability", () => {
  const missing = mapMetaPdMetrics({});
  for (const metric of RAW_METRICS) {
    assert.equal(missing.raw_metrics[metric], null);
    assert.equal(missing.metric_support[metric], "unknown");
    assert.equal(missing.observation_state[metric], "absent");
  }
  assert.equal(mapMetaPdMetrics({actions: null}).observation_state.purchase, "absent");
  assert.equal(mapMetaPdMetrics({actions: []}).observation_state.purchase, "empty");
  const zero = mapMetaPdMetrics({impressions: "0", spend: 0, actions: [event(web.purchase, "0")]});
  assert.equal(zero.raw_metrics.purchase, 0);
  assert.equal(zero.metric_support.purchase, "supported");
  assert.equal(zero.observation_state.purchase, "zero");
  assert.equal(zero.raw_metrics.purchase_value, null);
  assert.equal(mapMetaPdMetrics({action_values: [event(web.purchase, "0")]}).raw_metrics.purchase, null);
});

test("03 rejects malformed metrics and duplicate selected actions without guessing", () => {
  const bad = [true, "", " ", "NaN", "Infinity", "0x10", "1e3", "-1", -1, Infinity, {}, []];
  for (const value of bad) assert.throws(() => mapMetaPdMetrics({spend: value}), error => error.code === "META_REPORTING_SCHEMA_CHANGED");
  for (const actions of [{}, "0", [null], [{value: "1"}], [event(web.purchase, "2"), event(web.purchase, "2")]]) {
    assert.throws(() => mapMetaPdMetrics({actions}), error => error.code === "META_REPORTING_SCHEMA_CHANGED");
  }
});

test("02 and 03 preserve the whole native response and attach PD only to Ad rows", async () => {
  const row = {ad_id: "ad-1", actions: [event(web.purchase, "2")], action_values: [event(web.purchase, "25")], custom: "untouched"};
  let requested;
  const page = await fetchMetaAdChannelInsightsPage({...input, fetchFn: async url => {
    requested = new URL(url); return json({data: [row]});
  }});
  assert.deepEqual(page.rows, [row]);
  assert.equal(page.pd_metric_rows[0].source_row_index, 0);
  assert.equal(page.pd_metric_rows[0].raw_metrics.purchase_value, 25);
  assert.equal(requested.searchParams.get("action_breakdowns"), "action_type");
  assert.equal(requested.searchParams.has("breakdowns"), false);
  for (const field of ["impressions", "clicks", "inline_link_clicks", "outbound_clicks", "spend", "actions", "action_values"]) {
    assert.ok(requested.searchParams.get("fields").split(",").includes(field));
  }
  const product = {product_id: "p-1", converted_product_quantity: [], converted_product_value: null,
    converted_promoted_product_quantity: [{action_type: "purchase", value: "2"}], converted_promoted_product_value: "0"};
  for (const includePromotedProductMetrics of [undefined, false, true]) {
    const result = await fetchMetaProductBreakdownInsightsPage({...input, includePromotedProductMetrics,
      fetchFn: async url => {
        for (const field of ["converted_product_quantity", "converted_product_value", "converted_promoted_product_quantity", "converted_promoted_product_value"]) {
          assert.ok(new URL(url).searchParams.get("fields").split(",").includes(field));
        }
        return json({data: [product]});
      }});
    assert.deepEqual(result.rows, [product]);
    assert.equal(result.pd_metric_rows, undefined);
  }
});

test("02 + 03 contract tracks implemented projection separately from pending live product acceptance", async () => {
  const contract = JSON.parse(await readFile("contracts/eo-04b-meta-reporting-runtime-v1.json", "utf8"));
  assert.deepEqual(contract.query_alignment.inventory_items, ["02", "03"]);
  assert.equal(contract.query_alignment.standard_product_request_includes_promoted_fields, true);
  assert.equal(contract.query_alignment.live_acceptance, "pending");
  assert.equal(contract.query_alignment.projection_is_complete_canonical_dataset_fact, false);
  assert.equal(contract.product_breakdown_slice.sales_role_classification, false);
  assert.equal(contract.product_breakdown_slice.product_metric_semantics, "validation_pending_real_catalog_response");
});
