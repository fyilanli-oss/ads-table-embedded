export const GOOGLE_ADS_OAUTH_SCOPE: "https://www.googleapis.com/auth/adwords";
export const GOOGLE_ADS_AUTHORIZATION_ENDPOINT: string;
export const GOOGLE_ADS_TOKEN_ENDPOINT: string;
export const GOOGLE_ADS_REST_ORIGIN: string;
export const GOOGLE_ADS_REST_VERSION: "v25";

export type GoogleAdsOAuthConfig = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}>;

export class GoogleAdsRestError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown);
}

export function readGoogleAdsOAuthConfig(
  environment?: Record<string, string | undefined>,
): GoogleAdsOAuthConfig;

export function buildGoogleAdsAuthorizationUrl(input: {
  config: GoogleAdsOAuthConfig;
  state: string;
  pkceChallenge: string;
  loginHint?: string | null;
}): string;

export type GoogleAdsTokenSet = Readonly<{
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}>;

export function exchangeGoogleAdsAuthorizationCode(input: {
  config: GoogleAdsOAuthConfig;
  authorizationCode: string;
  pkceVerifier: string;
  fetchFn?: typeof fetch;
}): Promise<GoogleAdsTokenSet>;

export function refreshGoogleAdsAccessToken(input: {
  config: GoogleAdsOAuthConfig;
  refreshToken: string;
  fetchFn?: typeof fetch;
}): Promise<GoogleAdsTokenSet>;

export function createGoogleAdsRestClient(input: {
  accessToken: string;
  loginCustomerId?: string | null;
  fetchFn?: typeof fetch;
}): Readonly<{
  listAccessibleCustomers(): Promise<Readonly<{
    customers: readonly Readonly<{
      resource_name: string;
      customer_id: string;
    }>[];
    request_id: string | null;
  }>>;
  search(input: {
    customerId: string;
    query: string;
    pageToken?: string | null;
    pageSize?: number;
  }): Promise<Readonly<{
    results: readonly Record<string, unknown>[];
    next_page_token: string | null;
    total_results_count: number | null;
    request_id: string | null;
  }>>;
}>;
