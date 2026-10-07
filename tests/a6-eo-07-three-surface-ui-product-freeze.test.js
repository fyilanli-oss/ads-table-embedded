"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const contract = JSON.parse(fs.readFileSync(path.join(root, "contracts/shopify/a6-eo-07-three-surface-ui-product-freeze-v1.json"), "utf8"));
const doc = fs.readFileSync(path.join(root, "docs/A6_EO_07_THREE_SURFACE_UI_PRODUCT_FREEZE.md"), "utf8");
const plan = fs.readFileSync(path.join(root, "docs/EXECUTION_PLAN.md"), "utf8");

test("freezes exactly three Shopify product surfaces and three active providers", () => {
  assert.deepEqual(contract.surfaces.map(({route}) => route), ["/", "/ad-analysis", "/settings"]);
  assert.deepEqual(contract.active_providers, ["meta", "google_ads", "klaviyo"]);
  assert.equal(contract.shared.manual_or_page_open_refresh, false);
  assert.equal(contract.shared.minimum_mobile_width_px, 320);
});

test("keeps Funnel view and time presentation independent with bounded compare", () => {
  assert.deepEqual(contract.funnel.view, ["funnel", "table"]);
  assert.deepEqual(contract.funnel.presentation, ["summary", "daily"]);
  assert.equal(contract.funnel.dimensions_are_independent, true);
  assert.equal(contract.funnel.compare.equal_calendar_day_count, true);
  assert.equal(contract.funnel.compare.table_expands_explicit_metrics_only, true);
  assert.equal(contract.funnel.compare.mobile_maximum_expanded_metrics, 1);
});

test("Ad Analysis uses verified provider leafs, one details modal and evidence-bound products", () => {
  assert.equal(contract.ad_analysis.universal_ad_label_forbidden, true);
  assert.equal(contract.ad_analysis.item_label, "Analysis item");
  assert.equal(contract.ad_analysis.detail.one_modal, true);
  assert.equal(contract.ad_analysis.detail.simultaneous_modals, false);
  assert.equal(contract.ad_analysis.products.requires_provider_returned_identity, true);
  assert.equal(contract.ad_analysis.products.unsupported_is_not_zero, true);
  assert.ok(contract.ad_analysis.products.forbidden_inference.includes("arbitrary_shopify_order_join"));
});

test("Settings preserves the proven interaction flow but does not carry legacy source", () => {
  assert.equal(contract.settings.legacy_working_flow_is_interaction_reference, true);
  assert.equal(contract.settings.legacy_source_code_carry_as_is, false);
  assert.deepEqual(contract.settings.section_order, [
    "reporting_currency",
    "provider_connections_and_reporting_accounts",
    "reporting_store",
    "subscription",
    "data_and_privacy",
  ]);
  assert.equal(contract.settings.reporting_store_above_provider_accounts, false);
});

test("Reporting Account and Reporting Store activate atomically and fail closed", () => {
  const change = contract.settings.reporting_account_change;
  assert.equal(change.staged_until_store_topology_verified, true);
  assert.equal(change.account_and_store_activation_atomic, true);
  assert.equal(change.no_candidate_keeps_previous_active_pair, true);
  assert.equal(change.dataset_write_before_activation, false);
  assert.equal(change.snapshot_job_before_activation, false);
});

test("billing and privacy remain Shopify-authoritative and explicitly confirmed", () => {
  assert.equal(contract.settings.subscription.authority, "shopify_app_pricing");
  assert.equal(contract.settings.subscription.public_price_usd_monthly, 24.99);
  assert.equal(contract.settings.subscription.trial_days, 14);
  assert.equal(contract.settings.subscription.custom_checkout_forbidden, true);
  assert.equal(contract.settings.delete_my_data.sequential_explicit_confirmations, 2);
  assert.equal(contract.settings.delete_my_data.separate_from_disconnect_and_uninstall, true);
});

test("visualization scope remains truthful and explicitly gated", () => {
  assert.equal(contract.funnel.visualization.model, "relationship_oriented_graphs");
  assert.equal(contract.funnel.visualization.product_owner_reference_package, "pending");
  assert.equal(contract.funnel.visualization.implementation_authorized, false);
  assert.equal(contract.ad_analysis.visualization.status, "blocked_by_A6_EO_07_C");
  assert.equal(contract.ad_analysis.visualization.requires_both_earring_cross_sell_fixtures_per_provider, true);
  assert.equal(contract.ad_analysis.visualization.inferred_product_chart_forbidden, true);
  assert.equal(contract.settings.visualization.charts, false);
});

test("freeze records official components but authorizes no implementation or acceptance", () => {
  assert.equal(contract.shopify_components.table, "s-table");
  assert.equal(contract.shopify_components.modal, "s-modal");
  assert.equal(contract.shopify_components.date_range, "s-date-picker");
  assert.equal(contract.implementation_authorized_by_this_contract, false);
  assert.equal(contract.live_mutation_authorized, false);
  assert.match(doc, /Product decision frozen; implementation and acceptance pending/);
  assert.match(plan, /A6-EO-07 three-surface UI product freeze/);
});
