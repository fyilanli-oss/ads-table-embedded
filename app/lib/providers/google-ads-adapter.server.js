import {
  COMMON_ADAPTER_CONTRACT_VERSION,
  createQueryFingerprint,
  runCommonAdapterOperation,
  sha256,
  stableJson,
  validateCommonAdapterRequest,
} from "./common-adapter.server.js";

export const GOOGLE_ADS_ADAPTER_VERSION = "1.0.0";
export const GOOGLE_ADS_API_VERSION = "v25";
export const GOOGLE_QUERY_FAMILIES = Object.freeze([
  "canonical_ad_performance",
  "shopping_product_performance",
  "performance_max_retail_product_performance",
  "sold_product_cart",
]);
export const GOOGLE_CAMPAIGN_TYPES = Object.freeze(["standard", "performance_max"]);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONVERSION_CATEGORIES = Object.freeze({
  ADD_TO_CART: ["add_to_cart", "add_to_cart_value"],
  BEGIN_CHECKOUT: ["checkout", "checkout_value"],
  PURCHASE: ["purchase", "purchase_value"],
});
const ALL_METRICS = Object.freeze([
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
]);

export class GoogleAdsAdapterError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "GoogleAdsAdapterError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new GoogleAdsAdapterError(code, message, details);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, field) {
  if (!isRecord(value)) fail("GOOGLE_SCHEMA_CHANGED", `${field} must be an object`);
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("GOOGLE_SCHEMA_CHANGED", `${field} must be a non-empty string`);
  }
  return value;
}

function requireDate(value, field) {
  requireString(value, field);
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail("GOOGLE_SCHEMA_CHANGED", `${field} must be YYYY-MM-DD`);
  }
  return value;
}

function numberObservation(container, field, transform = (value) => value) {
  if (!Object.hasOwn(container, field)) {
    fail("GOOGLE_SCHEMA_CHANGED", `Selected field ${field} is missing`);
  }
  const raw = container[field];
  if ((typeof raw !== "string" && typeof raw !== "number") || String(raw).trim() === "") {
    fail("GOOGLE_SCHEMA_CHANGED", `${field} must be numeric`);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail("GOOGLE_SCHEMA_CHANGED", `${field} must be finite and non-negative`);
  }
  const value = transform(parsed);
  return { value, support: "supported", state: value === 0 ? "zero" : "present" };
}

function absentObservation() {
  return { value: null, support: "supported", state: "absent" };
}

function unsupportedObservation() {
  return { value: null, support: "unsupported", state: "not_requested" };
}

function putMetric(containers, metric, observation) {
  containers.raw_metrics[metric] = observation.value;
  containers.metric_support[metric] = observation.support;
  containers.observation_state[metric] = observation.state;
}

function createMetricContainers() {
  return { raw_metrics: {}, metric_support: {}, observation_state: {} };
}

function assertGoogleRequest(request) {
  validateCommonAdapterRequest(request);
  if (request.provider !== "google_ads") {
    fail("GOOGLE_REQUEST_INVALID", "Google Ads adapter requires provider=google_ads");
  }
  if (request.provider_api_version !== GOOGLE_ADS_API_VERSION) {
    fail("GOOGLE_REQUEST_INVALID", `Google Ads API version must be ${GOOGLE_ADS_API_VERSION}`);
  }
  if (request.operation !== "fetch_facts") {
    fail("GOOGLE_REQUEST_INVALID", "Google Ads canonical runner requires fetch_facts");
  }
  if (
    request.canonical_reporting_account_id !== request.platform_account_id ||
    !/^\d+$/.test(request.platform_account_id)
  ) {
    fail(
      "GOOGLE_REQUEST_INVALID",
      "Canonical reporting account must equal the verified numeric serving customer",
    );
  }
  if (
    !isRecord(request.account_context) ||
    request.account_context.customer_manager !== false
  ) {
    fail("GOOGLE_REQUEST_INVALID", "Manager customers cannot be reporting accounts");
  }
  if (!GOOGLE_QUERY_FAMILIES.includes(request.query_family)) {
    fail("GOOGLE_REQUEST_INVALID", "Unknown Google query family");
  }
  if (!GOOGLE_CAMPAIGN_TYPES.includes(request.campaign_type)) {
    fail("GOOGLE_REQUEST_INVALID", "Unknown Google campaign type");
  }
  if (
    request.query_family === "canonical_ad_performance" &&
    request.campaign_type === "standard" &&
    !request.levels.includes("ad")
  ) {
    fail("GOOGLE_REQUEST_INVALID", "Standard performance must preserve the real Ad leaf");
  }
  if (
    request.query_family === "canonical_ad_performance" &&
    request.campaign_type === "performance_max" &&
    (request.levels.includes("ad") || !request.levels.includes("asset_group"))
  ) {
    fail("GOOGLE_REQUEST_INVALID", "Performance Max must stop at Asset Group without a fake Ad");
  }
  return request;
}

