import {
  META_GRAPH_ORIGIN,
  META_GRAPH_VERSION,
  MetaGraphError,
  createMetaAppSecretProof,
} from "./meta-graph.server.js";

export const META_AD_CHANNEL_INSIGHTS_FIELDS = Object.freeze([
  "account_id",
  "account_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
  "impressions",
  "clicks",
  "inline_link_clicks",
  "outbound_clicks",
  "spend",
  "actions",
  "action_values",
]);

export const META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS = Object.freeze([
  "account_id",
  "account_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
  "impressions",
  "clicks",
  "spend",
  "converted_product_quantity",
  "converted_product_value",
  "converted_promoted_product_quantity",
  "converted_promoted_product_value",
]);

export const META_PRODUCT_BREAKDOWN_ID_LIMIT = 100;
// Compatibility export: the former opt-in fields now belong to every product request.
export const META_PROMOTED_PRODUCT_PROBE_FIELDS = META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS;

function productFields(includePromotedProductMetrics) {
  if (typeof includePromotedProductMetrics !== "boolean") {
    throw new MetaGraphError("META_REPORTING_PROBE_INVALID", "Probe flag must be boolean");
  }
  return META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS;
}

export const META_PD_METRIC_SOURCES = Object.freeze({
  impression: Object.freeze({field: "impressions"}),
  ad_click: Object.freeze({field: "outbound_clicks", action_type: "outbound_click"}),
  spend_value: Object.freeze({field: "spend"}),
  add_to_cart: Object.freeze({field: "actions", action_type: "offsite_conversion.fb_pixel_add_to_cart"}),
  add_to_cart_value: Object.freeze({field: "action_values", action_type: "offsite_conversion.fb_pixel_add_to_cart"}),
  checkout: Object.freeze({field: "actions", action_type: "offsite_conversion.fb_pixel_initiate_checkout"}),
  checkout_value: Object.freeze({field: "action_values", action_type: "offsite_conversion.fb_pixel_initiate_checkout"}),
  purchase: Object.freeze({field: "actions", action_type: "offsite_conversion.fb_pixel_purchase"}),
  purchase_value: Object.freeze({field: "action_values", action_type: "offsite_conversion.fb_pixel_purchase"}),
});

function metricSchemaError() {
  throw new MetaGraphError("META_REPORTING_SCHEMA_CHANGED", "Meta PD metric shape is invalid or ambiguous");
}

function metricNumber(value) {
  if (value == null) return null;
  if (typeof value !== "number" && typeof value !== "string") metricSchemaError();
  if (typeof value === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) metricSchemaError();
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) metricSchemaError();
  return numeric;
}

// A metric projection, not a canonical Dataset fact: identity, currency and publication
// remain owned by later gates. Provider-native rows are retained alongside this view.
export function mapMetaPdMetrics(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) metricSchemaError();
  const raw_metrics = {};
  const metric_support = {};
  const observation_state = {};
  for (const [metric, source] of Object.entries(META_PD_METRIC_SOURCES)) {
    let value = row[source.field];
    let state = "absent";
    if (source.action_type && value != null) {
      if (!Array.isArray(value)) metricSchemaError();
      if (value.some(item => !item || typeof item !== "object" || Array.isArray(item)
        || typeof item.action_type !== "string" || !item.action_type.length)) metricSchemaError();
      const selected = value.filter(item => item.action_type === source.action_type);
      if (selected.length > 1) metricSchemaError();
      state = value.length === 0 ? "empty" : "absent";
      value = selected[0]?.value;
    }
    const numeric = metricNumber(value);
    raw_metrics[metric] = numeric;
    metric_support[metric] = numeric === null ? "unknown" : "supported";
    observation_state[metric] = numeric === null ? state : numeric === 0 ? "zero" : "present";
  }
  return Object.freeze({
    raw_metrics: Object.freeze(raw_metrics),
    metric_support: Object.freeze(metric_support),
    observation_state: Object.freeze(observation_state),
    metric_sources: META_PD_METRIC_SOURCES,
  });
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_PATTERN = /^act_[0-9]+$/;
const MAX_CURSOR_LENGTH = 4096;
const RATE_LIMIT_CODES = new Set([4, 17, 32, 80000, 80004]);

function nonEmpty(value, code, maximum = 8192) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
  ) throw new MetaGraphError(code, code);
  return value;
}

