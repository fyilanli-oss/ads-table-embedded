import {GoogleReportingError} from "./google-reporting.server.js";

const text = value => typeof value === "string" && value.length > 0 && value.length <= 8192
  && value === value.trim() ? value : null;
const entityId = value => typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? value : null;
function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value ? value : null;
}
function key(row, scope, window) {
  const date = day(row?.segments?.date);
  if (row?.customer?.id !== scope.reporting_account_id || row?.campaign?.advertisingChannelType !== "SHOPPING"
    || !entityId(row?.campaign?.id) || !entityId(row?.adGroup?.id) || !date
    || date < window.start || date > window.end) return null;
  return {account_id: row.customer.id, campaign_id: row.campaign.id,
    ad_group_id: row.adGroup.id, business_date: date};
}
const keyString = value => JSON.stringify([value.account_id, value.campaign_id, value.ad_group_id, value.business_date]);

// A native reference only. The caller is the authenticated authority runtime after
// complete pagination. No product metrics, role or Shopify identity are inferred.
export function buildGoogleShoppingSourceLinks({scope, dateWindow, pdRows, productRows, saleRows}) {
  if (!text(scope?.workspace_id) || !text(scope?.connection_id) || !entityId(scope?.reporting_account_id)
    || !Number.isSafeInteger(scope?.install_generation) || scope.install_generation < 1
    || !day(dateWindow?.start) || !day(dateWindow?.end) || dateWindow.start > dateWindow.end
    || !Array.isArray(pdRows) || !Array.isArray(productRows) || !Array.isArray(saleRows)) {
    throw new GoogleReportingError("GOOGLE_SOURCE_LINK_INPUT_INVALID", "Google source link context is invalid");
  }
  const index = new Map();
  pdRows.forEach((row, position) => {
    const native = key(row, scope, dateWindow);
    if (!native) return;
    const id = keyString(native);
    const candidates = index.get(id) ?? [];
    candidates.push(position);
    index.set(id, candidates);
  });
  function links(rows, sales) {
    return Object.freeze(rows.map((row, sourceRowIndex) => {
      const native = key(row, scope, dateWindow);
      const candidates = native ? index.get(keyString(native)) ?? [] : [];
      const itemId = text(row?.segments?.productItemId);
      const soldId = sales ? text(row?.segments?.productSoldItemId) : null;
      let state = "unresolved";
      let reason = "native_account_campaign_ad_group_or_day_missing_invalid_or_outside_scope";
      let pdRowIndex = null;
      if (row?.campaign?.advertisingChannelType === "PERFORMANCE_MAX") {
        reason = "pmax_asset_group_reference_pending_item_10_11";
      } else if (row?.campaign?.advertisingChannelType === "SEARCH") {
        reason = "search_rows_require_search_source_entrypoint";
      } else if (native) {
        if (candidates.length > 1) {
          state = "ambiguous";
          reason = "multiple_pd_rows_for_native_ad_group_day";
        } else if (!(sales ? soldId : itemId)) {
          reason = "native_product_identity_missing";
        } else if (candidates.length === 0) {
          reason = "pd_row_not_observed";
        } else {
          state = "exact_native_ad_group_reference";
          reason = "same_account_campaign_ad_group_and_day";
          pdRowIndex = candidates[0];
        }
      }
      return Object.freeze({
        source_row_index: sourceRowIndex,
        pd_row_index: pdRowIndex,
        state, reason,
        native_leaf_key: native ? Object.freeze(native) : null,
        observed_context: Object.freeze({account_id: text(row?.customer?.id), campaign_id: text(row?.campaign?.id),
          campaign_type: text(row?.campaign?.advertisingChannelType), ad_group_id: text(row?.adGroup?.id),
          business_date: text(row?.segments?.date)}),
        provider_product_key: Object.freeze({merchant_id: text(row?.segments?.productMerchantId),
          feed_label: text(row?.segments?.productFeedLabel), advertised_item_id: itemId, sold_item_id: soldId}),
        shopify_identity_state: "unresolved_mapping_pending",
      });
    }));
  }
  return Object.freeze({
    version: "1.0.0",
    provider: "google_ads",
    scope: Object.freeze({workspace_id: scope.workspace_id, install_generation: scope.install_generation,
      connection_id: scope.connection_id, reporting_account_id: scope.reporting_account_id}),
    date_window: Object.freeze({start: dateWindow.start, end: dateWindow.end}),
    pd_fact_family: "ad_group_channel_daily",
    product_performance_fact_family: "shopping_product_daily",
    product_sales_fact_family: "shopping_cart_data_product_sales_daily",
    product_performance_links: links(productRows, false),
    product_sales_links: links(saleRows, true),
    publishable: false,
  });
}

