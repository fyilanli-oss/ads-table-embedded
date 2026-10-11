import {
  AdapterContractError,
  COMMON_ADAPTER_CONTRACT_VERSION,
  createQueryFingerprint,
  runCommonAdapterOperation,
  sha256,
  stableJson,
  validateCommonAdapterRequest,
} from "./common-adapter.server.js";

export const META_ADAPTER_VERSION = "1.0.0";
export const META_GRAPH_VERSION = "v26.0";
export const META_INSIGHTS_LEVEL = "ad";

export const META_INSIGHTS_FIELDS = Object.freeze([
  "account_id",
  "account_currency",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
  "impressions",
  "spend",
  "clicks",
  "inline_link_clicks",
  "website_clicks",
  "outbound_clicks",
  "actions",
  "action_values",
]);

export const META_CLICK_CANDIDATES = Object.freeze([
  "clicks",
  "inline_link_clicks",
  "website_clicks",
  "outbound_clicks",
]);

export const META_ACTION_ALIASES = Object.freeze({
  add_to_cart: Object.freeze([
    "offsite_conversion.fb_pixel_add_to_cart",
    "omni_add_to_cart",
  ]),
  checkout: Object.freeze([
    "offsite_conversion.fb_pixel_initiate_checkout",
    "omni_initiated_checkout",
  ]),
  purchase: Object.freeze([
    "offsite_conversion.fb_pixel_purchase",
    "omni_purchase",
  ]),
});

const SAFE_USAGE_HEADERS = Object.freeze([
  "x-app-usage",
  "x-ad-account-usage",
  "x-business-use-case-usage",
]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class MetaAdapterError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "MetaAdapterError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new MetaAdapterError(code, message, details);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, field) {
  if (!isRecord(value)) fail("META_SCHEMA_CHANGED", `${field} must be an object`);
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("META_SCHEMA_CHANGED", `${field} must be a non-empty string`);
  }
  return value;
}

function requireDate(value, field) {
  requireString(value, field);
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail("META_SCHEMA_CHANGED", `${field} must be YYYY-MM-DD`);
  }
  return value;
}

function parseNonNegativeNumber(value, field) {
  if (typeof value !== "string" && typeof value !== "number") {
    fail("META_SCHEMA_CHANGED", `${field} must be a numeric string or number`);
  }
  if (typeof value === "string" && value.trim() === "") {
    fail("META_SCHEMA_CHANGED", `${field} must not be empty`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail("META_SCHEMA_CHANGED", `${field} must be finite and non-negative`);
  }
  return parsed;
}

function scalarObservation(row, field) {
  if (!Object.hasOwn(row, field)) {
    return { value: null, support: "unknown", state: "absent" };
  }
  if (row[field] == null) {
    return { value: null, support: "unknown", state: "empty" };
  }
  const value = parseNonNegativeNumber(row[field], field);
  return {
    value,
    support: "supported",
    state: value === 0 ? "zero" : "present",
  };
}

function actionObservation(row, collectionField, aliases) {
  if (!Object.hasOwn(row, collectionField)) {
    return {
      value: null,
      support: "unknown",
      state: "absent",
      selected_action_type: null,
      observed_action_types: [],
    };
  }

  const collection = row[collectionField];
  if (!Array.isArray(collection)) {
    fail("META_SCHEMA_CHANGED", `${collectionField} must be an array`);
  }
  if (collection.length === 0) {
    return {
      value: null,
      support: "supported",
      state: "empty",
      selected_action_type: null,
      observed_action_types: [],
    };
  }

  const observed = [];
  for (const item of collection) {
    requireRecord(item, `${collectionField} item`);
    requireString(item.action_type, `${collectionField}.action_type`);
    observed.push(item.action_type);
  }

  for (const alias of aliases) {
    const matches = collection.filter((item) => item.action_type === alias);
    if (matches.length > 1) {
      fail("META_SCHEMA_CHANGED", `Duplicate ${collectionField} action_type ${alias}`);
    }
    if (matches.length === 1) {
      const value = parseNonNegativeNumber(
        matches[0].value,
        `${collectionField}[${alias}].value`,
      );
      return {
        value,
        support: "supported",
        state: value === 0 ? "zero" : "present",
        selected_action_type: alias,
        observed_action_types: observed,
      };
    }
  }

  return {
    value: null,
    support: "supported",
    state: "absent",
    selected_action_type: null,
    observed_action_types: observed,
  };
}

function putMetric(containers, metric, observation) {
  containers.raw_metrics[metric] = observation.value;
  containers.metric_support[metric] = observation.support;
  containers.observation_state[metric] = observation.state;
}

function metricContainers() {
  return {
    raw_metrics: {},
    metric_support: {},
    observation_state: {},
  };
}

function safeHeaderValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return entry ? String(entry[1]) : null;
}

