import assert from "node:assert/strict";
import test from "node:test";
import {buildGooglePmaxSourceLinks} from "../app/lib/providers/google-pmax-source-links.server.js";
import {buildGoogleReportingQueries} from "../app/lib/providers/google-reporting.server.js";
import {createGoogleReportingAuthorityRuntime} from "../app/lib/providers/google-reporting-authority.server.js";

const scope = {workspace_id: "11111111-1111-4111-8111-111111111111", install_generation: 2,
  connection_id: "22222222-2222-4222-8222-222222222222", reporting_account_id: "100"};
const dateWindow = {start: "2026-10-01", end: "2026-10-01"};
const timezone = "Atlantic/Reykjavik";
const pd = {customer: {id: "100"}, campaign: {id: "200", advertisingChannelType: "PERFORMANCE_MAX"},
  assetGroup: {id: "401", name: "Summer"}, segments: {date: dateWindow.start}, metrics: {costMicros: "300000000"}};
const product = {...pd, segments: {...pd.segments, productMerchantId: "300", productFeedLabel: "TR",
  productLanguage: "tr", productItemId: "A", productBrand: "Brand"}, metrics: {clicks: "2", costMicros: "18000000"}};
const sale = {...product, segments: {...product.segments, productSoldItemId: "B"},
  metrics: {unitsSold: "1", revenueMicros: "25000000", crossSellUnitsSold: "1", allUnitsSold: "99"}};
function snapshot(group = "401", dimensions = []) {
  return {account_id: "100", campaign_id: "200", asset_group_id: group, merchant_id: "300", feed_label: "TR", language: "tr",
    timezone, tree_hash: `reviewed-tree-${group}`, valid_from: "2026-10-01T00:00:00Z", valid_to: "2026-10-02T00:00:00Z",
    rows: [{customer: {id: "100"}, campaign: {id: "200"}, assetGroup: {id: group, name: `Group ${group}`},
      assetGroupListingGroupFilter: {type: "UNIT_INCLUDED", listingSource: "SHOPPING", path: {dimensions}}}]};
}
function membership(snapshots = [snapshot()]) {
  return {scope: {...scope}, timezone, complete: true,
    businessWindow: {business_date: dateWindow.start, timezone, start: "2026-10-01T00:00:00Z", end: "2026-10-02T00:00:00Z"}, snapshots};
}
const build = (overrides = {}) => buildGooglePmaxSourceLinks({scope, dateWindow, timezone, pdRows: [pd],
  productRows: [product], saleRows: [sale], listingEvidence: membership(), ...overrides});