// Search PD stays at Ad grain. Cart sales establish an independent native Ad Group
// Channel; matching child Ads are context only, never recipients of product sales.
export function buildGoogleSearchSourceLinks({scope, dateWindow, pdRows, saleRows}) {
  if (!text(scope?.workspace_id) || !text(scope?.connection_id) || !entityId(scope?.reporting_account_id)
    || !Number.isSafeInteger(scope?.install_generation) || scope.install_generation < 1
    || !day(dateWindow?.start) || !day(dateWindow?.end) || dateWindow.start > dateWindow.end
    || !Array.isArray(pdRows) || !Array.isArray(saleRows)) {
    throw new GoogleReportingError("GOOGLE_SOURCE_LINK_INPUT_INVALID", "Google source link context is invalid");
  }
  function searchKey(row) {
    const date = day(row?.segments?.date);
    if (row?.customer?.id !== scope.reporting_account_id || row?.campaign?.advertisingChannelType !== "SEARCH"
      || !entityId(row?.campaign?.id) || !entityId(row?.adGroup?.id) || !date
      || date < dateWindow.start || date > dateWindow.end) return null;
    return {account_id: row.customer.id, campaign_id: row.campaign.id,
      ad_group_id: row.adGroup.id, business_date: date};
  }
  const parents = new Map();
  pdRows.forEach((row, sourceRowIndex) => {
    const native = searchKey(row);
    const adId = entityId(row?.adGroupAd?.ad?.id);
    if (!native || !adId) return;
    const id = keyString(native);
    const children = parents.get(id) ?? [];
    children.push({ad_id: adId, source_row_index: sourceRowIndex});
    parents.set(id, children);
  });
  const links = saleRows.map((row, sourceRowIndex) => {
    const native = searchKey(row);
    const soldItemId = text(row?.segments?.productSoldItemId);
    const children = native ? parents.get(keyString(native)) ?? [] : [];
    const duplicateAds = new Set(children.map(child => child.ad_id)).size !== children.length;
    return Object.freeze({
      source_row_index: sourceRowIndex,
      channel_type: "ad_group",
      channel_state: native && soldItemId ? "exact_native_ad_group_reference" : "unresolved",
      native_leaf_key: native ? Object.freeze(native) : null,
      observed_context: Object.freeze({account_id: text(row?.customer?.id), campaign_id: text(row?.campaign?.id),
        campaign_type: text(row?.campaign?.advertisingChannelType), ad_group_id: text(row?.adGroup?.id),
        business_date: text(row?.segments?.date)}),
      provider_product_key: Object.freeze({merchant_id: text(row?.segments?.productMerchantId),
        feed_label: text(row?.segments?.productFeedLabel), advertised_item_id: null,
        sold_item_id: soldItemId}),
      pd_parent_context: Object.freeze({
        state: duplicateAds ? "ambiguous_pd_ad_rows" : children.length ? "observed" : "not_observed",
        ad_row_indexes: Object.freeze(children.map(child => child.source_row_index)),
        product_sales_attributed_to_these_ads: false,
      }),
      shopify_identity_state: "unresolved_mapping_pending",
    });
  });
  return Object.freeze({version: "1.0.0", provider: "google_ads",
    scope: Object.freeze({workspace_id: scope.workspace_id, install_generation: scope.install_generation,
      connection_id: scope.connection_id, reporting_account_id: scope.reporting_account_id}),
    date_window: Object.freeze({start: dateWindow.start, end: dateWindow.end}),
    pd_fact_family: "search_ad_channel_daily", pd_grain: "ad", cpd_channel_grain: "ad_group",
    product_sales_fact_family: "search_cart_data_product_sales_daily",
    product_sales_links: Object.freeze(links),
    product_metrics_from_pd_ads: false, publishable: false});
}
