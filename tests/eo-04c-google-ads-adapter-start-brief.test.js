import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("EO-04-C freezes truthful Google account and hierarchy boundaries", async () => {
  const contract = await readJson("contracts/eo-04c-google-ads-adapter-start-brief-v1.json");

  assert.equal(contract.status, "Start_brief_accepted_repository_implementation_pending");
  assert.equal(contract.authority.reporting_accounts.minimum, 1);
  assert.equal(contract.authority.reporting_accounts.maximum, 3);
  assert.equal(contract.authority.reporting_accounts.customer_manager_must_be_false, true);
  assert.equal(contract.authority.manager_account_selectable, false);
  assert.deepEqual(contract.hierarchy.standard, [
    "advertiser_account",
    "campaign",
    "ad_group",
    "ad",
    "source_date",
  ]);
  assert.deepEqual(contract.hierarchy.performance_max, [
    "advertiser_account",
    "campaign",
    "asset_group",
    "source_date",
  ]);
  assert.equal(contract.hierarchy.synthetic_ad_leaf_for_performance_max_forbidden, true);
  assert.equal(contract.api.developer_token_required, false);
  assert.equal(contract.mutations_authorized.implementation, false);
  assert.equal(contract.mutations_authorized.provider, false);
});

test("EO-04-C freezes canonical Funnel, zero and attribution semantics", async () => {
  const contract = await readJson("contracts/eo-04c-google-ads-adapter-start-brief-v1.json");

  assert.equal(contract.canonical_mapping.ad_click.source, "metrics.clicks");
  assert.equal(contract.canonical_mapping.session.status, "unsupported");
  assert.equal(contract.canonical_mapping.purchase.metric, "metrics.all_conversions");
  assert.equal(contract.canonical_mapping.purchase_value.metric, "metrics.all_conversions_value");
  assert.equal(contract.conversion_semantics.blind_all_conversions_sum_forbidden, true);
  assert.equal(contract.zero_and_missing.all_selected_metrics_zero_rows_may_be_omitted, true);
  assert.equal(contract.zero_and_missing.absent_or_empty_becomes_numeric_zero, false);
  assert.equal(contract.time_currency.default_conversion_reporting_date, "ad_interaction_date");
  assert.equal(contract.freshness_finality.single_fixed_google_finality_window_allowed, false);
});

test("EO-04-C leaves sold-product Ad grain and cross-sell at evidence gates", async () => {
  const contract = await readJson("contracts/eo-04c-google-ads-adapter-start-brief-v1.json");

  assert.deepEqual(contract.product_cart_data.documented_cart_data_segmenting_resources, [
    "campaign",
    "ad_group",
  ]);
  assert.equal(contract.product_cart_data.individual_standard_ad_sold_product_mapping_guaranteed, false);
  assert.equal(contract.product_cart_data.performance_max_individual_ad_exists, false);
  assert.equal(contract.product_cart_data.advertised_product_performance_is_not_sold_basket_cross_sell_proof, true);
  assert.equal(contract.product_cart_data.merchant_item_id_assumed_shopify_sku_or_variant, false);
  assert.equal(contract.product_cart_data.deeper_official_field_compatibility_and_live_query_required, true);
  assert.equal(contract.product_cart_data.owner_package, "A6-EO-07-C");
  assert.equal(contract.product_cart_data.product_ui_authorized, false);
  assert.equal(contract.product_cart_data.exact_live_fixtures.length, 2);
});

test("Execution Plan and master advance documentation discovery to EO-04-D without closing prior live gates", async () => {
  const plan = await readFile("docs/EXECUTION_PLAN.md", "utf8");
  const master = await readJson("contracts/a6-eo-implementation-master-v1.json");
  const eo04 = master.packages.find((item) => item.id === "A6-EO-04");
  const eo04b = eo04.children.find((item) => item.id === "A6-EO-04-B");
  const eo04c = eo04.children.find((item) => item.id === "A6-EO-04-C");
  const eo04d = eo04.children.find((item) => item.id === "A6-EO-04-D");

  for (const value of [
    "docs/EO_04C_GOOGLE_ADS_ADAPTER_START_BRIEF.md",
    "contracts/eo-04c-google-ads-adapter-start-brief-v1.json",
    "Ad-level sold-product attribution remains",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
  ]) {
    assert.match(plan, new RegExp(value.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, "\\$&")));
  }

  assert.equal(master.current_active_parent, "A6-EO-04");
  assert.equal(master.current_active_child, "A6-EO-04-D");
  assert.equal(master.current_gate, "A6-EO-04-D_start_brief_accepted_repository_implementation_pending");
  assert.equal(eo04b.status, "Repository_CI_PASS_controlled_live_evidence_pending");
  assert.equal(eo04c.status, "Start_brief_accepted_repository_implementation_pending");
  assert.equal(eo04c.live_mutation_authorized, false);
  assert.equal(eo04d.status, "Start_brief_accepted_repository_implementation_pending");
  assert.equal(eo04d.implementation_started, false);
});
