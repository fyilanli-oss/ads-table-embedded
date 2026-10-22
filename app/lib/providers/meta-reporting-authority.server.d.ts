export function createMetaReportingAuthorityRuntime(input: {
  database: any;
  tokenVault: any;
  appSecret?: string;
  graphVersion?: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
}): {
  readDailyEvidencePages(input: {
    installationAuthority: {
      authority: "shopify_installation_verified";
      workspaceId: string;
      installGeneration: number;
      status: "active";
    };
    dateWindow: {start: string; end: string};
    channelAfter?: string | null;
    productAfter?: string | null;
  }): Promise<Readonly<{
    provider: "meta";
    authority: Readonly<{
      connection_id: string;
      reporting_account_id: string;
    }>;
    channel: Readonly<Record<string, unknown>>;
    product: Readonly<Record<string, unknown>>;
  }>>;
  readDailyEvidenceSnapshot(input: {
    includePromotedProductMetrics?: boolean;
    installationAuthority: {
      authority: "shopify_installation_verified";
      workspaceId: string;
      installGeneration: number;
      status: "active";
    };
    dateWindow: {start: string; end: string};
  }): Promise<Readonly<{
    provider: "meta";
    authority: Readonly<{
      connection_id: string;
      reporting_account_id: string;
    }>;
    channel: Readonly<Record<string, unknown>>;
    product: Readonly<Record<string, unknown>>;
  }>>;
};
