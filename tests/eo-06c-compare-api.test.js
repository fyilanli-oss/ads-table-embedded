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
    assert.match(sql, /analytics\.read_report_sales_compare\(\$1::uuid,\$2::bigint,\$3::bigint/);
    calls.push({kind: "report", values});
    if (reportError) throw reportError;
    return {rows};
  }};
  return {dependencies: {authenticateAdmin, database}, calls};
}

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
