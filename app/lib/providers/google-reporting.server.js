import {createQueryFingerprint} from "./common-adapter.server.js";
import {
  GOOGLE_ADS_REST_VERSION,
  GoogleAdsRestError,
} from "./google-ads-rest.server.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RESOURCE_ID_PATTERN = /\/([0-9]+)$/;
const NON_NEGATIVE_NUMBER_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

export const GOOGLE_REPORTING_QUERY_FAMILIES = Object.freeze([
  "account_identity",
  "campaign_context",
  "ad_group_channel_daily",
  "search_ad_channel_daily",
  "pmax_asset_group_channel_daily",
  "search_ad_conversion_action_daily",
  "shopping_ad_group_conversion_action_daily",
  "pmax_asset_group_conversion_action_daily",
  "conversion_action_daily",
  "shopping_product_daily",
  "cart_data_product_sales_daily",
  "shopping_cart_data_product_sales_daily",
  "search_cart_data_product_sales_daily",
  "pmax_listing_tree_current",
  "pmax_product_group_aggregate_daily",
]);

export class GoogleReportingError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "GoogleReportingError";
    this.code = code;
    this.details = details;
  }
}

function requireString(value, code, maximum = 8192) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
  ) {
    throw new GoogleReportingError(code, code);
  }
  return value;
}