function canonicalLevels(campaignType) {
  return campaignType === "standard"
    ? ["campaign", "ad_group", "ad", "source_date"]
    : ["campaign", "asset_group", "source_date"];
}

function familyLevels(queryFamily, campaignType) {
  if (queryFamily === "canonical_ad_performance") return canonicalLevels(campaignType);
  if (queryFamily === "shopping_product_performance") {
    return ["campaign", "ad_group", "product_item", "source_date"];
  }
  if (queryFamily === "performance_max_retail_product_performance") {
    return ["campaign", "asset_group", "product_item", "source_date"];
  }
  return ["campaign_or_ad_group", "sold_product", "source_date"];
}

export function buildGoogleAdsRequest(overrides) {
  const queryFamily = overrides.query_family ?? "canonical_ad_performance";
  const campaignType = overrides.campaign_type ?? "standard";
  const shape = {
    provider: "google_ads",
    operation: "fetch_facts",
    adapter_contract_version: COMMON_ADAPTER_CONTRACT_VERSION,
    provider_api_version: GOOGLE_ADS_API_VERSION,
    query_family: queryFamily,
    campaign_type: campaignType,
    levels: familyLevels(queryFamily, campaignType),
    breakdowns:
      queryFamily === "canonical_ad_performance"
        ? [
            "segments.date",
            "segments.conversion_action",
            "segments.conversion_action_category",
            "segments.conversion_action_name",
            "segments.conversion_attribution_event_type",
          ]
        : ["segments.date"],
    ...overrides,
  };
  shape.query_fingerprint = createQueryFingerprint({
    provider: shape.provider,
    api_version: shape.provider_api_version,
    account_id: shape.platform_account_id,
    date_window: shape.date_window,
    query_family: shape.query_family,
    campaign_type: shape.campaign_type,
    levels: shape.levels,
    requested_metrics: shape.requested_metrics,
  });
  return assertGoogleRequest(shape);
}

function dateClause(request) {
  return `segments.date BETWEEN '${request.date_window.start}' AND '${request.date_window.end}'`;
}

function query(fields, resource, where) {
  return `SELECT ${fields.join(", ")} FROM ${resource} WHERE ${where}`;
}

function canonicalIdentityFields(campaignType) {
  const common = [
    "customer.id",
    "customer.currency_code",
    "customer.time_zone",
    "campaign.id",
    "campaign.name",
    "campaign.advertising_channel_type",
  ];
  if (campaignType === "standard") {
    return [
      ...common,
      "ad_group.id",
      "ad_group.name",
      "ad_group_ad.ad.id",
      "ad_group_ad.ad.name",
      "ad_group_ad.status",
      "segments.date",
    ];
  }
  return [...common, "asset_group.id", "asset_group.name", "asset_group.status", "segments.date"];
}

