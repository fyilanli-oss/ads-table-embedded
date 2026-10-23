import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMMON_ADAPTER_CONTRACT_VERSION, RAW_METRICS } from "../app/lib/providers/common-adapter.server.js";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const contractPath = "contracts/pd-cpd-query-standard-v1.json";

test("01 aligns nine PD metrics across target, common contract, runtime and types", async () => {
  const standard = await readJson(contractPath);
  const common = await readJson("contracts/eo-04a-common-adapter-start-brief-v1.json");
  const types = await readFile("app/lib/providers/common-adapter.server.d.ts", "utf8");
  assert.equal(standard.inventory_item, "01");
  assert.equal(common.query_standard, contractPath);
  assert.equal(standard.adapter_contract_version, COMMON_ADAPTER_CONTRACT_VERSION);
  assert.equal(common.adapter_contract_version, COMMON_ADAPTER_CONTRACT_VERSION);
  assert.deepEqual(standard.pd_metrics, RAW_METRICS);
  assert.deepEqual(common.canonical_funnel_fact_contract.raw_metrics, RAW_METRICS);
  const tuple = types.match(/RAW_METRICS: readonly \[([\s\S]*?)\];/)[1];
  assert.deepEqual([...tuple.matchAll(/"([^"]+)"/g)].map((match) => match[1]), RAW_METRICS);
  assert.ok(types.includes(`COMMON_ADAPTER_CONTRACT_VERSION: "${COMMON_ADAPTER_CONTRACT_VERSION}"`));
});

test("01 links all provider snapshots without claiming target implementation", async () => {
  for (const path of [
    "contracts/eo-04b-meta-reporting-runtime-v1.json",
    "contracts/eo-04c-google-reporting-runtime-v1.json",
    "contracts/eo-04d-klaviyo-reporting-runtime-v1.json",
    "contracts/eo-04e-three-provider-channel-product-economics-v1.json",
  ]) assert.equal((await readJson(path)).accepted_query_target_contract, contractPath);
  const standard = await readJson(contractPath);
  assert.equal(standard.delivery_boundary.new_provider_queries_or_live_calls, false);
  assert.equal(standard.delivery_boundary.dataset_writer_or_migration, false);
  assert.equal(standard.fact_boundaries.pd_purchase_equals_cpd_units, false);
  assert.equal(standard.fact_boundaries.pd_cost_copied_to_every_product, false);
  assert.equal(standard.fact_boundaries.same_native_fact_counted_twice_across_product_families, false);
  assert.equal(standard.fact_boundaries.physical_dataset_schema_selected, false);
});

test("01 preserves the 13-column table and exact provider flow hierarchy targets", async () => {
  const standard = await readJson(contractPath);
  const table = await readFile(standard.source_table, "utf8");
  const header = table.split(/\r?\n/).find((line) => line.startsWith("| Provider |"));
  assert.equal(header.split("|").slice(1, -1).length, 13);
  for (const column of standard.cpd_metric_columns) assert.ok(header.includes(column));
  assert.deepEqual(standard.hierarchy_targets.map(({provider, flow, levels, channel_key}) =>
    [provider, flow, levels, channel_key]), [
    ["meta", "ads", ["campaign", "adset", "ad"], "ad_id"],
    ["google_ads", "search", ["campaign", "ad_group", "ad"], "ad_id"],
    ["google_ads", "shopping", ["campaign", "ad_group"], "ad_group_id"],
    ["google_ads", "retail_pmax", ["campaign", "asset_group"], "asset_group_id"],
    ["klaviyo", "campaign", ["campaign", "campaign_message"], "campaign_message_id"],
    ["klaviyo", "flow", ["flow", "flow_message"], "flow_message_id"],
  ]);
  const metaChannel = table.split(/\r?\n/).find((line) => line.startsWith("| Meta | CPD | Channel performansı |"));
  assert.ok(metaChannel.includes("Ürün kayıtlarından toplam"));
  assert.equal(metaChannel.includes("`actions`"), false);
  assert.equal(standard.product_identity.reporting_backbone, "shopify_product_id");
  assert.equal(standard.product_identity.variant_id, "preserve_when_present_as_source_detail");
});

test("08 and role boundaries do not invent provider proof or mix normal and all", async () => {
  const standard = await readJson(contractPath);
  assert.equal(standard.google_ads.scope_decision, "normal");
  assert.equal(standard.google_ads.pd_purchase.filter, "purchase_conversion_action_required");
  assert.equal(standard.google_ads.all_fields_policy, "raw_only_never_add_or_use_as_missing_normal_fallback");
  assert.equal(standard.google_ads.normal_mapping_and_acceptance_complete, false);
  assert.equal(standard.google_ads.historical_pmax_gate, "paused_work_not_reopened_by_this_contract");
  assert.deepEqual(standard.google_ads.cpd_role_fields, ["lead_units_sold", "lead_revenue_micros", "cross_sell_units_sold", "cross_sell_revenue_micros"]);
  assert.equal(standard.meta.empty_product_response_proves_support_or_zero, false);
  assert.ok(standard.meta.cpd_product_fields_target.includes("converted_promoted_product_quantity"));
  assert.ok(standard.meta.cpd_product_fields_target.includes("converted_promoted_product_value"));
  assert.equal(standard.meta.promoted_fields_default_query_implemented_item, "02");
  assert.equal(standard.meta.pd_mapping_implemented_item, "03");
  assert.equal(standard.meta.pd_mapping_live_acceptance, "pending");
  assert.equal(standard.klaviyo.campaign_content_membership_proves_clicked_product, false);
  assert.equal(standard.klaviyo.campaign_content_membership_role, "Assisted");
  assert.equal(standard.klaviyo.spend, "open_no_formula_or_zero_fallback");
  assert.deepEqual(standard.klaviyo.pd_repository_implemented_items, ["13", "14"]);
  assert.equal(standard.klaviyo.live_acceptance_and_combined_dataset, "pending");
  assert.equal(standard.delivery_boundary["N/A_or_KD_is_numeric_zero"], false);
});

test("04 source reference is a partial native slice; 09–12 and 16 retain their own gates", async () => {
  const standard = await readJson(contractPath);
  const design = standard.source_link_design;
  const meta = await readJson("contracts/eo-04b-meta-reporting-runtime-v1.json");
  assert.deepEqual(design.inventory_items, ["04", "09", "10", "11", "12", "16"]);
  assert.deepEqual(design.meta.key, meta.native_source_reference.key);
  assert.deepEqual(design.meta.ancestor_checks, meta.native_source_reference.ancestor_checks);
  assert.equal(design.names_are_join_keys, false);
  assert.equal(design.channel_reference_proves_shopify_identity_or_sales_role, false);
  assert.equal(design.meta.publishable, false);
  assert.equal(meta.native_source_reference.metric_copy_or_aggregation, false);
  assert.equal(meta.native_source_reference.new_query_or_call, false);
  assert.equal(meta.native_source_reference.shopify_identity_role_or_cost_semantics_proven, false);
  assert.equal(design.google_ads.historical_gate_reopened, false);
  assert.equal(design.google_ads.new_google_query_in_this_slice, false);
  for (const item of ["09", "10", "11", "12"]) assert.equal(typeof design.google_ads[item], "string");
  assert.equal(design.identity_design_item_16.reporting_identity, "shopify_product_id");
  assert.equal(design.identity_design_item_16.physical_model_or_reader_implemented, false);
  assert.equal(design.identity_design_item_16.native_id_pattern_or_title_sku_price_is_proof, false);
  assert.equal(design.identity_design_item_16.unresolved_identity_blocks_native_channel_reference, false);
  assert.equal(design.identity_design_item_16.persistence_package, "A6-EO-05-B");
  assert.equal(design.dataset_channel_totals_fx_and_roles_implemented, false);
  const table = await readFile(standard.source_table, "utf8");
  assert.ok(table.includes("04 kapanmadı"));
  assert.ok(table.includes("tarihsel tam gün kanıtı"));
});