test("PMax dedicated cart query keeps normal and all metrics separate and requests product language", () => {
  const q = buildGoogleReportingQueries({dateWindow});
  assert.match(q.pmax_cart_data_product_sales_daily, /FROM cart_data_sales_view/);
  assert.match(q.pmax_cart_data_product_sales_daily, /advertising_channel_type = 'PERFORMANCE_MAX'/);
  assert.match(q.pmax_cart_data_product_sales_daily, /segments.product_language/);
  assert.match(q.pmax_product_daily, /segments.product_language/);
  assert.doesNotMatch(q.pmax_cart_data_product_sales_daily, /asset_group\.|ad_group\./);
  assert.doesNotMatch(q.cart_data_product_sales_daily, /advertising_channel_type =/);
});
test("unique period-valid advertised membership links performance and cross-sell without allocating PD spend", () => {
  const before = JSON.stringify({pd, product, sale});
  const result = build();
  for (const row of [...result.product_performance_links, ...result.product_sales_links]) {
    assert.equal(row.channel_id, "401"); assert.equal(row.pd_row_index, 0);
    assert.equal(row.state, "resolved_from_reviewed_membership");
  }
  assert.equal(result.product_sales_links[0].sales_role, "Cross-sell");
  assert.equal(result.metrics_allocated, false); assert.equal(result.publishable, false);
  assert.equal(result.native_attribution_verified, false);
  assert.equal(JSON.stringify({pd, product, sale}), before);
  assert.doesNotMatch(JSON.stringify(result), /300000000|allUnitsSold/);
});
test("Advertised stays Advertised; sold cross-sell membership never selects the source Channel", () => {
  const advertised = {...sale, segments: {...sale.segments, productSoldItemId: "A"},
    metrics: {unitsSold: "1", leadUnitsSold: "1"}};
  assert.equal(build({saleRows: [advertised]}).product_sales_links[0].sales_role, "Advertised");
  const second = snapshot("402", [{productItemId: {value: "B"}}]);
  const first = snapshot("401", [{productItemId: {value: "A"}}]);
  assert.equal(build({listingEvidence: membership([first, second])}).product_sales_links[0].channel_id, "401");
});
test("two eligible groups preserve both candidates and sales role under Unclassified", () => {
  const row = build({listingEvidence: membership([snapshot(), snapshot("402")])}).product_sales_links[0];
  assert.equal(row.channel_type, "Unclassified Channel");
  assert.equal(row.sales_role, "Cross-sell"); assert.deepEqual(row.candidate_asset_group_ids, ["401", "402"]);
});
test("other campaign membership does not erase a known source campaign", () => {
  const other = {...snapshot("402"), campaign_id: "900"};
  assert.equal(build({listingEvidence: membership([snapshot(), other])}).product_sales_links[0].channel_id, "401");
});
for (const [label, change] of Object.entries({
  missing: () => null,
  partial: e => ({...e, complete: false}),
  wrong_workspace: e => ({...e, scope: {...e.scope, workspace_id: "other"}}),
  wrong_connection: e => ({...e, scope: {...e.scope, connection_id: "other"}}),
  wrong_account: e => ({...e, scope: {...e.scope, reporting_account_id: "101"}}),
  wrong_generation: e => ({...e, scope: {...e.scope, install_generation: 3}}),
  wrong_timezone: e => ({...e, timezone: "UTC"}),
  partial_day: e => ({...e, businessWindow: {...e.businessWindow, start: "2026-10-01T01:00:00Z"}}),
  timezone_free_instant: e => ({...e, businessWindow: {...e.businessWindow, start: "2026-10-01T00:00:00"}}),
  malformed_candidate: e => ({...e, snapshots: [...e.snapshots, null]}),
  stale: e => ({...e, snapshots: [{...e.snapshots[0], valid_to: "2026-10-01T10:00:00Z"}]}),
  wrong_merchant: e => ({...e, snapshots: [{...e.snapshots[0], merchant_id: "999"}]}),
  wrong_feed: e => ({...e, snapshots: [{...e.snapshots[0], feed_label: "OTHER"}]}),
  wrong_language: e => ({...e, snapshots: [{...e.snapshots[0], language: "en"}]}),
})) test(`membership ${label} cannot manufacture a unique Channel`, () => {
  const row = build({listingEvidence: change(membership())}).product_sales_links[0];
  assert.equal(row.channel_type, "Unclassified Channel"); assert.equal(row.channel_id, null);
  assert.equal(row.sales_role, "Cross-sell");
});
test("an unknown dimension in another candidate blocks false uniqueness", () => {
  const second = snapshot("402", [{productCategory: {level: "LEVEL1", categoryId: "123"}}]);
  const row = build({listingEvidence: membership([snapshot(), second])}).product_sales_links[0];
  assert.equal(row.reason, "membership_dimension_or_source_not_verified"); assert.equal(row.channel_id, null);
});
test("conflicting product context or PD rows stays unresolved", () => {
  assert.equal(build({productRows: [product, product]}).product_sales_links[0].channel_id, null);
  assert.equal(build({pdRows: []}).product_sales_links[0].reason, "asset_group_PD_reference_missing");
  assert.equal(build({pdRows: [pd, pd]}).product_sales_links[0].reason, "asset_group_PD_reference_ambiguous");
});
test("a known second Asset Group omitted from membership prevents false uniqueness", () => {
  const row = build({pdRows: [pd, {...pd, assetGroup: {id: "402"}}]}).product_sales_links[0];
  assert.equal(row.channel_id, null); assert.equal(row.reason, "observed_asset_group_missing_from_membership_inventory");
});
test("bounded membership work stops a large candidate scan instead of returning a partial resolution", () => {
  const groups = Array.from({length: 1500}, (_, i) => String(1000 + i));
  assert.throws(() => build({pdRows: groups.map(group => ({...pd, assetGroup: {id: group}})),
    listingEvidence: membership(groups.map(group => snapshot(group)))}), e => e.code === "GOOGLE_PMAX_SOURCE_WORK_BOUND_EXCEEDED");
});
test("a 23-hour DST business day is accepted, not forced into UTC or 24 hours", () => {
  const d = "2026-03-29", tz = "Europe/Berlin", input = membership();
  input.timezone = tz; input.businessWindow = {business_date: d, timezone: tz,
    start: "2026-03-28T23:00:00Z", end: "2026-03-29T22:00:00Z"};
  input.snapshots[0] = {...input.snapshots[0], timezone: tz, valid_from: input.businessWindow.start, valid_to: input.businessWindow.end};
  const dated = row => ({...row, segments: {...row.segments, date: d}});
  assert.equal(build({timezone: tz, dateWindow: {start: d, end: d}, pdRows: [dated(pd)], productRows: [dated(product)],
    saleRows: [dated(sale)], listingEvidence: input}).product_sales_links[0].channel_id, "401");
});

