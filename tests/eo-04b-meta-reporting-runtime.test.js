import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  buildMetaAdChannelInsightsUrl,
  buildMetaProductBreakdownInsightsUrl,
  classifyMetaReportingError,
  fetchMetaAdChannelInsightsPage,
  fetchMetaProductBreakdownInsightsPage,
  META_AD_CHANNEL_INSIGHTS_FIELDS,
  META_PRODUCT_BREAKDOWN_ID_LIMIT,
  META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS,
} from "../app/lib/providers/meta-reporting.server.js";
import {MetaGraphError} from "../app/lib/providers/meta-graph.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const contract = JSON.parse(read("contracts/eo-04b-meta-reporting-runtime-v1.json"));
const brief = read("docs/EO_04B_META_REPORTING_RUNTIME_START_BRIEF.md");

const json = (payload, status = 200, headers = {}) => new Response(
  JSON.stringify(payload),
  {status, headers: {"content-type": "application/json", ...headers}},
);

test("Meta first reporting slice is exact daily Ad Channel without product breakdown", () => {
  const url = new URL(buildMetaAdChannelInsightsUrl({
    adAccountId: "act_123456",
    dateWindow: {start: "2026-10-14", end: "2026-10-15"},
    after: "opaque-next",
  }));
  assert.equal(url.origin, "https://graph.facebook.com");
  assert.equal(url.pathname, "/v26.0/act_123456/insights");
  assert.equal(url.searchParams.get("level"), "ad");
  assert.equal(url.searchParams.get("time_increment"), "1");
  assert.equal(url.searchParams.get("after"), "opaque-next");
  assert.deepEqual(
    JSON.parse(url.searchParams.get("time_range")),
    {since: "2026-10-14", until: "2026-10-15"},
  );
  assert.deepEqual(url.searchParams.get("fields").split(","), META_AD_CHANNEL_INSIGHTS_FIELDS);
  assert.equal(url.searchParams.has("breakdowns"), false);
  assert.equal(contract.slice.product_breakdown, false);
  assert.equal(contract.slice.channel, "ad");
});

test("Meta reporting page preserves provider-native rows and opaque cursor evidence", async () => {
  const requests = [];
  const result = await fetchMetaAdChannelInsightsPage({
    accessToken: "secret-token",
    adAccountId: "act_123456",
    dateWindow: {start: "2026-10-14", end: "2026-10-14"},
    fetchFn: async (url, options) => {
      requests.push({url: String(url), options});
      return json({
        data: [{ad_id: "42", ad_name: "Earring", impressions: "10", spend: "4.25"}],
        paging: {cursors: {after: "cursor-2"}, next: "https://graph.facebook.com/next"},
      }, 200, {"x-fb-trace-id": "trace-1"});
    },
  });
  assert.equal(requests[0].options.headers.authorization, "Bearer secret-token");
  assert.equal(result.channel_type, "ad");
  assert.equal(result.fact_family, "ad_channel_daily_insights");
  assert.deepEqual(result.rows, [
    {ad_id: "42", ad_name: "Earring", impressions: "10", spend: "4.25"},
  ]);
  assert.equal(result.next_cursor, "cursor-2");
  assert.equal(result.provider_request_id, "trace-1");
  assert.deepEqual(result.evidence.breakdowns, []);
  assert.doesNotMatch(JSON.stringify(result.evidence), /secret-token/);
});

test("Meta second slice requests only raw daily Ad plus product_id breakdown evidence", () => {
  const url = new URL(buildMetaProductBreakdownInsightsUrl({
    adAccountId: "act_123456",
    dateWindow: {start: "2026-10-14", end: "2026-10-15"},
    after: "product-page-2",
  }));
  assert.equal(url.pathname, "/v26.0/act_123456/insights");
  assert.equal(url.searchParams.get("level"), "ad");
  assert.equal(url.searchParams.get("breakdowns"), "product_id");
  assert.equal(url.searchParams.get("product_id_limit"), String(META_PRODUCT_BREAKDOWN_ID_LIMIT));
  assert.equal(url.searchParams.get("time_increment"), "1");
  assert.equal(url.searchParams.get("after"), "product-page-2");
  assert.deepEqual(
    url.searchParams.get("fields").split(","),
    META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS,
  );
  assert.equal(url.searchParams.get("fields").includes("creative"), false);
  assert.equal(contract.product_breakdown_slice.sales_role_classification, false);
  assert.equal(contract.product_breakdown_slice.shopify_identity_verification, false);
});

