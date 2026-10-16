import {createHash} from "node:crypto";
import {classifyMetaReportingError} from "./meta-reporting.server.js";

export const PROVIDER_LIVE_EVIDENCE_VERSION = "1.0.0";
export const META_PRODUCT_ACCEPTED_FIELDS = Object.freeze([
  "product_id",
  "impressions",
  "clicks",
  "spend",
  "converted_product_quantity",
  "converted_product_value",
]);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INPUT_KEYS = new Set(["provider", "business_date"]);
const CHANNEL_EVIDENCE_FIELDS = Object.freeze([
  "impressions",
  "spend",
  "clicks",
  "inline_link_clicks",
  "outbound_clicks",
  "actions",
  "action_values",
]);

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
      "Only provider and business_date are accepted",
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
  return Object.freeze({provider: "meta", businessDate: value.business_date});
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
  return Object.freeze({
    provider_request_id: typeof page.provider_request_id === "string"
      ? page.provider_request_id
      : null,
    next_page_exists: page.next_cursor !== null,
    next_cursor_sha256: page.next_cursor === null ? null : digest(page.next_cursor),
  });
}

export function summarizeMetaLiveEvidence(result, businessDate) {
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
      accepted_fields: META_PRODUCT_ACCEPTED_FIELDS,
      field_state_counts: Object.freeze(
        fieldStateCounts(productRows, META_PRODUCT_ACCEPTED_FIELDS),
      ),
      product_identity_sha256: rowHashes(productRows, ["date_start", "ad_id", "product_id"]),
      converted_product_action_types: Object.freeze({
        quantity: actionTypes(productRows, "converted_product_quantity"),
        value: actionTypes(productRows, "converted_product_value"),
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
  if (!metaRuntime || typeof metaRuntime.readDailyEvidencePages !== "function") {
    throw new TypeError("metaRuntime.readDailyEvidencePages is required");
  }
  return Object.freeze({
    async execute({installationAuthority, input}) {
      const accepted = validateProviderLiveEvidenceInput(input);
      const result = await metaRuntime.readDailyEvidencePages({
        installationAuthority,
        dateWindow: {start: accepted.businessDate, end: accepted.businessDate},
      });
      return summarizeMetaLiveEvidence(result, accepted.businessDate);
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
