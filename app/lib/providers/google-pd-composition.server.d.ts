import type {RawMetric} from "./common-adapter.server.js";
import type {PdCompositionScope, PdCompositionSource, PdCompositionCompatibility} from "./pd-composition-scope.server.js";

export interface GooglePdProjection extends PdCompositionSource {
  /** One leaf/day only; native rows from a completely collected projection. */
  rows: readonly Readonly<Record<string, any>>[];
}
export interface GooglePdSourceFact {
  readonly scope: PdCompositionScope;
  readonly raw_metrics: Readonly<Record<RawMetric, number | null>>;
  readonly metric_support: Readonly<Record<RawMetric, "supported" | "unknown">>;
  readonly observation_state: Readonly<Record<RawMetric, "present" | "zero" | "absent" | "partial">>;
  readonly metric_evidence: Readonly<Record<RawMetric, readonly Readonly<{
    source_family: string; source_reference: string; source_row_index: number; native_field: string;
  }>[]>>;
  readonly conversion_details: readonly Readonly<Record<string, unknown>>[];
  readonly source_projections: readonly Readonly<{
    source_family: string; source_reference: string; rows: readonly Readonly<Record<string, any>>[];
  }>[];
  readonly source_currency_conversion: "none_cost_micros_unit_scale_only";
}
export function composeGooglePdLeaf(input: {
  expected_scope: PdCompositionScope;
  performance: GooglePdProjection;
  conversions: GooglePdProjection;
}): Readonly<{
  status: "rejected" | "partial" | "composed";
  rows: readonly GooglePdSourceFact[];
  reason: string | null;
  compatibility: PdCompositionCompatibility | null;
  publishable: false;
}>;
