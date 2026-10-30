import {GoogleReportingError, normalizeGoogleCartDataSale, resolvePmaxSaleChannel} from "./google-reporting.server.js";
import {stableJson} from "./common-adapter.server.js";

const text = v => typeof v === "string" && v.length > 0 && v === v.trim();
const id = v => typeof v === "string" && /^[1-9][0-9]*$/.test(v);
const day = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const copy = v => v === null || typeof v !== "object" ? v : Object.freeze(Array.isArray(v) ? v.map(copy)
  : Object.fromEntries(Object.entries(v).map(([k, value]) => [k, copy(value)])));
const fields = ["workspace_id", "install_generation", "connection_id", "reporting_account_id"];
const instant = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(v)
  && Number.isFinite(Date.parse(v));
const productKey = r => [r.customer?.id, r.campaign?.id, r.segments?.date, r.segments?.productMerchantId,
  r.segments?.productFeedLabel, r.segments?.productLanguage, r.segments?.productItemId];
function fullBusinessDay(window, date, timezone) {
  if (!window || !instant(window.start) || !instant(window.end)) return false;
  const start = Date.parse(window.start), end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return false;
  const format = new Intl.DateTimeFormat("en-CA", {timeZone: timezone, hourCycle: "h23", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"});
  const parts = instant => Object.fromEntries(format.formatToParts(instant).map(p => [p.type, p.value]));
  const a = parts(start), b = parts(end), next = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
  return `${a.year}-${a.month}-${a.day}` === date && `${b.year}-${b.month}-${b.day}` === next
    && [a, b].every(p => p.hour === "00" && p.minute === "00" && p.second === "00")
    && start % 1000 === 0 && end % 1000 === 0;
}

// Explicit server composition input, not a native proof registrar. The historical
// evidence producer/storage remains step22. A current listing read never supplies
// a validity interval and is deliberately insufficient for past product facts.
export function buildGooglePmaxSourceLinks({scope, dateWindow, timezone, pdRows, productRows, saleRows,
  listingEvidence = null} = {}) {
  if (!scope || !text(scope.workspace_id) || !text(scope.connection_id) || !id(scope.reporting_account_id)
    || !Number.isSafeInteger(scope.install_generation) || scope.install_generation < 1
    || !day(dateWindow?.start) || !day(dateWindow?.end) || dateWindow.start !== dateWindow.end
    || !text(timezone) || ![pdRows, productRows, saleRows].every(v => Array.isArray(v) && v.length <= 20_000)) {
    throw new GoogleReportingError("GOOGLE_PMAX_SOURCE_INPUT_INVALID", "Invalid PMax source context");
  }
  try {new Intl.DateTimeFormat("en", {timeZone: timezone});}
  catch {throw new GoogleReportingError("GOOGLE_PMAX_SOURCE_INPUT_INVALID", "Invalid PMax timezone");}
  const valid = row => row?.customer?.id === scope.reporting_account_id && id(row.campaign?.id)
    && row.campaign.advertisingChannelType === "PERFORMANCE_MAX" && row.segments?.date === dateWindow.start;
  let checks = 0;
  const tick = () => {if (++checks > 1_000_000) throw new GoogleReportingError("GOOGLE_PMAX_SOURCE_WORK_BOUND_EXCEEDED", "PMax membership work bound exceeded");};
  const pd = new Map(), products = new Map();
  for (const [index, row] of pdRows.entries()) {
    if (!valid(row) || !id(row.assetGroup?.id)) continue;
    const key = stableJson([row.campaign.id, row.assetGroup.id]);
    pd.set(key, [...(pd.get(key) ?? []), index]);
  }
  for (const row of productRows) {
    if (!valid(row)) continue;
    const key = stableJson(productKey(row));
    products.set(key, [...(products.get(key) ?? []), row]);
  }
  const evidenceBound = listingEvidence?.complete === true && Array.isArray(listingEvidence.snapshots)
    && listingEvidence.snapshots.length <= 20_000 && listingEvidence.timezone === timezone
    && listingEvidence.snapshots.every(s => s && id(s.campaign_id))
    && fields.every(k => scope[k] === listingEvidence.scope?.[k]);
  const window = listingEvidence?.businessWindow;
  const windowValid = evidenceBound && window?.business_date === dateWindow.start && window.timezone === timezone
    && fullBusinessDay(window, dateWindow.start, timezone);
  function link(row, index, sales) {
    tick();
    const result = {source_row_index: index, pd_row_index: null, channel_type: "Unclassified Channel", channel_id: null,
      state: "unresolved", reason: "native_account_campaign_or_day_invalid", candidate_asset_group_ids: [],
      provider_product_key: {merchant_id: row?.segments?.productMerchantId ?? null,
        feed_label: row?.segments?.productFeedLabel ?? null, language: row?.segments?.productLanguage ?? null,
        advertised_item_id: row?.segments?.productItemId ?? null, sold_item_id: sales ? row?.segments?.productSoldItemId ?? null : null},
      shopify_identity_state: "unresolved_mapping_pending", sales_role: null, native_leaf_key: null};
    if (!valid(row)) return result;
    const sale = sales ? normalizeGoogleCartDataSale(row) : {campaign_type: "PERFORMANCE_MAX", campaign_id: row.campaign.id,
      business_date: row.segments.date, provider_product_key: {advertised_item_id: row.segments.productItemId}};
    if (sales) result.sales_role = sale.sales_role;
    if (!productKey(row).every(text)) return {...result, reason: "native_product_namespace_incomplete"};
    if (!windowValid) return {...result, reason: "temporally_valid_membership_evidence_required"};
    const snapshots = listingEvidence.snapshots.filter(s => {tick(); return s.campaign_id === row.campaign.id;});
    if (!snapshots.length) return {...result, reason: "campaign_membership_evidence_missing"};
    if (pdRows.some(p => {tick(); return valid(p) && p.campaign.id === row.campaign.id && id(p.assetGroup?.id)
      && !snapshots.some(s => {tick(); return s.asset_group_id === p.assetGroup.id;});})) {
      return {...result, reason: "observed_asset_group_missing_from_membership_inventory"};
    }
    // Every candidate in this campaign must have the same product namespace.
    // A mismatched/unknown candidate is not silently discarded to manufacture uniqueness.
    if (snapshots.some(s => {tick(); return s.account_id !== row.customer.id || s.merchant_id !== row.segments.productMerchantId
      || s.feed_label !== row.segments.productFeedLabel || s.language !== row.segments.productLanguage
      || s.timezone !== timezone || !id(s.asset_group_id) || !text(s.tree_hash) || !Array.isArray(s.rows)
      || s.rows.length > 20_000 || !s.rows.length
      || !instant(s.valid_from) || !instant(s.valid_to)
      || Date.parse(s.valid_from) > Date.parse(window.start) || Date.parse(s.valid_to) < Date.parse(window.end);})) {
      return {...result, reason: "campaign_membership_scope_or_period_incomplete"};
    }
    const matches = products.get(stableJson(productKey(row))) ?? [];
    if (matches.length !== 1) return {...result, reason: "advertised_product_context_missing_or_ambiguous"};
    const native = matches[0], product = {item_id: native.segments.productItemId, brand: native.segments.productBrand};
    // Unknown dimensions must not eliminate another potential Asset Group. More
    // dimensions can be enabled only with verified period-specific source attributes.
    if (snapshots.some(s => s.rows.some(r => {
      tick();
      const f = r?.assetGroupListingGroupFilter;
      if (r?.customer?.id !== row.customer.id || r.campaign?.id !== row.campaign.id
        || r.assetGroup?.id !== s.asset_group_id || f?.listingSource !== "SHOPPING"
        || !["UNIT_INCLUDED", "UNIT_EXCLUDED", "SUBDIVISION"].includes(f.type)) return true;
      if (f.type !== "UNIT_INCLUDED") return false;
      const dimensions = f.path?.dimensions;
      if (!Array.isArray(dimensions)) return true;
      if (!dimensions.length) return !!f.parentListingGroupFilter || !!f.caseValue;
      return dimensions.some(d => {tick(); return !d || Object.keys(d).length !== 1
        || (d.productItemId ? !text(d.productItemId.value)
          : d.productBrand ? !text(d.productBrand.value) || !text(product.brand) : true);});
    }))) return {...result, reason: "membership_dimension_or_source_not_verified"};
    const resolved = resolvePmaxSaleChannel({sale, advertisedProduct: product, businessWindow: window,
      listingEvidence: {complete: true, snapshots}});
    Object.assign(result, {channel_type: resolved.channel_type, channel_id: resolved.channel_id,
      reason: resolved.reason, candidate_asset_group_ids: resolved.candidate_asset_group_ids});
    if (resolved.resolution !== "exact") return result;
    const refs = pd.get(stableJson([row.campaign.id, resolved.channel_id])) ?? [];
    if (refs.length !== 1) return {...result, channel_type: "Unclassified Channel", channel_id: null,
      reason: refs.length ? "asset_group_PD_reference_ambiguous" : "asset_group_PD_reference_missing"};
    return {...result, pd_row_index: refs[0], state: "resolved_from_reviewed_membership",
      native_leaf_key: {account_id: row.customer.id, campaign_id: row.campaign.id, asset_group_id: resolved.channel_id,
        business_date: row.segments.date}, evidence: resolved.evidence};
  }
  return copy({provider: "google_ads", scope: Object.fromEntries(fields.map(k => [k, scope[k]])), date_window: dateWindow, timezone,
    pd_fact_family: "pmax_asset_group_channel_daily", product_performance_fact_family: "pmax_product_daily",
    product_sales_fact_family: "pmax_cart_data_product_sales_daily",
    product_performance_links: productRows.map((r, i) => link(r, i, false)),
    product_sales_links: saleRows.map((r, i) => link(r, i, true)),
    membership_provenance: "reviewed_server_input_not_native_verified_by_shape", metrics_allocated: false,
    sales_roles_changed: false, native_attribution_verified: false, publishable: false, persistable: false,
    historical_storage_or_loader_implemented: false});
}
