import type {Provider} from "./common-adapter.server.js";

/** Internal pre-composition envelope; not a Dataset schema or a provider response. */
export interface PdCompositionScope {
  workspace_id: string;
  installation_id: string;
  installation_generation: number;
  provider: Provider;
  provider_connection_id: string;
  platform_account_id: string;
  canonical_reporting_account_id: string | null;
  flow: "ads" | "search" | "shopping" | "retail_pmax" | "campaign" | "flow";
  entity_type: "ad" | "ad_group" | "asset_group" | "campaign_message" | "flow_message";
  entity_id: string;
  ancestors: {entity_type: string; entity_id: string}[];
  business_date: string;
  source_timezone: string;
  reporting_time_basis: string;
  source_currency: string;
  metric_units_fingerprint: string;
  attribution_fingerprint: string;
  conversion_scope: "normal" | "all";
  job_or_run_id: string;
  /** Shared composition attempt, distinct from each provider request attempt. */
  composition_attempt_id: string;
  snapshot_id: string;
  completeness: "complete";
  bounded: true;
}
export interface PdCompositionSource {
  source_family: string;
  source_reference: string;
  scope: PdCompositionScope;
}
export interface PdCompositionCompatibility {
  readonly compatible: boolean;
  readonly reason: "invalid_expected_scope" | "missing_sources" | "invalid_source_reference" |
    "invalid_source_scope" | "duplicate_source_reference" | "incompatible_scope" | null;
  readonly source_index: number | null;
  readonly field: string | null;
  readonly publishable: false;
}
export function checkPdCompositionCompatibility(
  expected: PdCompositionScope, sources: readonly PdCompositionSource[],
): PdCompositionCompatibility;