test("Meta product breakdown preserves raw provider rows and validation-pending semantics", async () => {
  const result = await fetchMetaProductBreakdownInsightsPage({
    accessToken: "secret-token",
    adAccountId: "act_123456",
    dateWindow: {start: "2026-10-14", end: "2026-10-14"},
    fetchFn: async () => json({
      data: [{
        ad_id: "42",
        product_id: "retailer-7",
        impressions: "8",
        spend: "3.50",
        converted_product_quantity: [{action_type: "purchase", value: "2"}],
        converted_product_value: [{action_type: "purchase", value: "125.00"}],
      }],
      paging: {cursors: {after: "product-cursor"}, next: "https://graph.facebook.com/next"},
    }, 200, {"x-fb-request-id": "product-request-1"}),
  });
  assert.equal(result.fact_family, "ad_product_breakdown_daily_insights");
  assert.equal(result.channel_type, "ad");
  assert.equal(result.breakdown, "product_id");
  assert.equal(result.rows[0].product_id, "retailer-7");
  assert.deepEqual(result.rows[0].converted_product_quantity, [
    {action_type: "purchase", value: "2"},
  ]);
  assert.equal(result.next_cursor, "product-cursor");
  assert.equal(result.provider_request_id, "product-request-1");
  assert.equal(
    result.evidence.product_metric_semantics,
    "validation_pending_real_catalog_response",
  );
  assert.equal(result.evidence.provider_product_ad_cost_status, "validation_pending");
  assert.doesNotMatch(JSON.stringify(result.evidence), /secret-token/);
});

test("Meta product breakdown fails closed when a returned row lacks product_id", async () => {
  await assert.rejects(
    fetchMetaProductBreakdownInsightsPage({
      accessToken: "valid",
      adAccountId: "act_123456",
      dateWindow: {start: "2026-10-14", end: "2026-10-14"},
      fetchFn: async () => json({data: [{ad_id: "42", spend: "3.50"}]}),
    }),
    (error) => error.code === "META_REPORTING_SCHEMA_CHANGED",
  );
});

test("Meta reporting fails closed on invalid auth, schema and cursor", async () => {
  await assert.rejects(
    fetchMetaAdChannelInsightsPage({
      accessToken: "expired",
      adAccountId: "act_123456",
      dateWindow: {start: "2026-10-14", end: "2026-10-14"},
      fetchFn: async () => json({error: {code: 190}}, 400),
    }),
    (error) => error.code === "META_REAUTHORIZATION_REQUIRED",
  );
  await assert.rejects(
    fetchMetaAdChannelInsightsPage({
      accessToken: "valid",
      adAccountId: "act_123456",
      dateWindow: {start: "2026-10-14", end: "2026-10-14"},
      fetchFn: async () => json({unexpected: []}),
    }),
    (error) => error.code === "META_REPORTING_SCHEMA_CHANGED",
  );
  await assert.rejects(
    fetchMetaAdChannelInsightsPage({
      accessToken: "valid",
      adAccountId: "act_123456",
      dateWindow: {start: "2026-10-14", end: "2026-10-14"},
      fetchFn: async () => json({data: [], paging: {next: "https://graph.facebook.com/next"}}),
    }),
    (error) => error.code === "META_REPORTING_CURSOR_INVALID",
  );
});

test("Meta reporting error classification keeps auth terminal and quotas retryable", () => {
  const auth = classifyMetaReportingError(new MetaGraphError(
    "META_REAUTHORIZATION_REQUIRED",
    "reauthorize",
    {status: 401, provider_error_code: 190, request_id: "auth-1"},
  ));
  assert.equal(auth.class, "reauthorization_required");
  assert.equal(auth.retryable, false);
  const quota = classifyMetaReportingError(new MetaGraphError(
    "META_REPORTING_REQUEST_FAILED",
    "rate limited",
    {status: 429, provider_error_code: 4, request_id: "rate-1"},
  ));
  assert.equal(quota.class, "rate_limited");
  assert.equal(quota.retryable, true);
});

test("Meta first reporting slice cannot mutate Dataset V2 or another provider", () => {
  assert.equal(contract.mutations.live_provider_call, false);
  assert.equal(contract.mutations.dataset_v2, false);
  assert.equal(contract.mutations.database, false);
  assert.equal(contract.google_runtime_started, false);
  assert.equal(contract.klaviyo_runtime_started, false);
  assert.match(brief, /not Dataset V2/i);
  assert.match(brief, /No Google or Klaviyo runtime begins/i);
  assert.match(brief, /validation_pending_real_catalog_response/);
  assert.equal(contract.product_breakdown_slice.live_provider_acceptance, false);
});
