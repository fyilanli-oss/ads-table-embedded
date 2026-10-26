import type {MetaSourceLinks} from "./meta-source-links.server.js";
import type {MetaSaleRoleEvidence, projectMetaProductSales} from "./meta-sales-role.server.js";

export function createMetaReportingAuthorityRuntime(input: {
  database: any;
  tokenVault: any;
  appSecret?: string;
  graphVersion?: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
  /** Server-internal verified relation evidence; never an unverified client claim. */
  loadProductSalesEvidence?: ((input: {
    installationAuthority: any;
    connectionId: string;
    reportingAccountId: string;
    dateWindow: Readonly<{start: string; end: string}>;
    productRows: Readonly<Record<string, unknown>>[];
  }) => Promise<Readonly<{
    scope: Readonly<{workspace_id: string; install_generation: number; connection_id: string; reporting_account_id: string}>;
    rows: readonly (MetaSaleRoleEvidence | null)[];
  }>>) | null;
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
    source_links: MetaSourceLinks;
    product_sales: ReturnType<typeof projectMetaProductSales>;
  }>>;
};
