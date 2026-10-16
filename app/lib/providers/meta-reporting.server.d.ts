export const META_AD_CHANNEL_INSIGHTS_FIELDS: readonly string[];
export const META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS: readonly string[];
export const META_PRODUCT_BREAKDOWN_ID_LIMIT: number;

export function buildMetaAdChannelInsightsUrl(input: {
  adAccountId: string;
  dateWindow: {start: string; end: string};
  after?: string | null;
  graphVersion?: string;
  limit?: number;
}): string;

export function fetchMetaAdChannelInsightsPage(input: {
  accessToken: string;
  adAccountId: string;
  dateWindow: {start: string; end: string};
  after?: string | null;
  graphVersion?: string;
  fetchFn?: typeof fetch;
}): Promise<{
  readonly provider: "meta";
  readonly fact_family: "ad_channel_daily_insights";
  readonly channel_type: "ad";
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly next_cursor: string | null;
  readonly provider_request_id: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
}>;

export function buildMetaProductBreakdownInsightsUrl(input: {
  adAccountId: string;
  dateWindow: {start: string; end: string};
  after?: string | null;
  graphVersion?: string;
  limit?: number;
}): string;

export function fetchMetaProductBreakdownInsightsPage(input: {
  accessToken: string;
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
  retryable: boolean;
  retry_after_ms: number | null;
  provider_request_id: string | null;
  message: string;
}>;
