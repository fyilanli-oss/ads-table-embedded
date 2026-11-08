import {emptyDatasetStorageRow, datasetMetricNames, DATASET_EXTENSION_VERSION, datasetNativeKey} from "../database/dataset-storage.server.js";
import {isStoredDatasetSource} from "../database/dataset-source-reader.server.js";
import {canonicalSourceJson} from "../database/source-evidence-store.server.js";
import {sourceText, sourceDecimal, addSourceDecimals, positiveSourceDecimal, sourceScalar} from "../database/dataset-source-values.server.js";
import {classifyGoogleCartDataRole, buildGoogleReportingQueries, GOOGLE_REPORTING_QUERY_FAMILIES} from "./google-reporting.server.js";
import {klaviyoBusinessDayTimeframe} from "./klaviyo-reporting.server.js";

export const STORED_DATASET_PROJECTION_VERSION = "eo05b-stored-native-v1";
const fail = code => {throw Error("DATASET_PROJECTION_" + code);};
const metric = (row, name, value) => {
  row[name] = value; row.metric_support[name] = "supported"; row.observation_state[name] = value === null ? "missing" : "present";
};
const refs = pages => [...new Map(pages.map(p => [p.ref.batch_id + ":" + p.ref.page_id, p.ref])).values()];
export function baseStoredFact(bundle, dataset, table, pages, breakdowns = {}) {
  const row = emptyDatasetStorageRow(table);
  Object.assign(row, {business_date: bundle.scope.window.from, source_timezone: dataset.source.timezone,
    reporting_scope: {time_basis: "native_query_business_date", conversion_scope: "normal", units: "native_count_and_source_currency", attribution: "native_query_parameters", native_breakdowns: breakdowns},
    source_identity: null, metric_support: {}, observation_state: {}, metric_extensions: {}, extension_schema_version: DATASET_EXTENSION_VERSION,
    provenance: {projection_version: STORED_DATASET_PROJECTION_VERSION, sources: refs(pages), source_context: dataset.sourceContext},
    source_batch_id: dataset.receipt.batchId, source_completeness: dataset.receipt.sourceState,
    source_currency: dataset.source.currency, target_currency: null, fx_rate_id: null, fx_state: "missing", fx_engine_version: null});
  for (const name of datasetMetricNames(table)) metric(row, name, null);
  if (table !== "pd_facts") Object.assign(row, {channel_type: null, channel_id: null, channel_resolution: "unresolved", product_context: {}});
  if (table === "cpd_product_sales_facts") Object.assign(row, {sales_role: "Unclassified", sales_role_evidence: {}, native_sales_metrics: {}});
  return row;
}
export {metric as setStoredMetric};
function fields(record) {
  if (!record || !Array.isArray(record.fields)) fail("FIELDS_INVALID");
  const out = {};
  for (const entry of record.fields) {
    if (!entry || typeof entry.field !== "string" || Object.hasOwn(out, entry.field)) fail("FIELDS_INVALID");
    out[entry.field] = entry.value;
  }
  return out;
}
export {fields as storedFieldMap};
function googleRecords(dataset, families, day, account) {
  const query = buildGoogleReportingQueries({dateWindow: {start: day, end: day}}), found = new Set(), result = [];
  for (const page of dataset.pages) {
    if (!families.includes(page.family)) fail("FAMILY_INVALID");
    found.add(page.family);
    if (page.payload.query !== query[page.family] || !Array.isArray(page.payload.selectedFields)
      || page.payload.selectedFields.join() !== /^SELECT\s+([\s\S]+?)\s+FROM\s/i.exec(query[page.family])[1].split(",").map(x => x.trim()).join()) fail("QUERY_CHANGED");
    for (const record of page.payload.records) {
      const f = fields(record);
      if (Object.keys(f).some(k => !page.payload.selectedFields.includes(k)) || sourceText(f["customer.id"]) !== account
        || f["segments.date"] !== undefined && f["segments.date"] !== day) fail("NATIVE_SCOPE_INVALID");
      result.push({f, page, family: page.family, record});
    }
  }
  if (families.some(f => !found.has(f))) fail("FAMILY_MISSING");
  return result;
}
const get = (f, key, nullable = false) => sourceText(f[key], {nullable});
function googleLeaf(f, family) {
  const shopping = family.startsWith("ad_group_") || family.startsWith("shopping_ad_group_"), pmax = family.startsWith("pmax_asset_group_");
  const type = shopping ? "ad_group" : pmax ? "asset_group" : "ad";
  if (f["campaign.advertising_channel_type"] !== (shopping ? "SHOPPING" : pmax ? "PERFORMANCE_MAX" : "SEARCH")) fail("NATIVE_SCOPE_INVALID");
  const entityId = get(f, shopping ? "ad_group.id" : pmax ? "asset_group.id" : "ad_group_ad.ad.id");
  return {entity_type: type, entity_id: entityId, campaign_id: get(f, "campaign.id"),
    ...!pmax ? {ad_group_id: get(f, "ad_group.id")} : {asset_group_id: entityId}};
}
function googleProductIdentity(f, sales) {
  const native = {campaign_id: get(f, "campaign.id"), merchant_id: get(f, "segments.product_merchant_id"), feed_label: get(f, "segments.product_feed_label"),
    language: get(f, "segments.product_language", true)};
  if (f["ad_group.id"] !== undefined) native.ad_group_id = get(f, "ad_group.id");
  if (sales) {native.sold_product_id = get(f, "segments.product_sold_item_id"); native.advertised_product_id = get(f, "segments.product_item_id", true);}
  else native.product_id = get(f, "segments.product_item_id");
  return native;
}
function googleSource(bundle) {
  const account = bundle.datasets.find(d => d.dataset === "account_performance"), products = bundle.datasets.find(d => d.dataset === "product_performance");
  if (!account || !products) fail("DATASET_MISSING");
  const day = bundle.scope.window.from, accountRows = googleRecords(account, GOOGLE_REPORTING_QUERY_FAMILIES.slice(0, 9), day, bundle.owner.accountId);
  const productRows = googleRecords(products, GOOGLE_REPORTING_QUERY_FAMILIES.slice(9), day, bundle.owner.accountId);
  const identity = accountRows.filter(r => r.family === "account_identity");
  if (identity.length !== 1 || get(identity[0].f, "customer.currency_code") !== account.source.currency
    || get(identity[0].f, "customer.time_zone") !== account.source.timezone) fail("ACCOUNT_CONTEXT_INVALID");
  const contextPage = identity[0].page, groups = new Map(), output = [], auxiliary = new Set();
  for (const item of accountRows) {
    const conversion = item.family.endsWith("conversion_action_daily") && item.family !== "conversion_action_daily";
    const base = ["ad_group_channel_daily", "search_ad_channel_daily", "pmax_asset_group_channel_daily"].includes(item.family);
    if (!conversion && !base) {auxiliary.add(item.family); continue;}
    const native = googleLeaf(item.f, item.family), key = canonicalSourceJson(native);
    let g = groups.get(key);
    if (!g) {
      const row = baseStoredFact(bundle, account, "pd_facts", [item.page, contextPage]);
      Object.assign(row, {entity_type: native.entity_type, entity_id: native.entity_id,
        entity_name: get(item.f, native.entity_type === "ad_group" ? "ad_group.name" : native.entity_type === "asset_group" ? "asset_group.name" : "ad_group_ad.ad.name", true),
        root_entity_type: "campaign", root_entity_id: native.campaign_id, root_entity_name: get(item.f, "campaign.name", true),
        parent_entity_type: native.entity_type === "ad" ? "ad_group" : "campaign", parent_entity_id: native.entity_type === "ad" ? native.ad_group_id : native.campaign_id,
        parent_entity_name: get(item.f, native.entity_type === "ad" ? "ad_group.name" : "campaign.name", true), campaign_type: get(item.f, "campaign.advertising_channel_type"),
        source_identity: {kind: "daily", namespace: "entity_performance", native}});
      g = {row, base: null, actions: new Map()}; groups.set(key, g);
    }
    const r = g.row;
    r.provenance.sources = refs([...r.provenance.sources.map(ref => ({ref})), item.page]);
    if (base) {
      const fingerprint = canonicalSourceJson(item.record);
      if (g.base !== null && g.base !== fingerprint) fail("DUPLICATE_CONFLICT");
      if (g.base !== null) continue;
      g.base = fingerprint;
      metric(r, "impression", sourceDecimal(item.f["metrics.impressions"])); metric(r, "ad_click", sourceDecimal(item.f["metrics.clicks"]));
      metric(r, "spend_value", sourceDecimal(item.f["metrics.cost_micros"], {micros: true}));
    } else {
      const action = get(item.f, "segments.conversion_action"), category = get(item.f, "segments.conversion_action_category");
      const names = {ADD_TO_CART: ["add_to_cart", "add_to_cart_value"], BEGIN_CHECKOUT: ["checkout", "checkout_value"], PURCHASE: ["purchase", "purchase_value"]}[category];
      if (!names) fail("CONVERSION_CATEGORY_INVALID");
      const fp = canonicalSourceJson(item.record);
      if (g.actions.has(action)) {if (g.actions.get(action) !== fp) fail("DUPLICATE_CONFLICT"); continue;} g.actions.set(action, fp);
      for (const [i, field] of ["metrics.conversions", "metrics.conversions_value"].entries()) {
        const n = sourceDecimal(item.f[field]); metric(r, names[i], addSourceDecimals(r[names[i]], n));
      }
    }
  }
  for (const g of groups.values()) output.push({table: "pd_facts", row: g.row});
  for (const item of productRows) {
    const performance = ["shopping_product_daily", "pmax_product_daily"].includes(item.family);
    const sale = ["shopping_cart_data_product_sales_daily", "search_cart_data_product_sales_daily", "pmax_cart_data_product_sales_daily"].includes(item.family);
    if (!performance && !sale) {auxiliary.add(item.family); continue;}
    const campaignType = item.family.startsWith("shopping_") ? "SHOPPING" : item.family.startsWith("search_") ? "SEARCH" : "PERFORMANCE_MAX";
    if (item.f["campaign.advertising_channel_type"] !== campaignType) fail("NATIVE_SCOPE_INVALID");
    const f = item.f, table = performance ? "cpd_product_performance_facts" : "cpd_product_sales_facts", native = googleProductIdentity(f, sale);
    const breakdowns = performance ? Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith("segments.product_")
      && !["segments.product_item_id", "segments.product_merchant_id", "segments.product_feed_label", "segments.product_language"].includes(k)).map(([k, v]) => [k, sourceScalar(v)])) : {};
    const r = baseStoredFact(bundle, products, table, [item.page, contextPage], breakdowns);
    if (account.receipt.sourceState === "partial") r.source_completeness = "partial";
    Object.assign(r, {root_entity_type: "campaign", root_entity_id: native.campaign_id, root_entity_name: get(f, "campaign.name", true),
      campaign_type: get(f, "campaign.advertising_channel_type"), product_context: {merchant_id: native.merchant_id, feed_label: native.feed_label, language: native.language},
      source_identity: {kind: "daily", namespace: performance ? "product_performance" : "product_sales", native}});
    if (native.ad_group_id && r.campaign_type === "SHOPPING") Object.assign(r, {channel_type: "ad_group", channel_id: native.ad_group_id, channel_resolution: "verified"});
    if (performance) {
      r.native_product_id = native.product_id;
      metric(r, "impression", sourceDecimal(f["metrics.impressions"])); metric(r, "click", sourceDecimal(f["metrics.clicks"]));
      metric(r, "spend_value", sourceDecimal(f["metrics.cost_micros"], {micros: true}));
    } else {
      const quantity = sourceDecimal(f["metrics.units_sold"]), value = sourceDecimal(f["metrics.revenue_micros"], {micros: true});
      if (quantity === null || quantity === "0") fail("SALE_QUANTITY_UNPROVEN");
      const search = item.family === "search_cart_data_product_sales_daily";
      const leadEvidence = !search && ["metrics.lead_units_sold", "metrics.lead_revenue_micros"].some(k => positiveSourceDecimal(f[k]));
      const crossSellEvidence = !search && ["metrics.cross_sell_units_sold", "metrics.cross_sell_revenue_micros"].some(k => positiveSourceDecimal(f[k]));
      const role = classifyGoogleCartDataRole({advertisedItemId: native.advertised_product_id, soldItemId: native.sold_product_id,
        normalObserved: quantity !== null || value !== null, leadEvidence, crossSellEvidence});
      Object.assign(r, {native_sold_product_id: native.sold_product_id, native_advertised_product_id: native.advertised_product_id,
        sales_role: role, sales_role_evidence: {rule: "existing_google_cart_data_role", advertised: native.advertised_product_id, sold: native.sold_product_id, leadEvidence, crossSellEvidence},
        native_sales_metrics: Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith("metrics.")).map(([k, v]) => [k, sourceDecimal(v)]))});
      metric(r, "sales_quantity", quantity); metric(r, "sales_value", value);
    }
    output.push({table, row: r});
  }
  return {rows: output, holds: [], auxiliary: [...auxiliary]};
}

