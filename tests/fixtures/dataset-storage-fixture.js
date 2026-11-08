import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {DATASET_EXTENSION_VERSION} from "../../app/lib/database/dataset-storage.server.js";

const design = JSON.parse(readFileSync(new URL("../../contracts/eo-05b-five-table-design-v1.json", import.meta.url), "utf8"));
export function datasetStorageFixture({owner, source, table = "pd_facts"} = {}) {
  owner ??= {workspaceId: randomUUID(), installationId: "9007199254740993", generation: "1", provider: "google_ads",
    shopId: "gid://shopify/Shop/1", shopDomain: "dataset-fixture.myshopify.com", connectionId: randomUUID(), connectionVersion: "1",
    accountId: "123", selectionEpoch: "1", credentialId: randomUUID()};
  source ??= {batch_id: "11", commit_id: randomUUID(), request_digest: "a".repeat(64), page_id: "12", payload_hash: "b".repeat(64)};
  const metadata = design.tables.find(t => t.name === table);
  const row = Object.fromEntries(metadata.columns.map(c => [c.name, null]));
  const metrics = metadata.columns.filter(c => c.type === "numeric").map(c => c.name);
  Object.assign(row, {business_date: "2026-11-01", source_timezone: "UTC", reporting_scope: {time_basis: "interaction_date", units: "native", attribution: "native"},
    source_identity: {kind: "daily", namespace: table === "pd_facts" ? "ad_performance" : "product", native: {entity_id: "ad-1", product_id: "product-1"}},
    metric_support: Object.fromEntries(metrics.map(k => [k, "supported"])), observation_state: Object.fromEntries(metrics.map(k => [k, "present"])),
    metric_extensions: {}, extension_schema_version: DATASET_EXTENSION_VERSION,
    provenance: {projection_version: "synthetic-only-v1", sources: [source]}, source_batch_id: source.batch_id, source_completeness: "complete",
    source_currency: "USD", target_currency: "USD", fx_rate_id: null, fx_state: "identity", fx_engine_version: null,
    ...Object.fromEntries(metrics.map(k => [k, "0"]))});
  if (table === "pd_facts") Object.assign(row, {entity_type: "ad", entity_id: "ad-1", entity_name: null});
  else Object.assign(row, {channel_type: null, channel_id: null, channel_resolution: "unresolved", product_context: {merchant_id: "merchant-1"}});
  if (table === "cpd_product_performance_facts") row.native_product_id = "product-1";
  if (table === "cpd_product_sales_facts") row.source_identity.native = {entity_id: "ad-1", sold_product_id: "product-1"};
  if (table === "cpd_product_sales_facts") Object.assign(row, {native_sold_product_id: "product-1", sales_role: "Unclassified", sales_role_evidence: {}, native_sales_metrics: {}});
  return {owner, rows: [{table, row}], policy: {version: "synthetic-test-policy", until: new Date(Date.now() + 86400000).toISOString()}, now: new Date().toISOString()};
}
