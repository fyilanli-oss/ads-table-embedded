export const GOOGLE_ADS_OAUTH_SCOPE: string;
export const GOOGLE_ADS_REVOCATION_ENDPOINT: string;
export function buildGoogleAdsAuthorizationUrl(input: {
  config: {clientId: string; redirectUri: string};
  state: string;
  pkceChallenge: string;
  loginHint?: string | null;
}): string;
export function readGoogleAdsOAuthConfig(environment?: NodeJS.ProcessEnv): any;
export function exchangeGoogleAdsAuthorizationCode(input: any): Promise<any>;
export function refreshGoogleAdsAccessToken(input: any): Promise<any>;
export function revokeGoogleAdsAuthorization(input: any): Promise<any>;
export function createGoogleAdsRestClient(input?: any): any;
export function googleAdsRestFailureMetadata(error: unknown): Readonly<{
  operation: "list_accessible_customers" | "search" | null;
  http_status: number | null;
  provider_status: string | null;
  provider_error_code: string | null;
}> | null;
