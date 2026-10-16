import {
  META_GRAPH_ORIGIN,
  META_GRAPH_VERSION,
  MetaGraphError,
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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_PATTERN = /^act_[0-9]+$/;
const MAX_CURSOR_LENGTH = 4096;

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

export function buildMetaAdChannelInsightsUrl({
  adAccountId,
  dateWindow,
  after = null,
  graphVersion = META_GRAPH_VERSION,
  limit = 100,
}) {
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

  const url = new URL(
    `/${exactVersion(graphVersion)}/${accountId}/insights`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set("fields", META_AD_CHANNEL_INSIGHTS_FIELDS.join(","));
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({since: start, until: end}));
  url.searchParams.set("limit", String(limit));
  const cursor = boundedCursor(after);
  if (cursor !== null) url.searchParams.set("after", cursor);
  return url.toString();
}

export async function fetchMetaAdChannelInsightsPage({
  accessToken,
  adAccountId,
  dateWindow,
  after = null,
  graphVersion = META_GRAPH_VERSION,
  fetchFn = fetch,
}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const url = buildMetaAdChannelInsightsUrl({
    adAccountId,
    dateWindow,
    after,
    graphVersion,
  });
  const response = await fetchFn(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${nonEmpty(accessToken, "META_ACCESS_TOKEN_REQUIRED")}`,
    },
  });
  const payload = await jsonResponse(response);
  if (!response.ok || !payload) {
    const code = providerErrorCode(payload);
    throw new MetaGraphError(
      code === 190 ? "META_REAUTHORIZATION_REQUIRED" : "META_REPORTING_REQUEST_FAILED",
      code === 190
        ? "Meta authorization is no longer valid"
        : "Meta reporting request failed",
      {
        status: response.status,
        provider_error_code: code,
        request_id: requestId(response),
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

  return Object.freeze({
    provider: "meta",
    fact_family: "ad_channel_daily_insights",
    channel_type: "ad",
    rows: Object.freeze(payload.data.map((row) => Object.freeze({...row}))),
    next_cursor: nextCursor,
    provider_request_id: requestId(response),
    evidence: Object.freeze({
      endpoint: "ad_account_insights",
      graph_version: graphVersion,
      level: "ad",
      time_increment: 1,
      requested_fields: META_AD_CHANNEL_INSIGHTS_FIELDS,
      breakdowns: Object.freeze([]),
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
      retry_after_ms: null,
      provider_request_id: error.details?.request_id ?? null,
      message: error.message,
    });
  }
  if (status === 429 || providerCode === 4 || providerCode === 17 || providerCode === 32) {
    return Object.freeze({
      class: "rate_limited",
      retryable: true,
      retry_after_ms: null,
      provider_request_id: error.details?.request_id ?? null,
      message: error.message,
    });
  }
  if (status >= 500 || providerCode === 1 || providerCode === 2) {
    return Object.freeze({
      class: "transient_provider_failure",
      retryable: true,
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
    retry_after_ms: null,
    provider_request_id: error.details?.request_id ?? null,
    message: error.message,
  });
}
