import type {CanonicalFunnelFact} from "./common-adapter.server.js";
import type {PdCompositionScope, PdCompositionCompatibility} from "./pd-composition-scope.server.js";
import type {GooglePdSourceFact} from "./google-pd-composition.server.js";
import type {KlaviyoPdMessageFact} from "./klaviyo-pd-composition.server.js";
export interface MetaPdSourceFact {
  scope: PdCompositionScope;
  raw_metrics: CanonicalFunnelFact["raw_metrics"];
  metric_support: CanonicalFunnelFact["metric_support"];
  observation_state: CanonicalFunnelFact["observation_state"];
  source_projections: readonly Readonly<Record<string, unknown>>[];
  metric_evidence: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}
export interface PdCanonicalEnrichment {
  scope: PdCompositionScope;
  entity: CanonicalFunnelFact["entity"];
  currency: CanonicalFunnelFact["currency"];
  time: CanonicalFunnelFact["time"];
  fx_for_business_date: string;
  references: {entity: string; time: string; fx: string; reporting_currency: string};
  provenance: Omit<CanonicalFunnelFact["provenance"], "raw_reference">;
}
export function bridgePdSourceToCanonical(input: {
  expected_scope: PdCompositionScope;
  source_fact: GooglePdSourceFact | KlaviyoPdMessageFact | MetaPdSourceFact;
  expected_target_currency: string;
  enrichment: PdCanonicalEnrichment;
}): Readonly<{status: "blocked" | "validated"; rows: readonly CanonicalFunnelFact[];
  canonical_validated: boolean; fact_key: string | null; reason: string | null;
  compatibility: PdCompositionCompatibility; source_fact: GooglePdSourceFact | KlaviyoPdMessageFact | MetaPdSourceFact | null; publishable: false}>;
