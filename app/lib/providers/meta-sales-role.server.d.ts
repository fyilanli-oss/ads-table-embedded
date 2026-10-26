export interface MetaSaleRoleEvidence {
  readonly state: "verified" | "pending" | "contradictory";
  readonly relation_scope?: "single_product_sale_relation";
  readonly row_identity?: Readonly<{
    account_id: string; ad_id: string; product_id: string; business_date: string;
  }>;
  readonly catalog_id?: string;
  readonly identity_namespace?: "catalog_product_id" | "retailer_id";
  readonly advertised_product_id?: string;
  readonly sold_product_id?: string;
  readonly sales_quantity?: number | string;
  readonly source_reference?: string;
}
export const META_NATIVE_PRODUCT_SALES_FIELDS: readonly string[];
export interface MetaProductSaleProjection {
  readonly provider: "meta";
  readonly business_date: string | null;
  readonly ad_id: string | null;
  readonly provider_product_key: Readonly<Record<string, string | null>>;
  readonly sales_role: "Advertised" | "Cross-sell" | "Unclassified";
  readonly sales_role_resolution: Readonly<{state: string; reason: string; source_reference: string | null}>;
  readonly raw_metrics: Readonly<Record<string, unknown>>;
  readonly metric_observation: Readonly<Record<string, string>>;
  readonly raw_row: Readonly<Record<string, unknown>>;
}
export function normalizeMetaProductSale(row: Readonly<Record<string, unknown>>, evidence?: MetaSaleRoleEvidence | null): MetaProductSaleProjection;
export function projectMetaProductSales(input: {
  rows: readonly Readonly<Record<string, unknown>>[];
  evidenceRows?: readonly (MetaSaleRoleEvidence | null)[] | null;
}): Readonly<{
  version: "1.0.0";
  source_family: "ad_product_breakdown_daily_insights";
  rows: readonly (MetaProductSaleProjection & {readonly source_row_index: number})[];
  additional_sales_facts_created: false;
  native_metric_semantics: "validation_pending";
  dataset_publishable: false;
  live_validation: false;
}>;
