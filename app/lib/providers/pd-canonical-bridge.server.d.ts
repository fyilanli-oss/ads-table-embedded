import type {CanonicalFunnelFact} from "./common-adapter.server.js";
import type {PdCompositionScope, PdCompositionCompatibility} from "./pd-composition-scope.server.js";
import type {GooglePdSourceFact} from "./google-pd-composition.server.js";
import type {KlaviyoPdMessageFact} from "./klaviyo-pd-composition.server.js";
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
  source_fact: GooglePdSourceFact | KlaviyoPdMessageFact;
  expected_target_currency: string;
  enrichment: PdCanonicalEnrichment;
}): Readonly<{status: "blocked" | "validated"; rows: readonly CanonicalFunnelFact[];
  canonical_validated: boolean; fact_key: string | null; reason: string | null;
  compatibility: PdCompositionCompatibility; source_fact: GooglePdSourceFact | KlaviyoPdMessageFact | null; publishable: false}>;
