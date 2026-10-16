import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  buildMetaAdChannelInsightsUrl,
  classifyMetaReportingError,
  fetchMetaAdChannelInsightsPage,
  META_AD_CHANNEL_INSIGHTS_FIELDS,
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
});
