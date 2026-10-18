import {oauthInstallationAuthority} from "../oauth/oauth-transaction.server.js";
import {createProviderAccountAuthorityRepository} from "../database/provider-account-authority-repository.server.js";
import {createProviderConnectionLifecycle} from "../oauth/provider-connection-lifecycle.server.js";
import {createKlaviyoCredentialAuthority} from "../oauth/klaviyo-oauth-runtime.server.js";
import {readKlaviyoOAuthConfig} from "./klaviyo-api.server.js";
import {
  KlaviyoReportingError,
  buildKlaviyoCampaignValuesRequest,
  buildKlaviyoFlowValuesRequest,
  buildKlaviyoOrderedProductEventsRequest,
  buildKlaviyoShopifyMetricsRequest,
  klaviyoBusinessDayTimeframe,
  normalizeKlaviyoOrderedProductEvent,
  normalizeKlaviyoReportRow,
  runKlaviyoReportingFamilies,
  selectKlaviyoShopifyMetrics,
} from "./klaviyo-reporting.server.js";
import {resolveKlaviyoOrderedProductSales} from "./klaviyo-attribution-resolution.server.js";

const PROVIDER = "klaviyo";
const API_ORIGIN = "https://a.klaviyo.com";
const REQUIRED_SCOPES = Object.freeze([
  "campaigns:read",
  "events:read",
  "flows:read",
  "metrics:read",
]);
const MAX_PAGES_PER_FAMILY = 100;
const MAX_ROWS_PER_FAMILY = 100_000;

function fail(code, message, details = null) {
  throw new KlaviyoReportingError(code, message, details);
}

function owner(value) {
  return oauthInstallationAuthority({
    workspaceId: value?.workspaceId,
    installGeneration: value?.installGeneration,
    status: value?.status,
  });
}

function text(value, code, maximum = 4096) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
  ) fail(code, code);
  return value;
}

function connectedAccount(connection) {
  if (!connection) fail("CONNECTED_KLAVIYO_CONNECTION_REQUIRED", "Connected Klaviyo account is required");
  if (!Array.isArray(connection.accounts) || connection.accounts.length !== 1) {
    fail("KLAVIYO_ACCOUNT_CARDINALITY_INVALID", "Klaviyo must have exactly one connected account");
  }
  const account = connection.accounts[0];
  if (account?.kind !== "account" || account?.status !== "active") {
    fail("KLAVIYO_ACCOUNT_AUTHORITY_INVALID", "Klaviyo connected account authority is invalid");
  }
  const scopes = new Set(connection.grantedScopes ?? []);
  const missingScopes = REQUIRED_SCOPES.filter((scope) => !scopes.has(scope));
  if (missingScopes.length > 0) {
    fail("KLAVIYO_REPORTING_SCOPE_MISSING", "Klaviyo reporting scope is missing", {
      missing_scopes: missingScopes,
    });
  }
  const currency = text(account.currency, "KLAVIYO_ACCOUNT_CURRENCY_INVALID", 3);
  if (!/^[A-Z]{3}$/.test(currency)) {
    fail("KLAVIYO_ACCOUNT_CURRENCY_INVALID", "Klaviyo account currency is invalid");
  }
  const timezone = text(account.timezone, "KLAVIYO_ACCOUNT_TIMEZONE_INVALID", 100);
  try {
    new Intl.DateTimeFormat("en", {timeZone: timezone}).format(new Date(0));
  } catch {
    fail("KLAVIYO_ACCOUNT_TIMEZONE_INVALID", "Klaviyo account timezone is invalid");
  }
  return Object.freeze({
    id: text(account.id, "KLAVIYO_ACCOUNT_ID_INVALID", 256),
    currency,
    timezone,
  });
}

function safeRequestId(response) {
  const value = response?.headers?.get?.("x-request-id") ?? null;
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
}

function safeProviderCode(payload) {
  const value = payload?.errors?.[0]?.code ?? payload?.error ?? null;
  return typeof value === "string" && value.length > 0 && value.length <= 100 ? value : null;
}

async function readPayload(response, family) {
  try {
    return await response.json();
  } catch {
    fail("KLAVIYO_REPORTING_RESPONSE_INVALID", "Klaviyo reporting response is not JSON", {family});
  }
}

