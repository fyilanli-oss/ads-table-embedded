import {reviewSalesRoleCohort} from "./sales-role-prewrite.server.js";
import {stableJson} from "./common-adapter.server.js";
import {normalizeGoogleCartDataSale} from "./google-reporting.server.js";

const fail = () => {throw Error("GOOGLE_PRODUCT_SALES_EVIDENCE_INVALID");};
const copy = value => value === null || typeof value !== "object" ? value
  : Object.freeze(Array.isArray(value) ? value.map(copy)
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])));

// Pure projection of a completed, scoped native read. This is neither a source
// observation proof nor Dataset authority; the private worker owns those gates.
export function projectGoogleProductSales({sourceContext: s, evidence: e} = {}) {
  const links = e?.source_links, family = links?.product_sales_fact_family;
  const shopping = family === "shopping_cart_data_product_sales_daily";
  const search = family === "search_cart_data_product_sales_daily";
  if (!shopping && !search && family !== "pmax_cart_data_product_sales_daily") fail();
  const scope = links?.scope, page = e?.results?.[family];
  if (s?.provider !== "google_ads" || !/^\d{4}-\d{2}-\d{2}$/.test(s.business_date ?? "")
    || !s.workspace_id || !s.provider_connection_id || !Number.isSafeInteger(s.installation_generation)
    || s.installation_generation < 1 || s.platform_account_id !== s.canonical_reporting_account_id
    || !/^[1-9][0-9]*$/.test(s.platform_account_id ?? "") || e?.provider !== s.provider
    || scope?.workspace_id !== s.workspace_id || scope?.install_generation !== s.installation_generation
    || scope?.connection_id !== s.provider_connection_id || scope?.reporting_account_id !== s.platform_account_id
    || e.authority?.connection_id !== s.provider_connection_id || e.authority?.reporting_account_id !== s.platform_account_id
    || e.authority?.reporting_account_currency !== s.source_currency || e.authority?.reporting_account_timezone !== s.source_timezone
    || !s.source_currency || !s.source_timezone || e.date_window?.start !== s.business_date || e.date_window?.end !== s.business_date
    || links.date_window?.start !== s.business_date || links.date_window?.end !== s.business_date
    || !Array.isArray(page?.rows) || page.next_cursor !== null || page.fact_family !== family || page.evidence?.query_family !== family
    || !Array.isArray(links.product_sales_links) || links.product_sales_links.length !== page.rows.length
    || !Array.isArray(page.evidence?.page_spans)) fail();
  const spans = page.evidence.page_spans;
  let covered = 0;
  for (const [index, span] of spans.entries()) {
    if (span.page_index !== index || span.row_start !== covered || !Number.isSafeInteger(span.row_count) || span.row_count < 0
      || !/^[a-f0-9]{64}$/.test(span.query_fingerprint ?? "") || span.query_fingerprint !== page.evidence.query_fingerprint) fail();
    covered += span.row_count;
  }
  if (covered !== page.rows.length || spans.length !== page.evidence.page_count || spans.length < 1) fail();
  const rows = page.rows.map((row, index) => {
    const link = links.product_sales_links[index];
    if (link.source_row_index !== index || row.customer?.id !== s.platform_account_id
      || row.segments?.date !== s.business_date || !/^[1-9][0-9]*$/.test(row.campaign?.id ?? "")
      || row.campaign?.advertisingChannelType !== (shopping ? "SHOPPING" : search ? "SEARCH" : "PERFORMANCE_MAX")) fail();
    // The existing Search query selects sold identity and total normal metrics
    // only. Unrequested advertised/lead/cross-sell fields cannot grant a role.
    const roleRow = search ? {...row, segments: {...row.segments, productItemId: undefined},
      metrics: {unitsSold: row.metrics?.unitsSold, revenueMicros: row.metrics?.revenueMicros}} : row;
    const sale = normalizeGoogleCartDataSale(roleRow);
    const span = spans.find(p => index >= p.row_start && index < p.row_start + p.row_count);
    if (!span || !shopping && !search && link.sales_role !== sale.sales_role) fail();
    return {...sale, raw_row: row, ...(search ? {role_evidence_scope: "search_sold_product_only",
      advertised_cross_sell_evidence: "not_established_by_current_query"} : {}), channel_reference: link, source_reference: {
      query_family: family, source_row_index: index, page_index: span.page_index,
      page_row_index: index - span.row_start, query_fingerprint: span.query_fingerprint,
      provider_request_id: span.provider_request_id ?? null,
    }};
  });
  return copy({status: rows.length ? "projected_for_prewrite" : "not_observed", provider: "google_ads",
    source_context: s, rows, conversion_scope: "normal", totals_computed: false, metrics_allocated: false,
    shopify_identity_resolved: false, canonical_scope_ready: false, persistable: false, publishable: false,
    Dataset_write_performed: false});
}


// Called only after the worker verifies its private source observation. Rebuild the
// projection from that same complete evidence before reviewing the sales cohort.
export function reviewGoogleProductSales({sourceContext, evidence, projected} = {}) {
  const checked = projectGoogleProductSales({sourceContext, evidence});
  if (stableJson(checked) !== stableJson(projected)) throw Error("GOOGLE_PRODUCT_SALES_PROJECTION_MISMATCH");
  const s = sourceContext, family = evidence.source_links.product_sales_fact_family;
  const cohort = {workspace_id: s.workspace_id, installation_id: s.installation_id,
    installation_generation: s.installation_generation, provider_connection_id: s.provider_connection_id,
    provider: s.provider, platform_account_id: s.platform_account_id, business_date: s.business_date,
    source_currency: s.source_currency, source_timezone: s.source_timezone, reporting_time_basis: s.reporting_time_basis,
    fact_family: family, conversion_scope: "normal", unit_kind: "product_unit"};
  return reviewSalesRoleCohort({cohort, rows: checked.rows.map(sale => {
    const row = sale.raw_row, p = sale.provider_product_key;
    return {cohort, native_identity: {campaign_id: sale.campaign_id, ad_group_id: family === "pmax_cart_data_product_sales_daily" ? null : row.adGroup?.id ?? null,
      merchant_id: p.merchant_id, feed_label: p.feed_label, language: family === "pmax_cart_data_product_sales_daily" ? row.segments?.productLanguage ?? null : null,
      advertised_item_id: p.advertised_item_id, sold_item_id: p.sold_item_id},
    source_product_id: p.sold_item_id, sales_role: sale.sales_role, metrics: {quantity: sale.raw_metrics.units_sold, value: sale.raw_metrics.revenue_micros, ...sale.raw_metrics},
    source_reference: {family, native_reference: stableJson(sale.source_reference)}, source_payload: row, observed: sale};
  })});
}
