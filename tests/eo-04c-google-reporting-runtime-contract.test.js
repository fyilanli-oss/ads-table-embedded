import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const contract = JSON.parse(read("contracts/eo-04c-google-reporting-runtime-v1.json"));
const brief = read("docs/EO_04C_GOOGLE_REPORTING_RUNTIME_START_BRIEF.md");

test("Google reporting start package preserves the accepted real Channel leaves", () => {
  assert.equal(contract.provider.api_version, "v25");
  assert.equal(contract.channels.standard_shopping, "ad_group");
  assert.equal(contract.channels.search, "ad_group");
  assert.equal(contract.channels.performance_max_retail, "asset_group");
  assert.equal(contract.provider.canonical_reporting_account_required, true);
  assert.equal(contract.provider.manager_account_reporting_eligible, false);
});

test("account identity is independent from campaign inventory", () => {
  assert.deepEqual(contract.request_families.slice(0, 2), [
    "account_identity",
    "campaign_context",
  ]);
  assert.equal(contract.account_context.account_identity_query, "FROM customer");
  assert.equal(contract.account_context.campaign_inventory_query, "FROM campaign");
  assert.equal(contract.account_context.empty_campaign_inventory_hides_account_type, false);
});

test("PMax broad listing resolution preserves sales without inventing Asset Group", () => {
  const pmax = contract.pmax_product_sales;
  assert.equal(pmax.cart_data_asset_group_segment_available, false);
  assert.equal(pmax.channel_resolution_uses, "advertised_product_listing_membership");
  assert.equal(pmax.channel_resolution_never_uses, "sold_product_listing_membership");
  assert.equal(pmax.one_eligible_asset_group, "exact_asset_group");
  assert.equal(pmax.multiple_eligible_asset_groups, "Unclassified Channel");
  assert.equal(pmax.one_all_products_asset_group, "exact_asset_group");
  assert.equal(pmax.multiple_overlapping_all_products_or_category_asset_groups, "Unclassified Channel");
  assert.equal(pmax.unclassified_channel_drops_product_sale, false);
  assert.equal(pmax.ambiguous_sale_distribution, "forbidden");
  assert.equal(pmax.aggregate_product_group_metrics_joined_to_exact_sold_product_by_arithmetic, false);
});

test("a current listing tree can never resolve an earlier sale without date-matched evidence", () => {
  const temporal = contract.pmax_product_sales.temporal_resolution;
  assert.equal(temporal.sale_business_date_timezone, "reporting_account_timezone");
  assert.equal(temporal.exact_requires_listing_tree_valid_for_complete_business_date_window, true);
  assert.equal(temporal.current_tree_may_resolve_earlier_sale, false);
  assert.equal(temporal.tree_change_inside_business_date_window, "Unclassified Channel");
  assert.equal(temporal.missing_partial_or_conflicting_temporal_evidence, "Unclassified Channel");
  assert.equal(temporal.unclassified_channel_drops_product_sale, false);
  assert.deepEqual(temporal.required_exact_evidence, [
    "sale_business_date",
    "reporting_account_timezone",
    "listing_tree_evidence_version_or_hash",
    "listing_tree_valid_from",
    "listing_tree_valid_to",
  ]);
  assert.match(brief, /Bugün gözlenen ağaç, önceki satış gününde etkin ağacı kanıtlamaz/);
  assert.match(brief, /geriye dönük uygulanamaz/);
});

test("Google product sales use Sales Role and preserve both product identities", () => {
  assert.equal(contract.sales_role.term, "Sales Role");
  assert.match(contract.sales_role.advertised, /match/);
  assert.match(contract.sales_role.cross_sell, /differ/);
  assert.equal(contract.sales_role.unclassified_channel_is_sales_role, false);
  assert.equal(contract.sales_role.zero_value_is_sales_role, false);
  assert.ok(contract.product_sales_fields.identity.includes("segments.product_item_id"));
  assert.ok(contract.product_sales_fields.identity.includes("segments.product_sold_item_id"));
  assert.ok(contract.product_sales_fields.metrics.includes("metrics.lead_units_sold"));
  assert.ok(contract.product_sales_fields.metrics.includes("metrics.cross_sell_units_sold"));
  assert.equal(contract.product_sales_fields.requires_conversions_with_cart_data, true);
});

test("Cross-sell revenue and advertised-product cost remain separate", () => {
  assert.equal(contract.cost.provider_product_cost_belongs_to, "advertised_product");
  assert.equal(contract.cost.cross_sell_cost_moved_to_sold_product, false);
  assert.equal(contract.cost.allocated_product_cost_owner, "A6-EO-05");
  assert.equal(contract.cost.product_rows_reconstruct_channel_total, false);
});

test("empty, missing, unsupported and real zero remain distinct", () => {
  assert.equal(contract.support_state.missing_configuration, "account_configuration_missing");
  assert.equal(contract.support_state.empty_success, "not_observed_in_this_execution");
  assert.equal(contract.support_state.absent_is_zero, false);
  assert.equal(contract.support_state.empty_is_zero, false);
  assert.equal(contract.support_state.unsupported_is_zero, false);
  assert.equal(contract.support_state.only_explicit_numeric_zero_is_zero, true);
});

test("accepted and merged runtime never authorizes a live provider call", () => {
  assert.equal(contract.product_owner_acceptance.analyst_brief_accepted, true);
  assert.equal(contract.product_owner_acceptance.runtime_implementation_authorized, true);
  assert.equal(contract.product_owner_acceptance.runtime_final_acceptance, true);
  assert.equal(contract.product_owner_acceptance.merge_authorized, true);
  assert.equal(
    contract.product_owner_acceptance.merge_commit,
    "752cc1988323c238297d00516e7b7009432032c2",
  );
  assert.equal(contract.first_evidence_execution.first_provider_error_stops_execution, true);
  assert.equal(contract.first_evidence_execution.automatic_retry, false);
  assert.equal(contract.first_evidence_execution.live_provider_call_authorized, false);
  assert.equal(contract.mutations.runtime_implementation, true);
  assert.equal(contract.mutations.database, false);
  assert.equal(contract.mutations.deployment, false);
  assert.match(brief, /Ürün sahibi analist açıklaması kabulü/);
  assert.match(brief, /Çalışma zamanı uygulaması: \*\*16 Ekim 2026'da kabul edildi ve merge edildi/);
  assert.doesNotMatch(brief, /Sales Mode/);
});

test("synthetic fixtures verify AdsTable logic but never stand in for Google evidence", () => {
  assert.equal(contract.test_strategy.google_test_account_used_as_performance_evidence, false);
  assert.equal(contract.test_strategy.google_test_account_serving_metrics_expected, false);
  assert.equal(contract.test_strategy.repository_fixtures_are_provider_evidence, false);
  assert.ok(contract.test_strategy.repository_fixtures_verify.includes("sales_role_classification"));
  assert.match(brief, /Google test hesapları reklam yayınlamaz/);
  assert.match(brief, /Sentetik testin geçmesi.*kanıtlamaz/);
});
