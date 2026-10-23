import assert from "node:assert/strict";
import test from "node:test";
import {buildGoogleShoppingSourceLinks} from "../app/lib/providers/google-source-links.server.js";
import {buildGoogleReportingQueries, fetchGoogleReportingPage} from "../app/lib/providers/google-reporting.server.js";

const scope = Object.freeze({workspace_id: "workspace-1", install_generation: 2,
  connection_id: "connection-1", reporting_account_id: "100"});
const dateWindow = {start: "2026-10-01", end: "2026-10-02"};
const pd = {customer: {id: "100"}, campaign: {id: "200", advertisingChannelType: "SHOPPING"},
  adGroup: {id: "300", name: "Group"}, segments: {date: "2026-10-01"}, metrics: {costMicros: "300000000"}};
const product = {...pd, segments: {...pd.segments, productMerchantId: "400", productFeedLabel: "TR",
  productItemId: "shopify_TR_500_600"}, metrics: {costMicros: "18000000", clicks: "2"}};
const sale = {...product, segments: {...product.segments, productSoldItemId: "other-product"},
  metrics: {unitsSold: "1", revenueMicros: "25000000", crossSellUnitsSold: "1", allUnitsSold: "9"}};
const build = (pdRows = [pd], productRows = [product], saleRows = [sale], overrides = {}) =>
  buildGoogleShoppingSourceLinks({scope, dateWindow, pdRows, productRows, saleRows, ...overrides});

test("09 scoped cart query adds Ad Group only for Shopping, without changing the general report", async () => {
  const queries = buildGoogleReportingQueries({dateWindow});
  const general = queries.cart_data_product_sales_daily;
  const scoped = queries.shopping_cart_data_product_sales_daily;
  assert.doesNotMatch(general, /ad_group[.]|asset_group[.]|ad_group_ad[.]|advertising_channel_type =/);
  assert.equal(scoped.replace("  ad_group.id,\n  ad_group.name,\n", "")
    .replace("\n  AND campaign.advertising_channel_type = 'SHOPPING'", ""), general);
  assert.match(scoped, /segments[.]product_item_id/);
  assert.match(scoped, /segments[.]product_sold_item_id/);
  assert.match(scoped, /metrics[.]units_sold/);
  assert.match(scoped, /metrics[.]all_units_sold/);
  assert.doesNotMatch(scoped, /metrics[.](impressions|clicks|cost_micros)|asset_group[.]|ad_group_ad[.]/);
  const result = await fetchGoogleReportingPage({customerId: "100", queryFamily: "shopping_cart_data_product_sales_daily",
    dateWindow, client: {async search(input) {
      assert.equal(input.query, scoped);
      return {results: [sale], next_page_token: null, request_id: "fixture-request"};
    }}});
  assert.deepEqual(result.rows, [sale]);
  assert.equal(result.evidence.query, scoped);
});

test("09 links product performance and sold-product evidence to one scoped Ad Group without copying values", () => {
  const before = JSON.stringify({pd, product, sale});
  const result = build();
  for (const link of [...result.product_performance_links, ...result.product_sales_links]) {
    assert.equal(link.pd_row_index, 0);
    assert.equal(link.state, "exact_native_ad_group_reference");
    assert.deepEqual(link.native_leaf_key, {account_id: "100", campaign_id: "200", ad_group_id: "300", business_date: "2026-10-01"});
    assert.equal(link.shopify_identity_state, "unresolved_mapping_pending");
  }
  assert.deepEqual(result.product_sales_links[0].provider_product_key, {merchant_id: "400", feed_label: "TR",
    advertised_item_id: "shopify_TR_500_600", sold_item_id: "other-product"});
  assert.equal(JSON.stringify({pd, product, sale}), before);
  assert.equal(result.publishable, false);
  assert.doesNotMatch(JSON.stringify(result), /costMicros|unitsSold|revenue|sales_role|shopify_product_id/);
  assert.ok(Object.isFrozen(result.product_sales_links[0].provider_product_key));
});

test("09 never joins another account, campaign, Ad Group or day; incomplete facts are retained", () => {
  for (const patch of [{customer: {id: "999"}}, {customer: {}}, {adGroup: {id: "0"}}, {adGroup: {}},
    {adGroup: {id: "301"}}, {campaign: {...pd.campaign, id: "201"}},
    {segments: {...product.segments, date: "2026-10-02"}}, {segments: {...product.segments, date: "2026-09-30"}},
    {segments: {...product.segments, date: "2026-02-30"}}, {segments: {date: "2026-10-01"}}]) {
    const result = build([pd], [{...product, ...patch}]);
    assert.equal(result.product_performance_links.length, 1);
    assert.equal(result.product_performance_links[0].state, "unresolved");
    assert.equal(result.product_performance_links[0].pd_row_index, null);
  }
  const missing = build([], [product], [sale]);
  assert.equal(missing.product_sales_links[0].provider_product_key.sold_item_id, "other-product");
  assert.equal(missing.product_sales_links[0].observed_context.ad_group_id, "300");
  assert.equal(missing.product_sales_links[0].pd_row_index, null);
  assert.equal(build([pd, {...pd}]).product_performance_links[0].state, "ambiguous");
  const renamed = build([{...pd, adGroup: {...pd.adGroup, name: "renamed"}}]);
  assert.equal(renamed.product_sales_links[0].state, "exact_native_ad_group_reference");
});

test("10 and 12 never substitute Ad Group or current listings for the missing native leaf", () => {
  for (const type of ["SEARCH", "PERFORMANCE_MAX"]) {
    const result = build([pd], [{...product, campaign: {...pd.campaign, advertisingChannelType: type}}],
      [{...sale, campaign: {...pd.campaign, advertisingChannelType: type}}]);
    for (const link of [...result.product_performance_links, ...result.product_sales_links]) {
      assert.equal(link.state, "unresolved");
      assert.equal(link.pd_row_index, null);
      assert.match(link.reason, type === "SEARCH" ? /item_12/ : /item_10_11/);
    }
  }
});

test("09 retains multiple products and explicit zero as native facts, with empty and scoped references distinct", () => {
  const zero = {...sale, metrics: {unitsSold: "0", revenueMicros: "0"}};
  const result = build([pd], [product, {...product, segments: {...product.segments, productItemId: "second"}}], [zero]);
  assert.deepEqual(result.product_performance_links.map(link => [link.source_row_index, link.pd_row_index]), [[0, 0], [1, 0]]);
  assert.equal(result.product_sales_links.length, 1);
  assert.equal(zero.metrics.unitsSold, "0");
  assert.deepEqual(build([], [], []).product_sales_links, []);
  assert.notDeepEqual(build([pd], [product], [sale], {scope: {...scope, workspace_id: "other"}}).scope, result.scope);
  assert.throws(() => build([], [], [], {scope: {...scope, install_generation: 0}}),
    error => error.code === "GOOGLE_SOURCE_LINK_INPUT_INVALID");
});
