import {createHash} from "node:crypto";
import {classifyMetaReportingError} from "./meta-reporting.server.js";

export const PROVIDER_LIVE_EVIDENCE_VERSION = "1.0.0";
export const PROVIDER_LIVE_EVIDENCE_SAFE_LOG_PREFIX =
  "[AdsTable provider live evidence safe]";
export const META_PRODUCT_ACCEPTED_FIELDS = Object.freeze([
  "product_id",
  "impressions",
  "clicks",
  "spend",
  "converted_product_quantity",
  "converted_product_value",
]);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const META_PROMOTED_PRODUCT_PROBE = "promoted_product_metrics";
export const META_PRODUCT_PROBE_ACCEPTED_FIELDS = Object.freeze([
  ...META_PRODUCT_ACCEPTED_FIELDS,
  "converted_promoted_product_quantity",
  "converted_promoted_product_value",
]);
const INPUT_KEYS = new Set(["provider", "business_date", "probe"]);

function probeFields(probe) {
  if (probe !== undefined && probe !== META_PROMOTED_PRODUCT_PROBE) {
    throw new ProviderLiveEvidenceError("LIVE_EVIDENCE_PROBE_INVALID", "Unknown evidence probe");
  }
  return probe === META_PROMOTED_PRODUCT_PROBE
    ? META_PRODUCT_PROBE_ACCEPTED_FIELDS : META_PRODUCT_ACCEPTED_FIELDS;
}

function promotedActionTypes(rows) {
  return Object.freeze({
    quantity: actionTypes(rows, "converted_promoted_product_quantity"),
    value: actionTypes(rows, "converted_promoted_product_value"),
  });
}
const CHANNEL_EVIDENCE_FIELDS = Object.freeze([
  "impressions",
  "spend",
  "clicks",
  "inline_link_clicks",
  "outbound_clicks",
  "actions",
  "action_values",
]);
const FIELD_STATE_KEYS = Object.freeze([
  "absent",
  "null",
  "empty",
  "array",
  "zero",
  "present_numeric",
  "present_string",
  "unexpected",
]);
const ACTION_TYPE_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const ACTION_TYPE_LOG_LIMIT = 50;

export class ProviderLiveEvidenceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ProviderLiveEvidenceError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf())
    && parsed.toISOString().slice(0, 10) === value;
}