function reportingDate(value, field) {
  const timestamp = typeof value === "string"
    ? Date.parse(`${value}T00:00:00Z`)
    : Number.NaN;
  if (
    typeof value !== "string"
    || !DATE_PATTERN.test(value)
    || Number.isNaN(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new GoogleReportingError(
      "GOOGLE_REPORTING_DATE_INVALID",
      `${field} must be a valid YYYY-MM-DD date`,
    );
  }
  return value;
}

function dateWindow(value) {
  const start = reportingDate(value?.start, "dateWindow.start");
  const end = reportingDate(value?.end, "dateWindow.end");
  if (start > end) {
    throw new GoogleReportingError(
      "GOOGLE_REPORTING_DATE_WINDOW_INVALID",
      "Google reporting start date must not exceed end date",
    );
  }
  return Object.freeze({start, end});
}

function datedQuery(fields, resource, filter, window) {
  const lines = [
    "SELECT",
    fields.map((field, index) => `  ${field}${index === fields.length - 1 ? "" : ","}`).join("\n"),
    `FROM ${resource}`,
    `WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'`,
  ];
  if (filter) lines.push(`  AND ${filter}`);
  return lines.join("\n");
}

function leafConversionQuery(resource, identity, filter, window) {
  return datedQuery([
    "customer.id", "campaign.id", "campaign.advertising_channel_type", ...identity,
    "segments.date", "segments.conversion_action", "segments.conversion_action_category",
    "metrics.conversions", "metrics.conversions_value",
  ], resource, `${filter} AND segments.conversion_action_category IN ('ADD_TO_CART', 'BEGIN_CHECKOUT', 'PURCHASE')`, window);
}

export function buildGoogleReportingQueries({dateWindow: requestedWindow}) {
  const window = dateWindow(requestedWindow);
  const cartFields = [
    "customer.id", "campaign.id", "campaign.name", "campaign.advertising_channel_type",
    "segments.date", "segments.product_merchant_id", "segments.product_feed_label",
    "segments.product_item_id", "segments.product_sold_item_id", "segments.product_sold_title",
    "metrics.units_sold", "metrics.revenue_micros", "metrics.lead_units_sold", "metrics.lead_revenue_micros",
    "metrics.cross_sell_units_sold", "metrics.cross_sell_revenue_micros",
    "metrics.all_units_sold", "metrics.all_revenue_micros", "metrics.all_lead_units_sold",
    "metrics.all_lead_revenue_micros", "metrics.all_cross_sell_units_sold", "metrics.all_cross_sell_revenue_micros",
  ];
  return Object.freeze({
    account_identity: [
      "SELECT",
      "  customer.id,",
      "  customer.descriptive_name,",
      "  customer.currency_code,",
      "  customer.time_zone,",
      "  customer.test_account",
      "FROM customer",
    ].join("\n"),
    campaign_context: [
      "SELECT",
      "  customer.id,",
      "  campaign.id,",
      "  campaign.name,",
      "  campaign.status,",
      "  campaign.advertising_channel_type,",
      "  campaign.advertising_channel_sub_type,",
      "  campaign.shopping_setting.merchant_id,",
      "  campaign.shopping_setting.feed_label",
      "FROM campaign",
    ].join("\n"),
    ad_group_channel_daily: datedQuery([
      "customer.id",
      "campaign.id",
      "campaign.name",
      "campaign.advertising_channel_type",
      "campaign.advertising_channel_sub_type",
      "ad_group.id",
      "ad_group.name",
      "ad_group.status",
      "segments.date",
      "metrics.impressions",
      "metrics.clicks",
      "metrics.cost_micros",
      "metrics.conversions",
      "metrics.conversions_value",
    ], "ad_group", "campaign.advertising_channel_type = 'SHOPPING'", window),
    search_ad_channel_daily: datedQuery([
      "customer.id", "campaign.id", "campaign.name", "campaign.advertising_channel_type",
      "ad_group.id", "ad_group.name", "ad_group_ad.ad.id", "ad_group_ad.status",
      "segments.date", "metrics.impressions", "metrics.clicks", "metrics.cost_micros",
      "metrics.conversions", "metrics.conversions_value",
    ], "ad_group_ad", "campaign.advertising_channel_type = 'SEARCH'", window),
    pmax_asset_group_channel_daily: datedQuery([
      "customer.id",
      "campaign.id",
      "campaign.name",
      "campaign.advertising_channel_type",
      "campaign.shopping_setting.merchant_id",
      "asset_group.id",
      "asset_group.name",
      "asset_group.status",
      "segments.date",
      "metrics.impressions",
      "metrics.clicks",
      "metrics.cost_micros",
      "metrics.conversions",
      "metrics.conversions_value",
    ], "asset_group", "campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND campaign.shopping_setting.merchant_id IS NOT NULL", window),
    search_ad_conversion_action_daily: leafConversionQuery("ad_group_ad",
      ["ad_group.id", "ad_group_ad.ad.id"], "campaign.advertising_channel_type = 'SEARCH'", window),
    shopping_ad_group_conversion_action_daily: leafConversionQuery("ad_group",
      ["ad_group.id"], "campaign.advertising_channel_type = 'SHOPPING'", window),
    pmax_asset_group_conversion_action_daily: leafConversionQuery("asset_group",
      ["asset_group.id"], "campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND campaign.shopping_setting.merchant_id IS NOT NULL", window),
    conversion_action_daily: datedQuery([
      "customer.id",
      "campaign.id",
      "campaign.name",
      "campaign.advertising_channel_type",
      "segments.date",
      "segments.conversion_action",
      "segments.conversion_action_name",
      "segments.conversion_action_category",
      "metrics.conversions",
      "metrics.conversions_value",
      "metrics.all_conversions",
      "metrics.all_conversions_value",
    ], "campaign", null, window),
    shopping_product_daily: datedQuery([
      "customer.id",
      "campaign.id",
      "campaign.name",
      "campaign.advertising_channel_type",
      "ad_group.id",
      "ad_group.name",
      "segments.date",
      "segments.product_merchant_id",
      "segments.product_feed_label",
      "segments.product_item_id",
      "segments.product_brand",
      "segments.product_category_level1",
      "segments.product_category_level2",
      "segments.product_category_level3",
      "segments.product_category_level4",
      "segments.product_category_level5",
      "segments.product_type_l1",
      "segments.product_type_l2",
      "segments.product_type_l3",
      "segments.product_type_l4",
      "segments.product_type_l5",
      "segments.product_custom_attribute0",
      "segments.product_custom_attribute1",
      "segments.product_custom_attribute2",
      "segments.product_custom_attribute3",
      "segments.product_custom_attribute4",
      "metrics.impressions",
      "metrics.clicks",
      "metrics.cost_micros",
      "metrics.conversions",
      "metrics.conversions_value",
    ], "shopping_performance_view", "campaign.advertising_channel_type IN ('SHOPPING', 'PERFORMANCE_MAX')", window),
    cart_data_product_sales_daily: datedQuery(cartFields, "cart_data_sales_view", null, window),
    shopping_cart_data_product_sales_daily: datedQuery([
      ...cartFields.slice(0, 4), "ad_group.id", "ad_group.name", ...cartFields.slice(4),
    ], "cart_data_sales_view", "campaign.advertising_channel_type = 'SHOPPING'", window),
    search_cart_data_product_sales_daily: datedQuery([
      "customer.id", "campaign.id", "campaign.name", "campaign.advertising_channel_type",
      "ad_group.id", "ad_group.name", "segments.date", "segments.product_merchant_id",
      "segments.product_feed_label", "segments.product_sold_item_id", "segments.product_sold_title",
      "metrics.units_sold", "metrics.revenue_micros", "metrics.all_units_sold", "metrics.all_revenue_micros",
    ], "cart_data_sales_view", "campaign.advertising_channel_type = 'SEARCH'", window),
    pmax_listing_tree_current: [
      "SELECT",
      "  customer.id,",
      "  campaign.id,",
      "  asset_group.id,",
      "  asset_group.name,",
      "  asset_group.status,",
      "  asset_group_listing_group_filter.resource_name,",
      "  asset_group_listing_group_filter.id,",
      "  asset_group_listing_group_filter.asset_group,",
      "  asset_group_listing_group_filter.parent_listing_group_filter,",
      "  asset_group_listing_group_filter.path,",
      "  asset_group_listing_group_filter.type,",
      "  asset_group_listing_group_filter.listing_source",
      "FROM asset_group_listing_group_filter",
      "WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'",
      "  AND campaign.shopping_setting.merchant_id IS NOT NULL",
    ].join("\n"),
    pmax_product_group_aggregate_daily: datedQuery([
      "customer.id",
      "campaign.id",
      "asset_group.id",
      "asset_group.name",
      "asset_group_listing_group_filter.id",
      "segments.date",
      "metrics.impressions",
      "metrics.clicks",
      "metrics.cost_micros",
      "metrics.conversions",
      "metrics.conversions_value",
    ], "asset_group_product_group_view", "campaign.advertising_channel_type = 'PERFORMANCE_MAX'", window),
  });
}

function freezeRows(rows) {
  return Object.freeze(rows.map((row) => Object.freeze({...row})));
}

export async function fetchGoogleReportingPage({
  client,
  customerId,
  queryFamily,
  dateWindow: requestedWindow,
  pageToken = null,
}) {
  if (!client || typeof client.search !== "function") {
    throw new TypeError("client.search is required");
  }
  if (!GOOGLE_REPORTING_QUERY_FAMILIES.includes(queryFamily)) {
    throw new GoogleReportingError(
      "GOOGLE_REPORTING_QUERY_FAMILY_INVALID",
      "Unknown Google reporting query family",
    );
  }
  const queries = buildGoogleReportingQueries({dateWindow: requestedWindow});
  const query = queries[queryFamily];
  const result = await client.search({customerId, query, pageToken});
  const rows = freezeRows(result.results);
  const pdMetrics = GOOGLE_PD_QUERY_FAMILIES.includes(queryFamily)
    ? Object.freeze(rows.map((row, source_row_index) => Object.freeze({
      source_row_index, ...mapGooglePdMetrics(row, queryFamily),
    }))) : null;
  return Object.freeze({
    provider: "google_ads",
    fact_family: queryFamily,
    rows,
    ...(pdMetrics ? {pd_metric_rows: pdMetrics} : {}),
    next_cursor: result.next_page_token,
    provider_request_id: result.request_id,
    observation_state: rows.length === 0
      ? "not_observed_in_this_execution"
      : "present",
    evidence: Object.freeze({
      api_version: GOOGLE_ADS_REST_VERSION,
      query_family: queryFamily,
      query,
      query_fingerprint: createQueryFingerprint(query),
      synthetic: false,
      page_row_count: rows.length,
    }),
  });
}

export const GOOGLE_PD_QUERY_FAMILIES = Object.freeze([
  "ad_group_channel_daily", "search_ad_channel_daily", "pmax_asset_group_channel_daily",
  "search_ad_conversion_action_daily", "shopping_ad_group_conversion_action_daily",
  "pmax_asset_group_conversion_action_daily",
]);
const GOOGLE_PD_METRICS = Object.freeze([
  "impression", "ad_click", "spend_value", "add_to_cart", "add_to_cart_value",
  "checkout", "checkout_value", "purchase", "purchase_value",
]);

// Leaf projections stay separate until the later completeness/rollup contract joins
// their exact authority/date/currency keys. A missing conversion row is not zero.
export function mapGooglePdMetrics(row, queryFamily) {
  if (!GOOGLE_PD_QUERY_FAMILIES.includes(queryFamily) || !row || typeof row !== "object" || Array.isArray(row)) {
    throw new GoogleReportingError("GOOGLE_PD_PROJECTION_INVALID", "Invalid Google PD source");
  }
  const conversion = queryFamily.endsWith("conversion_action_daily");
  const categoryMetrics = {ADD_TO_CART: ["add_to_cart", "add_to_cart_value"],
    BEGIN_CHECKOUT: ["checkout", "checkout_value"], PURCHASE: ["purchase", "purchase_value"]};
  const category = row.segments?.conversionActionCategory;
  const selected = conversion && Object.hasOwn(categoryMetrics, category) ? categoryMetrics[category] : null;
  if (conversion && (!selected || !optionalId(row.segments?.conversionAction))) {
    throw new GoogleReportingError("GOOGLE_PD_PROJECTION_INVALID", "Missing conversion action/category");
  }
  const sources = conversion ? {[selected[0]]: "conversions", [selected[1]]: "conversionsValue"}
    : {impression: "impressions", ad_click: "clicks", spend_value: "costMicros"};
  const raw_metrics = {}, metric_support = {}, observation_state = {};
  for (const metric of GOOGLE_PD_METRICS) {
    const source = sources[metric];
    const native = source ? row.metrics?.[source] : undefined;
    let value = null;
    if (native != null) {
      if ((typeof native !== "string" && typeof native !== "number")
        || (typeof native === "string" && !/^-?\d+(?:\.\d+)?$/.test(native))
        || !Number.isFinite(Number(native))) {
        throw new GoogleReportingError("GOOGLE_PD_PROJECTION_INVALID", "Malformed Google metric");
      }
      value = Number(native);
      if (metric === "spend_value") value /= 1_000_000;
    }
    raw_metrics[metric] = value;
    metric_support[metric] = value === null ? "unknown" : "supported";
    observation_state[metric] = !source ? "not_requested" : value === null ? "absent" : value === 0 ? "zero" : "present";
  }
  return Object.freeze({raw_metrics: Object.freeze(raw_metrics), metric_support: Object.freeze(metric_support),
    observation_state: Object.freeze(observation_state), conversion_scope: "normal",
    source_query_family: queryFamily, source_currency_conversion: "none_cost_micros_unit_scale_only"});
}

function optionalId(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numericEvidence(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && NON_NEGATIVE_NUMBER_PATTERN.test(value)) {
    return Number(value);
  }
  return null;
}

function hasPositiveMetric(metrics, names) {
  return names.some((name) => {
    const value = numericEvidence(metrics?.[name]);
    return value !== null && value > 0;
  });
}

export function normalizeGoogleCartDataSale(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new GoogleReportingError(
      "GOOGLE_CART_DATA_ROW_INVALID",
      "Google Cart Data row must be an object",
    );
  }
  const segments = row.segments ?? {};
  const metrics = row.metrics ?? {};
  const businessDate = reportingDate(segments.date, "segments.date");
  const advertisedItemId = optionalId(segments.productItemId);
  const soldItemId = optionalId(segments.productSoldItemId);
  const leadEvidence = hasPositiveMetric(metrics, ["leadUnitsSold", "leadRevenueMicros"]);
  const crossSellEvidence = hasPositiveMetric(metrics, [
    "crossSellUnitsSold",
    "crossSellRevenueMicros",
  ]);

  let salesRole = "Unclassified";
  const normalObserved = ["unitsSold", "revenueMicros", "leadUnitsSold", "leadRevenueMicros",
    "crossSellUnitsSold", "crossSellRevenueMicros"].some(name => numericEvidence(metrics[name]) !== null);
  if (normalObserved && soldItemId && !advertisedItemId) {
    salesRole = "Assisted";
  } else if (
    advertisedItemId
    && soldItemId
    && advertisedItemId === soldItemId
    && leadEvidence
    && !crossSellEvidence
  ) {
    salesRole = "Advertised";
  } else if (
    advertisedItemId
    && soldItemId
    && advertisedItemId !== soldItemId
    && crossSellEvidence
    && !leadEvidence
  ) {
    salesRole = "Cross-sell";
  }

  return Object.freeze({
    provider: "google_ads",
    business_date: businessDate,
    campaign_id: optionalId(row.campaign?.id),
    campaign_type: optionalId(row.campaign?.advertisingChannelType),
    provider_product_key: Object.freeze({
      merchant_id: optionalId(segments.productMerchantId),
      feed_label: optionalId(segments.productFeedLabel),
      advertised_item_id: advertisedItemId,
      sold_item_id: soldItemId,
    }),
    sales_role: salesRole,
    conversion_scope: "normal",
    raw_metrics: Object.freeze({
      units_sold: metrics.unitsSold ?? null,
      revenue_micros: metrics.revenueMicros ?? null,
      lead_units_sold: metrics.leadUnitsSold ?? null,
      lead_revenue_micros: metrics.leadRevenueMicros ?? null,
      cross_sell_units_sold: metrics.crossSellUnitsSold ?? null,
      cross_sell_revenue_micros: metrics.crossSellRevenueMicros ?? null,
    }),
    raw_row: Object.freeze({...row}),
  });
}

