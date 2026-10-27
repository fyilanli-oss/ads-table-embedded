export function createMetaOAuthRuntime(input: {
  database: any;
  tokenVault: any;
  environment?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  now?: () => Date;
  identityAuthorizationEnabled?: boolean;
}): any;