export function validateProviderLiveEvidenceInput(value) {
  if (!isRecord(value)) {
    throw new ProviderLiveEvidenceError(
      "LIVE_EVIDENCE_INPUT_INVALID",
      "Request body must be an object",
    );
  }
  const extras = Object.keys(value).filter((key) => !INPUT_KEYS.has(key));
  if (extras.length > 0) {
    throw new ProviderLiveEvidenceError(
      "LIVE_EVIDENCE_INPUT_FIELDS_INVALID",
      "Only provider, business_date and the fixed optional probe are accepted",
    );
  }
  if (value.provider !== "meta") {
    throw new ProviderLiveEvidenceError(
      "LIVE_EVIDENCE_PROVIDER_NOT_IMPLEMENTED",
      "Only the accepted Meta slice is available",
    );
  }
  if (!validDate(value.business_date)) {
    throw new ProviderLiveEvidenceError(
      "LIVE_EVIDENCE_DATE_INVALID",
      "business_date must be YYYY-MM-DD",
    );
  }
  probeFields(value.probe);
  return Object.freeze({
    provider: "meta", businessDate: value.business_date,
    ...(value.probe === undefined ? {} : {probe: value.probe}),
  });
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function valueState(value) {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "empty" : "array";
  if (typeof value === "string") {
    if (value === "") return "empty";
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric === 0 ? "zero" : "present_numeric";
    return "present_string";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value === 0 ? "zero" : "present_numeric";
  }
  return "unexpected";
}

function fieldStateCounts(rows, fields) {
  return Object.fromEntries(fields.map((field) => {
    const counts = {};
    for (const row of rows) {
      const state = valueState(row?.[field]);
      counts[state] = (counts[state] ?? 0) + 1;
    }
    return [field, Object.freeze(counts)];
  }));
}

function actionTypes(rows, field) {
  const types = new Set();
  let malformedEntryCount = 0;
  for (const row of rows) {
    const collection = row?.[field];
    if (collection == null) continue;
    if (!Array.isArray(collection)) {
      malformedEntryCount += 1;
      continue;
    }
    for (const entry of collection) {
      if (
        isRecord(entry)
        && typeof entry.action_type === "string"
        && entry.action_type.length > 0
      ) {
        types.add(entry.action_type);
      } else {
        malformedEntryCount += 1;
      }
    }
  }
  return Object.freeze({
    values: Object.freeze([...types].sort()),
    malformed_entry_count: malformedEntryCount,
  });
}

function rowHashes(rows, identityFields) {
  return Object.freeze(rows.map((row) => digest(
    identityFields.map((field) => String(row?.[field] ?? "-")).join("|"),
  )));
}

function requestEvidence(page) {
  const rateLimits = Array.isArray(page?.evidence?.rate_limits)
    ? page.evidence.rate_limits
    : page?.evidence?.rate_limit ? [page.evidence.rate_limit] : [];
  const countPresent = (field) => rateLimits.filter((item) => item?.[field] === true).length;
  const retryAfterValues = rateLimits
    .map((item) => item?.retry_after_ms)
    .filter((value) => Number.isSafeInteger(value) && value >= 0);
  return Object.freeze({
    provider_request_id: typeof page.provider_request_id === "string"
      ? page.provider_request_id
      : null,
    next_page_exists: page.next_cursor !== null,
    next_cursor_sha256: page.next_cursor === null ? null : digest(page.next_cursor),
    page_count: Number.isSafeInteger(page?.evidence?.page_count)
      ? page.evidence.page_count
      : 1,
    rate_limit_evidence: Object.freeze({
      app_usage_pages: countPresent("app_usage_present"),
      ad_account_usage_pages: countPresent("ad_account_usage_present"),
      business_use_case_usage_pages: countPresent("business_use_case_usage_present"),
      retry_after_ms: retryAfterValues.length > 0 ? Math.max(...retryAfterValues) : null,
    }),
  });
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeFieldStateCounts(source, fields) {
  return Object.freeze(Object.fromEntries(fields.map((field) => [
    field,
    Object.freeze(Object.fromEntries(FIELD_STATE_KEYS.flatMap((state) => {
      const count = source?.[field]?.[state];
      return Number.isSafeInteger(count) && count >= 0 ? [[state, count]] : [];
    }))),
  ])));
}

function safeActionTypeLog(source) {
  const sourceValues = Array.isArray(source?.values) ? source.values : [];
  const acceptedValues = sourceValues.filter(
    (value) => typeof value === "string" && ACTION_TYPE_PATTERN.test(value),
  );
  const values = acceptedValues.slice(0, ACTION_TYPE_LOG_LIMIT);
  return Object.freeze({
    values: Object.freeze(values),
    malformed_entry_count: safeCount(source?.malformed_entry_count),
    redacted_invalid_action_type_count: sourceValues.length - acceptedValues.length,
    truncated_valid_action_type_count: acceptedValues.length - values.length,
  });
}

export function buildProviderLiveEvidenceSafeLog(result) {
  const fields = probeFields(result?.probe);
  if (result?.status !== "complete" || result?.provider !== "meta") {
    throw new ProviderLiveEvidenceError(
      "LIVE_EVIDENCE_SAFE_LOG_RESULT_INVALID",
      "Only completed Meta evidence can be written to the safe evidence log",
      502,
    );
  }
  if (!validDate(result.business_date)) {
    throw new ProviderLiveEvidenceError(
      "LIVE_EVIDENCE_SAFE_LOG_DATE_INVALID",
      "Safe evidence log requires a valid business date",
      502,
    );
  }
  return Object.freeze({
    event: "provider_live_evidence_safe",
    status: "complete",
    provider: "meta",
    business_date: result.business_date,
    evidence_version: PROVIDER_LIVE_EVIDENCE_VERSION,
    ...(result.probe === undefined ? {} : {probe: result.probe}),
    publishable_to_dataset_v2: false,
    channel: Object.freeze({
      grain: "ad",
      row_count: safeCount(result.channel?.row_count),
      field_state_counts: safeFieldStateCounts(
        result.channel?.field_state_counts,
        CHANNEL_EVIDENCE_FIELDS,
      ),
      direct_metric_decisions: Object.freeze({
        impression: "evidence_supported_pending_numeric_publication",
        spend_value: "evidence_supported_pending_numeric_publication",
        ad_click: "mapping_pending_live_click_field_review",
        session: "mapping_pending_live_action_type_review",
        funnel: "mapping_pending_live_action_type_review",
      }),
      action_type_inventory: Object.freeze({
        actions: safeActionTypeLog(result.channel?.action_type_inventory?.actions),
        action_values: safeActionTypeLog(
          result.channel?.action_type_inventory?.action_values,
        ),
      }),
      next_page_exists: result.channel?.request?.next_page_exists === true,
    }),
    product: Object.freeze({
      status: "raw_provider_evidence_pending_standardization",
      grain: "ad_product_id",
      row_count: safeCount(result.product?.row_count),
      accepted_fields: fields,
      field_state_counts: safeFieldStateCounts(
        result.product?.field_state_counts,
        fields,
      ),
      converted_product_action_types: Object.freeze({
        quantity: safeActionTypeLog(
          result.product?.converted_product_action_types?.quantity,
        ),
        value: safeActionTypeLog(
          result.product?.converted_product_action_types?.value,
        ),
      }),
      ...(result.probe === undefined ? {} : {
        converted_promoted_product_action_types: Object.freeze({
          quantity: safeActionTypeLog(result.product?.converted_promoted_product_action_types?.quantity),
          value: safeActionTypeLog(result.product?.converted_promoted_product_action_types?.value),
        }),
      }),
      next_page_exists: result.product?.request?.next_page_exists === true,
      product_metric_semantics: "validation_pending_real_catalog_response",
    }),
    controls: Object.freeze({
      provider_retry_performed: false,
      next_provider_started: false,
      database_write_performed: false,
      raw_provider_rows_exposed: false,
      raw_identifiers_or_hashes_logged: false,
      provider_request_id_logged: false,
      cursor_or_cursor_hash_logged: false,
      token_or_credential_exposed: false,
    }),
  });
}

export function summarizeMetaLiveEvidence(result, businessDate, probe) {
  const fields = probeFields(probe);
  const channelRows = Array.isArray(result?.channel?.rows) ? result.channel.rows : null;
  const productRows = Array.isArray(result?.product?.rows) ? result.product.rows : null;
  if (!channelRows || !productRows) {
    throw new ProviderLiveEvidenceError(
      "LIVE_EVIDENCE_RUNTIME_RESULT_INVALID",
      "Meta runtime returned an invalid evidence envelope",
      502,
    );
  }
  if (
    typeof result?.authority?.connection_id !== "string"
    || result.authority.connection_id.length === 0
    || typeof result?.authority?.reporting_account_id !== "string"
    || result.authority.reporting_account_id.length === 0
  ) {
    throw new ProviderLiveEvidenceError(
      "LIVE_EVIDENCE_AUTHORITY_RESULT_INVALID",
      "Meta runtime returned invalid authority evidence",
      502,
    );
  }
  return Object.freeze({
    status: "complete",
    publishable_to_dataset_v2: false,
    provider: "meta",
    business_date: businessDate,
    evidence_version: PROVIDER_LIVE_EVIDENCE_VERSION,
    ...(probe === undefined ? {} : {probe}),
    authority: Object.freeze({
      connection_id_sha256: digest(result.authority?.connection_id ?? "missing"),
      reporting_account_id_sha256: digest(
        result.authority?.reporting_account_id ?? "missing",
      ),
      raw_identifiers_exposed: false,
    }),
    channel: Object.freeze({
      grain: "ad",
      row_count: channelRows.length,
      row_identity_sha256: rowHashes(channelRows, ["date_start", "ad_id"]),
      field_state_counts: Object.freeze(
        fieldStateCounts(channelRows, CHANNEL_EVIDENCE_FIELDS),
      ),
      direct_metric_decisions: Object.freeze({
        impression: "evidence_supported_pending_numeric_publication",
        spend_value: "evidence_supported_pending_numeric_publication",
        ad_click: "mapping_pending_live_click_field_review",
        session: "mapping_pending_live_action_type_review",
        funnel: "mapping_pending_live_action_type_review",
      }),
      action_type_inventory: Object.freeze({
        actions: actionTypes(channelRows, "actions"),
        action_values: actionTypes(channelRows, "action_values"),
      }),
      request: requestEvidence(result.channel),
    }),
    product: Object.freeze({
      status: "raw_provider_evidence_pending_standardization",
      grain: "ad_product_id",
      row_count: productRows.length,
      accepted_fields: fields,
      field_state_counts: Object.freeze(
        fieldStateCounts(productRows, fields),
      ),
      product_identity_sha256: rowHashes(productRows, ["date_start", "ad_id", "product_id"]),
      converted_product_action_types: Object.freeze({
        quantity: actionTypes(productRows, "converted_product_quantity"),
        value: actionTypes(productRows, "converted_product_value"),
      }),
      ...(probe === undefined ? {} : {
        converted_promoted_product_action_types: promotedActionTypes(productRows),
      }),
      request: requestEvidence(result.product),
      product_metric_semantics: "validation_pending_real_catalog_response",
    }),
    controls: Object.freeze({
      provider_retry_performed: false,
      next_provider_started: false,
      database_write_performed: false,
      raw_provider_rows_exposed: false,
      token_or_credential_exposed: false,
    }),
  });
}

export function createProviderLiveEvidenceRuntime({metaRuntime}) {
  if (!metaRuntime || typeof metaRuntime.readDailyEvidenceSnapshot !== "function") {
    throw new TypeError("metaRuntime.readDailyEvidenceSnapshot is required");
  }
  return Object.freeze({
    async execute({installationAuthority, input}) {
      const accepted = validateProviderLiveEvidenceInput(input);
      const result = await metaRuntime.readDailyEvidenceSnapshot({
        installationAuthority,
        dateWindow: {start: accepted.businessDate, end: accepted.businessDate},
        ...(accepted.probe === undefined ? {} : {includePromotedProductMetrics: true}),
      });
      return summarizeMetaLiveEvidence(result, accepted.businessDate, accepted.probe);
    },
  });
}

export function classifyProviderLiveEvidenceError(error) {
  if (error instanceof ProviderLiveEvidenceError) {
    return Object.freeze({
      status: error.status,
      code: error.code,
      class: error.status >= 500
        ? "internal_adapter_failure"
        : "request_contract_invalid",
      provider_request_id: null,
    });
  }
  const meta = classifyMetaReportingError(error);
  return Object.freeze({
    status: meta.class === "reauthorization_required" ? 401 : 502,
    code: "META_LIVE_EVIDENCE_FAILED",
    class: meta.class,
    provider_request_id: meta.provider_request_id,
  });
}