function resourceId(value, code) {
  const match = typeof value === "string" ? RESOURCE_ID_PATTERN.exec(value) : null;
  if (!match) throw new GoogleReportingError(code, code);
  return match[1];
}

function dimensionValue(product, dimension) {
  if (!dimension || typeof dimension !== "object") return false;
  if (dimension.productItemId) {
    return product.item_id === dimension.productItemId.value;
  }
  if (dimension.productBrand) {
    return product.brand === dimension.productBrand.value;
  }
  if (dimension.productChannel) {
    return product.channel === dimension.productChannel.channel;
  }
  if (dimension.productCondition) {
    return product.condition === dimension.productCondition.condition;
  }
  if (dimension.productCategory) {
    const level = dimension.productCategory.level;
    return product.category_ids?.[level] === String(dimension.productCategory.categoryId);
  }
  if (dimension.productType) {
    return product.product_types?.[dimension.productType.level] === dimension.productType.value;
  }
  if (dimension.productCustomAttribute) {
    return product.custom_attributes?.[dimension.productCustomAttribute.index]
      === dimension.productCustomAttribute.value;
  }
  return false;
}

function includedLeafMatches(row, product) {
  const filter = row?.assetGroupListingGroupFilter;
  if (!filter || filter.type !== "UNIT_INCLUDED") return false;
  const dimensions = filter.path?.dimensions;
  if (Array.isArray(dimensions) && dimensions.length > 0) {
    return dimensions.every((dimension) => dimensionValue(product, dimension));
  }
  return !filter.parentListingGroupFilter && !filter.caseValue;
}

