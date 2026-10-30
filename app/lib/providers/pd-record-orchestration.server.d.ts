import type {CanonicalFunnelFact} from "./common-adapter.server.js";
import type {PdCompositionScope} from "./pd-composition-scope.server.js";
import type {PdCanonicalEnrichment} from "./pd-canonical-bridge.server.js";

export interface PdRecordMetadata {
  /** Exact current server execution, including connection version/selection/fence. */
  binding: Readonly<Record<string, unknown>>;
  expected_target_currency: string;
  entries: readonly {
    scope: PdCompositionScope;
    metadata_references: {attribution: string; metric_units: string};
    enrichment: PdCanonicalEnrichment;
  }[];
}
/** A structural check is not native attribution evidence or persistence authority. */
export function bridgePdReadSnapshot(input: {
  sourceContext: Readonly<Record<string, unknown>>;
  evidence: Readonly<Record<string, unknown>>;
  composition?: Readonly<Record<string, unknown>>;
  metadata?: PdRecordMetadata;
}): Readonly<{
  status: "blocked" | "validated" | "not_observed";
  reason: string | null;
  rows: readonly CanonicalFunnelFact[];
  source_facts: readonly Readonly<Record<string, unknown>>[];
  decisions: readonly {entity: string; status: string; reason: string | null; fact_key: string | null}[];
  canonical_validated: boolean;
  canonical_scope_ready: false;
  authorizes_activation: false;
  persistable: false;
  publishable: false;
}>;
