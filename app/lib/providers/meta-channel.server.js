import {
  COMMON_ADAPTER_CONTRACT_VERSION,
  RAW_METRICS,
  validateCanonicalFunnelFact,
  validateCommonAdapterRequest,
} from "./common-adapter.server.js";
import {
  META_GRAPH_ORIGIN,
  META_GRAPH_VERSION,
  MetaGraphError,
} from "./meta-graph.server.js";

export const META_CHANNEL_ADAPTER_VERSION = "1.0.0";
export const META_CHANNEL_FIELDS = Object.freeze([
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
  "clicks",
  "outbound_clicks",
  "spend",
  "actions",
  "action_values",
]);

const ACTION_ALIASES = Object.freeze({
  ad_click: Object.freeze(["link_click"]),
  add_to_cart: Object.freeze(["add_to_cart", "omni_add_to_cart"]),
  checkout: Object.freeze([
    "initiate_checkout",
    "checkout",
    "omni_initiated_checkout",
  ]),
  purchase: Object.freeze(["purchase", "omni_purchase"]),
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fail(code, message, details = null) {
  throw new MetaGraphError(code, message, details);
}

function exactText(value, field, maximum = 4096) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
  ) fail("META_CHANNEL_SCHEMA_CHANGED", `${field} is invalid`);
  return value;
}

function nonNegative(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail("META_CHANNEL_SCHEMA_CHANGED", `${field} is not a non-negative number`);
  }
  return parsed;
}

function metric(value, supportedWhenAbsent = "unknown") {
  if (value === null) {
    return {
      value: null,
      support: supportedWhenAbsent,
      observation: supportedWhenAbsent === "unsupported" ? "not_requested" : "absent",
    };
  }
  return {
    value,
    support: "supported",
    observation: value === 0 ? "zero" : "present",
  };
}

function exactActionList(value, field) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    fail("META_CHANNEL_SCHEMA_CHANGED", `${field} must be an array when returned`);
  }
  return value;
}

function actionMetric(listValue, aliases, field) {
  const list = exactActionList(listValue, field);
  if (list === null || list.length === 0) {
    return {...metric(null), actionType: null, fallbackUsed: false};
  }
  for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex += 1) {
    const alias = aliases[aliasIndex];
    const matches = list.filter((entry) => entry?.action_type === alias);
    if (matches.length > 1) {
      fail(
        "META_CHANNEL_ACTION_DUPLICATE",
        `${field}.${alias} was returned more than once without an accepted breakdown`,
      );
    }
    if (matches.length === 1) {
      const value = nonNegative(matches[0]?.value, `${field}.${alias}.value`);
      if (value === null) {
        fail("META_CHANNEL_SCHEMA_CHANGED", `${field}.${alias}.value is missing`);
      }
      return {
        ...metric(value),
        actionType: alias,
        fallbackUsed: aliasIndex > 0,
      };
    }
  }
  return {...metric(null), actionType: null, fallbackUsed: false};
}

function requireMetaFactRequest(request) {
  validateCommonAdapterRequest(request);
  if (request.provider !== "meta" || request.operation !== "fetch_facts") {
    fail("META_CHANNEL_REQUEST_INVALID", "Meta Channel accepts only meta fetch_facts");
  }
  if (request.adapter_contract_version !== COMMON_ADAPTER_CONTRACT_VERSION) {
    fail("META_CHANNEL_REQUEST_INVALID", "Common adapter contract version mismatch");
  }
  if (request.provider_api_version !== META_GRAPH_VERSION) {
    fail("META_CHANNEL_REQUEST_INVALID", `Meta API version must be ${META_GRAPH_VERSION}`);
  }
  if (
    request.platform_account_id !== request.canonical_reporting_account_id
    || !/^act_[0-9]+$/.test(request.platform_account_id)
  ) {
    fail(
      "META_CHANNEL_REPORTING_ACCOUNT_MISMATCH",
      "Meta Channel may read only the canonical Reporting Account",
    );
  }
  if (
    request.requested_metrics.length !== RAW_METRICS.length
    || RAW_METRICS.some((name) => !request.requested_metrics.includes(name))
  ) fail("META_CHANNEL_REQUEST_INVALID", "The complete canonical metric demand is required");
  if (request.breakdowns.length !== 0) {
    fail("META_CHANNEL_BREAKDOWN_NOT_ACCEPTED", "Base Meta Channel facts use no breakdown");
  }
  return request;
}

export function buildMetaChannelInsightsUrl({request, cursor = null}) {
  requireMetaFactRequest(request);
  return buildMetaRawInsightsUrl({
    reportingAccountId: request.platform_account_id,
    start: request.date_window.start,
    end: request.date_window.end,
    cursor,
  });
}

