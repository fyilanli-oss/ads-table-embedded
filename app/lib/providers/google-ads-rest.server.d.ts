export const GOOGLE_ADS_OAUTH_SCOPE: string;
export function buildGoogleAdsAuthorizationUrl(input: {
  config: {clientId: string; redirectUri: string};
  state: string;
  pkceChallenge: string;
  loginHint?: string | null;
}): string;
export function readGoogleAdsOAuthConfig(environment?: NodeJS.ProcessEnv): any;
export function exchangeGoogleAdsAuthorizationCode(input: any): Promise<any>;
export function refreshGoogleAdsAccessToken(input: any): Promise<any>;
export function createGoogleAdsRestClient(input?: any): any;