function nextCursor(payload, {path, parameter, family}) {
  const next = payload?.links?.next ?? null;
  if (next == null) return null;
  let url;
  try {
    url = new URL(text(next, "KLAVIYO_PAGINATION_LINK_INVALID", 8192));
  } catch {
    fail("KLAVIYO_PAGINATION_LINK_INVALID", "Klaviyo pagination link is invalid", {family});
  }
  if (url.origin !== API_ORIGIN || url.pathname !== path) {
    fail("KLAVIYO_PAGINATION_LINK_INVALID", "Klaviyo pagination link left the approved endpoint", {family});
  }
  const cursor = url.searchParams.get(parameter);
  if (cursor == null) {
    fail("KLAVIYO_PAGINATION_CURSOR_MISSING", "Klaviyo pagination link has no cursor", {family});
  }
  return text(cursor, "KLAVIYO_CURSOR_INVALID");
}

function observation(rows) {
  return rows.length === 0 ? "not_observed_in_this_execution" : "observed";
}

function calendarDateInTimeZone(instant, timeZone) {
  const value = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(value.valueOf())) {
    fail("KLAVIYO_REPORTING_CLOCK_INVALID", "Klaviyo reporting clock is invalid");
  }
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
  } catch {
    fail("KLAVIYO_ACCOUNT_TIMEZONE_INVALID", "Klaviyo account timezone is invalid");
  }
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function normalizeAttributionResource(value) {
  if (value?.type !== "attribution") return null;
  const relationshipId = (name) => {
    const data = value.relationships?.[name]?.data ?? null;
    if (data == null) return null;
    return text(data.id, "KLAVIYO_ATTRIBUTION_RELATIONSHIP_INVALID", 256);
  };
  return Object.freeze({
    attribution_id: text(value.id, "KLAVIYO_ATTRIBUTION_ID_INVALID", 256),
    campaign_id: relationshipId("campaign"),
    campaign_message_id: relationshipId("campaign-message"),
    flow_id: relationshipId("flow"),
    flow_message_id: relationshipId("flow-message"),
    flow_message_variation_id: relationshipId("flow-message-variation"),
  });
}

function attachAttributionEvidence(events, included) {
  const attributions = new Map();
  for (const item of included ?? []) {
    const normalized = normalizeAttributionResource(item);
    if (normalized) {
      const existing = attributions.get(normalized.attribution_id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
        fail("KLAVIYO_ATTRIBUTION_DUPLICATE_CONFLICT", "Klaviyo attribution duplicate is contradictory");
      }
      attributions.set(normalized.attribution_id, normalized);
    }
  }
  return events.map((event) => {
    const normalized = normalizeKlaviyoOrderedProductEvent(event);
    const references = event?.relationships?.attributions?.data ?? [];
    if (!Array.isArray(references)) {
      fail("KLAVIYO_EVENT_ATTRIBUTIONS_INVALID", "Klaviyo event attributions are invalid");
    }
    const evidence = references.map((reference) => {
      if (reference?.type !== "attribution") {
        fail("KLAVIYO_ATTRIBUTION_REFERENCE_INVALID", "Klaviyo attribution reference type is invalid");
      }
      const id = text(reference?.id, "KLAVIYO_ATTRIBUTION_ID_INVALID", 256);
      const attribution = attributions.get(id);
      if (!attribution) {
        fail("KLAVIYO_ATTRIBUTION_INCLUDED_RESOURCE_MISSING", "Klaviyo attribution resource is missing");
      }
      return attribution;
    }).sort((left, right) => left.attribution_id.localeCompare(right.attribution_id));
    const uniqueEvidence = [...new Map(
      evidence.map((attribution) => [attribution.attribution_id, attribution]),
    ).values()];
    return Object.freeze({...normalized, provider_attributions: Object.freeze(uniqueEvidence)});
  });
}

