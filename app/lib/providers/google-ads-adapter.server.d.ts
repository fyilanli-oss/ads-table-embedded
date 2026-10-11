import type {
  AdapterAuthority,
  AdapterLimits,
  AdapterResult,
  CanonicalFunnelFact,
  CommonAdapterRequest,
} from "./common-adapter.server.js";

export const GOOGLE_ADS_ADAPTER_VERSION: "1.0.0";
export const GOOGLE_ADS_API_VERSION: "v25";
export const GOOGLE_QUERY_FAMILIES: readonly [
  "canonical_ad_performance",
  "shopping_product_performance",
  "performance_max_retail_product_performance",
  "sold_product_cart",
];
export const GOOGLE_CAMPAIGN_TYPES: readonly ["standard", "performance_max"];

export class GoogleAdsAdapterError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown);
}

export type GoogleQueryFamily = (typeof GOOGLE_QUERY_FAMILIES)[number];
export type GoogleCampaignType = (typeof GOOGLE_CAMPAIGN_TYPES)[number];

export type GoogleAdsRequest = CommonAdapterRequest & {
  query_family: GoogleQueryFamily;
  campaign_type: GoogleCampaignType;
  account_context: {
    customer_manager: false;
    login_customer_id?: string | null;
  };
};

export type GoogleAdsRequestInput = Omit<
  GoogleAdsRequest,
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

export type GoogleQueryDescriptor = Readonly<{
  partition: string;
  resource: string;
  gaql: string;
  required_native_item_partition?: string;
  incompatible_dimensions?: readonly string[];
}>;

export type GoogleCanonicalBundle = {
  base: Record<string, unknown>;
  conversions?: Record<string, unknown>[];
};

export type GoogleTransportResponse = {
  bundles: GoogleCanonicalBundle[];
  next_cursor?: string | null;
  request_id?: string | null;
  quota?: Record<string, unknown> | null;
};

export type GoogleTransport = (input: {
  method: "POST";
  api_version: "v25";
  customer_id: string;
  login_customer_id: string | null;
  query_plan: readonly GoogleQueryDescriptor[];
  cursor: string | null;
}) => Promise<GoogleTransportResponse>;

export function buildGoogleAdsRequest(overrides: GoogleAdsRequestInput): GoogleAdsRequest;
export function buildGoogleAdsQueryPlan(
  request: GoogleAdsRequest,
): readonly GoogleQueryDescriptor[];
export function translateGoogleAdsCanonicalBundle(
  bundle: GoogleCanonicalBundle,
  context: { request: GoogleAdsRequest; synthetic?: boolean },
): CanonicalFunnelFact;
export function createGoogleAdsCanonicalFetchPage(options: {
  transport: GoogleTransport;
  synthetic?: boolean;
}): (input: {
  request: GoogleAdsRequest;
  cursor: string | null;
}) => Promise<unknown>;
export function classifyGoogleAdsError(error: unknown): {
  class: string;
  retryable: boolean;
  retry_after_ms: number | null;
  provider_request_id: string | null;
  message: string;
};
export function runGoogleAdsCanonicalFacts(options: {
  request: GoogleAdsRequest;
  transport: GoogleTransport;
  synthetic?: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  limits?: AdapterLimits;
}): Promise<AdapterResult>;
