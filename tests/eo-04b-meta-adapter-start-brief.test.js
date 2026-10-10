import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("EO-04-B brief freezes truthful Meta mapping without authorizing implementation", async () => {
  const contract = await readJson("contracts/eo-04b-meta-adapter-start-brief-v1.json");

  assert.equal(contract.status, "Accepted_start_brief_repository_implementation_pending_CI");
  assert.equal(contract.authority.reporting_accounts.minimum, 1);
  assert.equal(contract.authority.reporting_accounts.maximum, 3);
  assert.equal(contract.authority.merchant_selectable_reporting_store, false);
  assert.equal(contract.authority.ambiguous_cross_store_rows_publishable, false);
  assert.deepEqual(contract.hierarchy, ["ad_account", "campaign", "ad_set", "ad", "business_date"]);
  assert.equal(contract.canonical_mapping.ad_click.status, "PENDING_LIVE_FIELD_EVIDENCE");
  assert.equal(contract.canonical_mapping.ad_click.never_sum_aliases, true);
  assert.equal(contract.canonical_mapping.session.status, "unsupported");
  assert.equal(contract.zero_and_missing.successful_response_without_matching_action_type, "absent");
  assert.equal(contract.zero_and_missing.empty_action_values_array, "empty");
  assert.equal(contract.zero_and_missing.absent_or_empty_becomes_numeric_zero, false);
  assert.equal(contract.zero_and_missing.failed_or_partial_attempt_publishable, false);
  assert.equal(contract.mutations_authorized.implementation, true);
  assert.equal(contract.mutations_authorized.provider, false);
  assert.equal(contract.mutations_authorized.database, false);
});

test("EO-04-B freezes completeness, attribution and converted-product gates", async () => {
  const contract = await readJson("contracts/eo-04b-meta-adapter-start-brief-v1.json");

  assert.equal(contract.pagination.follow, "paging.next");
  assert.equal(contract.pagination.empty_page_with_next_continues, true);
  assert.equal(contract.pagination.stop_only_when_next_absent, true);
  assert.equal(contract.pagination.partial_publish, false);
  assert.equal(contract.attribution.status, "PENDING_REAL_CONVERSION_EVIDENCE");
  assert.equal(contract.attribution.exact_ads_manager_parity_claim_allowed, false);
  assert.equal(contract.click_live_gate.existing_actions_link_click_evidence_sufficient, false);
  assert.equal(contract.converted_product_route.owner_package, "A6-EO-07-C");
  assert.equal(contract.converted_product_route.generic_product_id_is_purchase_proof, false);
  assert.equal(contract.converted_product_route.retailer_id_assumed_shopify_sku, false);
  assert.equal(contract.converted_product_route.product_ui_authorized, false);
  assert.equal(contract.converted_product_route.exact_live_fixtures.length, 2);
});

test("Execution Plan and master keep EO-04-B at the analyst acceptance gate", async () => {
  const plan = await readFile("docs/EXECUTION_PLAN.md", "utf8");
  const master = await readJson("contracts/a6-eo-implementation-master-v1.json");
  const eo04 = master.packages.find((item) => item.id === "A6-EO-04");
  const eo04b = eo04.children.find((item) => item.id === "A6-EO-04-B");

  for (const value of [
    "docs/EO_04B_META_ADAPTER_START_BRIEF.md",
    "contracts/eo-04b-meta-adapter-start-brief-v1.json",
    "tests/eo-04b-meta-adapter-start-brief.test.js",
    "PENDING_LIVE_FIELD_EVIDENCE",
    "PENDING_REAL_CONVERSION_EVIDENCE",
  ]) {
    assert.match(plan, new RegExp(value.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")));
  }

  assert.equal(master.current_active_parent, "A6-EO-04");
  assert.equal(master.current_active_child, "A6-EO-04-B");
  assert.equal(master.current_gate, "A6-EO-04-B_repository_CI");
  assert.equal(eo04.status, "Active");
  assert.equal(eo04b.status, "Implementation_pending_CI");
  assert.equal(eo04b.implementation_started, true);
  assert.equal(eo04b.live_mutation_authorized, false);
});
