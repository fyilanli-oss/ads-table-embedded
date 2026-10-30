export function createGoogleReportingAuthorityRuntime(input: {
  database: any;
  tokenVault: any;
  environment?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
}): {
  readPmaxSourceEvidenceSnapshot(input: {
    installationAuthority: {authority: "shopify_installation_verified"; workspaceId: string; installGeneration: number; status: "active"};
    dateWindow: {start: string; end: string};
    limits: {maxPages: number; maxRows: number; maxBytes: number};
    listingEvidence?: Record<string, any> | null;
    signal?: AbortSignal;
    maxElapsedMs?: number;
  }): Promise<Readonly<Record<string, any>>>;
  readPdEvidenceSnapshot(input: {
    installationAuthority: {authority: "shopify_installation_verified"; workspaceId: string; installGeneration: number; status: "active"};
    dateWindow: {start: string; end: string};
    flow: "search" | "shopping" | "retail_pmax";
    nativeMetadata?: boolean;
    limits: {maxPages: number; maxRows: number; maxBytes: number};
  }): Promise<Readonly<Record<string, any>>>;
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