function validInstant(value, code) {
  const normalized = requireString(value, code, 64);
  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp)) throw new GoogleReportingError(code, code);
  return new Date(timestamp).toISOString();
}

function unknownChannel(sale, reason, candidates = []) {
  return Object.freeze({
    channel_type: "Unclassified Channel",
    channel_id: null,
    channel_name: null,
    resolution: "unknown",
    reason,
    candidate_asset_group_ids: Object.freeze([...candidates].sort()),
    sale,
  });
}

export function resolvePmaxSaleChannel({
  sale,
  advertisedProduct,
  businessWindow,
  listingEvidence,
}) {
  if (!sale || sale.campaign_type !== "PERFORMANCE_MAX") {
    throw new GoogleReportingError(
      "GOOGLE_PMAX_SALE_REQUIRED",
      "PMax Channel resolution requires a Performance Max sale",
    );
  }
  const advertisedItemId = sale.provider_product_key?.advertised_item_id;
  if (!advertisedItemId) return unknownChannel(sale, "advertised_product_missing");
  if (advertisedProduct?.item_id !== advertisedItemId) {
    return unknownChannel(sale, "advertised_product_evidence_missing_or_mismatched");
  }
  if (listingEvidence?.complete !== true || !Array.isArray(listingEvidence?.snapshots)) {
    return unknownChannel(sale, "listing_tree_evidence_incomplete");
  }

  const timezone = requireString(
    businessWindow?.timezone,
    "GOOGLE_LISTING_TIMEZONE_REQUIRED",
    100,
  );
  const windowStart = validInstant(
    businessWindow?.start,
    "GOOGLE_LISTING_WINDOW_START_INVALID",
  );
  const windowEnd = validInstant(
    businessWindow?.end,
    "GOOGLE_LISTING_WINDOW_END_INVALID",
  );
  if (windowStart >= windowEnd) {
    throw new GoogleReportingError(
      "GOOGLE_LISTING_WINDOW_INVALID",
      "Listing evidence window start must precede end",
    );
  }
  if (businessWindow?.business_date !== sale.business_date) {
    return unknownChannel(sale, "sale_business_date_window_mismatch");
  }

  const candidates = new Map();
  for (const snapshot of listingEvidence.snapshots) {
    if (
      snapshot?.campaign_id !== sale.campaign_id
      || snapshot?.timezone !== timezone
      || typeof snapshot?.tree_hash !== "string"
      || snapshot.tree_hash.length < 1
      || !Array.isArray(snapshot?.rows)
    ) continue;
    const validFrom = validInstant(snapshot.valid_from, "GOOGLE_LISTING_VALID_FROM_INVALID");
    const validTo = validInstant(snapshot.valid_to, "GOOGLE_LISTING_VALID_TO_INVALID");
    if (validFrom > windowStart || validTo < windowEnd) continue;
    const matchingRow = snapshot.rows.find((row) => includedLeafMatches(row, advertisedProduct));
    if (!matchingRow) continue;
    const assetGroupId = snapshot.asset_group_id
      ?? matchingRow.assetGroup?.id
      ?? resourceId(
        matchingRow.assetGroupListingGroupFilter?.assetGroup,
        "GOOGLE_ASSET_GROUP_RESOURCE_INVALID",
      );
    const prior = candidates.get(String(assetGroupId));
    if (prior && prior.tree_hash !== snapshot.tree_hash) {
      return unknownChannel(sale, "conflicting_listing_tree_versions", candidates.keys());
    }
    candidates.set(String(assetGroupId), {
      tree_hash: snapshot.tree_hash,
      name: snapshot.asset_group_name ?? matchingRow.assetGroup?.name ?? null,
      valid_from: validFrom,
      valid_to: validTo,
    });
  }

  if (candidates.size !== 1) {
    return unknownChannel(
      sale,
      candidates.size === 0 ? "no_eligible_asset_group" : "overlapping_asset_groups",
      candidates.keys(),
    );
  }
  const [[channelId, evidence]] = candidates.entries();
  return Object.freeze({
    channel_type: "Asset Group",
    channel_id: channelId,
    channel_name: evidence.name,
    resolution: "exact",
    reason: "one_temporally_valid_eligible_asset_group",
    candidate_asset_group_ids: Object.freeze([channelId]),
    sale,
    evidence: Object.freeze({
      sale_business_date: sale.business_date,
      reporting_account_timezone: timezone,
      listing_tree_evidence_version_or_hash: evidence.tree_hash,
      listing_tree_valid_from: evidence.valid_from,
      listing_tree_valid_to: evidence.valid_to,
    }),
  });
}