const installationAuthority = {authority: "shopify_installation_verified", workspaceId: scope.workspace_id,
  installGeneration: 2, status: "active"};
const environment = {GOOGLE_ADS_OAUTH_CLIENT_ID: "client.apps.googleusercontent.com", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "synthetic",
  GOOGLE_ADS_OAUTH_REDIRECT_URI: "https://embedded.adstable.app/auth/google-ads/callback", GOOGLE_ADS_DEVELOPER_TOKEN: "synthetic"};
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});
const limits = {maxPages: 3, maxRows: 100, maxBytes: 200000};
function runtime(scenario = "normal") {
  const calls = [];
  const instance = createGoogleReportingAuthorityRuntime({environment,
    database: {async query() {return {rows: [{connection_id: scope.connection_id,
      credential_id: "33333333-3333-4333-8333-333333333333", granted_scopes: ["https://www.googleapis.com/auth/adwords"],
      connected_at: "2026-10-01T00:00:00Z", last_verified_at: "2026-10-01T00:00:00Z", reporting_account_id: "100",
      accounts: [{id: "100", kind: "advertiser", reporting_eligible: true, currency: "TRY", timezone}]}]};}},
    tokenVault: {async loadProviderTokenSet() {return {refresh_token: "synthetic-refresh"};}},
    fetchFn: async (address, options) => {
      if (new URL(address).hostname !== "googleads.googleapis.com") return json({access_token: "synthetic-access", token_type: "Bearer", expires_in: 3600});
      const body = JSON.parse(options.body); calls.push(body);
      if (scenario === "error" && calls.length === 2) return json({error: {code: 500, status: "INTERNAL"}}, 500);
      if (scenario === "slow") await new Promise(resolve => setTimeout(resolve, 40));
      const family = /FROM asset_group_listing_group_filter/.test(body.query) ? "listing"
        : /FROM cart_data_sales_view/.test(body.query) ? "sale" : /FROM shopping_performance_view/.test(body.query) ? "product" : "pd";
      const rows = {pd: [pd], product: [product], sale: [sale], listing: snapshot().rows}[family];
      const next = scenario === "loop" ? "loop" : scenario === "paged" && family === "product" && !body.pageToken ? "next" : null;
      return json({results: body.pageToken ? [] : rows, ...(next ? {nextPageToken: next} : {})});
    }});
  return {instance, calls};
}
test("runtime reads all four bounded families and current inventory never becomes historical evidence", async () => {
  const {instance, calls} = runtime("paged");
  const result = await instance.readPmaxSourceEvidenceSnapshot({installationAuthority, dateWindow, limits});
  assert.equal(calls.length, 5); assert.equal(result.source_links.product_sales_links[0].sales_role, "Cross-sell");
  assert.equal(result.source_links.product_sales_links[0].channel_id, null);
  assert.equal(result.current_listing_tree_is_historical_evidence, false);
  assert.deepEqual(result.results.pmax_cart_data_product_sales_daily.rows, [sale]);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-access|synthetic-refresh/);
});
test("runtime invokes the existing resolver only with separate reviewed period evidence", async () => {
  const {instance} = runtime();
  const result = await instance.readPmaxSourceEvidenceSnapshot({installationAuthority, dateWindow, limits, listingEvidence: membership()});
  assert.equal(result.source_links.product_sales_links[0].channel_id, "401"); assert.equal(result.publishable, false);
});
for (const scenario of ["error", "loop"]) test(`runtime ${scenario} stops before later families without partial success`, async () => {
  const {instance, calls} = runtime(scenario);
  await assert.rejects(instance.readPmaxSourceEvidenceSnapshot({installationAuthority, dateWindow, limits}));
  assert.equal(calls.length, 2);
});
test("shared row/byte bounds cover families and output", async () => {
  for (const bound of [{...limits, maxRows: 2}, {...limits, maxBytes: 50}]) {
    const {instance, calls} = runtime();
    await assert.rejects(instance.readPmaxSourceEvidenceSnapshot({installationAuthority, dateWindow, limits: bound}));
    assert.ok(calls.length <= 3);
  }
});
test("deadline and prior abort never advance to another family", async () => {
  const {instance, calls} = runtime("slow");
  await assert.rejects(instance.readPmaxSourceEvidenceSnapshot({installationAuthority, dateWindow, limits, maxElapsedMs: 10}), /DEADLINE/);
  await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(calls.length, 1);
  const cancelled = runtime(), controller = new AbortController(); controller.abort();
  await assert.rejects(cancelled.instance.readPmaxSourceEvidenceSnapshot({installationAuthority, dateWindow, limits, signal: controller.signal}), /ABORTED/);
  assert.equal(cancelled.calls.length, 0);
});
