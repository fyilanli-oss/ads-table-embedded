export const KLAVIYO_AUTHORIZATION_ENDPOINT: string;
export const KLAVIYO_TOKEN_ENDPOINT: string;
export const KLAVIYO_REVOCATION_ENDPOINT: string;
export const KLAVIYO_ACCOUNTS_ENDPOINT: string;
export const KLAVIYO_API_REVISION: string;
export const KLAVIYO_OAUTH_SCOPES: readonly string[];
export function readKlaviyoOAuthConfig(environment?: NodeJS.ProcessEnv): any;
export function buildKlaviyoAuthorizationUrl(input: any): string;
export function exchangeKlaviyoAuthorizationCode(input: any): Promise<any>;
export function refreshKlaviyoAccessToken(input: any): Promise<any>;
export function klaviyoTokenRequiresRefresh(
  tokenSet: any,
  now?: () => Date,
  minimumValidityMs?: number,
): boolean;
export function discoverKlaviyoAccount(input: any): Promise<any>;
export function revokeKlaviyoAuthorization(input: any): Promise<any>;