export function classifyGoogleReportingError(error) {
  const requestId = error?.details?.request_id ?? null;
  if (error instanceof GoogleAdsRestError) {
    const status = Number(error.details?.status);
    const providerCode = error.details?.provider_error_code ?? null;
    const providerStatus = error.details?.provider_status ?? null;
    let errorClass = "request_contract_invalid";
    if (providerCode === "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION") {
      errorClass = "provider_access_level_required";
    } else if (providerCode === "TWO_STEP_VERIFICATION_NOT_ENROLLED") {
      errorClass = "account_security_action_required";
    } else if (providerCode === "AUTHORIZATION_ERROR" || providerStatus === "AUTHORIZATION_ERROR") {
      errorClass = "provider_access_incident";
    } else if (status === 401) errorClass = "reauthorization_required";
    else if (status === 403) errorClass = "permission_or_scope_missing";
    else if (status === 429 || providerCode === "RESOURCE_EXHAUSTED") errorClass = "rate_limited";
    else if (status >= 500) errorClass = "transient_provider_failure";
    return Object.freeze({
      class: errorClass,
      retryable: false,
      retry_after_ms: null,
      provider_request_id: requestId,
      message: error.message,
    });
  }
  return Object.freeze({
    class: error instanceof GoogleReportingError
      ? "request_contract_invalid"
      : "internal_adapter_failure",
    retryable: false,
    retry_after_ms: null,
    provider_request_id: requestId,
    message: error instanceof Error ? error.message : "Unexpected Google reporting failure",
  });
}
