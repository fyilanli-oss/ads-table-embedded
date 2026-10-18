import {KLAVIYO_REPORTING_API_REVISION} from "./klaviyo-reporting.server.js";

export const KLAVIYO_LIVE_EVIDENCE_VERSION = "1.0.0";
export const KLAVIYO_LIVE_EVIDENCE_SAFE_LOG_PREFIX =
  "[AdsTable Klaviyo live evidence safe]";
export const KLAVIYO_LIVE_EVIDENCE_FAMILIES = Object.freeze([
  "metrics",
  "campaign_values",
  "flow_values",
  "ordered_product_events",
  "resolved_product_sales",
]);

const INPUT_KEYS = new Set(["provider"]);
const SAFE_CODE_PATTERN = /^KLAVIYO_[A-Z0-9_]{1,100}$/;
const SALES_ROLES = Object.freeze([
  "Advertised",
  "Cross-sell",
  "Assisted",
  "Triggered",
  "Unclassified",
]);
const PRODUCT_FIELDS = Object.freeze([
  "ProductID",
  "VariantID",
  "SKU",
  "ProductName",
  "Name",
  "Variant Name",
  "Quantity",
  "$value",
]);

export class KlaviyoLiveEvidenceError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "KlaviyoLiveEvidenceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateKlaviyoLiveEvidenceInput(value) {
  if (!isRecord(value)) {
    throw new KlaviyoLiveEvidenceError(
      "KLAVIYO_LIVE_EVIDENCE_INPUT_INVALID",
      "Request body must be an object",
    );
  }
  if (Object.keys(value).some((key) => !INPUT_KEYS.has(key))) {
    throw new KlaviyoLiveEvidenceError(
      "KLAVIYO_LIVE_EVIDENCE_INPUT_FIELDS_INVALID",
      "Only provider is accepted",
    );
  }
  if (value.provider !== "klaviyo") {
    throw new KlaviyoLiveEvidenceError(
      "KLAVIYO_LIVE_EVIDENCE_PROVIDER_INVALID",
      "The Klaviyo evidence route accepts only klaviyo",
    );
  }
  return Object.freeze({provider: "klaviyo"});
}

function countBy(rows, values, select) {
  const counts = Object.fromEntries(values.map((value) => [value, 0]));
  for (const row of rows) {
    const value = select(row);
    if (Object.hasOwn(counts, value)) counts[value] += 1;
  }
  return Object.freeze(counts);
}

function observation(rows) {
  return rows.length === 0 ? "not_observed_in_this_execution" : "present";
}

function familyRows(value, family, pageCountRequired = true) {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new KlaviyoLiveEvidenceError(
      "KLAVIYO_LIVE_EVIDENCE_FAMILY_INVALID",
      "Klaviyo evidence family is missing or malformed",
      502,
      {family},
    );
  }
  if (
    pageCountRequired
    && (!Number.isSafeInteger(value.page_count) || value.page_count < 1)
  ) {
    throw new KlaviyoLiveEvidenceError(
      "KLAVIYO_LIVE_EVIDENCE_PAGE_COUNT_INVALID",
      "Klaviyo evidence page count is missing or malformed",
      502,
      {family},
    );
  }
  return value.rows;
}

function reportFamilySummary(value, family) {
  const rows = familyRows(value, family);
  return Object.freeze({
    row_count: rows.length,
    page_count: value.page_count,
    observation_state: observation(rows),
    medium_counts: countBy(rows, ["Email", "SMS", "WhatsApp", "Push"], (row) => row?.medium),
    variation_resolution_counts: countBy(
      rows,
      ["exact", "unresolved"],
      (row) => row?.variation_resolution,
    ),
  });
}

