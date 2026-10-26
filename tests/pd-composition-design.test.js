import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {GOOGLE_PD_QUERY_FAMILIES} from "../app/lib/providers/google-reporting.server.js";

const standard = JSON.parse(await readFile("contracts/pd-cpd-query-standard-v1.json", "utf8"));
const design = standard.pd_composition_review;

test("17 is a design-only review, not a composer, Dataset or provider acceptance", () => {
  assert.equal(design.inventory_item, "17");
  assert.equal(design.status, "design_proposed_for_owner_review_not_runtime_implemented");
  assert.equal(design.runtime_composer_implemented, false);
  assert.equal(design.physical_dataset_schema_selected, false);
  assert.equal(design.publishable, false);
  assert.equal(design.items_18_19_closed, false);
  assert.equal(standard.delivery_boundary.dataset_writer_or_migration, false);
  assert.equal(standard.source_link_design.dataset_channel_totals_fx_and_roles_implemented, false);
});

test("17 owns each Google PD metric once and references the existing six source families", () => {
  const google = design.source_ownership.google_ads;
  assert.deepEqual([...google.family_pairs.flat()].sort(), [...GOOGLE_PD_QUERY_FAMILIES].sort());
  const metrics = [...google.performance_metrics, ...google.conversion_metrics];
  assert.equal(new Set(metrics).size, 9);
  assert.deepEqual(metrics, standard.pd_metrics);
  assert.equal(google.performance_conversions_or_campaign_helper_as_purchase_fallback, false);
  assert.equal(google.all_scope_as_normal_fallback, false);
  assert.equal(google.cart_or_product_metrics_as_pd_fallback, false);
  assert.equal(google.pmax_pd_composition_proves_product_asset_group_link, false);
  assert.match(google.reduction_of_multiple_conversion_actions, /complete_unique_disjoint/);
});

test("17 retains Klaviyo detail and separates CPD sales and open Spend from PD", () => {
  const klaviyo = design.source_ownership.klaviyo;
  assert.equal(klaviyo.delivery_and_purchase_source, "Placed Order");
  assert.equal(klaviyo.add_to_cart_source, "Added to Cart");
  assert.equal(klaviyo.checkout_source, "Checkout Started");
  assert.deepEqual(klaviyo.detail_checks, ["send_channel", "variation"]);
  assert.equal(klaviyo.variation_is_channel, false);
  assert.equal(klaviyo.ordered_product_events_as_pd_fallback, false);
  assert.equal(klaviyo.spend, "open_null_no_calculation");
  assert.equal(design.source_ownership.meta.product_breakdown_is_pd_fallback, false);
});

test("17 requires compatible scope and preserves missing, zero, partial and deferred gates", () => {
  assert.equal(design.compatibility_checks.length, 7);
  for (const dimension of ["workspace", "generation", "account", "ancestor", "timezone", "currency", "attribution", "execution"]) {
    assert.ok(design.compatibility_checks.some(check => check.includes(dimension)));
  }
  const policy = design.missing_and_conflict_policy;
  assert.equal(policy.absent_empty_null_or_not_requested_becomes_zero, false);
  assert.equal(policy.explicit_zero_preserved, true);
  assert.equal(policy.missing_count_inferred_from_value_or_reverse, false);
  assert.equal(policy.missing_metric_erases_other_observed_metrics, false);
  assert.equal(policy.failed_partial_or_incompatible_input_published_as_complete, false);
  assert.equal(policy.unobserved_leaf_created_from_cpd, false);
  assert.match(design.deferred_items["05"], /pending_real_data/);
  assert.match(design.deferred_items["15"], /investigation_closed_by_owner_2026_10_26_keep_Assisted_Triggered/);
  assert.equal(standard.klaviyo.sales_role_product_decision_2026_10_26.native_provider_support_or_impossibility_proven, false);
  assert.equal(standard.klaviyo.sales_role_product_decision_2026_10_26.Meta_sales_role_investigation, "remains_open");
  assert.match(design.deferred_items["10_11"], /history_still_paused/);
  assert.match(design.canonical_validation, /no_invented_fx_or_identity/);
});