function collectQuota(headers) {
  const quota = {};
  for (const name of SAFE_USAGE_HEADERS) {
    const value = safeHeaderValue(headers, name);
    if (value != null) quota[name] = value;
  }
  return quota;
}

function requestId(headers, response) {
  return (
    safeHeaderValue(headers, "x-fb-request-id") ??
    safeHeaderValue(headers, "x-fb-trace-id") ??
    (typeof response.request_id === "string" ? response.request_id : null)
  );
}

function assertMetaRequest(request) {
  validateCommonAdapterRequest(request);
  if (request.provider !== "meta") {
    fail("META_REQUEST_INVALID", "Meta adapter requires provider=meta");
  }
  if (request.provider_api_version !== META_GRAPH_VERSION) {
    fail(
      "META_REQUEST_INVALID",
      `Meta adapter requires pinned Graph version ${META_GRAPH_VERSION}`,
    );
  }
  if (request.operation !== "fetch_facts") {
    fail("META_REQUEST_INVALID", "Meta Insights runner requires fetch_facts");
  }
  if (
    request.canonical_reporting_account_id !== request.platform_account_id ||
    !request.platform_account_id.startsWith("act_")
  ) {
    fail(
      "META_REQUEST_INVALID",
      "Meta canonical reporting account must equal the verified act_ account",
    );
  }
  return request;
}

