import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {
  COMMON_ADAPTER_CONTRACT_VERSION,
  RAW_METRICS,
  createQueryFingerprint,
  runCommonAdapterOperation,
} from "../app/lib/providers/common-adapter.server.js";
import {
  META_CHANNEL_FIELDS,
  buildMetaChannelInsightsUrl,
  classifyMetaChannelError,
  fetchMetaChannelFactsPage,
  mapMetaInsightToCanonicalFact,
} from "../app/lib/providers/meta-channel.server.js";
import {MetaGraphError} from "../app/lib/providers/meta-graph.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(
  path.join(root, "contracts/eo-04b-meta-channel-v1.json"),
  "utf8",
));
const decision = fs.readFileSync(path.join(root, "docs/EO_04B_META_CHANNEL.md"), "utf8");

const IDS = {
  workspace: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
  connection: "33333333-3333-4333-8333-333333333333",
  attempt: "44444444-4444-4444-8444-444444444444",
};

function request(overrides = {}) {
  const query = {provider: "meta", account: "act_123", date: "2026-10-12"};
  return {
    authority: {
      workspace_id: IDS.workspace,
      installation_id: IDS.installation,
      installation_generation: 1,
      status: "active",
      store_scope: "verified_installed_shop",
      shop_domain: "example.myshopify.com",
    },
    provider_connection_id: IDS.connection,
    provider: "meta",
    platform_account_id: "act_123",
    canonical_reporting_account_id: "act_123",
    operation: "fetch_facts",
    adapter_contract_version: COMMON_ADAPTER_CONTRACT_VERSION,
    provider_api_version: "v26.0",
    installed_shop_timezone: "Europe/Istanbul",
    date_window: {start: "2026-10-12", end: "2026-10-12"},
    requested_metrics: [...RAW_METRICS],
    levels: ["campaign", "adset", "ad"],
    breakdowns: [],
    query_fingerprint: createQueryFingerprint(query),
    attempt_id: IDS.attempt,
    job_or_run_id: null,
    ...overrides,
  };
}

function insight(overrides = {}) {
  return {
    account_id: "123",
    account_currency: "TRY",
    campaign_id: "campaign-1",
    campaign_name: "Campaign",
    adset_id: "adset-1",
    adset_name: "Ad set",
    ad_id: "ad-1",
    ad_name: "Ad",
    date_start: "2026-10-12",
    date_stop: "2026-10-12",
    impressions: "100",
    clicks: "12",
    outbound_clicks: [{action_type: "outbound_click", value: "9"}],
    spend: "25.50",
    actions: [
      {action_type: "link_click", value: "8"},
      {action_type: "add_to_cart", value: "4"},
      {action_type: "omni_add_to_cart", value: "99"},
      {action_type: "initiate_checkout", value: "3"},
      {action_type: "purchase", value: "2"},
    ],
    action_values: [
      {action_type: "add_to_cart", value: "400"},
      {action_type: "initiate_checkout", value: "300"},
      {action_type: "purchase", value: "200"},
    ],
    ...overrides,
  };
}

const currency = {
  targetCurrency: "TRY",
  fxRate: 1,
  fxProvider: "fixture",
  fxEngineVersion: "v1",
  accountTimezone: "Europe/Istanbul",
  timeEngineVersion: "v1",
};

test("Meta Channel query is ad-level, daily, reporting-account-only and breakdown-free", () => {
  const url = new URL(buildMetaChannelInsightsUrl({request: request()}));
  assert.equal(url.pathname, "/v26.0/act_123/insights");
  assert.equal(url.searchParams.get("level"), "ad");
  assert.equal(url.searchParams.get("time_increment"), "1");
  assert.deepEqual(JSON.parse(url.searchParams.get("time_range")), {
    since: "2026-10-12",
    until: "2026-10-12",
  });
  assert.deepEqual(url.searchParams.get("fields").split(","), META_CHANNEL_FIELDS);
  assert.equal(url.searchParams.has("breakdowns"), false);
  assert.equal(url.searchParams.has("action_report_time"), false);
  assert.equal(url.searchParams.has("use_unified_attribution_setting"), false);
  assert.throws(
    () => buildMetaChannelInsightsUrl({
      request: request({canonical_reporting_account_id: "act_999"}),
    }),
    /canonical Reporting Account/,
  );
});

test("Meta Channel maps standard actions first and never sums omni aliases", () => {
  const row = mapMetaInsightToCanonicalFact({
    insight: insight(),
    request: request(),
    ...currency,
  });
  assert.equal(row.entity.root_entity_type, "campaign");
  assert.equal(row.entity.parent_entity_type, "adset");
  assert.equal(row.entity.entity_type, "ad");
  assert.equal(row.raw_metrics.impression, 100);
  assert.equal(row.raw_metrics.ad_click, 8);
  assert.equal(row.raw_metrics.spend_value, 25.5);
  assert.equal(row.raw_metrics.add_to_cart, 4);
  assert.equal(row.raw_metrics.checkout, 3);
  assert.equal(row.raw_metrics.purchase, 2);
  assert.equal(row.raw_metrics.purchase_value, 200);
  assert.equal(row.raw_metrics.session, null);
  assert.equal(row.metric_support.session, "unsupported");
  assert.equal(row.time.source_timezone, "Europe/Istanbul");
  assert.equal(row.provenance.raw_reference.selected_action_types.add_to_cart, "add_to_cart");
  assert.equal(row.provenance.raw_reference.fallback_used.add_to_cart, false);
});

