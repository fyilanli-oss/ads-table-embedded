import {MetaGraphError} from "./meta-graph.server.js";

export const META_NATIVE_PRODUCT_SALES_FIELDS = Object.freeze([
  "converted_product_quantity", "converted_product_value",
  "converted_promoted_product_quantity", "converted_promoted_product_value",
]);

function id(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 8192 && value === value.trim();
}
function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function positiveQuantity(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value !== "string" || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

// The evidence decoder must verify a SINGLE native sale relationship, not ad
// product-set membership. The four aggregated fields alone are not that proof.
export function normalizeMetaProductSale(row, evidence = null) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new MetaGraphError("META_PRODUCT_SALE_ROW_INVALID", "Meta product sale row is invalid");
  }
  const rawMetrics = {}, states = {};
  for (const field of META_NATIVE_PRODUCT_SALES_FIELDS) {
    rawMetrics[field] = Object.hasOwn(row, field) ? row[field] : null;
    states[field] = !Object.hasOwn(row, field) ? "absent" : row[field] === null ? "null"
      : Array.isArray(row[field]) && row[field].length === 0 ? "empty" : "present";
  }
  const result = (role, reason, accepted = false) => Object.freeze({
    provider: "meta", business_date: day(row.date_start) ? row.date_start : null,
    ad_id: id(row.ad_id) ? row.ad_id : null,
    provider_product_key: Object.freeze({source_product_id: id(row.product_id) ? row.product_id : null,
      advertised_item_id: accepted ? evidence.advertised_product_id : null,
      sold_item_id: accepted ? evidence.sold_product_id : null,
      catalog_id: accepted ? evidence.catalog_id : null,
      identity_namespace: accepted ? evidence.identity_namespace : null}),
    sales_role: role,
    sales_role_resolution: Object.freeze({state: accepted ? "verified_relation" : "unresolved",
      reason, source_reference: accepted ? evidence.source_reference : null}),
    raw_metrics: Object.freeze(rawMetrics), metric_observation: Object.freeze(states), raw_row: row,
  });
  if (!evidence || evidence.state === "pending") return result("Unclassified", "native_sale_relation_not_verified");
  if (evidence.state === "contradictory") return result("Unclassified", "native_sale_relation_conflicting");
  if (evidence.state !== "verified" || evidence.relation_scope !== "single_product_sale_relation") {
    return result("Unclassified", "single_sale_relation_required");
  }
  const key = evidence.row_identity;
  if (!id(row.account_id) || !id(row.ad_id) || !id(row.product_id) || !day(row.date_start)
    || row.date_stop !== row.date_start || key?.account_id !== row.account_id || key?.ad_id !== row.ad_id
    || key?.product_id !== row.product_id || key?.business_date !== row.date_start) {
    return result("Unclassified", "native_row_identity_mismatch");
  }
  if (!id(evidence.catalog_id) || !["catalog_product_id", "retailer_id"].includes(evidence.identity_namespace)
    || !id(evidence.source_reference) || !id(evidence.advertised_product_id) || !id(evidence.sold_product_id)) {
    return result("Unclassified", "product_identity_or_provenance_missing");
  }
  if (!positiveQuantity(evidence.sales_quantity)) return result("Unclassified", "positive_sale_quantity_not_verified");
  if (row.product_id !== evidence.advertised_product_id && row.product_id !== evidence.sold_product_id) {
    return result("Unclassified", "source_product_not_in_verified_relation");
  }
  return evidence.advertised_product_id === evidence.sold_product_id
    ? result("Advertised", "same_advertised_and_sold_product", true)
    : result("Cross-sell", "different_advertised_and_sold_product", true);
}

export function projectMetaProductSales({rows, evidenceRows = null}) {
  if (!Array.isArray(rows) || (evidenceRows !== null && (!Array.isArray(evidenceRows)
    || evidenceRows.length !== rows.length || rows.some((_, index) => !Object.hasOwn(evidenceRows, index))))) {
    throw new MetaGraphError("META_PRODUCT_SALE_EVIDENCE_INVALID", "Meta sale evidence must match source rows");
  }
  return Object.freeze({version: "1.0.0", source_family: "ad_product_breakdown_daily_insights",
    rows: Object.freeze(rows.map((row, sourceRowIndex) => Object.freeze({source_row_index: sourceRowIndex,
      ...normalizeMetaProductSale(row, evidenceRows?.[sourceRowIndex] ?? null)}))),
    additional_sales_facts_created: false, native_metric_semantics: "validation_pending",
    dataset_publishable: false, live_validation: false});
}
