import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const standard = JSON.parse(await readFile("contracts/pd-cpd-query-standard-v1.json", "utf8"));
const review = standard.hierarchy_channel_review;

test("18–19 remain design review without runtime, Dataset, FX or package closure", () => {
  assert.deepEqual(review.inventory_items, ["18", "19"]);
  assert.equal(review.status, "design_proposed_for_owner_review_not_runtime_implemented");
  for (const flag of ["runtime_aggregator_implemented", "physical_schema_or_writer_implemented",
    "fx_or_formula_implemented", "publishable", "items_17_18_19_closed",
    "pmax_product_asset_group_link_or_history_reopened"]) assert.equal(review[flag], false);
  assert.equal(standard.pd_composition_review.runtime_composer_implemented, true);
  assert.equal(standard.pd_composition_review.all_provider_composers_and_native_orchestration_complete, false);
  assert.equal(standard.source_link_design.dataset_channel_totals_fx_and_roles_implemented, false);
});

test("18 derives parents only from composed PD leaves and existing hierarchy targets", () => {
  const rollup = review.pd_rollup;
  assert.equal(rollup.paths_authority, "hierarchy_targets.levels");
  assert.equal(rollup.input, "composed_pd_leaf_metrics_not_all_raw_report_rows");
  assert.equal(rollup.parent_plus_child_added_together, false);
  assert.equal(rollup.direct_parent_query_is_total_fallback, false);
  assert.equal(rollup.campaign_conversion_action_helper_is_additive_source, false);
  assert.equal(rollup.consistent_native_parent_ids_required, true);
  assert.equal(rollup.name_based_or_guessed_parent, false);
  assert.match(rollup.ratios, /EO06A_never_sum_or_average/);
  assert.equal(standard.hierarchy_targets.find(row => row.flow === "search").pd_leaf_key, "ad_id");
  assert.equal(standard.hierarchy_targets.find(row => row.flow === "search").channel_key, "ad_group_id");
});

test("19 separates cost and sale ownership without dropping unsold cost or multiplying rows", () => {
  const channel = review.cpd_channel;
  assert.equal(channel.identity_authority, "hierarchy_targets.channel_key");
  assert.equal(channel.delivery_cost_source, "validated_native_product_performance_only");
  assert.equal(channel.sales_source, "validated_native_product_sales_only");
  assert.match(channel.aggregation_order, /each_family_independently/);
  for (const flag of ["raw_product_performance_times_sales_join", "pd_delivery_cost_or_purchase_used_as_product_total",
    "product_performance_conversions_used_as_sold_quantity", "sales_absence_is_no_conversion_or_numeric_zero",
    "cost_repeated_per_sale_or_sales_role", "cost_of_unsold_products_redistributed",
    "pd_total_equals_cpd_channel_total_required", "product_cost_completeness_inferred_from_pd_cost",
    "missing_product_metric_filled_from_pd_residual"]) assert.equal(channel[flag], false);
  assert.equal(channel.sale_only_product_retained, true);
  assert.equal(channel.performance_only_product_and_observed_cost_retained, true);
  assert.match(channel.shopify_identity_unresolved, /preserve_native/);
});

test("19 single count and coverage do not fabricate Meta roles, Klaviyo cost or store sales", () => {
  const single = review.single_count;
  assert.match(single.identity, /not_product_id_alone_or_snapshot_row_index/);
  assert.match(single.google_sales_total, /not_total_plus_lead_plus_cross_sell/);
  assert.equal(single.google_general_and_scoped_cart_reports_added_together, false);
  assert.equal(single.meta_total_and_promoted_added_or_subtracted_without_semantic_acceptance, false);
  assert.equal(single.klaviyo_placed_order_added_to_ordered_product_sales, false);
  assert.equal(single.provider_attributed_sales_are_deduplicated_shopify_store_sales, false);
  assert.equal(review.coverage.per_metric, true);
  for (const flag of ["unknown_or_NA_as_zero", "known_subtotal_as_complete_total", "empty_response_proves_zero",
    "different_currency_values_summed_before_FX"]) assert.equal(review.coverage[flag], false);
  assert.equal(review.coverage.klaviyo_product_impression_click, "N/A_by_existing_product_decision");
  assert.equal(review.coverage.klaviyo_spend, "open_no_new_formula");
  assert.equal(review.deferred, "pd_composition_review.deferred_items_remain_open");
});
