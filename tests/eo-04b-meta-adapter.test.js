import assert from "node:assert/strict";
import test from "node:test";

import {
  META_ACTION_ALIASES,
  META_CLICK_CANDIDATES,
  META_GRAPH_VERSION,
  META_INSIGHTS_FIELDS,
  buildMetaInsightsUrl,
  buildMetaRequest,
  classifyMetaError,
  runMetaInsights,
  translateMetaInsightRow,
} from "../app/lib/providers/meta-adapter.server.js";

const IDS = Object.freeze({
  workspace: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
  connection: "33333333-3333-4333-8333-333333333333",
  attempt: "44444444-4444-4444-8444-444444444444",
});

function request(overrides = {}) {
  return buildMetaRequest({
    authority: {
      workspace_id: IDS.workspace,
      installation_id: IDS.installation,
      installation_generation: 1,
      status: "active",
      store_scope: "verified_installed_shop",
      shop_domain: "example.myshopify.com",
    },
    provider_connection_id: IDS.connection,
    platform_account_id: "act_123",
    canonical_reporting_account_id: "act_123",
    installed_shop_timezone: "Europe/Istanbul",
    date_window: { start: "2026-10-08", end: "2026-10-09" },
    requested_metrics: [
      "impression",
      "ad_click",
      "session",
      "spend_value",
      "add_to_cart",
      "add_to_cart_value",
      "checkout",
      "checkout_value",
      "purchase",
      "purchase_value",
    ],
    attempt_id: IDS.attempt,
    job_or_run_id: null,
    ...overrides,
  });
}

function insight(overrides = {}) {
  return {
    account_id: "123",
    account_currency: "TRY",
    campaign_id: "campaign-1",
    campaign_name: "Campaign 1",
    adset_id: "adset-1",
    adset_name: "Ad set 1",
    ad_id: "ad-1",
    ad_name: "Ad 1",
    date_start: "2026-10-08",
    date_stop: "2026-10-08",
    impressions: "181",
    spend: "117.22",
    clicks: "9",
    inline_link_clicks: "8",
    website_clicks: "8",
    outbound_clicks: "8",
    actions: [
      { action_type: "landing_page_view", value: "8" },
      { action_type: "link_click", value: "8" },
      { action_type: "offsite_conversion.fb_pixel_add_to_cart", value: "0" },
      { action_type: "omni_add_to_cart", value: "0" },
    ],
    action_values: [],
    ...overrides,
  };
}

test("Meta request pins v26, daily ad grain and every click candidate", () => {
  const value = request();
  const url = new URL(buildMetaInsightsUrl(value));

  assert.equal(value.provider_api_version, META_GRAPH_VERSION);
  assert.equal(url.pathname, "/v26.0/act_123/insights");
  assert.equal(url.searchParams.get("level"), "ad");
  assert.equal(url.searchParams.get("time_increment"), "1");
  assert.deepEqual(JSON.parse(url.searchParams.get("time_range")), {
    since: "2026-10-08",
    until: "2026-10-09",
  });
  for (const field of [...META_CLICK_CANDIDATES, "actions", "action_values"]) {
    assert.ok(META_INSIGHTS_FIELDS.includes(field));
  }
});

test("Meta translation preserves explicit zero, empty values and provisional click", () => {
  const row = translateMetaInsightRow(insight(), {
    request: request(),
    account_currency: "TRY",
    source_timezone: "Europe/Istanbul",
    synthetic: true,
  });

  assert.equal(row.raw_metrics.impression, 181);
  assert.equal(row.raw_metrics.spend_value, 117.22);
  assert.equal(row.raw_metrics.ad_click, null);
  assert.equal(row.metric_support.ad_click, "unknown");
  assert.equal(row.observation_state.ad_click, "provisional");
  assert.equal(row.raw_metrics.add_to_cart, 0);
  assert.equal(row.observation_state.add_to_cart, "zero");
  assert.equal(row.raw_metrics.add_to_cart_value, null);
  assert.equal(row.observation_state.add_to_cart_value, "empty");
  assert.equal(row.raw_metrics.purchase, null);
  assert.equal(row.observation_state.purchase, "absent");
  assert.equal(row.raw_metrics.session, null);
  assert.equal(row.metric_support.session, "unsupported");
  assert.equal(
    row.provenance.raw_reference.action_resolution.add_to_cart.count_action_type,
    META_ACTION_ALIASES.add_to_cart[0],
  );
  assert.equal(
    row.provenance.raw_reference.click_mapping_status,
    "PENDING_LIVE_FIELD_EVIDENCE",
  );
});

