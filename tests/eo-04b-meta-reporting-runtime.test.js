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
    appSecret: "test-secret",
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
  assert.match(requests[0].url, /appsecret_proof=[0-9a-f]{64}/);
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
    appSecret: "test-secret",
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
      appSecret: "test-secret",
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
      appSecret: "test-secret",
      adAccountId: "act_123456",
      dateWindow: {start: "2026-10-14", end: "2026-10-14"},
      fetchFn: async () => json({error: {code: 190}}, 400),
    }),
    (error) => error.code === "META_REAUTHORIZATION_REQUIRED",
  );
  await assert.rejects(
    fetchMetaAdChannelInsightsPage({
      accessToken: "valid",
      appSecret: "test-secret",
      adAccountId: "act_123456",
      dateWindow: {start: "2026-10-14", end: "2026-10-14"},
      fetchFn: async () => json({unexpected: []}),
    }),
    (error) => error.code === "META_REPORTING_SCHEMA_CHANGED",
  );
  await assert.rejects(
    fetchMetaAdChannelInsightsPage({
      accessToken: "valid",
      appSecret: "test-secret",
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
  const retryAfter = classifyMetaReportingError(new MetaGraphError(
    "META_REPORTING_REQUEST_FAILED",
    "rate limited",
    {status: 429, provider_error_code: 4, retry_after_ms: 7000},
  ));
  assert.equal(retryAfter.retry_after_ms, 7000);
});

test("Meta permission errors and bare 403 do not masquerade as invalid tokens", async () => {
  for (const [status, code] of [[403, 10], [400, 10], [400, 200], [403, 299], [403, null]]) {
    let calls = 0;
    await assert.rejects(fetchMetaAdChannelInsightsPage({
      accessToken: "valid", appSecret: "test-secret", adAccountId: "act_123456",
      dateWindow: {start: "2026-10-14", end: "2026-10-14"},
      fetchFn: async () => {calls++; return json({error: code === null ? {} : {code}}, status);},
    }), error => {
      assert.equal(error.code, "META_PERMISSION_DENIED");
      assert.equal(classifyMetaReportingError(error).class, "permission_denied");
      assert.equal(classifyMetaReportingError(error).retryable, false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("Meta BUC quota codes win over generic HTTP 403 and never retry the request", async () => {
  for (const code of [80000, 80004]) {
    for (const status of [400, 403, 429]) {
      let calls = 0;
      await assert.rejects(fetchMetaAdChannelInsightsPage({
        accessToken: "valid", appSecret: "test-secret", adAccountId: "act_123456",
        dateWindow: {start: "2026-10-14", end: "2026-10-14"},
        fetchFn: async () => {calls++; return json({error: {code, error_subcode: 2446079}}, status, {"retry-after": "7"});},
      }), error => {
        assert.equal(error.code, "META_REPORTING_REQUEST_FAILED");
        const classified = classifyMetaReportingError(error);
        assert.equal(classified.class, "rate_limited");
        assert.equal(classified.retryable, true);
        assert.equal(classified.retry_after_ms, 7000);
        return true;
      });
      assert.equal(calls, 1);
    }
  }
});

test("Meta explicit invalid token code remains reauthorization even on HTTP 403", async () => {
  await assert.rejects(fetchMetaAdChannelInsightsPage({
    accessToken: "expired", appSecret: "test-secret", adAccountId: "act_123456",
    dateWindow: {start: "2026-10-14", end: "2026-10-14"},
    fetchFn: async () => json({error: {code: 190}}, 403),
  }), error => error.code === "META_REAUTHORIZATION_REQUIRED"
    && classifyMetaReportingError(error).class === "reauthorization_required");
});

test("Meta first reporting slice cannot mutate Dataset V2 or another provider", () => {
  assert.equal(contract.mutations.live_provider_call, false);
  assert.equal(contract.mutations.dataset_v2, false);
  assert.equal(contract.mutations.database, false);
  assert.equal(contract.google_runtime_started, false);
  assert.equal(contract.klaviyo_runtime_started, false);
  assert.match(brief, /Dataset V2 değildir/i);
  assert.match(brief, /Meta sağlayıcı dilimi kabul edilmeden Google veya Klaviyo çalışma zamanı başlamaz/i);
  assert.match(brief, /validation_pending_real_catalog_response/);
  assert.equal(contract.product_breakdown_slice.live_provider_acceptance, false);
  assert.equal(contract.reporting_authority_slice.installed_shop_authority_required, true);
  assert.equal(contract.reporting_authority_slice.canonical_reporting_account_required, true);
  assert.equal(contract.reporting_authority_slice.merchant_supplied_account_id_forbidden, true);
  assert.equal(contract.reporting_authority_slice.token_in_result_or_evidence, false);
  assert.equal(contract.reporting_authority_slice.database_write, false);
});