function exactVersion(value) {
  if (value !== META_GRAPH_VERSION) {
    throw new MetaGraphError(
      "META_GRAPH_VERSION_MISMATCH",
      `Meta Graph version must be ${META_GRAPH_VERSION}`,
    );
  }
  return value;
}

function date(value, field) {
  if (
    typeof value !== "string"
    || !DATE_PATTERN.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw new MetaGraphError("META_REPORTING_DATE_INVALID", `${field} must be YYYY-MM-DD`);
  }
  return value;
}

function requestId(response) {
  return response?.headers?.get?.("x-fb-trace-id")
    ?? response?.headers?.get?.("x-fb-request-id")
    ?? null;
}

function retryAfterMs(response) {
  const raw = response?.headers?.get?.("retry-after");
  if (typeof raw !== "string" || raw.length < 1) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - Date.now());
}

function usageEvidence(response) {
  const names = ["x-app-usage", "x-ad-account-usage", "x-business-use-case-usage"];
  const present = names.filter((name) => {
    const value = response?.headers?.get?.(name);
    return typeof value === "string" && value.length > 0;
  });
  return Object.freeze({
    app_usage_present: present.includes("x-app-usage"),
    ad_account_usage_present: present.includes("x-ad-account-usage"),
    business_use_case_usage_present: present.includes("x-business-use-case-usage"),
    retry_after_ms: retryAfterMs(response),
  });
}

