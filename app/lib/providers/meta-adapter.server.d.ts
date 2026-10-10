import type {
  AdapterAuthority,
  CommonAdapterRequest,
  CommonAdapterResult,
} from "./common-adapter.server.js";

export const META_ADAPTER_VERSION: "1.0.0";
export const META_GRAPH_VERSION: "v26.0";
export const META_INSIGHTS_LEVEL: "ad";
export const META_INSIGHTS_FIELDS: readonly string[];
export const META_CLICK_CANDIDATES: readonly string[];
export const META_ACTION_ALIASES: Readonly<Record<string, readonly string[]>>;

export class MetaAdapterError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown);
}

export type MetaRequestInput = Omit<
  CommonAdapterRequest,
  | "provider"
  | "operation"
  | "adapter_contract_version"
  | "provider_api_version"
  | "levels"
  | "breakdowns"
  | "query_fingerprint"
> & {
  authority: AdapterAuthority;
};

export type MetaTransportResponse = {
  data: Record<string, unknown>[];
  paging?: { next?: string | null };
  headers?: Headers | Record<string, unknown>;
  request_id?: string;
};

export type MetaTransport = (input: {
  method: "GET";
  url: string;
  provider: "meta";
  account_id: string;
}) => Promise<MetaTransportResponse>;

export function buildMetaRequest(overrides: MetaRequestInput): CommonAdapterRequest;
export function buildMetaInsightsUrl(request: CommonAdapterRequest): string;
export function translateMetaInsightRow(
  row: Record<string, unknown>,
  context: {
    request: CommonAdapterRequest;
    account_currency: string;
    source_timezone: string;
    synthetic?: boolean;
  },
): unknown;
export function createMetaInsightsFetchPage(options: {
  transport: MetaTransport;
  account_currency: string;
  source_timezone: string;
  synthetic?: boolean;
}): (input: {
  request: CommonAdapterRequest;
  cursor: string | null;
}) => Promise<unknown>;
export function classifyMetaError(error: unknown): {
  class: string;
  retryable: boolean;
  retry_after_ms: number | null;
  provider_request_id: string | null;
  message: string;
};
export function runMetaInsights(options: {
  request: CommonAdapterRequest;
  transport: MetaTransport;
  account_currency: string;
  source_timezone: string;
  synthetic?: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  limits?: Record<string, number>;
}): Promise<CommonAdapterResult>;
