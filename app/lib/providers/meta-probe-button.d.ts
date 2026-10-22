export const META_PROBE_BUTTON_INPUT: Readonly<{
  provider: "meta"; business_date: "2026-10-01"; probe: "promoted_product_metrics";
}>;
export type MetaProbeButtonResult =
  | Readonly<{status: "complete"; channelRows: number; productRows: number}>
  | Readonly<{status: "failed"; code: string}>;
export function createMetaProbeButtonRunner(input?: {fetchFn?: typeof fetch}): {
  readonly attempted: boolean;
  run(): Promise<MetaProbeButtonResult | null>;
};
