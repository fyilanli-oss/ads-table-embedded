export const COMMON_ADAPTER_CONTRACT_VERSION: "1.0.0";
export const PROVIDERS: readonly ["meta", "google_ads", "klaviyo"];
export const OPERATIONS: readonly [
  "inspect_connection",
  "discover_scope_evidence",
  "fetch_structure",
  "fetch_facts",
  "describe_capability",
];
export const RAW_METRICS: readonly [
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
];
export const METRIC_SUPPORT_VALUES: readonly [
  "supported",
  "unsupported",
  "unknown",
];
export const OBSERVATION_STATES: readonly [
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
];
export const NORMALIZED_ERROR_CLASSES: readonly [
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
];
export const RETRYABLE_ERROR_CLASSES: readonly [
  "rate_limited",
  "transient_provider_failure",
  "provider_timeout",
];

export type Provider = (typeof PROVIDERS)[number];
export type AdapterOperation = (typeof OPERATIONS)[number];
export type RawMetric = (typeof RAW_METRICS)[number];
export type MetricSupport = (typeof METRIC_SUPPORT_VALUES)[number];
export type ObservationState = (typeof OBSERVATION_STATES)[number];
export type NormalizedErrorClass = (typeof NORMALIZED_ERROR_CLASSES)[number];

export class AdapterContractError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown);
}

export interface AdapterAuthority {
  workspace_id: string;
  installation_id: string;
  installation_generation: number;
  status: "active";
  store_scope: "verified_installed_shop";
  shop_domain: string;
}

export interface CommonAdapterRequest {
  authority: AdapterAuthority;
  provider_connection_id: string;
  provider: Provider;
  platform_account_id: string;
  canonical_reporting_account_id: string | null;
  operation: AdapterOperation;
  adapter_contract_version: typeof COMMON_ADAPTER_CONTRACT_VERSION;
  provider_api_version: string;
  installed_shop_timezone: string;
  date_window: {
    start: string;
    end: string;
  };
  requested_metrics: RawMetric[];
  levels: string[];
  breakdowns: string[];
  query_fingerprint: string;
  attempt_id: string;
  job_or_run_id: string | null;
}

export interface CanonicalFunnelFact {
  identity: {
    workspace_id: string;
    installation_id: string;
    installation_generation: number;
    provider_connection_id: string;
    platform: Provider;
    platform_account_id: string;
    canonical_reporting_account_id: string | null;
    business_date: string;
  };
  entity: {
    campaign_type?: "standard" | "performance_max" | null;
    root_entity_type?: "campaign" | "flow" | "organic" | null;
    root_entity_id?: string | null;
    root_entity_name?: string | null;
    parent_entity_type?: "adset" | "adgroup" | "campaign" | "flow" | null;
    parent_entity_id?: string | null;
    parent_entity_name?: string | null;
    entity_type: string;
    entity_id: string;
    entity_name: string;
  };
  raw_metrics: Record<RawMetric, number | null>;
  metric_support: Record<RawMetric, MetricSupport>;
  observation_state: Record<RawMetric, ObservationState>;
  currency: {
    source_currency: string;
    target_currency: string;
    fx_rate: number;
    fx_rate_date: string;
    fx_provider: string;
    fx_engine_version: string;
  };
  time: {
    source_timezone: string;
    business_date: string;
    time_engine_version: string;
  };
  provenance: {
    source_system: string;
    adapter_version: string;
    source_confidence: "real" | "fallback" | "partial";
    synthetic: boolean;
    ga4_property_id?: string | null;
    raw_reference: Record<string, unknown>;
  };
}

export interface ProviderPage {
  rows: CanonicalFunnelFact[];
  next_cursor: string | null;
  provider_request_id?: string | null;
  quota?: Record<string, unknown> | null;
  raw_evidence?: unknown;
}

export interface ClassifiedProviderError {
  class: NormalizedErrorClass;
  retryable?: boolean;
  retry_after_ms?: number | null;
  provider_request_id?: string | null;
  message?: string;
}

export interface AdapterLimits {
  maximum_pages?: number;
  maximum_rows?: number;
  maximum_elapsed_ms?: number;
  maximum_attempts_per_page?: number;
  base_delay_ms?: number;
  maximum_delay_ms?: number;
  maximum_evidence_bytes?: number;
}

export interface AdapterPageContext {
  request: CommonAdapterRequest;
  cursor: string | null;
  page_number: number;
  attempt_number: number;
}

export interface AdapterEvidence {
  provider: Provider;
  operation: AdapterOperation;
  adapter_contract_version: string;
  provider_api_version: string;
  query_fingerprint: string;
  attempt_id: string;
  page_count: number;
  staged_row_count: number;
  total_attempts?: number;
  completeness: "complete" | "partial";
  pages: readonly Record<string, unknown>[];
  elapsed_ms: number;
}

export type AdapterResult =
  | {
      status: "complete";
      publishable: true;
      rows: readonly CanonicalFunnelFact[];
      error: null;
      evidence: AdapterEvidence;
    }
  | {
      status: "failed";
      publishable: false;
      rows: readonly [];
      error: Readonly<{
        class: NormalizedErrorClass;
        message: string;
        provider_request_id: string | null;
      }>;
      evidence: AdapterEvidence;
    };

export function stableJson(value: unknown): string;
export function sha256(value: string): string;
export function createQueryFingerprint(query: unknown): string;
export function sanitizeProviderEvidence(
  value: unknown,
  options?: { maxBytes?: number },
): Readonly<{
  sanitized: unknown;
  sha256: string;
  byte_length: number;
}>;
export function validateCommonAdapterRequest(
  request: CommonAdapterRequest,
): CommonAdapterRequest;
export function validateCanonicalFunnelFact(
  row: CanonicalFunnelFact,
): CanonicalFunnelFact;
export function canonicalFactKey(row: CanonicalFunnelFact): string;
export function runCommonAdapterOperation(options: {
  request: CommonAdapterRequest;
  fetchPage: (context: AdapterPageContext) => Promise<ProviderPage>;
  classifyError: (
    error: unknown,
    context: AdapterPageContext,
  ) => ClassifiedProviderError | Promise<ClassifiedProviderError>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  limits?: AdapterLimits;
}): Promise<AdapterResult>;