export function buildMetaInsightsUrl(request) {
  assertMetaRequest(request);
  const account = encodeURIComponent(request.canonical_reporting_account_id);
  const url = new URL(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${account}/insights`,
  );
  url.searchParams.set("level", META_INSIGHTS_LEVEL);
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("limit", "500");
  url.searchParams.set("fields", META_INSIGHTS_FIELDS.join(","));
  url.searchParams.set(
    "time_range",
    JSON.stringify({
      since: request.date_window.start,
      until: request.date_window.end,
    }),
  );
  return url.toString();
}

export function buildMetaRequest(overrides) {
  const request = {
    ...overrides,
    provider: "meta",
    operation: "fetch_facts",
    adapter_contract_version: COMMON_ADAPTER_CONTRACT_VERSION,
    provider_api_version: META_GRAPH_VERSION,
    levels: ["campaign", "adset", "ad"],
    breakdowns: [],
  };
  const query = {
    provider: "meta",
    account: request.canonical_reporting_account_id,
    operation: request.operation,
    api_version: request.provider_api_version,
    level: META_INSIGHTS_LEVEL,
    fields: META_INSIGHTS_FIELDS,
    date_window: request.date_window,
  };
  request.query_fingerprint = createQueryFingerprint(query);
  assertMetaRequest(request);
  return Object.freeze(request);
}

export function translateMetaInsightRow(row, context) {
  requireRecord(row, "Meta insight row");
  requireRecord(context, "Meta translation context");
  const request = assertMetaRequest(context.request);
  const sourceCurrency =
    typeof row.account_currency === "string" && row.account_currency
      ? row.account_currency
      : requireString(context.account_currency, "context.account_currency");
  const sourceTimezone = requireString(
    context.source_timezone,
    "context.source_timezone",
  );
  const businessDate = requireDate(row.date_start, "date_start");
  requireDate(row.date_stop, "date_stop");
  if (row.date_stop !== businessDate) {
    fail("META_SCHEMA_CHANGED", "Daily Meta row must have matching start and stop dates");
  }

  const accountId = requireString(row.account_id, "account_id");
  const expectedAccount = request.canonical_reporting_account_id.replace(/^act_/, "");
  if (accountId !== expectedAccount && accountId !== request.canonical_reporting_account_id) {
    fail("META_ACCOUNT_MISMATCH", "Meta row account does not match reporting authority");
  }

  const campaignId = requireString(row.campaign_id, "campaign_id");
  const campaignName = requireString(row.campaign_name, "campaign_name");
  const adsetId = requireString(row.adset_id, "adset_id");
  const adsetName = requireString(row.adset_name, "adset_name");
  const adId = requireString(row.ad_id, "ad_id");
  const adName = requireString(row.ad_name, "ad_name");

  const containers = metricContainers();
  putMetric(containers, "impression", scalarObservation(row, "impressions"));

  // The four candidates are collected in evidence, but no click value is
  // published until the controlled same-row live gate chooses one definition.
  putMetric(containers, "ad_click", {
    value: null,
    support: "unknown",
    state: "provisional",
  });
  putMetric(containers, "session", {
    value: null,
    support: "unsupported",
    state: "not_requested",
  });
  putMetric(containers, "spend_value", scalarObservation(row, "spend"));

  const observations = {};
  for (const [metric, aliases] of Object.entries(META_ACTION_ALIASES)) {
    const count = actionObservation(row, "actions", aliases);
    const value = actionObservation(row, "action_values", aliases);
    observations[metric] = { count, value };
    putMetric(containers, metric, count);
    putMetric(containers, `${metric}_value`, value);
  }

  const clickCandidates = Object.fromEntries(
    META_CLICK_CANDIDATES.map((field) => [
      field,
      Object.hasOwn(row, field)
        ? scalarObservation(row, field)
        : { value: null, support: "unknown", state: "absent" },
    ]),
  );
  const rawReference = {
    provider: "meta",
    adapter_version: META_ADAPTER_VERSION,
    api_version: META_GRAPH_VERSION,
    response_row_sha256: sha256(stableJson(row)),
    click_mapping_status: "PENDING_LIVE_FIELD_EVIDENCE",
    attribution_status: "PENDING_REAL_CONVERSION_EVIDENCE",
    click_candidates: clickCandidates,
    action_resolution: Object.fromEntries(
      Object.entries(observations).map(([metric, value]) => [
        metric,
        {
          count_action_type: value.count.selected_action_type,
          value_action_type: value.value.selected_action_type,
          observed_count_types: value.count.observed_action_types,
          observed_value_types: value.value.observed_action_types,
        },
      ]),
    ),
  };

  return Object.freeze({
    identity: {
      workspace_id: request.authority.workspace_id,
      installation_id: request.authority.installation_id,
      installation_generation: request.authority.installation_generation,
      provider_connection_id: request.provider_connection_id,
      platform: "meta",
      platform_account_id: request.platform_account_id,
      canonical_reporting_account_id: request.canonical_reporting_account_id,
      business_date: businessDate,
    },
    entity: {
      campaign_type: "standard",
      root_entity_type: "campaign",
      root_entity_id: campaignId,
      root_entity_name: campaignName,
      parent_entity_type: "adset",
      parent_entity_id: adsetId,
      parent_entity_name: adsetName,
      entity_type: "ad",
      entity_id: adId,
      entity_name: adName,
    },
    ...containers,
    currency: {
      source_currency: sourceCurrency,
      target_currency: sourceCurrency,
      fx_rate: 1,
      fx_rate_date: businessDate,
      fx_provider: "identity_pre_eo05",
      fx_engine_version: "pending_eo05",
    },
    time: {
      source_timezone: sourceTimezone,
      business_date: businessDate,
      time_engine_version: "meta_account_timezone_v1",
    },
    provenance: {
      source_system: "meta_ads",
      adapter_version: META_ADAPTER_VERSION,
      source_confidence: "real",
      synthetic: context.synthetic === true,
      raw_reference: rawReference,
    },
  });
}

export function createMetaInsightsFetchPage({
  transport,
  account_currency,
  source_timezone,
  synthetic = false,
}) {
  if (typeof transport !== "function") {
    fail("META_REQUEST_INVALID", "transport must be a function");
  }
  requireString(account_currency, "account_currency");
  requireString(source_timezone, "source_timezone");

  return async ({ request, cursor }) => {
    assertMetaRequest(request);
    const url = cursor == null ? buildMetaInsightsUrl(request) : cursor;
    const response = await transport({
      method: "GET",
      url,
      provider: "meta",
      account_id: request.canonical_reporting_account_id,
    });
    requireRecord(response, "Meta transport response");
    if (!Array.isArray(response.data)) {
      fail("META_SCHEMA_CHANGED", "Meta response data must be an array");
    }

    const paging = response.paging == null ? {} : requireRecord(response.paging, "paging");
    if (
      Object.hasOwn(paging, "next") &&
      paging.next != null &&
      (typeof paging.next !== "string" || paging.next === "")
    ) {
      fail("META_SCHEMA_CHANGED", "paging.next must be an opaque non-empty URL");
    }

    const rows = response.data.map((row) =>
      translateMetaInsightRow(row, {
        request,
        account_currency,
        source_timezone,
        synthetic,
      }),
    );
    const headers = response.headers ?? null;
    const actionTypes = new Set();
    const actionValueTypes = new Set();
    for (const row of response.data) {
      for (const action of Array.isArray(row.actions) ? row.actions : []) {
        if (typeof action?.action_type === "string") actionTypes.add(action.action_type);
      }
      for (const action of Array.isArray(row.action_values) ? row.action_values : []) {
        if (typeof action?.action_type === "string") actionValueTypes.add(action.action_type);
      }
    }

    return {
      rows,
      next_cursor: paging.next ?? null,
      provider_request_id: requestId(headers, response),
      quota: collectQuota(headers),
      raw_evidence: {
        api_version: META_GRAPH_VERSION,
        level: META_INSIGHTS_LEVEL,
        row_count: response.data.length,
        returned_top_level_fields: [
          ...new Set(response.data.flatMap((row) => Object.keys(row)).sort()),
        ],
        returned_action_types: [...actionTypes].sort(),
        returned_action_value_types: [...actionValueTypes].sort(),
        paging_has_next: paging.next != null,
      },
    };
  };
}

export function classifyMetaError(error) {
  if (error instanceof AdapterContractError) {
    return {
      class: "request_contract_invalid",
      retryable: false,
      retry_after_ms: null,
      provider_request_id: null,
      message: error.message,
    };
  }
  if (error instanceof MetaAdapterError) {
    const accountMismatch = error.code === "META_ACCOUNT_MISMATCH";
    return {
      class: accountMismatch ? "reporting_account_inaccessible" : "provider_schema_changed",
      retryable: false,
      retry_after_ms: null,
      provider_request_id: null,
      message: error.message,
    };
  }

  const payload = isRecord(error)
    ? (isRecord(error.error) ? error.error : error)
    : {};
  const code = Number(payload.code);
  const subcode = Number(payload.error_subcode);
  const retryAfter = Number(payload.retry_after_ms);
  const providerRequestId =
    typeof payload.fbtrace_id === "string"
      ? payload.fbtrace_id
      : typeof payload.request_id === "string"
        ? payload.request_id
        : null;
  const base = {
    retry_after_ms: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
    provider_request_id: providerRequestId,
    message: typeof payload.message === "string" ? payload.message : "Meta request failed",
  };

  if (code === 190) {
    return { ...base, class: "reauthorization_required", retryable: false };
  }
  if ([10, 200].includes(code) || subcode === 3191001) {
    return { ...base, class: "permission_or_scope_missing", retryable: false };
  }
  if ([4, 17, 32, 613].includes(code) || [1504022, 1504039].includes(subcode)) {
    return { ...base, class: "rate_limited", retryable: true };
  }
  if (subcode === 2490547 || subcode === 1504043 || code === -2) {
    return { ...base, class: "transient_provider_failure", retryable: true };
  }
  if ([1504018, 1504038].includes(subcode)) {
    return { ...base, class: "provider_timeout", retryable: false };
  }
  if ([1504041, 1504042, 1504045].includes(subcode) || code === 100 || code === -3) {
    return { ...base, class: "request_contract_invalid", retryable: false };
  }
  if (code === 2 || subcode === 1504044) {
    return { ...base, class: "transient_provider_failure", retryable: true };
  }
  return { ...base, class: "internal_adapter_failure", retryable: false };
}

export async function runMetaInsights({
  request,
  transport,
  account_currency,
  source_timezone,
  synthetic = false,
  sleep,
  now,
  random,
  limits,
}) {
  assertMetaRequest(request);
  return runCommonAdapterOperation({
    request,
    fetchPage: createMetaInsightsFetchPage({
      transport,
      account_currency,
      source_timezone,
      synthetic,
    }),
    classifyError: classifyMetaError,
    sleep,
    now,
    random,
    limits,
  });
}
