export interface KlaviyoProductIdentityContext {
  shop: {
    authority: "shopify_admin_verified";
    shopId: string;
    myshopifyDomain: string;
  };
  installation: {
    workspaceId: string;
    installGeneration: number;
    status: "active";
  };
  admin: {
    graphql(query: string, options?: {variables?: Record<string, string>}): Promise<Response>;
  };
}

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
  /** Server-only fresh context loader; omitted/null preserves the existing execution. */
  loadProductIdentityContext?: ((input: {
    installationAuthority: any;
    connectionId: string;
    accountId: string;
  }) => Promise<KlaviyoProductIdentityContext>) | null;
}): {
  readPdEvidenceSnapshot(input: {
    installationAuthority: any;
    businessDate?: string | null;
  }): Promise<any>;
  readDailyEvidenceSnapshot(input: {
    installationAuthority: any;
    businessDate?: string | null;
  }): Promise<any>;
};
