import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("EO-04-D freezes truthful Klaviyo reporting and hierarchy boundaries", async () => {
  const contract = await readJson("contracts/eo-04d-klaviyo-adapter-start-brief-v1.json");

  assert.equal(contract.status, "Start_brief_accepted_repository_implementation_pending");
  assert.equal(contract.stable_api_revision, "2026-07-15");
  assert.equal(contract.authority.reporting_accounts.minimum, 1);
  assert.equal(contract.authority.reporting_accounts.maximum, 3);
  assert.equal(contract.canonical_reporting_source.funnel_totals, "Klaviyo Reporting API");
  assert.equal(contract.canonical_reporting_source.query_metric_aggregates_is_ui_parity_source, false);
  assert.equal(contract.hierarchy.campaign_performance_leaf, "campaign_message");
  assert.equal(contract.hierarchy.flow_performance_leaf, "flow_message");
  assert.equal(contract.hierarchy.flow_action_is_performance_leaf, false);
  assert.equal(contract.hierarchy.campaign_variation.production_beta_forbidden, true);
});

test("EO-04-D maps funnel metrics without manufacturing zero or spend", async () => {
  const contract = await readJson("contracts/eo-04d-klaviyo-adapter-start-brief-v1.json");

  assert.equal(contract.canonical_mapping.impression.source, "delivered");
  assert.equal(contract.canonical_mapping.ad_click.source, "clicks_unique");
  assert.equal(contract.canonical_mapping.session.status, "unsupported");
  assert.equal(contract.mapped_metrics.name_only_matching_forbidden, true);
  assert.equal(contract.zero_and_missing.absent_or_null_becomes_numeric_zero, false);
  assert.equal(contract.cost.sms_null_before_supported_period_or_contracted_plan_is_not_zero, true);
  assert.equal(contract.cost.unsupported_channel_cost_is_not_zero, true);
  assert.equal(contract.attribution_and_finality.hardcoded_five_days_forbidden, true);
});

test("EO-04-D limits product analysis to attributed sold-product facts", async () => {
  const contract = await readJson("contracts/eo-04d-klaviyo-adapter-start-brief-v1.json");
  const sold = contract.sold_product_enrichment;

  assert.deepEqual(sold.target_fields, [
    "product_id",
    "sku",
    "product_name",
    "purchase_quantity",
    "sales",
  ]);
  assert.equal(sold.same_event_line_items_and_attribution_required, true);
  assert.equal(sold.clicked_product_identification_required, false);
  assert.equal(sold.clicked_product_inference_forbidden, true);
  assert.equal(sold.advertised_vs_cross_sell_classification_required, false);
  assert.equal(sold.reporting_api_is_canonical_conversion_total, true);
  assert.equal(sold.events_api_enrichment_must_not_double_count, true);
});

test("Execution Plan and master activate accepted EO-04-D without live mutation", async () => {
  const contract = await readJson("contracts/eo-04d-klaviyo-adapter-start-brief-v1.json");
  const master = await readJson("contracts/a6-eo-implementation-master-v1.json");
  const plan = await readFile("docs/EXECUTION_PLAN.md", "utf8");
  const eo04 = master.packages.find((entry) => entry.id === "A6-EO-04");
  const eo04d = eo04.children.find((entry) => entry.id === "A6-EO-04-D");
  const decision = master.cross_cutting_decisions.klaviyo_attributed_sold_product_discovery_v1;

  for (const value of [
    "EO-04-D Klaviyo official-document decision",
    "product ID, SKU, product name, purchase quantity and Sales",
    "clicked product",
    "15 October 2026",
    "five-day",
  ]) {
    assert.match(plan, new RegExp(value.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&"), "i"));
  }

  assert.equal(master.current_active_parent, "A6-EO-04");
  assert.equal(master.current_active_child, "A6-EO-04-D");
  assert.equal(master.current_gate, "A6-EO-04-D_start_brief_accepted_repository_implementation_pending");
  assert.equal(eo04d.status, "Start_brief_accepted_repository_implementation_pending");
  assert.equal(eo04d.product_owner_start_brief_accepted, true);
  assert.equal(eo04d.live_mutation_authorized, false);
  assert.equal(decision.clicked_product_classification_required, false);
  assert.equal(decision.product_ui_authorized, false);
  assert.equal(contract.mutations_authorized.provider, false);
  assert.equal(contract.mutations_authorized.secrets, false);
});