export function buildGoogleAdsQueryPlan(request) {
  assertGoogleRequest(request);
  const where = dateClause(request);

  if (request.query_family === "canonical_ad_performance") {
    const identity = canonicalIdentityFields(request.campaign_type);
    const resource = request.campaign_type === "standard" ? "ad_group_ad" : "asset_group";
    return Object.freeze([
      Object.freeze({
        partition: "base_performance",
        resource,
        gaql: query(
          [...identity, "metrics.impressions", "metrics.clicks", "metrics.cost_micros"],
          resource,
          where,
        ),
      }),
      Object.freeze({
        partition: "conversion_actions",
        resource,
        gaql: query(
          [
            ...identity,
            "segments.conversion_action",
            "segments.conversion_action_category",
            "segments.conversion_action_name",
            "segments.conversion_attribution_event_type",
            "metrics.all_conversions",
            "metrics.all_conversions_value",
          ],
          resource,
          where,
        ),
      }),
    ]);
  }

  if (request.query_family === "shopping_product_performance") {
    return Object.freeze([
      Object.freeze({
        partition: "shopping_product_performance",
        resource: "shopping_performance_view",
        gaql: query(
          [
            "customer.id",
            "campaign.id",
            "campaign.name",
            "ad_group.id",
            "ad_group.name",
            "segments.product_item_id",
            "segments.product_title",
            "segments.date",
            "metrics.impressions",
            "metrics.clicks",
            "metrics.cost_micros",
            "metrics.conversions",
            "metrics.conversions_value",
            "metrics.orders",
            "metrics.units_sold",
            "metrics.revenue_micros",
          ],
          "shopping_performance_view",
          where,
        ),
      }),
    ]);
  }

  if (request.query_family === "performance_max_retail_product_performance") {
    return Object.freeze([
      Object.freeze({
        partition: "performance_max_retail_product_performance",
        resource: "asset_group_product_group_view",
        gaql: query(
          [
            "customer.id",
            "campaign.id",
            "campaign.name",
            "asset_group.id",
            "asset_group.name",
            "asset_group_listing_group_filter.case_value.product_item_id.value",
            "segments.date",
            "metrics.impressions",
            "metrics.clicks",
            "metrics.cost_micros",
            "metrics.conversions",
            "metrics.conversions_value",
          ],
          "asset_group_product_group_view",
          where,
        ),
        required_native_item_partition:
          "asset_group_listing_group_filter.case_value.product_item_id.value",
      }),
    ]);
  }

  return Object.freeze([
    Object.freeze({
      partition: "sold_product_cart",
      resource: "cart_data_sales_view",
      gaql: query(
        [
          "customer.id",
          "campaign.id",
          "campaign.name",
          "ad_group.id",
          "ad_group.name",
          "segments.product_sold_item_id",
          "segments.product_sold_title",
          "segments.product_item_id",
          "segments.product_title",
          "segments.date",
          "metrics.units_sold",
          "metrics.revenue_micros",
          "metrics.lead_units_sold",
          "metrics.lead_revenue_micros",
          "metrics.cross_sell_units_sold",
          "metrics.cross_sell_revenue_micros",
        ],
        "cart_data_sales_view",
        where,
      ),
      incompatible_dimensions: Object.freeze(["ad_group_ad.ad.id", "asset_group.id"]),
    }),
  ]);
}

function entityIdentity(row, campaignType) {
  const campaign = requireRecord(row.campaign, "campaign");
  const campaignId = requireString(campaign.id, "campaign.id");
  const campaignName = requireString(campaign.name, "campaign.name");
  if (campaignType === "standard") {
    const adGroup = requireRecord(row.adGroup, "adGroup");
    const adGroupAd = requireRecord(row.adGroupAd, "adGroupAd");
    const ad = requireRecord(adGroupAd.ad, "adGroupAd.ad");
    return {
      campaign_id: campaignId,
      campaign_name: campaignName,
      parent_type: "adgroup",
      parent_id: requireString(adGroup.id, "adGroup.id"),
      parent_name: requireString(adGroup.name, "adGroup.name"),
      entity_type: "ad",
      entity_id: requireString(ad.id, "adGroupAd.ad.id"),
      entity_name: requireString(ad.name, "adGroupAd.ad.name"),
    };
  }
  const assetGroup = requireRecord(row.assetGroup, "assetGroup");
  return {
    campaign_id: campaignId,
    campaign_name: campaignName,
    parent_type: "campaign",
    parent_id: campaignId,
    parent_name: campaignName,
    entity_type: "asset_group",
    entity_id: requireString(assetGroup.id, "assetGroup.id"),
    entity_name: requireString(assetGroup.name, "assetGroup.name"),
  };
}

function rowKey(row, campaignType) {
  const segments = requireRecord(row.segments, "segments");
  const entity = entityIdentity(row, campaignType);
  return `${requireDate(segments.date, "segments.date")}|${entity.entity_type}|${entity.entity_id}`;
}

function aggregateConversions(rows) {
  const observations = new Map();
  const evidence = [];
  const unique = new Set();
  for (const row of rows) {
    const segments = requireRecord(row.segments, "segments");
    const metrics = requireRecord(row.metrics, "metrics");
    const category = requireString(
      segments.conversionActionCategory,
      "segments.conversionActionCategory",
    );
    if (!Object.hasOwn(CONVERSION_CATEGORIES, category)) continue;
    const action = requireString(segments.conversionAction, "segments.conversionAction");
    const eventType = requireString(
      segments.conversionAttributionEventType,
      "segments.conversionAttributionEventType",
    );
    const identity = `${category}|${action}|${eventType}`;
    if (unique.has(identity)) {
      fail("GOOGLE_SCHEMA_CHANGED", "Duplicate conversion action attribution component");
    }
    unique.add(identity);
    const count = numberObservation(metrics, "allConversions");
    const value = numberObservation(metrics, "allConversionsValue");
    const prior = observations.get(category) ?? { count: 0, value: 0, components: 0 };
    prior.count += count.value;
    prior.value += value.value;
    prior.components += 1;
    observations.set(category, prior);
    evidence.push({
      category,
      action_sha256: sha256(action),
      action_name_sha256:
        typeof segments.conversionActionName === "string"
          ? sha256(segments.conversionActionName)
          : null,
      attribution_event_type: eventType,
      count: count.value,
      value: value.value,
    });
  }
  return { observations, evidence };
}

