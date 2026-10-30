export const META_AD_CHANNEL_INSIGHTS_FIELDS: readonly string[];
export const META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS: readonly string[];
export const META_PRODUCT_BREAKDOWN_ID_LIMIT: number;
export const META_PROMOTED_PRODUCT_PROBE_FIELDS: readonly string[];
export const META_PD_METRIC_SOURCES: Readonly<Record<string, Readonly<{field: string; action_type?: string}>>>;
export type MetaPdMetricProjection = Readonly<{
  raw_metrics: Readonly<Record<string, number | null>>;
  metric_support: Readonly<Record<string, "supported" | "unknown">>;
  observation_state: Readonly<Record<string, "absent" | "empty" | "zero" | "present">>;
  metric_sources: typeof META_PD_METRIC_SOURCES;
}>;
export function mapMetaPdMetrics(row: Readonly<Record<string, unknown>>): MetaPdMetricProjection;

export function buildMetaAdChannelInsightsUrl(input: {
  nativeMetadata?: boolean;
  adAccountId: string;
  dateWindow: {start: string; end: string};
  after?: string | null;
  graphVersion?: string;
  limit?: number;
}): string;

export function fetchMetaAdChannelInsightsPage(input: {
  nativeMetadata?: boolean;
  accessToken: string;
  appSecret: string;
  adAccountId: string;
  dateWindow: {start: string; end: string};
  after?: string | null;
  graphVersion?: string;
  fetchFn?: typeof fetch;
}): Promise<{
  readonly provider: "meta";
  readonly fact_family: "ad_channel_daily_insights";
  readonly pd_metric_rows: readonly (MetaPdMetricProjection & {readonly source_row_index: number})[];
  readonly channel_type: "ad";
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly next_cursor: string | null;
  readonly provider_request_id: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
}>;

export function buildMetaProductBreakdownInsightsUrl(input: {
  nativeMetadata?: boolean;
  includePromotedProductMetrics?: boolean;
  adAccountId: string;
  dateWindow: {start: string; end: string};
  after?: string | null;
  graphVersion?: string;
  limit?: number;
}): string;

export function fetchMetaProductBreakdownInsightsPage(input: {
  nativeMetadata?: boolean;
  includePromotedProductMetrics?: boolean;
  accessToken: string;
  appSecret: string;
  adAccountId: string;
  dateWindow: {start: string; end: string};
  after?: string | null;
  graphVersion?: string;
  fetchFn?: typeof fetch;
}): Promise<{
  readonly provider: "meta";
  readonly fact_family: "ad_product_breakdown_daily_insights";
  readonly channel_type: "ad";
  readonly breakdown: "product_id";
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly next_cursor: string | null;
  readonly provider_request_id: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
}>;

export function classifyMetaReportingError(error: unknown): Readonly<{
  class: string;
  retryable: false;
  retry_after_ms: number | null;
  provider_request_id: string | null;
  message: string;
}>;
