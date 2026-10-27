import type {PdCompositionScope, PdCompositionSource, PdCompositionCompatibility} from "./pd-composition-scope.server.js";
import type {RawMetric} from "./common-adapter.server.js";
export type KlaviyoPdMetricName = "Placed Order" | "Added to Cart" | "Checkout Started";
export interface KlaviyoPdProjection extends PdCompositionSource {
  source: "campaign" | "flow";
  conversion_metric_name: KlaviyoPdMetricName;
  conversion_metric_id: string | null;
  observation: "observed" | "not_observed_in_this_execution" | "account_configuration_missing";
  rows: readonly Readonly<Record<string, any>>[];
  evidence?: {revision: string; request_body: Readonly<Record<string, any>>};
}
export interface KlaviyoPdMessageFact {
  readonly scope: PdCompositionScope;
  readonly raw_metrics: Readonly<Record<RawMetric, number | null>>;
  readonly metric_support: Readonly<Record<RawMetric, "supported" | "unknown">>;
  readonly observation_state: Readonly<Record<RawMetric, "present" | "zero" | "absent" | "partial" | "account_configuration_missing" | "not_requested">>;
  readonly metric_evidence: Readonly<Record<RawMetric, readonly Readonly<Record<string, unknown>>[]>>;
  readonly details: readonly Readonly<Record<string, unknown>>[];
  readonly source_projections: readonly Readonly<Record<string, unknown>>[];
  readonly spend_state: "open_no_calculation";
}
export function composeKlaviyoPdMessage(input: {
  expected_scope: PdCompositionScope;
  metric_selection: Record<KlaviyoPdMetricName, {metric_id: string | null; state: "present" | "account_configuration_missing"}>;
  projections: readonly KlaviyoPdProjection[];
}): Readonly<{status: "composed" | "partial" | "rejected"; rows: readonly KlaviyoPdMessageFact[];
  reason: string | null; compatibility: PdCompositionCompatibility | null; publishable: false}>;
