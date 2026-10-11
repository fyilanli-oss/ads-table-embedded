import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoogleAdsQueryPlan,
  buildGoogleAdsRequest,
  classifyGoogleAdsError,
  runGoogleAdsCanonicalFacts,
  translateGoogleAdsCanonicalBundle,
} from "../app/lib/providers/google-ads-adapter.server.js";

const authority = Object.freeze({
  workspace_id: "11111111-1111-4111-8111-111111111111",
  installation_id: "22222222-2222-4222-8222-222222222222",
  installation_generation: 1,
  status: "active",
  store_scope: "verified_installed_shop",
  shop_domain: "example.myshopify.com",
});

function request(overrides = {}) {
  return buildGoogleAdsRequest({
    authority,
    provider_connection_id: "33333333-3333-4333-8333-333333333333",
    platform_account_id: "1234567890",
    canonical_reporting_account_id: "1234567890",
    installed_shop_timezone: "Europe/Istanbul",
    date_window: { start: "2026-10-01", end: "2026-10-02" },
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
    attempt_id: "44444444-4444-4444-8444-444444444444",
    job_or_run_id: "test-run",
    account_context: { customer_manager: false, login_customer_id: "9999999999" },
    query_family: "canonical_ad_performance",
    campaign_type: "standard",
    ...overrides,
  });
}

function standardBase(overrides = {}) {
  return {
    customer: {
      id: "1234567890",
      currencyCode: "TRY",
      timeZone: "Europe/Istanbul",
    },
    campaign: {
      id: "10",
      name: "Search Campaign",
      advertisingChannelType: "SEARCH",
    },
    adGroup: { id: "20", name: "Earrings" },
    adGroupAd: { ad: { id: "30", name: "Earring Ad" }, status: "ENABLED" },
    segments: { date: "2026-10-01" },
    metrics: { impressions: "100", clicks: "8", costMicros: "2500000" },
    ...overrides,
  };
}

function conversion(category, count, value, actionId = category) {
  const base = standardBase();
  return {
    ...base,
    segments: {
      ...base.segments,
      conversionAction: `customers/1234567890/conversionActions/${actionId}`,
      conversionActionCategory: category,
      conversionActionName: category,
      conversionAttributionEventType: "INTERACTION",
    },
    metrics: {
      allConversions: String(count),
      allConversionsValue: String(value),
    },
  };
}

test("Google query contract preserves real Standard Ad and PMax Asset Group leaves", () => {
  const standard = request();
  const standardPlan = buildGoogleAdsQueryPlan(standard);
  assert.deepEqual(standard.levels, ["campaign", "ad_group", "ad", "source_date"]);
  assert.equal(standardPlan.length, 2);
  assert.match(standardPlan[0].gaql, /FROM ad_group_ad/);
  assert.match(standardPlan[0].gaql, /ad_group_ad\.ad\.id/);
  assert.doesNotMatch(standardPlan[0].gaql, /asset_group\.id/);

  const pmax = request({ campaign_type: "performance_max" });
  const pmaxPlan = buildGoogleAdsQueryPlan(pmax);
  assert.deepEqual(pmax.levels, ["campaign", "asset_group", "source_date"]);
  assert.match(pmaxPlan[0].gaql, /FROM asset_group/);
  assert.match(pmaxPlan[0].gaql, /asset_group\.id/);
  assert.doesNotMatch(pmaxPlan[0].gaql, /ad_group_ad\.ad\.id/);
});

test("Google product query families keep native product grains and never invent Ads", () => {
  const shopping = buildGoogleAdsQueryPlan(
    request({ query_family: "shopping_product_performance" }),
  )[0];
  assert.match(shopping.gaql, /FROM shopping_performance_view/);
  assert.match(shopping.gaql, /segments\.product_item_id/);
  assert.doesNotMatch(shopping.gaql, /ad_group_ad\.ad\.id/);

  const pmaxProduct = buildGoogleAdsQueryPlan(
    request({
      query_family: "performance_max_retail_product_performance",
      campaign_type: "performance_max",
    }),
  )[0];
  assert.match(pmaxProduct.gaql, /FROM asset_group_product_group_view/);
  assert.match(
    pmaxProduct.gaql,
    /asset_group_listing_group_filter\.case_value\.product_item_id\.value/,
  );
  assert.doesNotMatch(pmaxProduct.gaql, /ad_group_ad\.ad\.id/);

  const cart = buildGoogleAdsQueryPlan(
    request({ query_family: "sold_product_cart" }),
  )[0];
  assert.match(cart.gaql, /FROM cart_data_sales_view/);
  assert.match(cart.gaql, /segments\.product_sold_item_id/);
  assert.deepEqual(cart.incompatible_dimensions, [
    "ad_group_ad.ad.id",
    "asset_group.id",
  ]);
  assert.doesNotMatch(cart.gaql, /ad_group_ad\.ad\.id/);
  assert.doesNotMatch(cart.gaql, /asset_group\.id/);
});

