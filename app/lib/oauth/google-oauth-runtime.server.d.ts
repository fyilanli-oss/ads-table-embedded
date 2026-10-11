export declare function createGoogleOAuthRuntime(options: {
  database: unknown;
  tokenVault: unknown;
  environment?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  now?: () => Date;
}): any;
