import assert from "node:assert/strict";
import test from "node:test";
import {normalizeMetaProductSale, projectMetaProductSales, META_NATIVE_PRODUCT_SALES_FIELDS} from "../app/lib/providers/meta-sales-role.server.js";

// Synthetic verified-relation inputs test our policy, not Meta field semantics.
const native = productId => ({account_id: "123", ad_id: "ad-1", product_id: productId,
  date_start: "2026-10-26", date_stop: "2026-10-26", impressions: "100", spend: "20",
  converted_product_quantity: [{action_type: "purchase", value: "4"}],
  converted_product_value: [{action_type: "purchase", value: "400"}],
  converted_promoted_product_quantity: [{action_type: "purchase", value: "1"}],
  converted_promoted_product_value: [{action_type: "purchase", value: "100"}]});
const proof = (sourceId, soldId = sourceId) => ({state: "verified", relation_scope: "single_product_sale_relation",
  row_identity: {account_id: "123", ad_id: "ad-1", product_id: sourceId, business_date: "2026-10-26"},
  advertised_product_id: "A", sold_product_id: soldId, sales_quantity: "1", catalog_id: "catalog-1",
  identity_namespace: "retailer_id", source_reference: "synthetic:verified-relation"});

test("Meta classifies A as Advertised and B/C/D as Cross-sell using verified product relationships", () => {
  for (const sold of ["A", "B", "C", "D"]) {
    const result = normalizeMetaProductSale(native(sold), proof(sold));
    assert.equal(result.sales_role, sold === "A" ? "Advertised" : "Cross-sell");
    assert.equal(result.sales_role_resolution.state, "verified_relation");
  }
});

test("Meta same catalog/ad set membership does not change a different sold product into Advertised", () => {
  const result = normalizeMetaProductSale(native("B"), {...proof("B"), advertised_product_set: ["A", "B", "C"]});
  assert.equal(result.sales_role, "Cross-sell");
  assert.equal(result.provider_product_key.advertised_item_id, "A");
  assert.equal(result.provider_product_key.sold_item_id, "B");
});

test("Meta four fields including positive promoted values do not invent verified relation evidence", () => {
  const row = native("A");
  const result = normalizeMetaProductSale(row);
  assert.equal(result.sales_role, "Unclassified");
  assert.equal(result.provider_product_key.advertised_item_id, null);
  assert.equal(result.sales_role_resolution.reason, "native_sale_relation_not_verified");
  assert.deepEqual(Object.keys(result.raw_metrics), META_NATIVE_PRODUCT_SALES_FIELDS);
  assert.ok(!Object.hasOwn(result.raw_metrics, "cross_sell_quantity"));
});

test("Meta preserves raw lists and monetary values without summing or subtracting total/promoted fields", () => {
  const row = native("B"), before = structuredClone(row);
  const result = normalizeMetaProductSale(row, proof("B"));
  assert.deepEqual(row, before);
  assert.equal(result.raw_row, row);
  for (const field of META_NATIVE_PRODUCT_SALES_FIELDS) assert.equal(result.raw_metrics[field], row[field]);
  assert.equal(result.raw_metrics.converted_product_quantity[0].value, "4");
  assert.equal(result.raw_metrics.converted_promoted_product_quantity[0].value, "1");
});

test("Meta zero sales value does not erase a verified positive-quantity sale or change its role", () => {
  const row = {...native("B"), converted_product_value: [{action_type: "purchase", value: "0"}]};
  assert.equal(normalizeMetaProductSale(row, proof("B")).sales_role, "Cross-sell");
});

test("Meta distinguishes absent, null and empty metrics and never fabricates a zero", () => {
  const row = native("A");
  delete row.converted_product_quantity;
  row.converted_product_value = null;
  row.converted_promoted_product_quantity = [];
  const result = normalizeMetaProductSale(row);
  assert.equal(result.metric_observation.converted_product_quantity, "absent");
  assert.equal(result.metric_observation.converted_product_value, "null");
  assert.equal(result.metric_observation.converted_promoted_product_quantity, "empty");
  assert.equal(result.raw_metrics.converted_product_quantity, null);
});

test("Meta pending, conflicting, missing and mixed relationships remain Unclassified", () => {
  for (const evidence of [null, {state: "pending"}, {state: "contradictory"},
    {...proof("A"), relation_scope: "mixed_product_sale_relations"}, {...proof("A"), sold_product_id: null},
    {...proof("A"), advertised_product_id: null}, {...proof("A"), catalog_id: null},
    {...proof("A"), identity_namespace: "unknown"}, {...proof("A"), source_reference: ""}]) {
    assert.equal(normalizeMetaProductSale(native("A"), evidence).sales_role, "Unclassified");
  }
});

test("Meta evidence cannot be applied to another account, Ad, day or source product", () => {
  for (const identity of [{account_id: "999"}, {ad_id: "ad-2"}, {business_date: "2026-10-25"}, {product_id: "Z"}]) {
    const result = normalizeMetaProductSale(native("A"), {...proof("A"), row_identity: {...proof("A").row_identity, ...identity}});
    assert.equal(result.sales_role, "Unclassified");
    assert.equal(result.sales_role_resolution.reason, "native_row_identity_mismatch");
  }
  assert.equal(normalizeMetaProductSale(native("Z"), {...proof("Z"), sold_product_id: "B"}).sales_role, "Unclassified");
});

test("Meta does not classify missing/zero/negative/nonfinite quantities or infer quantity from revenue", () => {
  for (const quantity of [null, 0, "0", -1, "-1", Infinity, "Infinity", "bad"]) {
    assert.equal(normalizeMetaProductSale(native("A"), {...proof("A"), sales_quantity: quantity}).sales_role, "Unclassified");
  }
  assert.equal(normalizeMetaProductSale(native("A"), {...proof("A"), sales_quantity: ".5"}).sales_role, "Advertised");
});

test("Meta batch is a one-to-one source projection, not a second set of additive sales facts", () => {
  const rows = [native("A"), native("B")];
  const result = projectMetaProductSales({rows, evidenceRows: [proof("A"), proof("B")]});
  assert.deepEqual(result.rows.map(row => row.sales_role), ["Advertised", "Cross-sell"]);
  assert.deepEqual(result.rows.map(row => row.source_row_index), [0, 1]);
  assert.equal(result.additional_sales_facts_created, false);
  assert.equal(result.dataset_publishable, false);
  assert.equal(result.live_validation, false);
  assert.deepEqual(projectMetaProductSales({rows: []}).rows, []);
  assert.throws(() => projectMetaProductSales({rows, evidenceRows: []}), error => error.code === "META_PRODUCT_SALE_EVIDENCE_INVALID");
  assert.throws(() => projectMetaProductSales({rows, evidenceRows: Array(2)}), error => error.code === "META_PRODUCT_SALE_EVIDENCE_INVALID");
  assert.throws(() => normalizeMetaProductSale(null), error => error.code === "META_PRODUCT_SALE_ROW_INVALID");
});
