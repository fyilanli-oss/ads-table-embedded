export function createKlaviyoReportingAuthorityRuntime(input?: {
  database?: any;
  tokenVault?: any;
  environment?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  now?: () => Date;
  accountAuthority?: any;
  lifecycle?: any;
  credentialAuthority?: any;
  config?: any;
}): {
  readDailyEvidenceSnapshot(input: {
    installationAuthority: any;
    businessDate?: string | null;
  }): Promise<any>;
};