export function createKlaviyoReportingAuthorityRuntime({
  database,
  tokenVault,
  environment = process.env,
  fetchFn = fetch,
  now = () => new Date(),
  accountAuthority: accountAuthorityOverride = null,
  lifecycle: lifecycleOverride = null,
  credentialAuthority: credentialAuthorityOverride = null,
  config: configOverride = null,
} = {}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const accountAuthority = accountAuthorityOverride ?? createProviderAccountAuthorityRepository(database);
  const lifecycle = lifecycleOverride ?? createProviderConnectionLifecycle({database, now});
  const config = configOverride ?? readKlaviyoOAuthConfig(environment);
  const credentialAuthority = credentialAuthorityOverride ?? createKlaviyoCredentialAuthority({
    tokenVault,
    lifecycle,
    setup: null,
    config,
    fetchFn,
    now,
  });

  async function markReauthorizationRequired(context) {
    const current = await lifecycle.load({
      installationAuthority: context.installation,
      connectionId: context.connection.connectionId,
      provider: PROVIDER,
    });
    if (!current || current.status !== "connected") return;
    await lifecycle.markReauthorizationRequired({
      installationAuthority: context.installation,
      connectionId: context.connection.connectionId,
      provider: PROVIDER,
      expectedVersion: current.version,
      reason: "klaviyo_reporting_authorization_rejected",
    });
  }

  async function prepareContext(installationAuthority) {
    const installation = owner(installationAuthority);
    const connection = await accountAuthority.load({
      workspaceId: installation.workspaceId,
      installGeneration: installation.installGeneration,
      provider: PROVIDER,
    });
    const account = connectedAccount(connection);
    const prepared = await credentialAuthority.prepareCredential({
      installationAuthority: installation,
      credentialId: connection.credentialId,
      scopes: connection.grantedScopes,
      connected: connection,
    });
    return Object.freeze({
      installation,
      connection,
      account,
      accessToken: text(prepared?.tokenSet?.access_token, "KLAVIYO_ACCESS_TOKEN_REQUIRED", 16384),
    });
  }

  async function providerRequest(context, request, family) {
    let response;
    try {
      response = await fetchFn(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body == null ? {} : {body: request.body}),
      });
    } catch {
      fail("KLAVIYO_REPORTING_REQUEST_FAILED", "Klaviyo reporting request failed", {family});
    }
    const payload = await readPayload(response, family);
    if (!response.ok) {
      if (response.status === 401) await markReauthorizationRequired(context);
      const code = response.status === 401
        ? "KLAVIYO_REAUTHORIZATION_REQUIRED"
        : response.status === 403
          ? "KLAVIYO_PERMISSION_DENIED"
          : "KLAVIYO_REPORTING_REQUEST_REJECTED";
      fail(code, "Klaviyo reporting request was rejected", {
        family,
        status: response.status,
        provider_status: safeProviderCode(payload),
        request_id: safeRequestId(response),
      });
    }
    return Object.freeze({payload, requestId: safeRequestId(response)});
  }

  async function collect({context, family, path, parameter, buildRequest, rowsOf}) {
    const rows = [];
    const requestIds = [];
    const included = [];
    const seen = new Set();
    let cursor = null;
    for (let page = 0; page < MAX_PAGES_PER_FAMILY; page += 1) {
      const response = await providerRequest(context, buildRequest(cursor), family);
      const pageRows = rowsOf(response.payload);
      if (!Array.isArray(pageRows)) {
        fail("KLAVIYO_REPORTING_RESPONSE_SCHEMA_INVALID", "Klaviyo response data is not an array", {family});
      }
      rows.push(...pageRows);
      if (Array.isArray(response.payload.included)) included.push(...response.payload.included);
      if (response.requestId) requestIds.push(response.requestId);
      if (rows.length > MAX_ROWS_PER_FAMILY) {
        fail("KLAVIYO_REPORTING_ROW_LIMIT_EXCEEDED", "Klaviyo reporting row limit exceeded", {family});
      }
      const next = nextCursor(response.payload, {path, parameter, family});
      if (next == null) {
        return Object.freeze({
          rows: Object.freeze(rows),
          included: Object.freeze(included),
          page_count: page + 1,
          request_ids: Object.freeze(requestIds),
        });
      }
      if (seen.has(next)) {
        fail("KLAVIYO_REPORTING_CURSOR_LOOP", "Klaviyo reporting cursor loop detected", {family});
      }
      seen.add(next);
      cursor = next;
    }
    fail("KLAVIYO_REPORTING_PAGE_LIMIT_EXCEEDED", "Klaviyo reporting page limit exceeded", {family});
  }

  return Object.freeze({
    async readDailyEvidenceSnapshot({installationAuthority, businessDate = null}) {
      const context = await prepareContext(installationAuthority);
      const resolvedBusinessDate = businessDate ?? calendarDateInTimeZone(
        now(),
        context.account.timezone,
      );
      const timeframe = klaviyoBusinessDayTimeframe({
        businessDate: resolvedBusinessDate,
        timeZone: context.account.timezone,
      });
      const result = await runKlaviyoReportingFamilies({
        discoverMetrics: async () => {
          const collected = await collect({
            context,
            family: "metrics",
            path: "/api/metrics",
            parameter: "page[cursor]",
            buildRequest: (cursor) => buildKlaviyoShopifyMetricsRequest({
              accessToken: context.accessToken,
              cursor,
            }),
            rowsOf: (payload) => payload?.data,
          });
          return Object.freeze({
            ...selectKlaviyoShopifyMetrics(collected.rows),
            page_count: collected.page_count,
            request_ids: collected.request_ids,
          });
        },
        fetchCampaignValues: async ({metrics}) => {
          const collected = await collect({
            context,
            family: "campaign_values",
            path: "/api/campaign-values-reports",
            parameter: "page_cursor",
            buildRequest: (pageCursor) => buildKlaviyoCampaignValuesRequest({
              accessToken: context.accessToken,
              businessDate: resolvedBusinessDate,
              timeZone: context.account.timezone,
              conversionMetricId: metrics.placed_order_metric_id,
              pageCursor,
            }),
            rowsOf: (payload) => payload?.data?.attributes?.results,
          });
          const rows = collected.rows.map((row) => normalizeKlaviyoReportRow("campaign", row));
          return Object.freeze({
            rows: Object.freeze(rows),
            observation: observation(rows),
            page_count: collected.page_count,
            request_ids: collected.request_ids,
          });
        },
        fetchFlowValues: async ({metrics}) => {
          const collected = await collect({
            context,
            family: "flow_values",
            path: "/api/flow-values-reports",
            parameter: "page_cursor",
            buildRequest: (pageCursor) => buildKlaviyoFlowValuesRequest({
              accessToken: context.accessToken,
              businessDate: resolvedBusinessDate,
              timeZone: context.account.timezone,
              conversionMetricId: metrics.placed_order_metric_id,
              pageCursor,
            }),
            rowsOf: (payload) => payload?.data?.attributes?.results,
          });
          const rows = collected.rows.map((row) => normalizeKlaviyoReportRow("flow", row));
          return Object.freeze({
            rows: Object.freeze(rows),
            observation: observation(rows),
            page_count: collected.page_count,
            request_ids: collected.request_ids,
          });
        },
        fetchOrderedProductEvents: async ({metrics}) => {
          const collected = await collect({
            context,
            family: "ordered_product_events",
            path: "/api/events",
            parameter: "page[cursor]",
            buildRequest: (cursor) => buildKlaviyoOrderedProductEventsRequest({
              accessToken: context.accessToken,
              orderedProductMetricId: metrics.ordered_product_metric_id,
              businessDate: resolvedBusinessDate,
              timeZone: context.account.timezone,
              cursor,
            }),
            rowsOf: (payload) => payload?.data,
          });
          const normalized = attachAttributionEvidence(collected.rows, collected.included);
          const unique = new Map();
          for (const event of normalized) {
            const existing = unique.get(event.provider_event_id);
            if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
              fail("KLAVIYO_EVENT_DUPLICATE_CONFLICT", "Klaviyo event duplicate is contradictory");
            }
            unique.set(event.provider_event_id, event);
          }
          const rows = [...unique.values()];
          return Object.freeze({
            rows: Object.freeze(rows),
            observation: observation(rows),
            page_count: collected.page_count,
            request_ids: collected.request_ids,
          });
        },
        resolveProductSales: async ({campaign_values, flow_values, ordered_product_events}) => (
          resolveKlaviyoOrderedProductSales({
            campaignChannels: campaign_values.rows,
            flowChannels: flow_values.rows,
            orderedProductEvents: ordered_product_events.rows,
          })
        ),
      });
      return Object.freeze({
        provider: PROVIDER,
        authority: Object.freeze({
          connection_id: context.connection.connectionId,
          connected_account_id: context.account.id,
          connected_account_currency: context.account.currency,
          connected_account_timezone: context.account.timezone,
        }),
        business_date: resolvedBusinessDate,
        timeframe,
        ...result,
      });
    },
  });
}
