import type {
  ClassifiedProviderError,
  CommonAdapterRequest,
  ProviderPage,
} from "./common-adapter.server.js";

export const META_CHANNEL_ADAPTER_VERSION: "1.0.0";
export const META_CHANNEL_FIELDS: readonly string[];

export interface MetaCurrencyContext {
  targetCurrency: string;
  fxRate: number;
  fxProvider: string;
  fxEngineVersion: string;
  accountTimezone: string;
  timeEngineVersion: string;
}

export function buildMetaChannelInsightsUrl(input: {
  request: CommonAdapterRequest;
  cursor?: string | null;
}): string;

export function buildMetaRawInsightsUrl(input: {
  reportingAccountId: string;
  start: string;
  end: string;
  cursor?: string | null;
}): string;

export function fetchMetaRawInsightsPage(input: {
  reportingAccountId: string;
  start: string;
  end: string;
  accessToken: string;
  cursor?: string | null;
  fetchFn?: typeof fetch;
}): Promise<{
  rows: readonly Readonly<Record<string, unknown>>[];
  next_cursor: string | null;
  provider_request_id: string | null;
}>;

export function mapMetaInsightToCanonicalFact(input: {
  insight: Record<string, unknown>;
  request: CommonAdapterRequest;
} & MetaCurrencyContext): any;

export function fetchMetaChannelFactsPage(input: {
  request: CommonAdapterRequest;
  accessToken: string;
  cursor?: string | null;
  currency: MetaCurrencyContext;
  fetchFn?: typeof fetch;
}): Promise<ProviderPage>;

export function classifyMetaChannelError(error: unknown): ClassifiedProviderError;
