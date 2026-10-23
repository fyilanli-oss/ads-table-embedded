import assert from "node:assert/strict";
import test from "node:test";
import {RAW_METRICS} from "../app/lib/providers/common-adapter.server.js";
import {buildKlaviyoPdValuesRequest, selectKlaviyoPdShopifyMetrics, mapKlaviyoPdMetrics,
  runKlaviyoPdReportingFamilies, KLAVIYO_PD_CONVERSION_METRICS} from "../app/lib/providers/klaviyo-reporting.server.js";

const metric = (id, name, integration = "Shopify") => ({type: "metric", id, attributes: {name, integration: {name: integration}}});
const input = {accessToken: "fixture", businessDate: "2026-10-17", timeZone: "Europe/Istanbul"};

test("14 creates separate Campaign and Flow metric requests without duplicating delivery", () => {
  for (const kind of ["campaign", "flow"]) for (const conversionMetricName of KLAVIYO_PD_CONVERSION_METRICS) {
    const request = buildKlaviyoPdValuesRequest({...input, kind, conversionMetricName, conversionMetricId: conversionMetricName, pageCursor: "next"});
    const body = JSON.parse(request.body);
    assert.equal(body.data.attributes.conversion_metric_id, conversionMetricName);
    assert.equal(request.headers.revision, "2026-10-15");
    assert.equal(body.data.type, `${kind}-values-report`);
    assert.equal(new URL(request.url).searchParams.get("page_cursor"), "next");
    assert.deepEqual(body.data.attributes.statistics, conversionMetricName === "Placed Order"
      ? ["delivered", "clicks", "conversions", "conversion_value"] : ["conversions", "conversion_value"]);
    for (const dimension of [`${kind}_id`, `${kind}_message_id`, "send_channel", "variation"]) {
      assert.ok(body.data.attributes.group_by.includes(dimension));
    }
    assert.equal(body.data.attributes.timeframe.start, "2026-10-17T00:00:00+03:00");
  }
  assert.throws(() => buildKlaviyoPdValuesRequest({...input, kind: "campaign", conversionMetricName: "Ordered Product", conversionMetricId: "x"}));
});

test("14 discovery excludes custom metrics and distinguishes missing from ambiguous configuration", () => {
  const selected = selectKlaviyoPdShopifyMetrics([metric("p", "Placed Order"), metric("a", "Added to Cart"),
    metric("custom", "Checkout Started", "API")]);
  assert.equal(selected["Checkout Started"].metric_id, null);
  assert.equal(selected["Checkout Started"].state, "account_configuration_missing");
  assert.equal(selected["Added to Cart"].metric_id, "a");
  assert.throws(() => selectKlaviyoPdShopifyMetrics([metric("a", "Added to Cart"), metric("b", "Added to Cart")]));
  assert.throws(() => selectKlaviyoPdShopifyMetrics([metric("a", "Added to Cart"), metric("a", "Placed Order")]));
});

test("13 maps accepted delivery and click rather than recipients, unique counters or opens", () => {
  const row = {statistics: {delivered: 100, clicks: 7, conversions: 2, conversion_value: 300,
    recipients: 500, clicks_unique: 4, conversion_uniques: 1, opens: 900}};
  const before = JSON.stringify(row);
  const mapped = mapKlaviyoPdMetrics(row, "Placed Order");
  assert.deepEqual(Object.keys(mapped.raw_metrics), RAW_METRICS);
  assert.equal(mapped.raw_metrics.impression, 100);
  assert.equal(mapped.raw_metrics.ad_click, 7);
  assert.equal(mapped.raw_metrics.purchase, 2);
  assert.equal(mapped.raw_metrics.purchase_value, 300);
  assert.equal(mapped.raw_metrics.spend_value, null);
  assert.equal(mapped.spend_state, "open_no_calculation");
  assert.equal(mapped.raw_metrics.add_to_cart, null);
  assert.equal(JSON.stringify(row), before);
  const onlyAlternatives = mapKlaviyoPdMetrics({statistics: {recipients: 50, clicks_unique: 9, conversion_uniques: 3}}, "Placed Order");
  assert.equal(onlyAlternatives.raw_metrics.impression, null);
  assert.equal(onlyAlternatives.raw_metrics.ad_click, null);
  assert.equal(onlyAlternatives.raw_metrics.purchase, null);
});

test("14 funnel counts and values are independent; no copied impression/click/purchase", () => {
  for (const [name, count, value] of [["Added to Cart", "add_to_cart", "add_to_cart_value"],
    ["Checkout Started", "checkout", "checkout_value"]]) {
    const mapped = mapKlaviyoPdMetrics({statistics: {conversions: 0, delivered: 999, clicks: 999}}, name);
    assert.equal(mapped.raw_metrics[count], 0);
    assert.equal(mapped.observation_state[count], "zero");
    assert.equal(mapped.raw_metrics[value], null);
    assert.equal(mapped.observation_state[value], "absent");
    for (const key of ["impression", "ad_click", "purchase", "spend_value"]) assert.equal(mapped.raw_metrics[key], null);
  }
  for (const value of ["", " ", true, [], {}, "NaN", -1]) {
    assert.throws(() => mapKlaviyoPdMetrics({statistics: {conversions: value}}, "Placed Order"));
  }
});

test("14 first family failure discards staged results and never retries", async () => {
  const selected = selectKlaviyoPdShopifyMetrics(KLAVIYO_PD_CONVERSION_METRICS.map((name, i) => metric(String(i), name)));
  let calls = 0;
  const result = await runKlaviyoPdReportingFamilies({discoverMetrics: async () => ({selected}),
    fetchValues: async () => {calls++; if (calls === 2) throw new Error("fixture rejected"); return {rows: []};}});
  assert.equal(calls, 2);
  assert.equal(result.status, "failed");
  assert.equal(result.results, null);
  assert.equal(result.publishable, false);
});
