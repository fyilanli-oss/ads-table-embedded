import {MetaGraphError} from "./meta-graph.server.js";

function identifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 8192
    && value === value.trim() ? value : null;
}

function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value
    ? value : null;
}

function nativeKey(row, accountId, window) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const date = day(row.date_start);
  const adId = identifier(row.ad_id);
  if (row.account_id !== accountId || !adId || !date || row.date_stop !== date
    || date < window.start || date > window.end) return null;
  return {account_id: accountId, ad_id: adId, business_date: date};
}

const keyString = key => JSON.stringify([key.account_id, key.ad_id, key.business_date]);

// Pure references between the two fully collected native families, not a Dataset
// join/publication or proof of product semantics. Scope must come from the runtime's
// authenticated installation and connected account, never from a client request.
export function buildMetaSourceLinks({scope, dateWindow, channelRows, productRows}) {
  const accountMatch = /^act_([0-9]+)$/.exec(scope?.reporting_account_id ?? "");
  if (!identifier(scope?.workspace_id) || !identifier(scope?.connection_id)
    || !Number.isSafeInteger(scope?.install_generation) || scope.install_generation < 1
    || !accountMatch || !day(dateWindow?.start) || !day(dateWindow?.end)
    || dateWindow.start > dateWindow.end || !Array.isArray(channelRows) || !Array.isArray(productRows)) {
    throw new MetaGraphError("META_SOURCE_LINK_INPUT_INVALID", "Meta source link context is invalid");
  }
  const index = new Map();
  channelRows.forEach((row, sourceIndex) => {
    const key = nativeKey(row, accountMatch[1], dateWindow);
    if (!key) return;
    const id = keyString(key);
    const candidates = index.get(id) ?? [];
    candidates.push(sourceIndex);
    index.set(id, candidates);
  });
  const links = productRows.map((row, productRowIndex) => {
    const key = nativeKey(row, accountMatch[1], dateWindow);
    const candidates = key ? index.get(keyString(key)) ?? [] : [];
    let state = "unresolved";
    let reason = "native_account_ad_or_daily_date_missing_invalid_or_outside_scope";
    let pdRowIndex = null;
    if (key) {
      if (candidates.length > 1) {
        state = "ambiguous";
        reason = "multiple_pd_rows_for_native_ad_day";
      } else if (!identifier(row.product_id) || !identifier(row.campaign_id) || !identifier(row.adset_id)) {
        reason = "product_or_hierarchy_identity_missing";
      } else if (candidates.length === 0) {
        reason = "pd_row_not_observed";
      } else {
        const parent = channelRows[candidates[0]];
        if (!identifier(parent.campaign_id) || !identifier(parent.adset_id)) {
          reason = "pd_hierarchy_identity_missing";
        } else if (parent.campaign_id !== row.campaign_id || parent.adset_id !== row.adset_id) {
          state = "conflicting";
          reason = "native_hierarchy_conflict";
        } else {
          state = "exact_native_ad_reference";
          reason = "same_account_ad_day_and_hierarchy";
          pdRowIndex = candidates[0];
        }
      }
    }
    return Object.freeze({
      product_row_index: productRowIndex,
      pd_row_index: pdRowIndex,
      state,
      reason,
      channel_type: "ad",
      referenced_pd_ad_id: pdRowIndex === null ? null : key.ad_id,
      native_key: key ? Object.freeze({...key,
        campaign_id: identifier(row.campaign_id), adset_id: identifier(row.adset_id)}) : null,
      provider_product_id: identifier(row?.product_id),
      shopify_identity_state: "unresolved_mapping_pending",
    });
  });
  return Object.freeze({
    version: "1.0.0",
    scope: Object.freeze({workspace_id: scope.workspace_id, install_generation: scope.install_generation,
      connection_id: scope.connection_id, reporting_account_id: scope.reporting_account_id}),
    date_window: Object.freeze({start: dateWindow.start, end: dateWindow.end}),
    pd_fact_family: "ad_channel_daily_insights",
    product_fact_family: "ad_product_breakdown_daily_insights",
    product_links: Object.freeze(links),
    publishable: false,
  });
}
