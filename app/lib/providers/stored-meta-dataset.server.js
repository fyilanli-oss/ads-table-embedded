import {META_PD_METRIC_SOURCES, META_AD_CHANNEL_INSIGHTS_FIELDS, META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS} from "./meta-reporting.server.js";
import {baseStoredFact, setStoredMetric, storedFieldMap, validateStoredProjectionScope, finalizeStoredProjection} from "./stored-dataset-projection.server.js";
import {sourceText, sourceDecimal} from "../database/dataset-source-values.server.js";

const fail = code => {throw Error("DATASET_PROJECTION_" + code);};
function value(f, spec) {
  const raw = f[spec.field];
  if (!spec.action_type) return sourceDecimal(raw);
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) fail("ACTION_SHAPE_INVALID");
  const selected = raw.filter(a => a?.action_type === spec.action_type);
  if (selected.length > 1) fail("ACTION_CONFLICT");
  return selected.length ? sourceDecimal(selected[0].value) : null;
}
export function projectStoredMetaDataset(bundle) {
  validateStoredProjectionScope(bundle); if (bundle.owner.provider !== "meta") fail("PROVIDER_MISMATCH");
  if (!bundle.datasets.some(d => d.dataset === "account_performance") || !bundle.datasets.some(d => d.dataset === "product_performance")) fail("DATASET_MISSING");
  const rows = [], holds = [], auxiliary = [];
  for (const dataset of bundle.datasets) {
    const product = dataset.dataset === "product_performance", family = product ? "ad_product_breakdown_daily_insights" : "ad_channel_daily_insights";
    if (!["account_performance", "product_performance"].includes(dataset.dataset)) fail("FAMILY_INVALID");
    let found = false, permission = false;
    for (const page of dataset.pages) {
      if (page.family === "meta_permission_check") {permission = true; auxiliary.push(page.family); continue;}
      if (page.family !== family) fail("FAMILY_INVALID"); found = true;
      const selected = product ? [...META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS, "product_id"] : META_AD_CHANNEL_INSIGHTS_FIELDS;
      if (page.payload.selectedFields?.join() !== selected.join() || page.payload.request?.level !== "ad" || page.payload.request?.timeIncrement !== 1
        || page.payload.request?.window?.from !== bundle.scope.window.from || page.payload.request?.window?.to !== bundle.scope.window.to) fail("QUERY_CHANGED");
      for (const record of page.payload.records) {
        const f = storedFieldMap(record);
        if (Object.keys(f).some(k => !selected.includes(k)) || f.account_id !== bundle.owner.accountId.slice(4)
          || f.date_start !== bundle.scope.window.from || f.date_stop !== bundle.scope.window.to) fail("NATIVE_SCOPE_INVALID");
        const ad = sourceText(f.ad_id), adset = sourceText(f.adset_id), campaign = sourceText(f.campaign_id);
        const table = product ? "cpd_product_performance_facts" : "pd_facts", r = baseStoredFact(bundle, dataset, table, [page], {adset_id: adset});
        Object.assign(r, {root_entity_type: "campaign", root_entity_id: campaign, root_entity_name: sourceText(f.campaign_name, {nullable: true}),
          parent_entity_type: "adset", parent_entity_id: adset, parent_entity_name: sourceText(f.adset_name, {nullable: true}),
          source_identity: {kind: "daily", namespace: product ? "product_performance" : "entity_performance", native: {entity_type: "ad", entity_id: ad, campaign_id: campaign}}});
        if (product) {
          const productId = sourceText(f.product_id);
          r.native_product_id = productId; r.source_identity.native.product_id = productId;
          Object.assign(r, {channel_type: "ad", channel_id: ad, channel_resolution: "verified", product_context: {product_id: productId}});
          setStoredMetric(r, "impression", sourceDecimal(f.impressions)); setStoredMetric(r, "click", sourceDecimal(f.clicks)); setStoredMetric(r, "spend_value", sourceDecimal(f.spend));
          // The four native conversion fields stay in the encrypted source. Step18
          // has not established their sale/role meaning; no sales fact is invented.
          if (["converted_product_quantity", "converted_product_value", "converted_promoted_product_quantity", "converted_promoted_product_value"].some(k => f[k] !== undefined))
            holds.push({reason: "meta_sales_semantics_unproven", sourcePageId: page.ref.page_id});
        } else {
          Object.assign(r, {entity_type: "ad", entity_id: ad, entity_name: sourceText(f.ad_name, {nullable: true})});
          for (const [name, spec] of Object.entries(META_PD_METRIC_SOURCES)) setStoredMetric(r, name, value(f, spec));
        }
        rows.push({table, row: r});
      }
    }
    if (!found || !permission) fail("FAMILY_MISSING");
  }
  return finalizeStoredProjection(bundle, {rows, holds, auxiliary: [...new Set(auxiliary)]});
}
