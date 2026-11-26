import assert from "node:assert/strict";
import test from "node:test";
import {handleCompareRequest} from "../app/lib/reporting/compare-request.server.js";

const BASE = "https://ads.example/api/reports/compare";
const QUERY = "view=daily&startDate=2026-10-01&endDate=2026-10-07";
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const SHOP = "gid://shopify/Shop/111";
const DOMAIN = "store-a.myshopify.com";
const PRODUCT = "gid://shopify/Product/999";

function request(suffix = "", headers = {authorization: "Bearer test-session"}, method = "GET") {
  return new Request(`${BASE}?${QUERY}${suffix}`, {method, headers});
}

function fixture({authorityError, reportError, ownerMissing = false, mismatchedShop = false, rows = []} = {}) {
  const calls = [];
  const authenticateAdmin = async () => {
    calls.push({kind: "authenticate"});
    if (authorityError) throw authorityError;
    return {
      sessionToken: {dest: `https://${DOMAIN}`},
      admin: {graphql: async () => Response.json({data: {shop: {
        id: SHOP, myshopifyDomain: mismatchedShop ? "store-b.myshopify.com" : DOMAIN,
      }}})},
    };
  };
  const database = {async query(sql, values) {
    if (sql.includes("shopify.resolve_active_installation(")) {
      calls.push({kind: "installation", values});
      return {rows: [{workspace_id: WORKSPACE, install_generation: "3", installation_status: "active"}]};
    }
    if (sql.includes("shopify.load_active_installation_owner(")) {
      calls.push({kind: "owner", values});
      return {rows: ownerMissing ? [] : [{workspace_id: WORKSPACE, installation_id: "9007199254740995",
        install_generation: "3", installation_status: "active", shop_id: SHOP, shop_domain: DOMAIN}]};
    }
    assert.match(sql, /analytics\.(?:read_report_sales_compare|read_v1_report_sales)\(\$1::uuid,\$2::bigint,\$3::bigint/);
    calls.push({kind: "report", values});
    if (reportError) throw reportError;
    return {rows};
  }};
  return {dependencies: {authenticateAdmin, database}, calls};
}

const OTHER_PRODUCT = "gid://shopify/Product/998";
const v1Query = `&grain=product&bucket=daily&platform=google_ads&platform=klaviyo&product=${encodeURIComponent(PRODUCT)}&product=${encodeURIComponent(OTHER_PRODUCT)}`;
const reportFact = {
  period: "primary", date_label: "2026-10-02", day_offset: 1, source_timezone: "Europe/Istanbul",
  time_basis: "native_query_business_date", conversion_scope: "normal", units: "native_count_and_source_currency",
  platform: "google_ads", platform_account_id: "account-a", root_entity_type: "campaign", campaign_id: "campaign-a",
  campaign_name: "Campaign A", campaign_format: "SHOPPING", channel_type: "ad_group", channel_id: "channel-a",
  channel_name: "Channel A", channel_resolution: "verified", advertised_product_id: PRODUCT,
  sold_product_id: OTHER_PRODUCT, sales_role: "Cross-sell", sales_quantity: "2", sales_value: "100",
  currency: "TRY", reporting_currency: null, reporting_value: null, source_completeness: "complete",
  quantity_support: "supported", quantity_observation: "present", value_support: "supported", value_observation: "present",
  destination_count: 1, destination_campaign_type: "campaign", destination_campaign_id: "campaign-a",
  destination_channel_type: "ad_group", destination_channel_id: "channel-a",
};

async function readV1(rows, suffix = v1Query) {
  const f = fixture({rows});
  const response = await handleCompareRequest(request(suffix), f.dependencies);
  assert.equal(response.status, 200);
  return {body: await response.json(), calls: f.calls};
}

test("V1 multi-selection reads one A → B sale for both screens and keeps the two relationship identities", async () => {
  const {body, calls} = await readV1([reportFact]);
  assert.deepEqual(calls.at(-1).values.slice(8), [["google_ads", "klaviyo"], null, null, null, [PRODUCT, OTHER_PRODUCT]]);
  assert.equal(body.version, "report-v1");
  assert.equal(body.primary.scopes[0].purchase.value, "2");
  assert.equal(body.primary.groups[0].sales.value, "100");
  assert.deepEqual(body.primary.groups[0].identity, [OTHER_PRODUCT]);
  assert.equal(body.primary.groups[0].salesShare, "1");
  assert.deepEqual(body.primary.productLinks.map(link => [link.from, link.to, link.mutual, link.sales.value]),
    [[PRODUCT, OTHER_PRODUCT, false, "100"]]);
  assert.deepEqual(body.primary.channelLinks.map(link => [link.category, link.sales.value]), [["Same Channel", "100"]]);
});

test("V1 reciprocal product facts keep both directions, while Klaviyo without an advertised product still counts", async () => {
  const {body} = await readV1([reportFact, {...reportFact, advertised_product_id: OTHER_PRODUCT, sold_product_id: PRODUCT,
    sales_value: "25", sales_quantity: "1", destination_count: 0}, {...reportFact, platform: "klaviyo", root_entity_type: "flow",
    channel_type: "flow_message", advertised_product_id: null, sales_role: "Triggered", sales_value: "40", sales_quantity: "1"}]);
  assert.deepEqual(body.primary.productLinks.map(link => [link.from, link.to, link.mutual, link.sales.value]),
    [[PRODUCT, OTHER_PRODUCT, true, "100"], [OTHER_PRODUCT, PRODUCT, true, "25"]]);
  assert.equal(body.primary.scopes[0].sales.value, "165");
  const {body: flow} = await readV1([{...reportFact, platform: "klaviyo", root_entity_type: "flow", channel_type: "flow_message",
    channel_name: "Welcome", advertised_product_id: null, sales_role: "Triggered", sales_value: "40", sales_quantity: "1"}],
  "&grain=channel&bucket=daily&role=Triggered");
  assert.equal(flow.primary.groups[0].channelName, "Welcome");
  assert.equal(flow.primary.groups[0].purchase.value, "1");
  assert.deepEqual(flow.primary.productLinks, []);
});

test("V1 ambiguous and absent placement never duplicate a sale or create a non-advertised class", async () => {
  for (const destination_count of [0, 2]) {
    const {body} = await readV1([{...reportFact, destination_count}]);
    assert.equal(body.primary.scopes[0].sales.value, "100");
    assert.equal(body.primary.productLinks.length, 1);
    assert.deepEqual(body.primary.channelLinks, []);
  }
});

test("V1 a recorded zero in the reverse direction is not a mutual sale", async () => {
  const {body} = await readV1([reportFact, {...reportFact, advertised_product_id: OTHER_PRODUCT,
    sold_product_id: PRODUCT, sales_value: "0", sales_quantity: "0"}]);
  assert.equal(body.primary.groups.length, 2);
  assert.deepEqual(body.primary.productLinks.map(link => [link.from, link.to, link.mutual]), [[PRODUCT, OTHER_PRODUCT, false]]);
});

test("V1 retains native currencies and product units with missing FX, and sums verified FX exactly", async () => {
  const trySale = {...reportFact, reporting_currency: "TRY", reporting_value: "100"};
  const usdSale = {...reportFact, currency: "USD", sales_value: "10", sales_quantity: "1", reporting_currency: "TRY"};
  const {body} = await readV1([trySale, usdSale]);
  assert.deepEqual(body.primary.scopes[0].sales, {currency: "TRY", value: null, state: "unknown"});
  assert.deepEqual(body.primary.scopes[0].salesByCurrency.map(m => [m.currency, m.value]), [["TRY", "100"], ["USD", "10"]]);
  assert.equal(body.primary.scopes[0].purchase.value, "3");
  const {body: converted} = await readV1([trySale, {...usdSale, reporting_value: "355.1234567890123456789"}]);
  assert.equal(converted.primary.scopes[0].sales.value, "455.1234567890123456789");
});

test("V1 keeps recorded zero and missing sales distinct and aligns the comparison dates", async () => {
  const missing = {...reportFact, sales_value: null, value_observation: "missing", source_completeness: "partial"};
  const {body} = await readV1([{...reportFact, sales_value: "0"}, missing,
    {...missing, period: "comparison", date_label: "2026-09-25"}], `${v1Query}&mode=previous-period`);
  assert.deepEqual(body.primary.scopes[0].sales, {currency: "TRY", value: "0", state: "partial"});
  assert.equal(body.comparison.scopes[0].sales.value, null);
  assert.equal(body.primary.buckets[1].key, body.comparison.buckets[1].key);
  assert.equal(body.comparison.buckets[1].startDate, "2026-09-25");
  const f = fixture();
  const response = await handleCompareRequest(request(`${v1Query}&mode=custom&compareStartDate=2026-10-04&compareEndDate=2026-10-10`), f.dependencies);
  assert.deepEqual([response.status, (await response.json()).code, f.calls], [400, "COMPARE_RANGES_OVERLAP", []]);
});

test("V1 weekly buckets keep partial weeks and split incompatible report scopes", async () => {
  const f = fixture({rows: [reportFact, {...reportFact, time_basis: "conversion_date", sales_value: "40"}]});
  const response = await handleCompareRequest(new Request(`${BASE}?grain=campaign&bucket=weekly&startDate=2026-10-01&endDate=2026-10-07`,
    {headers: {authorization: "Bearer test-session"}}), f.dependencies);
  assert.equal(response.status, 200);
  const {primary} = await response.json();
  assert.deepEqual(primary.buckets, [
    {key: "2026-09-28", startDate: "2026-10-01", endDate: "2026-10-04"},
    {key: "2026-10-05", startDate: "2026-10-05", endDate: "2026-10-07"},
  ]);
  assert.deepEqual(primary.scopes.map(scope => scope.sales.value), ["100", "40"]);
  assert.ok(primary.groups.every(group => group.campaignFormat === "SHOPPING"));
});

test("reads both date windows with one filter set and the verified installed shop", async () => {
  const shared = {source_timezone: "Europe/Istanbul", platform: "google_ads", platform_account_id: "account-a",
    campaign_id: "campaign-a", channel_id: "channel-a", sales_value: null, sales_quantity: "0",
    quantity_observation: "present", value_observation: "missing", source_completeness: "partial",
    workspace_id: WORKSPACE, source_batch_id: "private batch"};
  const f = fixture({rows: [{...shared, period: "comparison", day_offset: 2, business_date: "2026-09-26"},
    {...shared, period: "primary", day_offset: 1, business_date: "2026-10-02", sales_value: "36.75"}]});
  const response = await handleCompareRequest(request(`&mode=previous-period&platform=google_ads&account=account-a&campaign=campaign-a&channel=channel-a&product=${encodeURIComponent(PRODUCT)}`), f.dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(f.calls, [
    {kind: "authenticate"}, {kind: "installation", values: [SHOP, DOMAIN]},
    {kind: "owner", values: [WORKSPACE, 3, SHOP, DOMAIN]},
    {kind: "report", values: [WORKSPACE, "9007199254740995", 3, "daily", "2026-10-01", "2026-10-07",
      "2026-09-24", "2026-09-30", "google_ads", "account-a", "campaign-a", "channel-a", PRODUCT]},
  ]);
  const data = await response.json();
  assert.equal(data.version, "compare-v1");
  assert.deepEqual([data.primary.startDate, data.comparison.endDate, data.dayCount], ["2026-10-01", "2026-09-30", 7]);
  assert.deepEqual(data.comparison.rows.map(row => [row.date, row.dayOffset, row.salesQuantity, row.salesValue,
    row.quantityObservation, row.valueObservation, row.sourceCompleteness]),
  [["2026-09-26", 2, "0", null, "present", "missing", "partial"]]);
  assert.equal(data.primary.rows[0].salesValue, "36.75");
  assert.ok(!JSON.stringify(data).includes(WORKSPACE));
  assert.ok(!JSON.stringify(data).includes("private batch"));
});

test("rejects client-supplied scope, repeated keys, invalid dates and malformed filters before database access", async () => {
  const f = fixture();
  for (const query of ["&workspaceId=other", "&installationId=2", "&shop=store-b", "&generation=4",
    "&view=table", "&mode=custom&compareStartDate=2026-09-24&compareEndDate=2026-09-29",
    "&compareStartDate=2026-09-24", "&campaign=campaign-a", "&product=0"]) {
    assert.equal((await handleCompareRequest(request(query), f.dependencies)).status, 400, query);
  }
  assert.deepEqual(f.calls, []);
});

test("rejects unauthenticated, cross-origin and write requests before I/O", async () => {
  const f = fixture();
  assert.equal((await handleCompareRequest(request("", {}), f.dependencies)).status, 401);
  assert.equal((await handleCompareRequest(request("", {authorization: "Bearer test-session", origin: "https://other.example"}), f.dependencies)).status, 403);
  const post = await handleCompareRequest(request("", {}, "POST"), f.dependencies);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET");
  assert.deepEqual(f.calls, []);
});

test("fails closed when the token shop or durable installation does not match", async () => {
  for (const setup of [{mismatchedShop: true}, {ownerMissing: true}]) {
    const f = fixture(setup);
    assert.equal((await handleCompareRequest(request(), f.dependencies)).status, 403);
    assert.ok(!f.calls.some(call => call.kind === "report"));
  }
});

test("keeps Shopify session recovery headers and sanitizes database errors", async () => {
  const denied = fixture({authorityError: new Response(null, {status: 401,
    headers: {"X-Shopify-Retry-Invalid-Session-Request": "1"}})});
  const response = await handleCompareRequest(request(), denied.dependencies);
  assert.equal(response.headers.get("X-Shopify-Retry-Invalid-Session-Request"), "1");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const missing = fixture({reportError: Object.assign(new Error("private database diagnostic"), {code: "42883"})});
  const unavailable = await handleCompareRequest(request(), missing.dependencies);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {code: "COMPARE_UNAVAILABLE"});
});

test("reports empty results without synthesizing zeros and rejects a mismatched SQL period", async () => {
  const empty = fixture();
  const data = await (await handleCompareRequest(request(), empty.dependencies)).json();
  assert.deepEqual(data.primary.rows, []);
  assert.equal(data.comparison, null);
  assert.deepEqual(empty.calls.at(-1).values.slice(6, 8), [null, null]);
  const inconsistent = fixture({rows: [{period: "comparison", business_date: "2026-10-02", day_offset: 1}]});
  assert.equal((await handleCompareRequest(request(), inconsistent.dependencies)).status, 503);
});