async function jsonResponse(response) {
  try {
    const payload = await response.json();
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function providerErrorCode(payload) {
  const value = Number(payload?.error?.code);
  return Number.isSafeInteger(value) ? value : null;
}

function boundedCursor(value) {
  if (value == null) return null;
  return nonEmpty(value, "META_REPORTING_CURSOR_INVALID", MAX_CURSOR_LENGTH);
}

function validatedRequest({adAccountId, dateWindow, graphVersion, limit}) {
  const accountId = nonEmpty(adAccountId, "META_AD_ACCOUNT_ID_REQUIRED", 64);
  if (!ACCOUNT_PATTERN.test(accountId)) {
    throw new MetaGraphError("META_AD_ACCOUNT_ID_INVALID", "Meta ad account id is invalid");
  }
  const start = date(dateWindow?.start, "dateWindow.start");
  const end = date(dateWindow?.end, "dateWindow.end");
  if (start > end) {
    throw new MetaGraphError(
      "META_REPORTING_DATE_WINDOW_INVALID",
      "Meta reporting start date must not exceed end date",
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new MetaGraphError("META_REPORTING_PAGE_SIZE_INVALID", "Meta page size must be 1-500");
  }
  return {accountId, start, end, graphVersion: exactVersion(graphVersion)};
}

function baseInsightsUrl({
  adAccountId,
  dateWindow,
  after,
  graphVersion,
  limit,
  fields,
}) {
  const request = validatedRequest({adAccountId, dateWindow, graphVersion, limit});
  const url = new URL(
    `/${request.graphVersion}/${request.accountId}/insights`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set("fields", fields.join(","));
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set(
    "time_range",
    JSON.stringify({since: request.start, until: request.end}),
  );
  url.searchParams.set("limit", String(limit));
  const cursor = boundedCursor(after);
  if (cursor !== null) url.searchParams.set("after", cursor);
  return url;
}

async function fetchMetaInsightsPayload({url, accessToken, appSecret, fetchFn}) {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set(
    "appsecret_proof",
    createMetaAppSecretProof({accessToken, appSecret}),
  );
  const response = await fetchFn(requestUrl.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${nonEmpty(accessToken, "META_ACCESS_TOKEN_REQUIRED")}`,
    },
  });
  const payload = await jsonResponse(response);
  if (!response.ok || !payload) {
    const code = providerErrorCode(payload);
    const authorizationInvalid = code === 190 || response.status === 401;
    const rateLimited = response.status === 429 || RATE_LIMIT_CODES.has(code);
    const permissionDenied = !rateLimited && (
      response.status === 403 || code === 10 || (code >= 200 && code <= 299)
    );
    throw new MetaGraphError(
      authorizationInvalid
        ? "META_REAUTHORIZATION_REQUIRED"
        : permissionDenied ? "META_PERMISSION_DENIED" : "META_REPORTING_REQUEST_FAILED",
      authorizationInvalid
        ? "Meta authorization is no longer valid"
        : permissionDenied ? "Meta permission was denied" : "Meta reporting request failed",
      {
        status: response.status,
        provider_error_code: code,
        request_id: requestId(response),
        retry_after_ms: retryAfterMs(response),
      },
    );
  }
  if (!Array.isArray(payload.data)) {
    throw new MetaGraphError(
      "META_REPORTING_SCHEMA_CHANGED",
      "Meta Insights response data is malformed",
      {request_id: requestId(response)},
    );
  }

  const hasNext = typeof payload?.paging?.next === "string" && payload.paging.next.length > 0;
  const nextCursor = hasNext
    ? boundedCursor(payload?.paging?.cursors?.after)
    : null;
  if (hasNext && nextCursor === null) {
    throw new MetaGraphError(
      "META_REPORTING_CURSOR_INVALID",
      "Meta Insights returned a next page without an opaque cursor",
      {request_id: requestId(response)},
    );
  }
  return {payload, response, nextCursor, rateLimit: usageEvidence(response)};
}

export function buildMetaAdChannelInsightsUrl({
  adAccountId,
  dateWindow,
  after = null,
  graphVersion = META_GRAPH_VERSION,
  limit = 100,
  nativeMetadata = false,
}) {
  if (typeof nativeMetadata !== "boolean") throw new TypeError("nativeMetadata must be boolean");
  const url = baseInsightsUrl({
    adAccountId,
    dateWindow,
    after,
    graphVersion,
    limit,
    fields: nativeMetadata ? [...META_AD_CHANNEL_INSIGHTS_FIELDS, "account_currency", "attribution_setting"] : META_AD_CHANNEL_INSIGHTS_FIELDS,
  });
  url.searchParams.set("action_breakdowns", "action_type");
  if (nativeMetadata) {
    url.searchParams.set("action_report_time", "impression");
    url.searchParams.set("use_unified_attribution_setting", "true");
  }
  return url.toString();
}

export async function fetchMetaAdChannelInsightsPage({
  accessToken,
  appSecret,
  adAccountId,
  dateWindow,
  after = null,
  graphVersion = META_GRAPH_VERSION,
  fetchFn = fetch,
  nativeMetadata = false,
}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const url = buildMetaAdChannelInsightsUrl({
    adAccountId,
    dateWindow,
    after,
    graphVersion,
    nativeMetadata,
  });
  const {payload, response, nextCursor, rateLimit} = await fetchMetaInsightsPayload({
    url,
    accessToken,
    appSecret,
    fetchFn,
  });

  return Object.freeze({
    provider: "meta",
    fact_family: "ad_channel_daily_insights",
    channel_type: "ad",
    rows: Object.freeze(payload.data.map((row) => Object.freeze({...row}))),
    pd_metric_rows: Object.freeze(payload.data.map((row, source_row_index) => Object.freeze({
      source_row_index,
      ...mapMetaPdMetrics(row),
    }))),
    next_cursor: nextCursor,
    provider_request_id: requestId(response),
    evidence: Object.freeze({
      endpoint: "ad_account_insights",
      graph_version: graphVersion,
      level: "ad",
      time_increment: 1,
      requested_fields: nativeMetadata ? [...META_AD_CHANNEL_INSIGHTS_FIELDS, "account_currency", "attribution_setting"] : META_AD_CHANNEL_INSIGHTS_FIELDS,
      ...(nativeMetadata ? {action_report_time: "impression", use_unified_attribution_setting: true} : {}),
      breakdowns: Object.freeze([]),
      action_breakdowns: Object.freeze(["action_type"]),
      pd_mapping_version: "1.0.0",
      pd_metric_sources: META_PD_METRIC_SOURCES,
      rate_limit: rateLimit,
    }),
  });
}

export function buildMetaProductBreakdownInsightsUrl({
  nativeMetadata = false,
  adAccountId,
  dateWindow,
  after = null,
  graphVersion = META_GRAPH_VERSION,
  limit = 100,
  includePromotedProductMetrics = false,
}) {
  if (typeof nativeMetadata !== "boolean") throw new TypeError("nativeMetadata must be boolean");
  const url = baseInsightsUrl({
    adAccountId,
    dateWindow,
    after,
    graphVersion,
    limit,
    fields: productFields(includePromotedProductMetrics),
  });
  url.searchParams.set("breakdowns", "product_id");
  if (nativeMetadata) {url.searchParams.set("action_report_time", "impression"); url.searchParams.set("use_unified_attribution_setting", "true");}
  url.searchParams.set("product_id_limit", String(META_PRODUCT_BREAKDOWN_ID_LIMIT));
  return url.toString();
}

export async function fetchMetaProductBreakdownInsightsPage({
  nativeMetadata = false,
  accessToken,
  appSecret,
  adAccountId,
  dateWindow,
  after = null,
  graphVersion = META_GRAPH_VERSION,
  fetchFn = fetch,
  includePromotedProductMetrics = false,
}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const url = buildMetaProductBreakdownInsightsUrl({
    nativeMetadata,
    adAccountId,
    dateWindow,
    after,
    graphVersion,
    includePromotedProductMetrics,
  });
  const {payload, response, nextCursor, rateLimit} = await fetchMetaInsightsPayload({
    url,
    accessToken,
    appSecret,
    fetchFn,
  });
  for (const row of payload.data) {
    if (
      !row
      || typeof row !== "object"
      || Array.isArray(row)
      || typeof row.product_id !== "string"
      || row.product_id.length < 1
    ) {
      throw new MetaGraphError(
        "META_REPORTING_SCHEMA_CHANGED",
        "Meta product breakdown row is missing product_id",
        {request_id: requestId(response)},
      );
    }
  }

  return Object.freeze({
    provider: "meta",
    fact_family: "ad_product_breakdown_daily_insights",
    channel_type: "ad",
    breakdown: "product_id",
    rows: Object.freeze(payload.data.map((row) => Object.freeze({...row}))),
    next_cursor: nextCursor,
    provider_request_id: requestId(response),
    evidence: Object.freeze({
      endpoint: "ad_account_insights",
      graph_version: graphVersion,
      level: "ad",
      time_increment: 1,
      requested_fields: productFields(includePromotedProductMetrics),
      breakdowns: Object.freeze(["product_id"]),
      product_id_limit: META_PRODUCT_BREAKDOWN_ID_LIMIT,
      product_metric_semantics: "validation_pending_real_catalog_response",
      provider_product_ad_cost_status: "validation_pending",
      rate_limit: rateLimit,
    }),
  });
}

export function classifyMetaReportingError(error) {
  if (!(error instanceof MetaGraphError)) {
    return Object.freeze({
      class: "internal_adapter_failure",
      retryable: false,
      retry_after_ms: null,
      provider_request_id: null,
      message: "Unexpected Meta reporting failure",
    });
  }
  const status = Number(error.details?.status);
  const providerCode = Number(error.details?.provider_error_code);
  if (error.code === "META_REAUTHORIZATION_REQUIRED" || providerCode === 190) {
    return Object.freeze({
      class: "reauthorization_required",
      retryable: false,
      retry_after_ms: error.details?.retry_after_ms ?? null,
      provider_request_id: error.details?.request_id ?? null,
      message: error.message,
    });
  }
  if (status === 429 || RATE_LIMIT_CODES.has(providerCode)) {
    return Object.freeze({
      class: "rate_limited",
      retryable: false,
      retry_after_ms: error.details?.retry_after_ms ?? null,
      provider_request_id: error.details?.request_id ?? null,
      message: error.message,
    });
  }
  if (
    error.code === "META_PERMISSION_DENIED" || status === 403
    || providerCode === 10 || (providerCode >= 200 && providerCode <= 299)
  ) {
    return Object.freeze({
      class: "permission_or_scope_missing",
      retryable: false,
      retry_after_ms: error.details?.retry_after_ms ?? null,
      provider_request_id: error.details?.request_id ?? null,
      message: error.message,
    });
  }
  if (status >= 500 || providerCode === 1 || providerCode === 2) {
    return Object.freeze({
      class: "transient_provider_failure",
      retryable: false,
      retry_after_ms: null,
      provider_request_id: error.details?.request_id ?? null,
      message: error.message,
    });
  }
  return Object.freeze({
    class: error.code === "META_REPORTING_SCHEMA_CHANGED"
      ? "provider_schema_changed"
      : "request_contract_invalid",
    retryable: false,
    retry_after_ms: error.details?.retry_after_ms ?? null,
    provider_request_id: error.details?.request_id ?? null,
    message: error.message,
  });
}