export function translateGoogleAdsCanonicalBundle(bundle, context) {
  const request = assertGoogleRequest(context.request);
  if (request.query_family !== "canonical_ad_performance") {
    fail("GOOGLE_REQUEST_INVALID", "Canonical translation only accepts canonical_ad_performance");
  }
  const base = requireRecord(bundle.base, "bundle.base");
  const conversionRows = Array.isArray(bundle.conversions) ? bundle.conversions : [];
  const customer = requireRecord(base.customer, "customer");
  const metrics = requireRecord(base.metrics, "metrics");
  const segments = requireRecord(base.segments, "segments");
  const businessDate = requireDate(segments.date, "segments.date");
  const entity = entityIdentity(base, request.campaign_type);
  const customerId = requireString(customer.id, "customer.id");
  if (customerId !== request.platform_account_id) {
    fail("GOOGLE_ACCOUNT_SCOPE_MISMATCH", "Response customer differs from reporting authority");
  }

  for (const row of conversionRows) {
    if (rowKey(row, request.campaign_type) !== rowKey(base, request.campaign_type)) {
      fail("GOOGLE_SCHEMA_CHANGED", "Conversion row does not match its canonical entity/date");
    }
  }

  const containers = createMetricContainers();
  putMetric(containers, "impression", numberObservation(metrics, "impressions"));
  putMetric(containers, "ad_click", numberObservation(metrics, "clicks"));
  putMetric(containers, "session", unsupportedObservation());
  putMetric(
    containers,
    "spend_value",
    numberObservation(metrics, "costMicros", (value) => value / 1_000_000),
  );

  const aggregated = aggregateConversions(conversionRows);
  for (const [category, [countMetric, valueMetric]] of Object.entries(CONVERSION_CATEGORIES)) {
    const observed = aggregated.observations.get(category);
    if (!observed) {
      putMetric(containers, countMetric, absentObservation());
      putMetric(containers, valueMetric, absentObservation());
    } else {
      putMetric(containers, countMetric, {
        value: observed.count,
        support: "supported",
        state: observed.count === 0 ? "zero" : "present",
      });
      putMetric(containers, valueMetric, {
        value: observed.value,
        support: "supported",
        state: observed.value === 0 ? "zero" : "present",
      });
    }
  }

  for (const metric of ALL_METRICS) {
    if (!Object.hasOwn(containers.raw_metrics, metric)) {
      fail("GOOGLE_SCHEMA_CHANGED", `Canonical metric ${metric} was not populated`);
    }
  }

  const sourceCurrency = requireString(customer.currencyCode, "customer.currencyCode");
  const sourceTimezone = requireString(customer.timeZone, "customer.timeZone");
  return {
    identity: {
      workspace_id: request.authority.workspace_id,
      installation_id: request.authority.installation_id,
      installation_generation: request.authority.installation_generation,
      provider_connection_id: request.provider_connection_id,
      platform: "google_ads",
      platform_account_id: request.platform_account_id,
      canonical_reporting_account_id: request.canonical_reporting_account_id,
      business_date: businessDate,
    },
    entity: {
      campaign_type: request.campaign_type,
      root_entity_type: "campaign",
      root_entity_id: entity.campaign_id,
      root_entity_name: entity.campaign_name,
      parent_entity_type: entity.parent_type,
      parent_entity_id: entity.parent_id,
      parent_entity_name: entity.parent_name,
      entity_type: entity.entity_type,
      entity_id: entity.entity_id,
      entity_name: entity.entity_name,
    },
    ...containers,
    currency: {
      source_currency: sourceCurrency,
      target_currency: sourceCurrency,
      fx_rate: 1,
      fx_rate_date: businessDate,
      fx_provider: "source_identity",
      fx_engine_version: "not_applied_in_adapter",
    },
    time: {
      source_timezone: sourceTimezone,
      business_date: businessDate,
      time_engine_version: "google_customer_interaction_date_v1",
    },
    provenance: {
      source_system: "google_ads",
      adapter_version: GOOGLE_ADS_ADAPTER_VERSION,
      source_confidence: "real",
      synthetic: context.synthetic === true,
      raw_reference: {
        query_fingerprint: request.query_fingerprint,
        query_family: request.query_family,
        campaign_type: request.campaign_type,
        conversion_components: aggregated.evidence,
      },
    },
  };
}

