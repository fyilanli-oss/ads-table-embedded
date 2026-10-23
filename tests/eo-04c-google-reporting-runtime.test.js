import assert from "node:assert/strict";
import test from "node:test";

import {GoogleAdsRestError} from "../app/lib/providers/google-ads-rest.server.js";
import {
  GOOGLE_REPORTING_QUERY_FAMILIES,
  buildGoogleReportingQueries,
  classifyGoogleReportingError,
  fetchGoogleReportingPage,
  normalizeGoogleCartDataSale,
  resolvePmaxSaleChannel,
} from "../app/lib/providers/google-reporting.server.js";

const DATE_WINDOW = Object.freeze({start: "2026-10-01", end: "2026-10-01"});

function cartRow(overrides = {}) {
  return {
    customer: {id: "100"},
    campaign: {
      id: "200",
      name: "Retail PMax",
      advertisingChannelType: "PERFORMANCE_MAX",
    },
    segments: {
      date: "2026-10-01",
      productMerchantId: "300",
      productFeedLabel: "IS",
      productItemId: "advertised-1",
      productSoldItemId: "advertised-1",
    },
    metrics: {
      unitsSold: 1,
      revenueMicros: "25000000",
      leadUnitsSold: 1,
      leadRevenueMicros: "25000000",
      crossSellUnitsSold: 0,
      crossSellRevenueMicros: "0",
    },
    ...overrides,
  };
}

function rootAllProductsRow(assetGroupId, name = `Asset Group ${assetGroupId}`) {
  return {
    campaign: {id: "200"},
    assetGroup: {id: String(assetGroupId), name},
    assetGroupListingGroupFilter: {
      resourceName: `customers/100/assetGroupListingGroupFilters/${assetGroupId}~1`,
      assetGroup: `customers/100/assetGroups/${assetGroupId}`,
      type: "UNIT_INCLUDED",
      listingSource: "SHOPPING",
      path: {dimensions: []},
    },
  };
}

function categoryRow(assetGroupId, categoryId) {
  return {
    campaign: {id: "200"},
    assetGroup: {id: String(assetGroupId), name: `Category ${assetGroupId}`},
    assetGroupListingGroupFilter: {
      resourceName: `customers/100/assetGroupListingGroupFilters/${assetGroupId}~2`,
      assetGroup: `customers/100/assetGroups/${assetGroupId}`,
      parentListingGroupFilter: `customers/100/assetGroupListingGroupFilters/${assetGroupId}~1`,
      type: "UNIT_INCLUDED",
      listingSource: "SHOPPING",
      path: {
        dimensions: [{
          productCategory: {level: "LEVEL1", categoryId: String(categoryId)},
        }],
      },
    },
  };
}

function snapshot(assetGroupId, rows, overrides = {}) {
  return {
    campaign_id: "200",
    asset_group_id: String(assetGroupId),
    asset_group_name: `Asset Group ${assetGroupId}`,
    timezone: "Atlantic/Reykjavik",
    tree_hash: `tree-${assetGroupId}`,
    valid_from: "2026-10-01T00:00:00Z",
    valid_to: "2026-10-02T00:00:00Z",
    rows,
    ...overrides,
  };
}

function resolutionInput(overrides = {}) {
  return {
    sale: normalizeGoogleCartDataSale(cartRow()),
    advertisedProduct: {
      item_id: "advertised-1",
      brand: "AdsTable",
      category_ids: {LEVEL1: "166"},
      product_types: {},
      custom_attributes: {},
    },
    businessWindow: {
      business_date: "2026-10-01",
      timezone: "Atlantic/Reykjavik",
      start: "2026-10-01T00:00:00Z",
      end: "2026-10-02T00:00:00Z",
    },
    listingEvidence: {complete: true, snapshots: []},
    ...overrides,
  };
}

test("Google reporting separates account identity from campaign inventory", () => {
  const queries = buildGoogleReportingQueries({dateWindow: DATE_WINDOW});
  assert.deepEqual(Object.keys(queries), [...GOOGLE_REPORTING_QUERY_FAMILIES]);
  assert.match(queries.account_identity, /FROM customer$/);
  assert.match(queries.account_identity, /customer[.]test_account/);
  assert.doesNotMatch(queries.account_identity, /campaign[.]/);
  assert.match(queries.campaign_context, /FROM campaign$/);
  assert.match(queries.campaign_context, /campaign[.]id/);
  assert.doesNotMatch(queries.campaign_context, /customer[.]test_account/);
  assert.match(queries.ad_group_channel_daily, /FROM ad_group/);
  assert.match(queries.ad_group_channel_daily, /ad_group[.]id/);
  assert.match(queries.ad_group_channel_daily, /advertising_channel_type = 'SHOPPING'/);
  assert.match(queries.pmax_asset_group_channel_daily, /FROM asset_group/);
  assert.match(queries.pmax_asset_group_channel_daily, /asset_group[.]id/);
  assert.match(queries.pmax_asset_group_channel_daily, /PERFORMANCE_MAX/);
  assert.match(queries.shopping_product_daily, /FROM shopping_performance_view/);
  assert.match(queries.shopping_product_daily, /metrics[.]cost_micros/);
  assert.match(queries.cart_data_product_sales_daily, /FROM cart_data_sales_view/);
  assert.match(queries.cart_data_product_sales_daily, /segments[.]product_sold_item_id/);
  assert.doesNotMatch(queries.cart_data_product_sales_daily, /asset_group[.]id/);
  for (const query of Object.values(queries)) {
    assert.doesNotMatch(query, /\b(?:MUTATE|CREATE|UPDATE|DELETE|INSERT)\b/i);
  }
});

