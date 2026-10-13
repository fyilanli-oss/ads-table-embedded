export const META_GRAPH_VERSION: string;
export const META_OAUTH_SCOPE: string;
export function readMetaOAuthConfig(environment?: NodeJS.ProcessEnv): any;
export function buildMetaAuthorizationUrl(input: {
  config: {appId: string; redirectUri: string};
  state: string;
}): string;
export function exchangeAndValidateMetaAuthorizationCode(input: any): Promise<any>;
export function discoverMetaAdAccounts(input: any): Promise<any>;
export function revokeMetaAuthorization(input: any): Promise<any>;