export function createGoogleAdsCanonicalFetchPage({ transport, synthetic = false }) {
  if (typeof transport !== "function") {
    fail("GOOGLE_REQUEST_INVALID", "transport must be a function");
  }
  return async ({ request, cursor }) => {
    assertGoogleRequest(request);
    if (request.query_family !== "canonical_ad_performance") {
      fail("GOOGLE_REQUEST_INVALID", "Canonical runner only executes canonical_ad_performance");
    }
    const queryPlan = buildGoogleAdsQueryPlan(request);
    const response = await transport({
      method: "POST",
      api_version: GOOGLE_ADS_API_VERSION,
      customer_id: request.platform_account_id,
      login_customer_id: request.account_context.login_customer_id ?? null,
      query_plan: queryPlan,
      cursor,
    });
    requireRecord(response, "response");
    if (!Array.isArray(response.bundles)) {
      fail("GOOGLE_SCHEMA_CHANGED", "response.bundles must be an array");
    }
    return {
      rows: response.bundles.map((bundle) =>
        translateGoogleAdsCanonicalBundle(bundle, { request, synthetic }),
      ),
      next_cursor: response.next_cursor ?? null,
      provider_request_id:
        typeof response.request_id === "string" ? response.request_id : null,
      quota: isRecord(response.quota) ? response.quota : null,
      raw_evidence: {
        query_plan_sha256: sha256(stableJson(queryPlan)),
        response_bundle_count: response.bundles.length,
      },
    };
  };
}

export function classifyGoogleAdsError(error) {
  const status =
    typeof error?.status === "string"
      ? error.status
      : typeof error?.code === "string"
        ? error.code
        : "";
  const providerRequestId =
    typeof error?.request_id === "string"
      ? error.request_id
      : typeof error?.requestId === "string"
        ? error.requestId
        : null;
  if (status === "UNAUTHENTICATED") {
    return {
      class: "reauthorization_required",
      retryable: false,
      retry_after_ms: null,
      provider_request_id: providerRequestId,
      message: "Google Ads authentication must be renewed",
    };
  }
  if (status === "PERMISSION_DENIED") {
    return {
      class: "permission_or_scope_missing",
      retryable: false,
      retry_after_ms: null,
      provider_request_id: providerRequestId,
      message: "Google Ads permission or OAuth scope is missing",
    };
  }
  if (status === "RESOURCE_EXHAUSTED") {
    return {
      class: "rate_limited",
      retryable: true,
      retry_after_ms:
        Number.isFinite(error?.retry_after_ms) && error.retry_after_ms >= 0
          ? error.retry_after_ms
          : null,
      provider_request_id: providerRequestId,
      message: "Google Ads quota or rate limit was reached",
    };
  }
  if (status === "DEADLINE_EXCEEDED") {
    return {
      class: "provider_timeout",
      retryable: true,
      retry_after_ms: null,
      provider_request_id: providerRequestId,
      message: "Google Ads request timed out",
    };
  }
  if (["UNAVAILABLE", "INTERNAL", "UNKNOWN", "ABORTED"].includes(status)) {
    return {
      class: "transient_provider_failure",
      retryable: true,
      retry_after_ms: null,
      provider_request_id: providerRequestId,
      message: "Google Ads returned a transient failure",
    };
  }
  if (["INVALID_ARGUMENT", "FAILED_PRECONDITION"].includes(status)) {
    return {
      class: "request_contract_invalid",
      retryable: false,
      retry_after_ms: null,
      provider_request_id: providerRequestId,
      message: "Google Ads rejected the deterministic query contract",
    };
  }
  return {
    class: error instanceof GoogleAdsAdapterError
      ? error.code === "GOOGLE_ACCOUNT_SCOPE_MISMATCH"
        ? "reporting_account_inaccessible"
        : error.code === "GOOGLE_REQUEST_INVALID"
          ? "request_contract_invalid"
          : "provider_schema_changed"
      : "internal_adapter_failure",
    retryable: false,
    retry_after_ms: null,
    provider_request_id: providerRequestId,
    message: error instanceof Error ? error.message : "Google Ads adapter failed",
  };
}

export function runGoogleAdsCanonicalFacts({
  request,
  transport,
  synthetic = false,
  sleep,
  now,
  random,
  limits,
}) {
  assertGoogleRequest(request);
  return runCommonAdapterOperation({
    request,
    fetchPage: createGoogleAdsCanonicalFetchPage({ transport, synthetic }),
    classifyError: classifyGoogleAdsError,
    sleep,
    now,
    random,
    limits,
  });
}