test("Google page fetch preserves raw rows, opaque pagination and exact GAQL evidence", async () => {
  const calls = [];
  const result = await fetchGoogleReportingPage({
    client: {
      search: async (input) => {
        calls.push(input);
        return {
          results: [cartRow()],
          next_page_token: "opaque-page-2",
          request_id: "google-request-1",
        };
      },
    },
    customerId: "100",
    queryFamily: "cart_data_product_sales_daily",
    dateWindow: DATE_WINDOW,
  });
  assert.equal(calls.length, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.next_cursor, "opaque-page-2");
  assert.equal(result.provider_request_id, "google-request-1");
  assert.equal(result.observation_state, "present");
  assert.equal(result.evidence.api_version, "v25");
  assert.equal(result.evidence.query_fingerprint.length, 64);
});

test("successful empty Google page is not observed, never numeric zero", async () => {
  const result = await fetchGoogleReportingPage({
    client: {
      search: async () => ({results: [], next_page_token: null, request_id: "empty-1"}),
    },
    customerId: "100",
    queryFamily: "shopping_product_daily",
    dateWindow: DATE_WINDOW,
  });
  assert.equal(result.observation_state, "not_observed_in_this_execution");
  assert.deepEqual(result.rows, []);
});

test("invalid calendar dates and reversed windows fail before a provider request", () => {
  assert.throws(
    () => buildGoogleReportingQueries({dateWindow: {start: "2026-02-31", end: "2026-03-01"}}),
    (error) => error.code === "GOOGLE_REPORTING_DATE_INVALID",
  );
  assert.throws(
    () => buildGoogleReportingQueries({dateWindow: {start: "2026-10-02", end: "2026-10-01"}}),
    (error) => error.code === "GOOGLE_REPORTING_DATE_WINDOW_INVALID",
  );
});

test("Cart Data classifies Advertised, Cross-sell, Assisted and conflicts without guessing", () => {
  assert.equal(normalizeGoogleCartDataSale(cartRow()).sales_role, "Advertised");

  const crossSell = cartRow();
  crossSell.segments = {...crossSell.segments, productSoldItemId: "sold-2"};
  crossSell.metrics = {
    ...crossSell.metrics,
    leadUnitsSold: 0,
    leadRevenueMicros: "0",
    crossSellUnitsSold: 1,
    crossSellRevenueMicros: "25000000",
  };
  assert.equal(normalizeGoogleCartDataSale(crossSell).sales_role, "Cross-sell");

  const assisted = cartRow();
  assisted.segments = {...assisted.segments, productItemId: undefined};
  assert.equal(normalizeGoogleCartDataSale(assisted).sales_role, "Assisted");

  const conflicting = cartRow();
  conflicting.metrics = {...conflicting.metrics, crossSellUnitsSold: 1};
  assert.equal(normalizeGoogleCartDataSale(conflicting).sales_role, "Unclassified");
});

test("one temporally valid All products Asset Group resolves exact", () => {
  const result = resolvePmaxSaleChannel(resolutionInput({
    listingEvidence: {
      complete: true,
      snapshots: [snapshot("401", [rootAllProductsRow("401")])],
    },
  }));
  assert.equal(result.channel_type, "Asset Group");
  assert.equal(result.channel_id, "401");
  assert.equal(result.resolution, "exact");
  assert.equal(result.evidence.listing_tree_evidence_version_or_hash, "tree-401");
});

test("overlapping All products Asset Groups preserve sale under Unclassified Channel", () => {
  const input = resolutionInput({
    listingEvidence: {
      complete: true,
      snapshots: [
        snapshot("401", [rootAllProductsRow("401")]),
        snapshot("402", [rootAllProductsRow("402")]),
      ],
    },
  });
  const result = resolvePmaxSaleChannel(input);
  assert.equal(result.channel_type, "Unclassified Channel");
  assert.equal(result.reason, "overlapping_asset_groups");
  assert.deepEqual(result.candidate_asset_group_ids, ["401", "402"]);
  assert.equal(result.sale.sales_role, "Advertised");
});

