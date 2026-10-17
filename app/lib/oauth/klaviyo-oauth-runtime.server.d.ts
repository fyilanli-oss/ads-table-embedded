export function createKlaviyoOAuthRuntime(input: {
  database: any;
  tokenVault: any;
  environment?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  now?: () => Date;
  randomUUIDFn?: () => string;
}): any;

export function createKlaviyoCredentialAuthority(input: {
  tokenVault: any;
  lifecycle: any;
  setup: any;
  config: any;
  fetchFn?: typeof fetch;
  now?: () => Date;
}): any;

export function selectKlaviyoAccount(accounts: any[], accountId: string): any;