test("standard action wins over omni and aliases are never summed", () => {
  const row = translateMetaInsightRow(
    insight({
      actions: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
        { action_type: "omni_purchase", value: "3" },
      ],
      action_values: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "200" },
        { action_type: "omni_purchase", value: "300" },
      ],
    }),
    {
      request: request(),
      account_currency: "TRY",
      source_timezone: "Europe/Istanbul",
      synthetic: true,
    },
  );

  assert.equal(row.raw_metrics.purchase, 2);
  assert.equal(row.raw_metrics.purchase_value, 200);
  assert.equal(
    row.provenance.raw_reference.action_resolution.purchase.count_action_type,
    "offsite_conversion.fb_pixel_purchase",
  );
});

test("missing actions and explicit empty actions remain distinct non-zero states", () => {
  const missing = insight();
  delete missing.actions;
  delete missing.action_values;
  const absent = translateMetaInsightRow(missing, {
    request: request(),
    account_currency: "TRY",
    source_timezone: "Europe/Istanbul",
    synthetic: true,
  });
  assert.equal(absent.observation_state.purchase, "absent");
  assert.equal(absent.metric_support.purchase, "unknown");

  const empty = translateMetaInsightRow(
    insight({ actions: [], action_values: [] }),
    {
      request: request(),
      account_currency: "TRY",
      source_timezone: "Europe/Istanbul",
      synthetic: true,
    },
  );
  assert.equal(empty.observation_state.purchase, "empty");
  assert.equal(empty.metric_support.purchase, "supported");
  assert.equal(empty.raw_metrics.purchase, null);
});

test("Meta pagination continues through an empty page that still has paging.next", async () => {
  const calls = [];
  const result = await runMetaInsights({
    request: request(),
    account_currency: "TRY",
    source_timezone: "Europe/Istanbul",
    synthetic: true,
    transport: async ({ url }) => {
      calls.push(url);
      if (calls.length === 1) {
        return {
          data: [],
          paging: { next: "https://graph.facebook.com/opaque-page-2" },
          headers: { "x-fb-request-id": "req-1" },
        };
      }
      return {
        data: [insight()],
        paging: {},
        headers: {
          "x-fb-request-id": "req-2",
          "x-ad-account-usage": "{fixture}",
        },
      };
    },
  });

  assert.equal(result.publishable, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.evidence.page_count, 2);
  assert.equal(calls[1], "https://graph.facebook.com/opaque-page-2");
});

test("account mismatch and malformed action rows fail closed", async () => {
  const mismatch = await runMetaInsights({
    request: request(),
    account_currency: "TRY",
    source_timezone: "Europe/Istanbul",
    synthetic: true,
    transport: async () => ({ data: [insight({ account_id: "999" })] }),
  });
  assert.equal(mismatch.publishable, false);
  assert.equal(mismatch.error.class, "reporting_account_inaccessible");

  const malformed = await runMetaInsights({
    request: request(),
    account_currency: "TRY",
    source_timezone: "Europe/Istanbul",
    synthetic: true,
    transport: async () => ({
      data: [insight({ actions: [{ action_type: "omni_purchase" }] })],
    }),
  });
  assert.equal(malformed.publishable, false);
  assert.equal(malformed.error.class, "provider_schema_changed");
});

test("Meta error mapping retries only documented transient and rate conditions", () => {
  assert.deepEqual(
    {
      class: classifyMetaError({ code: 4, error_subcode: 1504022 }).class,
      retryable: classifyMetaError({ code: 4, error_subcode: 1504022 }).retryable,
    },
    { class: "rate_limited", retryable: true },
  );
  assert.equal(classifyMetaError({ code: 190 }).class, "reauthorization_required");
  assert.equal(classifyMetaError({ code: 190 }).retryable, false);
  assert.equal(
    classifyMetaError({ code: 100, error_subcode: 1504041 }).class,
    "request_contract_invalid",
  );
  assert.equal(
    classifyMetaError({ code: 100, error_subcode: 1504041 }).retryable,
    false,
  );
  assert.equal(
    classifyMetaError({ code: 2, error_subcode: 1504038 }).class,
    "provider_timeout",
  );
  assert.equal(classifyMetaError({ code: 2, error_subcode: 1504038 }).retryable, false);
});

test("request rejects a different account or unverified Shopify scope", () => {
  assert.throws(
    () =>
      request({
        canonical_reporting_account_id: "act_456",
      }),
    /must equal the verified act_ account/,
  );
  assert.throws(
    () =>
      request({
        authority: {
          ...request().authority,
          store_scope: "ambiguous",
        },
      }),
    /verified installed Shopify store/,
  );
});