test("category matching requires category-ID evidence and remains conservative", () => {
  const exact = resolvePmaxSaleChannel(resolutionInput({
    listingEvidence: {
      complete: true,
      snapshots: [snapshot("403", [categoryRow("403", "166")])],
    },
  }));
  assert.equal(exact.channel_id, "403");

  const missingCategoryEvidence = resolutionInput({
    advertisedProduct: {
      item_id: "advertised-1",
      brand: "AdsTable",
      category_ids: {},
      product_types: {},
      custom_attributes: {},
    },
    listingEvidence: {
      complete: true,
      snapshots: [snapshot("403", [categoryRow("403", "166")])],
    },
  });
  const unknown = resolvePmaxSaleChannel(missingCategoryEvidence);
  assert.equal(unknown.channel_type, "Unclassified Channel");
  assert.equal(unknown.reason, "no_eligible_asset_group");
});

test("sold product is never used to choose a PMax Asset Group", () => {
  const row = cartRow();
  row.segments = {...row.segments, productSoldItemId: "sold-2"};
  row.metrics = {
    ...row.metrics,
    leadUnitsSold: 0,
    leadRevenueMicros: "0",
    crossSellUnitsSold: 1,
    crossSellRevenueMicros: "25000000",
  };
  const sale = normalizeGoogleCartDataSale(row);
  const result = resolvePmaxSaleChannel(resolutionInput({
    sale,
    advertisedProduct: {
      item_id: "sold-2",
      category_ids: {},
      product_types: {},
      custom_attributes: {},
    },
    listingEvidence: {
      complete: true,
      snapshots: [snapshot("404", [rootAllProductsRow("404")])],
    },
  }));
  assert.equal(result.channel_type, "Unclassified Channel");
  assert.equal(result.reason, "advertised_product_evidence_missing_or_mismatched");
  assert.equal(result.sale.sales_role, "Cross-sell");
});

test("current or partial listing evidence cannot resolve an earlier sale", () => {
  const currentTree = snapshot("405", [rootAllProductsRow("405")], {
    valid_from: "2026-10-16T00:00:00Z",
    valid_to: "2026-10-17T00:00:00Z",
  });
  const staleResult = resolvePmaxSaleChannel(resolutionInput({
    listingEvidence: {complete: true, snapshots: [currentTree]},
  }));
  assert.equal(staleResult.channel_type, "Unclassified Channel");
  assert.equal(staleResult.reason, "no_eligible_asset_group");

  const partialResult = resolvePmaxSaleChannel(resolutionInput({
    listingEvidence: {
      complete: false,
      snapshots: [snapshot("405", [rootAllProductsRow("405")])],
    },
  }));
  assert.equal(partialResult.channel_type, "Unclassified Channel");
  assert.equal(partialResult.reason, "listing_tree_evidence_incomplete");
});

test("a tree change inside the sale day cannot produce exact Channel", () => {
  const result = resolvePmaxSaleChannel(resolutionInput({
    listingEvidence: {
      complete: true,
      snapshots: [snapshot("406", [rootAllProductsRow("406")], {
        valid_to: "2026-10-01T12:00:00Z",
      })],
    },
  }));
  assert.equal(result.channel_type, "Unclassified Channel");
  assert.equal(result.reason, "no_eligible_asset_group");
});

test("Google error classification forbids automatic retry after the first provider error", () => {
  const rateLimit = classifyGoogleReportingError(new GoogleAdsRestError(
    "GOOGLE_ADS_REST_REQUEST_FAILED",
    "Google Ads REST request failed",
    {status: 429, provider_error_code: "RESOURCE_EXHAUSTED", request_id: "req-429"},
  ));
  assert.equal(rateLimit.class, "rate_limited");
  assert.equal(rateLimit.retryable, false);
  assert.equal(rateLimit.provider_request_id, "req-429");

  const cases = [
    [{status: 401}, "reauthorization_required"],
    [{status: 403}, "permission_or_scope_missing"],
    [{status: 403, provider_error_code: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"},
      "provider_access_level_required"],
    [{status: 403, provider_error_code: "TWO_STEP_VERIFICATION_NOT_ENROLLED"},
      "account_security_action_required"],
    [{status: 403, provider_status: "AUTHORIZATION_ERROR"}, "provider_access_incident"],
  ];
  for (const [details, expectedClass] of cases) {
    const classified = classifyGoogleReportingError(new GoogleAdsRestError(
      "GOOGLE_ADS_REST_REQUEST_FAILED",
      "Google Ads REST request failed",
      details,
    ));
    assert.equal(classified.class, expectedClass);
    assert.equal(classified.retryable, false);
  }
});