function productEventSummary(value) {
  const rows = familyRows(value, "ordered_product_events");
  const propertyPresenceCounts = Object.fromEntries(PRODUCT_FIELDS.map((field) => [
    field,
    Object.freeze({
      present: rows.filter(
        (row) => row?.provider_product_properties?.[field]?.state === "present",
      ).length,
      absent: rows.filter(
        (row) => row?.provider_product_properties?.[field]?.state !== "present",
      ).length,
    }),
  ]));
  return Object.freeze({
    row_count: rows.length,
    page_count: value.page_count,
    observation_state: observation(rows),
    product_identity_state_counts: countBy(
      rows,
      ["provider_native_observed", "missing"],
      (row) => row?.product_identity_state,
    ),
    attribution_state_counts: Object.freeze({
      present: rows.filter((row) => row?.provider_attributions?.length > 0).length,
      not_observed: rows.filter((row) => !(row?.provider_attributions?.length > 0)).length,
    }),
    property_presence_counts: Object.freeze(propertyPresenceCounts),
  });
}

function resolvedSalesSummary(value) {
  const rows = familyRows(value, "resolved_product_sales", false);
  return Object.freeze({
    row_count: rows.length,
    observation_state: observation(rows),
    channel_resolution_counts: Object.freeze({
      exact: rows.filter((row) => row?.attribution_resolution?.channel_id != null).length,
      unclassified: rows.filter(
        (row) => row?.attribution_resolution?.channel_type === "Unclassified Channel",
      ).length,
    }),
    medium_resolution_counts: countBy(
      rows,
      ["exact", "unresolved"],
      (row) => row?.attribution_resolution?.medium_resolution,
    ),
    variation_resolution_counts: countBy(
      rows,
      ["exact", "unresolved", "conflicting", "orphaned"],
      (row) => row?.attribution_resolution?.variation_resolution,
    ),
    sales_role_counts: countBy(
      rows,
      SALES_ROLES,
      (row) => row?.attribution_resolution?.sales_role,
    ),
  });
}

function stoppedRuntimeError(result) {
  const sourceCode = typeof result?.error?.code === "string"
    && SAFE_CODE_PATTERN.test(result.error.code)
    ? result.error.code
    : "KLAVIYO_REPORTING_FAMILY_FAILED";
  const status = sourceCode === "KLAVIYO_REAUTHORIZATION_REQUIRED"
    ? 401
    : sourceCode === "KLAVIYO_PERMISSION_DENIED" ? 403 : 502;
  return new KlaviyoLiveEvidenceError(
    sourceCode,
    "Klaviyo evidence runtime stopped",
    status,
    {completed_families: result?.completed_families ?? []},
  );
}

export function summarizeKlaviyoLiveEvidence(result) {
  if (result?.provider !== "klaviyo") {
    throw new KlaviyoLiveEvidenceError(
      "KLAVIYO_LIVE_EVIDENCE_RESULT_INVALID",
      "Klaviyo reporting runtime returned an invalid provider envelope",
      502,
    );
  }
  if (result.status === "failed") throw stoppedRuntimeError(result);
  if (
    result.status !== "completed"
    || result.publishable !== true
    || !isRecord(result.results)
    || typeof result.business_date !== "string"
    || !Array.isArray(result.completed_families)
    || result.completed_families.length !== KLAVIYO_LIVE_EVIDENCE_FAMILIES.length
    || !KLAVIYO_LIVE_EVIDENCE_FAMILIES.every(
      (family, index) => result.completed_families[index] === family,
    )
  ) {
    throw new KlaviyoLiveEvidenceError(
      "KLAVIYO_LIVE_EVIDENCE_RESULT_INVALID",
      "Klaviyo reporting runtime returned an invalid evidence envelope",
      502,
    );
  }

  if (
    typeof result.results.metrics?.placed_order_metric_id !== "string"
    || result.results.metrics.placed_order_metric_id.length === 0
    || typeof result.results.metrics?.ordered_product_metric_id !== "string"
    || result.results.metrics.ordered_product_metric_id.length === 0
  ) {
    throw new KlaviyoLiveEvidenceError(
      "KLAVIYO_LIVE_EVIDENCE_METRICS_INVALID",
      "Klaviyo Shopify metric evidence is missing or malformed",
      502,
    );
  }

  const campaign = reportFamilySummary(result.results.campaign_values, "campaign_values");
  const flow = reportFamilySummary(result.results.flow_values, "flow_values");
  const events = productEventSummary(result.results.ordered_product_events);
  const resolved = resolvedSalesSummary(result.results.resolved_product_sales);
  const observedRows = campaign.row_count + flow.row_count + events.row_count;
  return Object.freeze({
    status: "complete",
    provider: "klaviyo",
    evidence_version: KLAVIYO_LIVE_EVIDENCE_VERSION,
    api_revision: KLAVIYO_REPORTING_API_REVISION,
    business_date: result.business_date,
    observation_state: observedRows === 0
      ? "not_observed_in_this_execution"
      : "present",
    publishable_to_dataset_v2: false,
    shopify_metrics: Object.freeze({
      state: "exact",
      placed_order: "resolved_once",
      ordered_product: "resolved_once",
    }),
    campaign_messages: campaign,
    flow_messages: flow,
    ordered_product_events: events,
    resolved_product_sales: resolved,
    controls: Object.freeze({
      query_families_completed: KLAVIYO_LIVE_EVIDENCE_FAMILIES,
      provider_retry_performed: false,
      alternate_route_used: false,
      database_write_performed: false,
      raw_provider_rows_exposed: false,
      raw_provider_identifiers_exposed: false,
      profile_or_pii_exposed: false,
      commercial_values_exposed: false,
      provider_request_ids_exposed: false,
      cursors_exposed: false,
      token_or_credential_exposed: false,
      synthetic_custom_ecommerce_is_shopify_evidence: false,
    }),
  });
}

