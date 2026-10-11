export function createGoogleOAuthRuntime(input: {
  database: any;
  tokenVault: any;
  environment?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  now?: () => Date;
}): any;