test("a cross-account insight row is rejected before publication", () => {
  assert.throws(
    () => mapMetaInsightToCanonicalFact({
      insight: insight({account_id: "999"}),
      request: request(),
      ...currency,
    }),
    (error) => error.code === "META_CHANNEL_REPORTING_ACCOUNT_MISMATCH",
  );
});

test("empty or absent action collections remain unknown null, not invented zero", () => {
  const row = mapMetaInsightToCanonicalFact({
    insight: insight({actions: [], action_values: []}),
    request: request(),
    ...currency,
  });
  for (const name of [
    "ad_click",
    "add_to_cart",
    "add_to_cart_value",
    "checkout",
    "checkout_value",
    "purchase",
    "purchase_value",
  ]) {
    assert.equal(row.raw_metrics[name], null, name);
    assert.equal(row.metric_support[name], "unknown", name);
    assert.equal(row.observation_state[name], "absent", name);
  }
});

test("explicit provider zero remains supported zero", () => {
  const row = mapMetaInsightToCanonicalFact({
    insight: insight({
      impressions: "0",
      spend: "0",
      actions: [{action_type: "link_click", value: "0"}],
      action_values: [],
    }),
    request: request(),
    ...currency,
  });
  for (const name of ["impression", "ad_click", "spend_value"]) {
    assert.equal(row.raw_metrics[name], 0);
    assert.equal(row.metric_support[name], "supported");
    assert.equal(row.observation_state[name], "zero");
  }
});

test("duplicate same-type actions fail closed instead of double counting", () => {
  assert.throws(
    () => mapMetaInsightToCanonicalFact({
      insight: insight({actions: [
        {action_type: "purchase", value: "1"},
        {action_type: "purchase", value: "2"},
      ]}),
      request: request(),
      ...currency,
    }),
    (error) => error.code === "META_CHANNEL_ACTION_DUPLICATE",
  );
});

test("Meta page reader preserves opaque pagination and sanitized action evidence", async () => {
  const page = await fetchMetaChannelFactsPage({
    request: request(),
    accessToken: "server-only-token",
    cursor: "opaque-in",
    currency,
    fetchFn: async (url, options) => {
      assert.equal(new URL(url).searchParams.get("after"), "opaque-in");
      assert.equal(options.headers.authorization, "Bearer server-only-token");
      return new Response(JSON.stringify({
        data: [insight()],
        paging: {cursors: {after: "opaque-out"}, next: "https://graph.facebook.com/next"},
      }), {
        status: 200,
        headers: {"content-type": "application/json", "x-fb-trace-id": "trace-1"},
      });
    },
  });
  assert.equal(page.rows.length, 1);
  assert.equal(page.next_cursor, "opaque-out");
  assert.equal(page.provider_request_id, "trace-1");
  assert.deepEqual(page.raw_evidence.actions[0], insight().actions);
  assert.equal(page.raw_evidence.clicks[0], "12");
  assert.deepEqual(page.raw_evidence.outbound_clicks[0], insight().outbound_clicks);
});

test("common runner publishes Meta rows only after the final page", async () => {
  const pages = [
    {data: [insight()], paging: {cursors: {after: "next"}, next: "https://graph.facebook.com/next"}},
    {data: [insight({ad_id: "ad-2", ad_name: "Ad 2"})], paging: {}},
  ];
  const result = await runCommonAdapterOperation({
    request: request(),
    fetchPage: ({cursor}) => fetchMetaChannelFactsPage({
      request: request(),
      accessToken: "server-only-token",
      cursor,
      currency,
      fetchFn: async () => new Response(JSON.stringify(pages.shift()), {
        status: 200,
        headers: {"content-type": "application/json"},
      }),
    }),
    classifyError: classifyMetaChannelError,
  });
  assert.equal(result.status, "complete");
  assert.equal(result.publishable, true);
  assert.equal(result.rows.length, 2);
  assert.equal(result.evidence.page_count, 2);
});

test("Meta provider errors classify auth, permission, rate limit and transient separately", () => {
  const classified = [
    classifyMetaChannelError(new MetaGraphError("x", "x", {status: 401, provider_error_code: 190})),
    classifyMetaChannelError(new MetaGraphError("x", "x", {status: 403, provider_error_code: 10})),
    classifyMetaChannelError(new MetaGraphError("x", "x", {status: 429, provider_error_code: 4, retry_after: "2"})),
    classifyMetaChannelError(new MetaGraphError("x", "x", {status: 503, provider_error_code: 2})),
  ];
  assert.deepEqual(classified.map((item) => item.class), [
    "reauthorization_required",
    "permission_or_scope_missing",
    "rate_limited",
    "transient_provider_failure",
  ]);
  assert.equal(classified[2].retry_after_ms, 2000);
});

test("Meta product breakdown stays runtime-unverified and this slice cannot write Dataset V2", () => {
  assert.equal(contract.product_breakdown.status, "api_supported_runtime_unverified");
  assert.equal(contract.product_breakdown.base_query_enabled, false);
  assert.equal(contract.product_breakdown.sku_or_product_name_guaranteed_by_current_contract, false);
  assert.ok(contract.forbidden.includes("dataset_v2_write"));
  assert.match(decision, /does not write Dataset\s+V2/i);
  const runtime = fs.readFileSync(
    path.join(root, "app/lib/providers/meta-channel.server.js"),
    "utf8",
  );
  assert.doesNotMatch(runtime, /insert\s+into|dataset[_ -]?v2|snapshotjob|backfill/i);
});

