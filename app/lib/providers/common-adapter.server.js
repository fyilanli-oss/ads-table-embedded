import { createHash } from "node:crypto";

export const COMMON_ADAPTER_CONTRACT_VERSION = "1.0.0";

export const PROVIDERS = Object.freeze(["meta", "google_ads", "klaviyo"]);
export const OPERATIONS = Object.freeze([
  "inspect_connection",
  "discover_scope_evidence",
  "fetch_structure",
  "fetch_facts",
  "describe_capability",
]);
export const RAW_METRICS = Object.freeze([
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
export const METRIC_SUPPORT_VALUES = Object.freeze([
  "supported",
  "unsupported",
  "unknown",
]);
export const OBSERVATION_STATES = Object.freeze([
  "present",
  "zero",
  "empty",
  "absent",
  "not_requested",
  "permission_denied",
  "account_configuration_missing",
  "ambiguous_store_scope",
  "provisional",
  "partial",
  "failed",
]);
export const NORMALIZED_ERROR_CLASSES = Object.freeze([
  "reauthorization_required",
  "permission_or_scope_missing",
  "reporting_account_inaccessible",
  "request_contract_invalid",
  "provider_schema_changed",
  "rate_limited",
  "quota_exhausted",
  "transient_provider_failure",
  "provider_timeout",
  "data_not_ready",
  "ambiguous_store_scope",
  "partial_result",
  "internal_adapter_failure",
]);
export const RETRYABLE_ERROR_CLASSES = Object.freeze([
  "rate_limited",
  "transient_provider_failure",
  "provider_timeout",
]);

const RETRYABLE_SET = new Set(RETRYABLE_ERROR_CLASSES);
const PROVIDER_SET = new Set(PROVIDERS);
const OPERATION_SET = new Set(OPERATIONS);
const SUPPORT_SET = new Set(METRIC_SUPPORT_VALUES);
const OBSERVATION_SET = new Set(OBSERVATION_STATES);
const ERROR_CLASS_SET = new Set(NORMALIZED_ERROR_CLASSES);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SENSITIVE_KEY_PATTERN =
  /(authorization|token|secret|password|passwd|pkce|verifier|database.?url|email|profile|cookie|session.?id)/i;

export class AdapterContractError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "AdapterContractError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new AdapterContractError(code, message, details);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, field) {
  if (!isRecord(value)) {
    fail("REQUEST_CONTRACT_INVALID", `${field} must be an object`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("REQUEST_CONTRACT_INVALID", `${field} must be a non-empty string`);
  }
  return value;
}

function requireUuid(value, field) {
  requireString(value, field);
  if (!UUID_PATTERN.test(value)) {
    fail("REQUEST_CONTRACT_INVALID", `${field} must be a UUID`);
  }
  return value;
}

function requireDate(value, field) {
  requireString(value, field);
  if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail("REQUEST_CONTRACT_INVALID", `${field} must be YYYY-MM-DD`);
  }
  return value;
}

function requireFiniteNonNegative(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("CANONICAL_ROW_INVALID", `${field} must be a finite non-negative number`);
  }
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createQueryFingerprint(query) {
  return sha256(stableJson(query));
}

function sanitizeValue(value, key = "") {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value.replace(EMAIL_PATTERN, "[REDACTED_EMAIL]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

export function sanitizeProviderEvidence(value, options = {}) {
  const maxBytes = options.maxBytes ?? 65_536;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    fail("EVIDENCE_POLICY_INVALID", "maxBytes must be a positive integer");
  }

  const sanitized = sanitizeValue(value);
  const serialized = stableJson(sanitized);
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > maxBytes) {
    fail("EVIDENCE_TOO_LARGE", "Sanitized provider evidence exceeds its byte limit", {
      byte_length: byteLength,
      max_bytes: maxBytes,
    });
  }

  return Object.freeze({
    sanitized,
    sha256: sha256(serialized),
    byte_length: byteLength,
  });
}

export function validateCommonAdapterRequest(request) {
  requireRecord(request, "request");
  const authority = requireRecord(request.authority, "authority");
  requireUuid(authority.workspace_id, "authority.workspace_id");
  requireUuid(authority.installation_id, "authority.installation_id");
  if (!Number.isInteger(authority.installation_generation) || authority.installation_generation < 1) {
    fail(
      "REQUEST_CONTRACT_INVALID",
      "authority.installation_generation must be a positive integer",
    );
  }
  if (authority.status !== "active" || authority.store_scope !== "verified_installed_shop") {
    fail(
      "AMBIGUOUS_STORE_SCOPE",
      "An active verified installed Shopify store is required",
    );
  }
  requireString(authority.shop_domain, "authority.shop_domain");

  requireUuid(request.provider_connection_id, "provider_connection_id");
  if (!PROVIDER_SET.has(request.provider)) {
    fail("REQUEST_CONTRACT_INVALID", "provider is not supported");
  }
  requireString(request.platform_account_id, "platform_account_id");

  if (request.provider === "klaviyo") {
    if (request.canonical_reporting_account_id != null) {
      fail(
        "REQUEST_CONTRACT_INVALID",
        "Klaviyo must not receive an Ad Account reporting selector",
      );
    }
  } else {
    requireString(
      request.canonical_reporting_account_id,
      "canonical_reporting_account_id",
    );
  }

  if (!OPERATION_SET.has(request.operation)) {
    fail("REQUEST_CONTRACT_INVALID", "operation is not supported");
  }
  if (request.adapter_contract_version !== COMMON_ADAPTER_CONTRACT_VERSION) {
    fail("REQUEST_CONTRACT_INVALID", "adapter contract version mismatch");
  }
  requireString(request.provider_api_version, "provider_api_version");
  requireString(request.installed_shop_timezone, "installed_shop_timezone");

  const dateWindow = requireRecord(request.date_window, "date_window");
  const start = requireDate(dateWindow.start, "date_window.start");
  const end = requireDate(dateWindow.end, "date_window.end");
  if (start > end) {
    fail("REQUEST_CONTRACT_INVALID", "date_window.start must not exceed end");
  }

  if (!Array.isArray(request.requested_metrics) || request.requested_metrics.length === 0) {
    fail("REQUEST_CONTRACT_INVALID", "requested_metrics must be non-empty");
  }
  const uniqueMetrics = new Set(request.requested_metrics);
  if (
    uniqueMetrics.size !== request.requested_metrics.length ||
    request.requested_metrics.some((metric) => !RAW_METRICS.includes(metric))
  ) {
    fail(
      "REQUEST_CONTRACT_INVALID",
      "requested_metrics must be unique canonical raw metrics",
    );
  }
  if (!Array.isArray(request.levels) || request.levels.some((value) => typeof value !== "string")) {
    fail("REQUEST_CONTRACT_INVALID", "levels must be an array of strings");
  }
  if (
    !Array.isArray(request.breakdowns) ||
    request.breakdowns.some((value) => typeof value !== "string")
  ) {
    fail("REQUEST_CONTRACT_INVALID", "breakdowns must be an array of strings");
  }
  if (typeof request.query_fingerprint !== "string" || !HASH_PATTERN.test(request.query_fingerprint)) {
    fail("REQUEST_CONTRACT_INVALID", "query_fingerprint must be a SHA-256 hex digest");
  }
  requireUuid(request.attempt_id, "attempt_id");
  if (request.job_or_run_id != null) {
    requireString(request.job_or_run_id, "job_or_run_id");
  }

  return request;
}

function validateMetricPair(metric, rawValue, support, observation) {
  if (!SUPPORT_SET.has(support)) {
    fail("CANONICAL_ROW_INVALID", `metric_support.${metric} is invalid`);
  }
  if (!OBSERVATION_SET.has(observation)) {
    fail("CANONICAL_ROW_INVALID", `observation_state.${metric} is invalid`);
  }

  if (support !== "supported") {
    if (rawValue !== null) {
      fail(
        "CANONICAL_ROW_INVALID",
        `raw_metrics.${metric} must be null when support is ${support}`,
      );
    }
    return;
  }

  if (observation === "zero") {
    if (rawValue !== 0) {
      fail(
        "CANONICAL_ROW_INVALID",
        `raw_metrics.${metric} must be explicit numeric zero for zero state`,
      );
    }
    return;
  }

  if (observation === "present") {
    requireFiniteNonNegative(rawValue, `raw_metrics.${metric}`);
    if (rawValue === 0) {
      fail(
        "CANONICAL_ROW_INVALID",
        `raw_metrics.${metric} zero requires zero observation state`,
      );
    }
    return;
  }

  if (rawValue !== null) {
    fail(
      "CANONICAL_ROW_INVALID",
      `raw_metrics.${metric} must be null for ${observation} state`,
    );
  }
}

export function validateCanonicalFunnelFact(row) {
  requireRecord(row, "row");
  const identity = requireRecord(row.identity, "identity");
  requireUuid(identity.workspace_id, "identity.workspace_id");
  requireUuid(identity.installation_id, "identity.installation_id");
  if (
    !Number.isInteger(identity.installation_generation) ||
    identity.installation_generation < 1
  ) {
    fail(
      "CANONICAL_ROW_INVALID",
      "identity.installation_generation must be a positive integer",
    );
  }
  requireUuid(identity.provider_connection_id, "identity.provider_connection_id");
  if (!PROVIDER_SET.has(identity.platform)) {
    fail("CANONICAL_ROW_INVALID", "identity.platform is invalid");
  }
  requireString(identity.platform_account_id, "identity.platform_account_id");
  if (identity.platform === "klaviyo") {
    if (identity.canonical_reporting_account_id != null) {
      fail(
        "CANONICAL_ROW_INVALID",
        "Klaviyo canonical_reporting_account_id must be null",
      );
    }
  } else {
    requireString(
      identity.canonical_reporting_account_id,
      "identity.canonical_reporting_account_id",
    );
  }
  requireDate(identity.business_date, "identity.business_date");

  const entity = requireRecord(row.entity, "entity");
  requireString(entity.entity_type, "entity.entity_type");
  requireString(entity.entity_id, "entity.entity_id");
  requireString(entity.entity_name, "entity.entity_name");

  const rawMetrics = requireRecord(row.raw_metrics, "raw_metrics");
  const metricSupport = requireRecord(row.metric_support, "metric_support");
  const observationState = requireRecord(row.observation_state, "observation_state");
  for (const metric of RAW_METRICS) {
    if (!(metric in rawMetrics) || !(metric in metricSupport) || !(metric in observationState)) {
      fail(
        "CANONICAL_ROW_INVALID",
        `Canonical metric triplet is incomplete for ${metric}`,
      );
    }
    validateMetricPair(
      metric,
      rawMetrics[metric],
      metricSupport[metric],
      observationState[metric],
    );
  }
  for (const container of [rawMetrics, metricSupport, observationState]) {
    const extras = Object.keys(container).filter((key) => !RAW_METRICS.includes(key));
    if (extras.length > 0) {
      fail("CANONICAL_ROW_INVALID", "Canonical metric container has extra fields", {
        extras,
      });
    }
  }

  const currency = requireRecord(row.currency, "currency");
  requireString(currency.source_currency, "currency.source_currency");
  requireString(currency.target_currency, "currency.target_currency");
  requireFiniteNonNegative(currency.fx_rate, "currency.fx_rate");
  requireDate(currency.fx_rate_date, "currency.fx_rate_date");
  requireString(currency.fx_provider, "currency.fx_provider");
  requireString(currency.fx_engine_version, "currency.fx_engine_version");

  const time = requireRecord(row.time, "time");
  requireString(time.source_timezone, "time.source_timezone");
  requireDate(time.business_date, "time.business_date");
  requireString(time.time_engine_version, "time.time_engine_version");
  if (time.business_date !== identity.business_date) {
    fail("CANONICAL_ROW_INVALID", "identity and time business dates must match");
  }

  const provenance = requireRecord(row.provenance, "provenance");
  requireString(provenance.source_system, "provenance.source_system");
  requireString(provenance.adapter_version, "provenance.adapter_version");
  if (!["real", "fallback", "partial"].includes(provenance.source_confidence)) {
    fail("CANONICAL_ROW_INVALID", "provenance.source_confidence is invalid");
  }
  if (typeof provenance.synthetic !== "boolean") {
    fail("CANONICAL_ROW_INVALID", "provenance.synthetic must be boolean");
  }
  requireRecord(provenance.raw_reference, "provenance.raw_reference");

  return row;
}

export function canonicalFactKey(row) {
  validateCanonicalFunnelFact(row);
  const { identity, entity } = row;
  return [
    identity.workspace_id,
    identity.installation_id,
    identity.installation_generation,
    identity.provider_connection_id,
    identity.platform,
    identity.platform_account_id,
    identity.canonical_reporting_account_id ?? "-",
    identity.business_date,
    entity.entity_type,
    entity.entity_id,
  ].join("|");
}

function normalizeClassifiedError(classification) {
  if (!isRecord(classification) || !ERROR_CLASS_SET.has(classification.class)) {
    return {
      class: "internal_adapter_failure",
      retryable: false,
      retry_after_ms: null,
      provider_request_id: null,
      message: "Provider error classifier returned an invalid classification",
    };
  }
  const retryable =
    classification.retryable === true && RETRYABLE_SET.has(classification.class);
  return {
    class: classification.class,
    retryable,
    retry_after_ms:
      Number.isFinite(classification.retry_after_ms) &&
      classification.retry_after_ms >= 0
        ? classification.retry_after_ms
        : null,
    provider_request_id:
      typeof classification.provider_request_id === "string"
        ? classification.provider_request_id
        : null,
    message:
      typeof classification.message === "string"
        ? classification.message
        : "Provider operation failed",
  };
}

function retryDelayMs({ classification, retryIndex, baseDelayMs, maxDelayMs, random }) {
  if (classification.retry_after_ms != null) {
    return Math.min(classification.retry_after_ms, maxDelayMs);
  }
  const exponential = Math.min(baseDelayMs * 2 ** retryIndex, maxDelayMs);
  return Math.min(exponential + Math.floor(random() * baseDelayMs), maxDelayMs);
}

export async function runCommonAdapterOperation({
  request,
  fetchPage,
  classifyError,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
  random = Math.random,
  limits = {},
}) {
  validateCommonAdapterRequest(request);
  if (typeof fetchPage !== "function" || typeof classifyError !== "function") {
    fail("REQUEST_CONTRACT_INVALID", "fetchPage and classifyError must be functions");
  }

  const maximumPages = limits.maximum_pages ?? 100;
  const maximumRows = limits.maximum_rows ?? 100_000;
  const maximumElapsedMs = limits.maximum_elapsed_ms ?? 120_000;
  const maximumAttemptsPerPage = limits.maximum_attempts_per_page ?? 4;
  const baseDelayMs = limits.base_delay_ms ?? 250;
  const maximumDelayMs = limits.maximum_delay_ms ?? 30_000;
  for (const [field, value] of Object.entries({
    maximumPages,
    maximumRows,
    maximumElapsedMs,
    maximumAttemptsPerPage,
    baseDelayMs,
    maximumDelayMs,
  })) {
    if (!Number.isInteger(value) || value < 1) {
      fail("REQUEST_CONTRACT_INVALID", `limits.${field} must be a positive integer`);
    }
  }

  const startedAt = now();
  const seenCursors = new Set();
  const stagedRows = new Map();
  const pageEvidence = [];
  let cursor = null;
  let pageNumber = 0;
  let totalAttempts = 0;

  const failure = (normalizedError) =>
    Object.freeze({
      status: "failed",
      publishable: false,
      rows: Object.freeze([]),
      error: Object.freeze(normalizedError),
      evidence: Object.freeze({
        provider: request.provider,
        operation: request.operation,
        adapter_contract_version: request.adapter_contract_version,
        provider_api_version: request.provider_api_version,
        query_fingerprint: request.query_fingerprint,
        attempt_id: request.attempt_id,
        page_count: pageNumber,
        staged_row_count: stagedRows.size,
        completeness: "partial",
        pages: Object.freeze(pageEvidence),
        elapsed_ms: Math.max(0, now() - startedAt),
      }),
    });

  while (true) {
    if (pageNumber >= maximumPages) {
      return failure({
        class: "partial_result",
        message: "Maximum page limit reached before completion",
        provider_request_id: null,
      });
    }
    if (now() - startedAt >= maximumElapsedMs) {
      return failure({
        class: "provider_timeout",
        message: "Adapter elapsed-time budget exhausted",
        provider_request_id: null,
      });
    }

    const cursorKey = cursor ?? "__FIRST_PAGE__";
    if (seenCursors.has(cursorKey)) {
      return failure({
        class: "partial_result",
        message: "Provider cursor loop detected",
        provider_request_id: null,
      });
    }
    seenCursors.add(cursorKey);

    let page;
    let pageAttempts = 0;
    let lastClassification = null;
    while (pageAttempts < maximumAttemptsPerPage) {
      pageAttempts += 1;
      totalAttempts += 1;
      try {
        page = await fetchPage({
          request,
          cursor,
          page_number: pageNumber + 1,
          attempt_number: pageAttempts,
        });
        break;
      } catch (error) {
        const classification = normalizeClassifiedError(
          await classifyError(error, {
            request,
            cursor,
            page_number: pageNumber + 1,
            attempt_number: pageAttempts,
          }),
        );
        lastClassification = classification;
        const elapsed = now() - startedAt;
        if (
          !classification.retryable ||
          pageAttempts >= maximumAttemptsPerPage ||
          elapsed >= maximumElapsedMs
        ) {
          return failure(classification);
        }
        const delay = retryDelayMs({
          classification,
          retryIndex: pageAttempts - 1,
          baseDelayMs,
          maxDelayMs: maximumDelayMs,
          random,
        });
        if (elapsed + delay > maximumElapsedMs) {
          return failure({
            ...classification,
            message: "Retry delay would exceed adapter elapsed-time budget",
          });
        }
        await sleep(delay);
      }
    }

    if (!page) {
      return failure(
        lastClassification ?? {
          class: "internal_adapter_failure",
          message: "Provider page was not returned",
          provider_request_id: null,
        },
      );
    }
    if (!isRecord(page) || !Array.isArray(page.rows)) {
      return failure({
        class: "provider_schema_changed",
        message: "Provider page must contain a rows array",
        provider_request_id: null,
      });
    }

    pageNumber += 1;
    const rawEvidence = sanitizeProviderEvidence(page.raw_evidence ?? {}, {
      maxBytes: limits.maximum_evidence_bytes ?? 65_536,
    });
    pageEvidence.push(
      Object.freeze({
        page_number: pageNumber,
        row_count: page.rows.length,
        provider_request_id:
          typeof page.provider_request_id === "string"
            ? page.provider_request_id
            : null,
        cursor_in_hash: sha256(cursorKey),
        cursor_out_hash:
          page.next_cursor == null ? null : sha256(String(page.next_cursor)),
        quota: isRecord(page.quota) ? sanitizeProviderEvidence(page.quota).sanitized : null,
        raw_evidence_sha256: rawEvidence.sha256,
        raw_evidence_byte_length: rawEvidence.byte_length,
      }),
    );

    try {
      for (const row of page.rows) {
        validateCanonicalFunnelFact(row);
        const key = canonicalFactKey(row);
        const digest = sha256(stableJson(row));
        const prior = stagedRows.get(key);
        if (prior && prior.digest !== digest) {
          return failure({
            class: "partial_result",
            message: "Conflicting duplicate canonical fact detected",
            provider_request_id: null,
          });
        }
        if (!prior) stagedRows.set(key, { row, digest });
      }
    } catch (error) {
      if (error instanceof AdapterContractError) {
        return failure({
          class: "provider_schema_changed",
          message: error.message,
          provider_request_id: null,
        });
      }
      throw error;
    }

    if (stagedRows.size > maximumRows) {
      return failure({
        class: "partial_result",
        message: "Maximum row limit reached before completion",
        provider_request_id: null,
      });
    }

    if (page.next_cursor == null) break;
    if (typeof page.next_cursor !== "string" || page.next_cursor === "") {
      return failure({
        class: "provider_schema_changed",
        message: "Provider next cursor must be an opaque non-empty string or null",
        provider_request_id: null,
      });
    }
    cursor = page.next_cursor;
  }

  return Object.freeze({
    status: "complete",
    publishable: true,
    rows: Object.freeze([...stagedRows.values()].map(({ row }) => Object.freeze(row))),
    error: null,
    evidence: Object.freeze({
      provider: request.provider,
      operation: request.operation,
      adapter_contract_version: request.adapter_contract_version,
      provider_api_version: request.provider_api_version,
      query_fingerprint: request.query_fingerprint,
      attempt_id: request.attempt_id,
      page_count: pageNumber,
      staged_row_count: stagedRows.size,
      total_attempts: totalAttempts,
      completeness: "complete",
      pages: Object.freeze(pageEvidence),
      elapsed_ms: Math.max(0, now() - startedAt),
    }),
  });
}
