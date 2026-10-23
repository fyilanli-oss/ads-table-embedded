import assert from "node:assert/strict";
import test from "node:test";
import {RAW_METRICS} from "../app/lib/providers/common-adapter.server.js";
import {buildGoogleReportingQueries, mapGooglePdMetrics, fetchGoogleReportingPage,
  normalizeGoogleCartDataSale} from "../app/lib/providers/google-reporting.server.js";
const dateWindow = {start: "2026-10-01", end: "2026-10-01"};
const conversionFamily = "search_ad_conversion_action_daily";
const sale = (metrics, same = true) => ({segments: {date: dateWindow.start, productItemId: "a",
  productSoldItemId: same ? "a" : "b"}, metrics});

test("06 + 07 query exact leaves and separate conversion metrics from delivery cost", () => {
  const q = buildGoogleReportingQueries({dateWindow});
  assert.match(q.search_ad_channel_daily, /FROM ad_group_ad/);
  assert.match(q.search_ad_channel_daily, /ad_group_ad.ad.id/);
  assert.doesNotMatch(q.search_ad_channel_daily, /segments.conversion_action/);
  assert.match(q.ad_group_channel_daily, /advertising_channel_type = 'SHOPPING'/);
  for (const [family, resource, identity] of [
    [conversionFamily, "ad_group_ad", "ad_group_ad.ad.id"],
    ["shopping_ad_group_conversion_action_daily", "ad_group", "ad_group.id"],
    ["pmax_asset_group_conversion_action_daily", "asset_group", "asset_group.id"],
  ]) {
    assert.ok(q[family].includes(`FROM ${resource}\n`));
    assert.ok(q[family].includes(identity));
    for (const field of ["segments.date", "segments.conversion_action", "segments.conversion_action_category",
      "metrics.conversions", "metrics.conversions_value"]) assert.ok(q[family].includes(field));
    assert.doesNotMatch(q[family], /metrics\.(cost_micros|clicks|impressions|all_)/);
    assert.match(q[family], /ADD_TO_CART.*BEGIN_CHECKOUT.*PURCHASE/);
  }
});

test("08 separates normal category metrics, nonconversion performance and unit scaling", () => {
  const base = mapGooglePdMetrics({metrics: {impressions: "100", clicks: "7", costMicros: "2500000",
    conversions: 99, conversionsValue: 9900}}, "search_ad_channel_daily");
  assert.deepEqual(Object.keys(base.raw_metrics), RAW_METRICS);
  assert.equal(base.raw_metrics.spend_value, 2.5);
  assert.equal(base.raw_metrics.purchase, null);
  assert.equal(base.observation_state.purchase, "not_requested");
  for (const [category, countKey, valueKey] of [["PURCHASE", "purchase", "purchase_value"],
    ["ADD_TO_CART", "add_to_cart", "add_to_cart_value"], ["BEGIN_CHECKOUT", "checkout", "checkout_value"]]) {
    const mapped = mapGooglePdMetrics({segments: {conversionAction: "customers/1/conversionActions/2", conversionActionCategory: category},
      metrics: {conversions: 2.5, conversionsValue: 300, allConversions: 900, allConversionsValue: 90000}}, conversionFamily);
    assert.equal(mapped.raw_metrics[countKey], 2.5);
    assert.equal(mapped.raw_metrics[valueKey], 300);
    assert.equal(mapped.raw_metrics.spend_value, null);
  }
});

test("08 only all fields and missing normal value never become standard count/value", () => {
  const segments = {conversionAction: "x", conversionActionCategory: "PURCHASE"};
  const allOnly = mapGooglePdMetrics({segments, metrics: {allConversions: 3, allConversionsValue: 90}}, conversionFamily);
  assert.equal(allOnly.raw_metrics.purchase, null);
  assert.equal(allOnly.observation_state.purchase, "absent");
  const zero = mapGooglePdMetrics({segments, metrics: {conversions: 0, allConversions: 3}}, conversionFamily);
  assert.equal(zero.raw_metrics.purchase, 0);
  assert.equal(zero.observation_state.purchase, "zero");
  assert.equal(zero.raw_metrics.purchase_value, null);
});

test("08 cart data keeps only normal metrics as standard and all fields unchanged as raw", () => {
  const row = sale({unitsSold: 2, revenueMicros: "3000000", leadUnitsSold: 2, leadRevenueMicros: "3000000",
    allUnitsSold: 100, allRevenueMicros: "900000000", allCrossSellUnitsSold: 90});
  const mapped = normalizeGoogleCartDataSale(row);
  assert.equal(mapped.sales_role, "Advertised");
  assert.equal(mapped.raw_metrics.units_sold, 2);
  assert.equal(mapped.raw_metrics.all_units_sold, undefined);
  assert.deepEqual(mapped.raw_row, row);
  const all = normalizeGoogleCartDataSale(sale({allUnitsSold: 9, allLeadUnitsSold: 9}));
  assert.equal(all.raw_metrics.units_sold, null);
  assert.equal(all.sales_role, "Unclassified");
  const unidentifiedAdvertised = sale({allUnitsSold: 9});
  delete unidentifiedAdvertised.segments.productItemId;
  assert.equal(normalizeGoogleCartDataSale(unidentifiedAdvertised).sales_role, "Unclassified");
  const cross = normalizeGoogleCartDataSale(sale({unitsSold: 1, crossSellUnitsSold: 1, crossSellRevenueMicros: "0"}, false));
  assert.equal(cross.sales_role, "Cross-sell");
  const conflict = normalizeGoogleCartDataSale(sale({leadUnitsSold: 1, crossSellUnitsSold: 1}));
  assert.equal(conflict.sales_role, "Unclassified");
});

test("06 + 07 page retains complete native row and query fingerprint with linked projection", async () => {
  const row = {adGroupAd: {ad: {id: "10"}}, segments: {date: dateWindow.start, conversionAction: "x", conversionActionCategory: "PURCHASE"},
    metrics: {conversions: 1, conversionsValue: 25, allConversions: 100}};
  let calls = 0;
  const page = await fetchGoogleReportingPage({client: {async search(input) {calls++;
    assert.match(input.query, /FROM ad_group_ad/);
    return {results: [row], next_page_token: "next", request_id: "fixture"};}},
    customerId: "1", queryFamily: conversionFamily, dateWindow});
  assert.deepEqual(page.rows, [row]);
  assert.equal(page.pd_metric_rows[0].source_row_index, 0);
  assert.equal(page.pd_metric_rows[0].raw_metrics.purchase, 1);
  assert.equal(page.evidence.query_fingerprint.length, 64);
  assert.equal(page.next_cursor, "next");
  assert.equal(calls, 1);
});

test("malformed conversion projection and first query error do not retry or return partial data", async () => {
  assert.throws(() => mapGooglePdMetrics({segments: {conversionActionCategory: "PURCHASE"}}, conversionFamily));
  assert.throws(() => mapGooglePdMetrics({segments: {conversionAction: "x", conversionActionCategory: "toString"}}, conversionFamily));
  assert.throws(() => mapGooglePdMetrics({segments: {conversionAction: "x", conversionActionCategory: "PURCHASE"},
    metrics: {conversions: "broken"}}, conversionFamily));
  let calls = 0;
  await assert.rejects(fetchGoogleReportingPage({client: {async search() {calls++; throw new Error("fixture rejection");}},
    customerId: "1", queryFamily: conversionFamily, dateWindow}));
  assert.equal(calls, 1);
});
