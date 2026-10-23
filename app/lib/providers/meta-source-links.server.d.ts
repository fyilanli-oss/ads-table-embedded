export type MetaSourceLinkScope = Readonly<{
  workspace_id: string;
  install_generation: number;
  connection_id: string;
  reporting_account_id: string;
}>;
export type MetaSourceLinks = Readonly<{
  version: "1.0.0";
  scope: MetaSourceLinkScope;
  date_window: Readonly<{start: string; end: string}>;
  pd_fact_family: "ad_channel_daily_insights";
  product_fact_family: "ad_product_breakdown_daily_insights";
  product_links: readonly Readonly<{
    product_row_index: number;
    pd_row_index: number | null;
    state: "unresolved" | "ambiguous" | "conflicting" | "exact_native_ad_reference";
    reason: string;
    channel_type: "ad";
    referenced_pd_ad_id: string | null;
    native_key: Readonly<{account_id: string; ad_id: string; business_date: string;
      campaign_id: string | null; adset_id: string | null}> | null;
    provider_product_id: string | null;
    shopify_identity_state: "unresolved_mapping_pending";
  }>[];
  publishable: false;
}>;
export function buildMetaSourceLinks(input: {
  scope: MetaSourceLinkScope;
  dateWindow: {start: string; end: string};
  channelRows: readonly unknown[];
  productRows: readonly unknown[];
}): MetaSourceLinks;
