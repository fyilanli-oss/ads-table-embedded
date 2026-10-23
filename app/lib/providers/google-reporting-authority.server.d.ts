export function createGoogleReportingAuthorityRuntime(input: {
  database: any;
  tokenVault: any;
  environment?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
}): {
  prepareEvidenceExecution(input: {
    installationAuthority: {
      authority: "shopify_installation_verified";
      workspaceId: string;
      installGeneration: number;
      status: "active";
    };
  }): Promise<Readonly<Record<string, unknown>>>;
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
  readShoppingSourceEvidenceSnapshot(input: {
    installationAuthority: {
      authority: "shopify_installation_verified";
      workspaceId: string;
      installGeneration: number;
      status: "active";
    };
    dateWindow: {start: string; end: string};
  }): Promise<Readonly<Record<string, any>>>;
  readSearchSourceEvidenceSnapshot(input: {
    installationAuthority: {
      authority: "shopify_installation_verified";
      workspaceId: string;
      installGeneration: number;
      status: "active";
    };
    dateWindow: {start: string; end: string};
  }): Promise<Readonly<Record<string, any>>>;
};
