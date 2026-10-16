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

test("PMax broad listing resolution preserves sales without inventing Asset Group", () => {
  const pmax = contract.pmax_product_sales;
  assert.equal(pmax.cart_data_asset_group_segment_available, false);
  assert.equal(pmax.channel_resolution_uses, "advertised_product_listing_membership");
  assert.equal(pmax.channel_resolution_never_uses, "sold_product_listing_membership");
  assert.equal(pmax.one_eligible_asset_group, "exact_asset_group");
  assert.equal(pmax.multiple_eligible_asset_groups, "Unknown Channel");
  assert.equal(pmax.one_all_products_asset_group, "exact_asset_group");
  assert.equal(pmax.multiple_overlapping_all_products_or_category_asset_groups, "Unknown Channel");
  assert.equal(pmax.unknown_channel_drops_product_sale, false);
  assert.equal(pmax.ambiguous_sale_distribution, "forbidden");
  assert.equal(pmax.aggregate_product_group_metrics_joined_to_exact_sold_product_by_arithmetic, false);
});

test("Google product sales use Sales Role and preserve both product identities", () => {
  assert.equal(contract.sales_role.term, "Sales Role");
  assert.match(contract.sales_role.advertised, /match/);
  assert.match(contract.sales_role.cross_sell, /differ/);
  assert.equal(contract.sales_role.unknown_channel_is_sales_role, false);
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

test("accepted brief does not authorize runtime or a live provider call", () => {
  assert.equal(contract.product_owner_acceptance.analyst_brief_accepted, true);
  assert.equal(contract.product_owner_acceptance.runtime_implementation_requires_separate_approval, true);
  assert.equal(contract.first_evidence_execution.first_provider_error_stops_execution, true);
  assert.equal(contract.first_evidence_execution.automatic_retry, false);
  assert.equal(contract.first_evidence_execution.live_provider_call_authorized, false);
  assert.equal(contract.mutations.runtime_implementation, false);
  assert.equal(contract.mutations.database, false);
  assert.equal(contract.mutations.deployment, false);
  assert.match(brief, /Product-owner analyst-brief acceptance/);
  assert.match(brief, /Runtime implementation: \*\*not authorized/);
  assert.doesNotMatch(brief, /Sales Mode/);
});