export function createKlaviyoLiveEvidenceRuntime({klaviyoRuntime}) {
  if (!klaviyoRuntime || typeof klaviyoRuntime.readDailyEvidenceSnapshot !== "function") {
    throw new TypeError("klaviyoRuntime.readDailyEvidenceSnapshot is required");
  }
  return Object.freeze({
    async execute({installationAuthority, input}) {
      validateKlaviyoLiveEvidenceInput(input);
      const result = await klaviyoRuntime.readDailyEvidenceSnapshot({installationAuthority});
      return summarizeKlaviyoLiveEvidence(result);
    },
  });
}

export function buildKlaviyoLiveEvidenceSafeLog(result) {
  if (result?.status !== "complete" || result?.provider !== "klaviyo") {
    throw new KlaviyoLiveEvidenceError(
      "KLAVIYO_LIVE_EVIDENCE_SAFE_LOG_RESULT_INVALID",
      "Only completed Klaviyo evidence can be logged",
      502,
    );
  }
  return Object.freeze({event: "klaviyo_live_evidence_safe", ...result});
}

export function classifyKlaviyoLiveEvidenceError(error) {
  if (error instanceof KlaviyoLiveEvidenceError) {
    return Object.freeze({
      status: error.status,
      code: error.code,
      class: error.status === 401
        ? "reauthorization_required"
        : error.status === 403
          ? "permission_or_scope_missing"
          : error.status >= 500 ? "reporting_execution_stopped" : "request_contract_invalid",
      completed_families: Array.isArray(error.details?.completed_families)
        ? error.details.completed_families.filter(
            (family) => KLAVIYO_LIVE_EVIDENCE_FAMILIES.includes(family),
          )
        : [],
    });
  }
  return Object.freeze({
    status: 502,
    code: "KLAVIYO_LIVE_EVIDENCE_FAILED",
    class: "internal_adapter_failure",
    completed_families: [],
  });
}

export function buildKlaviyoLiveEvidenceSafeFailureLog(
  failure,
  stage = "runtime_initialization_or_execution",
) {
  return Object.freeze({
    event: "klaviyo_live_evidence_failed",
    status: "failed",
    code: failure.code,
    class: failure.class,
    stage,
    completed_families: Object.freeze([...failure.completed_families]),
    provider_retry_performed: false,
    next_query_family_started: false,
    raw_provider_rows_logged: false,
    identifiers_or_profiles_logged: false,
    commercial_values_logged: false,
  });
}