export function buildMetaRawInsightsUrl({
  reportingAccountId,
  start,
  end,
  cursor = null,
}) {
  if (typeof reportingAccountId !== "string" || !/^act_[0-9]+$/.test(reportingAccountId)) {
    fail("META_CHANNEL_REPORTING_ACCOUNT_INVALID", "Meta Reporting Account is invalid");
  }
  if (
    typeof start !== "string"
    || typeof end !== "string"
    || !DATE_PATTERN.test(start)
    || !DATE_PATTERN.test(end)
    || start > end
  ) fail("META_CHANNEL_DATE_WINDOW_INVALID", "Meta date window is invalid");
  const url = new URL(
    `/${META_GRAPH_VERSION}/${reportingAccountId}/insights`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({
    since: start,
    until: end,
  }));
  url.searchParams.set("fields", META_CHANNEL_FIELDS.join(","));
  url.searchParams.set("limit", "100");
  if (cursor !== null) url.searchParams.set("after", exactText(cursor, "cursor"));
  return url.toString();
}

export async function fetchMetaRawInsightsPage({
  reportingAccountId,
  start,
  end,
  accessToken,
  cursor = null,
  fetchFn = fetch,
}) {
  const url = buildMetaRawInsightsUrl({reportingAccountId, start, end, cursor});
  const response = await fetchFn(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${exactText(accessToken, "accessToken", 8192)}`,
    },
  });
  const payload = await responseJson(response);
  const requestId = header(response, "x-fb-trace-id") ?? header(response, "x-fb-request-id");
  if (!response.ok || !payload || typeof payload !== "object") {
    fail("META_CHANNEL_REQUEST_FAILED", "Meta Insights request failed", {
      status: response.status,
      provider_error_code: Number.isSafeInteger(Number(payload?.error?.code))
        ? Number(payload.error.code)
        : null,
      request_id: requestId,
      retry_after: header(response, "retry-after"),
    });
  }
  if (!Array.isArray(payload.data)) {
    fail("META_CHANNEL_SCHEMA_CHANGED", "Meta Insights data is not an array");
  }
  for (const row of payload.data) {
    const returnedAccount = String(row?.account_id ?? "").replace(/^act_/, "");
    if (`act_${returnedAccount}` !== reportingAccountId) {
      fail(
        "META_CHANNEL_REPORTING_ACCOUNT_MISMATCH",
        "Meta returned a row for a different Reporting Account",
      );
    }
  }
  const hasNext = typeof payload?.paging?.next === "string" && payload.paging.next.length > 0;
  const nextCursor = payload?.paging?.cursors?.after;
  if (hasNext && (typeof nextCursor !== "string" || nextCursor.length < 1)) {
    fail("META_CHANNEL_PAGINATION_INVALID", "Meta returned next without an opaque cursor");
  }
  return Object.freeze({
    rows: Object.freeze(payload.data.map((row) => Object.freeze({...row}))),
    next_cursor: hasNext ? nextCursor : null,
    provider_request_id: requestId,
  });
}

function assignMetric(target, name, result) {
  target.raw_metrics[name] = result.value;
  target.metric_support[name] = result.support;
  target.observation_state[name] = result.observation;
}

export function mapMetaInsightToCanonicalFact({
  insight,
  request,
  targetCurrency,
  fxRate,
  fxProvider,
  fxEngineVersion,
  accountTimezone,
  timeEngineVersion,
}) {
  requireMetaFactRequest(request);
  if (!insight || typeof insight !== "object" || Array.isArray(insight)) {
    fail("META_CHANNEL_SCHEMA_CHANGED", "Meta insight row must be an object");
  }
  const businessDate = exactText(insight.date_start, "date_start", 10);
  if (businessDate !== exactText(insight.date_stop, "date_stop", 10)) {
    fail("META_CHANNEL_DATE_GRAIN_INVALID", "Meta insight row is not daily");
  }
  if (
    businessDate < request.date_window.start
    || businessDate > request.date_window.end
  ) fail("META_CHANNEL_DATE_OUT_OF_RANGE", "Meta returned a date outside the request");

  const returnedAccount = String(insight.account_id ?? "").replace(/^act_/, "");
  if (`act_${returnedAccount}` !== request.canonical_reporting_account_id) {
    fail(
      "META_CHANNEL_REPORTING_ACCOUNT_MISMATCH",
      "Meta returned a row for a different Reporting Account",
    );
  }

  const sourceCurrency = exactText(insight.account_currency, "account_currency", 3);
  const actions = insight.actions;
  const actionValues = insight.action_values;
  const selected = {
    ad_click: actionMetric(actions, ACTION_ALIASES.ad_click, "actions"),
    add_to_cart: actionMetric(actions, ACTION_ALIASES.add_to_cart, "actions"),
    add_to_cart_value: actionMetric(
      actionValues,
      ACTION_ALIASES.add_to_cart,
      "action_values",
    ),
    checkout: actionMetric(actions, ACTION_ALIASES.checkout, "actions"),
    checkout_value: actionMetric(
      actionValues,
      ACTION_ALIASES.checkout,
      "action_values",
    ),
    purchase: actionMetric(actions, ACTION_ALIASES.purchase, "actions"),
    purchase_value: actionMetric(
      actionValues,
      ACTION_ALIASES.purchase,
      "action_values",
    ),
  };

  const row = {
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
      root_entity_id: exactText(insight.campaign_id, "campaign_id"),
      root_entity_name: exactText(insight.campaign_name, "campaign_name"),
      parent_entity_type: "adset",
      parent_entity_id: exactText(insight.adset_id, "adset_id"),
      parent_entity_name: exactText(insight.adset_name, "adset_name"),
      entity_type: "ad",
      entity_id: exactText(insight.ad_id, "ad_id"),
      entity_name: exactText(insight.ad_name, "ad_name"),
    },
    raw_metrics: {},
    metric_support: {},
    observation_state: {},
    currency: {
      source_currency: sourceCurrency,
      target_currency: exactText(targetCurrency, "targetCurrency", 3),
      fx_rate: nonNegative(fxRate, "fxRate"),
      fx_rate_date: businessDate,
      fx_provider: exactText(fxProvider, "fxProvider", 200),
      fx_engine_version: exactText(fxEngineVersion, "fxEngineVersion", 200),
    },
    time: {
      source_timezone: exactText(accountTimezone, "accountTimezone", 100),
      business_date: businessDate,
      time_engine_version: exactText(timeEngineVersion, "timeEngineVersion", 200),
    },
    provenance: {
      source_system: "meta_ads",
      adapter_version: META_CHANNEL_ADAPTER_VERSION,
      source_confidence: "real",
      synthetic: false,
      raw_reference: {
        requested_level: "ad",
        attribution_parameters_applied: false,
        selected_action_types: Object.fromEntries(
          Object.entries(selected).map(([name, result]) => [name, result.actionType]),
        ),
        fallback_used: Object.fromEntries(
          Object.entries(selected).map(([name, result]) => [name, result.fallbackUsed]),
        ),
        provider_field_presence: Object.fromEntries(
          META_CHANNEL_FIELDS.map((name) => [name, Object.hasOwn(insight, name)]),
        ),
      },
    },
  };

  assignMetric(row, "impression", metric(nonNegative(insight.impressions, "impressions")));
  assignMetric(row, "ad_click", selected.ad_click);
  assignMetric(row, "session", metric(null, "unsupported"));
  assignMetric(row, "spend_value", metric(nonNegative(insight.spend, "spend")));
  for (const name of [
    "add_to_cart",
    "add_to_cart_value",
    "checkout",
    "checkout_value",
    "purchase",
    "purchase_value",
  ]) assignMetric(row, name, selected[name]);

  if (Object.values(selected).some((result) => result.fallbackUsed)) {
    row.provenance.source_confidence = "fallback";
  } else if (Object.values(row.metric_support).some((value) => value === "unknown")) {
    row.provenance.source_confidence = "partial";
  }
  return Object.freeze(validateCanonicalFunnelFact(row));
}

function header(response, name) {
  return response?.headers?.get?.(name) ?? null;
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchMetaChannelFactsPage({
  request,
  accessToken,
  cursor = null,
  currency,
  fetchFn = fetch,
}) {
  const page = await fetchMetaRawInsightsPage({
    reportingAccountId: request.platform_account_id,
    start: request.date_window.start,
    end: request.date_window.end,
    accessToken,
    cursor,
    fetchFn,
  });
  return Object.freeze({
    rows: Object.freeze(page.rows.map((insight) => mapMetaInsightToCanonicalFact({
      insight,
      request,
      ...currency,
    }))),
    next_cursor: page.next_cursor,
    provider_request_id: page.provider_request_id,
    quota: null,
    raw_evidence: {
      returned_row_count: page.rows.length,
      fields: META_CHANNEL_FIELDS,
      actions: page.rows.map((row) => row.actions ?? null),
      action_values: page.rows.map((row) => row.action_values ?? null),
      clicks: page.rows.map((row) => row.clicks ?? null),
      outbound_clicks: page.rows.map((row) => row.outbound_clicks ?? null),
    },
  });
}

export function classifyMetaChannelError(error) {
  const status = Number(error?.details?.status);
  const code = Number(error?.details?.provider_error_code);
  const requestId = typeof error?.details?.request_id === "string"
    ? error.details.request_id
    : null;
  if (status === 401 || code === 190) {
    return {class: "reauthorization_required", retryable: false, provider_request_id: requestId};
  }
  if (status === 403 || code === 10 || code === 200) {
    return {class: "permission_or_scope_missing", retryable: false, provider_request_id: requestId};
  }
  if (status === 429 || [4, 17, 32, 613].includes(code)) {
    const seconds = Number(error?.details?.retry_after);
    return {
      class: "rate_limited",
      retryable: true,
      retry_after_ms: Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null,
      provider_request_id: requestId,
    };
  }
  if (status >= 500 || code === 1 || code === 2) {
    return {class: "transient_provider_failure", retryable: true, provider_request_id: requestId};
  }
  if (error instanceof MetaGraphError) {
    return {class: "request_contract_invalid", retryable: false, provider_request_id: requestId};
  }
  return {class: "internal_adapter_failure", retryable: false, provider_request_id: requestId};
}