export function validateStoredProjectionScope(bundle) {
  if (!isStoredDatasetSource(bundle)) fail("VERIFIED_SOURCE_REQUIRED");
  for (const dataset of bundle.datasets) {
    const start = Date.parse(klaviyoBusinessDayTimeframe({businessDate: bundle.scope.window.from, timeZone: dataset.source.timezone}).start);
    if (!Number.isFinite(start) || start < dataset.source.eligibleFromMs) fail("PRE_CONNECTION_HOURS");
  }
}
export function finalizeStoredProjection(bundle, result) {
  const unique = new Map();
  for (const item of result.rows) {
    const key = item.table + ":" + datasetNativeKey({owner: bundle.owner, ...item}).hash;
    const semantic = canonicalSourceJson({...item.row, provenance: null});
    if (unique.has(key)) {
      const old = unique.get(key); if (old.semantic !== semantic) fail("DUPLICATE_CONFLICT");
      old.item.row.provenance.sources = refs([...old.item.row.provenance.sources, ...item.row.provenance.sources].map(ref => ({ref})));
    } else unique.set(key, {item, semantic});
  }
  return {...result, rows: [...unique.values()].map(x => x.item), sourceVerified: true, authorizesActivation: false, consumerReceipt: false};
}
export function projectStoredGoogleDataset(bundle) {
  validateStoredProjectionScope(bundle); if (bundle.owner.provider !== "google_ads") fail("PROVIDER_MISMATCH");
  return finalizeStoredProjection(bundle, googleSource(bundle));
}
