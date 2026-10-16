export function createGoogleReportingAuthorityRuntime(input: {
  database: any;
  tokenVault: any;
  environment?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
}): {
  readEvidencePage(input: {
    installationAuthority: {
      authority: "shopify_installation_verified";
      workspaceId: string;
      installGeneration: number;
      status: "active";
    };
    queryFamily: string;
    dateWindow: {start: string; end: string};
    pageToken?: string | null;
  }): Promise<Readonly<Record<string, unknown>>>;
};
