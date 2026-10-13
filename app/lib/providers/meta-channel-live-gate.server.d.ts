export const META_CHANNEL_LIVE_GATE_LOOKBACK_DAYS: 31;

export function previousClosedMetaDate(now: Date, timeZone: string): string;

export function providerMetricEvidence(
  rows: readonly Record<string, unknown>[],
  field: "actions" | "action_values",
): {
  source_field: string;
  source_row_count: number;
  entry_count: number;
  malformed_entry_count: number;
  entries: readonly {
    action_type: string;
    value: string;
    entry_count: number;
  }[];
};

export function createMetaChannelReadOnlyGate(input: {
  database: any;
  tokenVault: any;
  fetchFn?: typeof fetch;
  now?: () => Date;
}): {
  execute(input: {installationAuthority: any}): Promise<any>;
};