test("Google canonical translation keeps explicit zero, absent conversions and unsupported session distinct", () => {
  const row = translateGoogleAdsCanonicalBundle(
    {
      base: standardBase({
        metrics: { impressions: "100", clicks: "0", costMicros: "2500000" },
      }),
      conversions: [
        conversion("ADD_TO_CART", 3, 900),
        conversion("PURCHASE", 1, 500),
      ],
    },
    { request: request(), synthetic: true },
  );

  assert.equal(row.entity.entity_type, "ad");
  assert.equal(row.entity.entity_id, "30");
  assert.equal(row.raw_metrics.impression, 100);
  assert.equal(row.raw_metrics.ad_click, 0);
  assert.equal(row.observation_state.ad_click, "zero");
  assert.equal(row.raw_metrics.spend_value, 2.5);
  assert.equal(row.raw_metrics.add_to_cart, 3);
  assert.equal(row.raw_metrics.purchase_value, 500);
  assert.equal(row.raw_metrics.checkout, null);
  assert.equal(row.metric_support.checkout, "supported");
  assert.equal(row.observation_state.checkout, "absent");
  assert.equal(row.raw_metrics.session, null);
  assert.equal(row.metric_support.session, "unsupported");
  assert.equal(row.provenance.synthetic, true);
  assert.equal(row.provenance.raw_reference.conversion_components.length, 2);
});

test("Google canonical translation aggregates explicit action components without collapsing identity evidence", () => {
  const first = conversion("PURCHASE", 1, 500, "purchase-a");
  const second = conversion("PURCHASE", 2, 800, "purchase-b");
  second.segments.conversionAttributionEventType = "ENGAGED_VIEW";

  const row = translateGoogleAdsCanonicalBundle(
    { base: standardBase(), conversions: [first, second] },
    { request: request(), synthetic: true },
  );

  assert.equal(row.raw_metrics.purchase, 3);
  assert.equal(row.raw_metrics.purchase_value, 1300);
  assert.equal(row.provenance.raw_reference.conversion_components.length, 2);
  assert.deepEqual(
    row.provenance.raw_reference.conversion_components.map(
      (component) => component.attribution_event_type,
    ),
    ["INTERACTION", "ENGAGED_VIEW"],
  );
});

test("Google runner uses the common complete-before-publish pagination gate", async () => {
  const cursors = [];
  const result = await runGoogleAdsCanonicalFacts({
    request: request(),
    synthetic: true,
    transport: async ({ query_plan, cursor }) => {
      cursors.push(cursor);
      assert.equal(query_plan.length, 2);
      if (cursor == null) {
        return {
          bundles: [
            {
              base: standardBase(),
              conversions: [conversion("PURCHASE", 1, 500)],
            },
          ],
          next_cursor: "opaque-next",
          request_id: "request-1",
          quota: { operation_cost: 1 },
        };
      }
      const base = standardBase({
        adGroupAd: { ad: { id: "31", name: "Second Ad" }, status: "ENABLED" },
      });
      return {
        bundles: [{ base, conversions: [] }],
        next_cursor: null,
        request_id: "request-2",
      };
    },
    sleep: async () => {},
    now: (() => {
      let value = 0;
      return () => (value += 10);
    })(),
    random: () => 0,
  });

  assert.equal(result.status, "complete");
  assert.equal(result.publishable, true);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(cursors, [null, "opaque-next"]);
  assert.equal(result.evidence.page_count, 2);
});

test("Google runner fails closed and retries only normalized transient errors", async () => {
  let attempts = 0;
  const result = await runGoogleAdsCanonicalFacts({
    request: request(),
    transport: async () => {
      attempts += 1;
      throw Object.assign(new Error("unavailable"), {
        status: "UNAVAILABLE",
        request_id: "google-request",
      });
    },
    sleep: async () => {},
    now: (() => {
      let value = 0;
      return () => (value += 10);
    })(),
    random: () => 0,
    limits: { maximum_attempts_per_page: 2, maximum_elapsed_ms: 10_000 },
  });

  assert.equal(attempts, 2);
  assert.equal(result.status, "failed");
  assert.equal(result.publishable, false);
  assert.deepEqual(result.rows, []);
  assert.equal(result.error.class, "transient_provider_failure");
  assert.equal(result.error.provider_request_id, "google-request");

  assert.equal(classifyGoogleAdsError({ status: "UNAUTHENTICATED" }).retryable, false);
  assert.equal(classifyGoogleAdsError({ status: "INVALID_ARGUMENT" }).class, "request_contract_invalid");
});

test("Google serving-account and response-account guards reject manager or cross-account data", () => {
  assert.throws(
    () => request({ account_context: { customer_manager: true } }),
    /Manager customers cannot be reporting accounts/,
  );

  assert.throws(
    () =>
      translateGoogleAdsCanonicalBundle(
        {
          base: standardBase({
            customer: {
              id: "5555555555",
              currencyCode: "TRY",
              timeZone: "Europe/Istanbul",
            },
          }),
          conversions: [],
        },
        { request: request() },
      ),
    /Response customer differs from reporting authority/,
  );
});
