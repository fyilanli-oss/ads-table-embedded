import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const quality = read("contracts/a6-quality-and-assurance-gates-v1.json");
const master = read("contracts/a6-eo-implementation-master-v1.json");
const plan = quality.staged_rollout;

test("staged plan records parallel merchant preparation without starting EO05 or external actions", () => {
  assert.equal(plan.merchant, "Zey&Rose");
  assert.equal(plan.approved_at, "2026-10-19");
  assert.equal(plan.EO05_implementation_authorized, false);
  assert.equal(plan.external_mutation_authorized, false);
  assert.equal(plan.phase_1_real_validation.live_queries_authorized, false);
  assert.equal(master.current_gate, "A6-EO-05_START_BRIEF_PENDING");
  assert.equal(master.current_active_parent, null);
  assert.equal(master.current_active_child, null);
  assert.equal(read("contracts/a6-docs-01-turkish-standardization-v1.json").package_complete, true);
  assert.equal(plan.phase_1_parallel_preparation.advertising_scenarios.length, 4);
  assert.deepEqual(plan.phase_1_parallel_preparation.access_targets, ["Meta_App_Role", "Google_Explorer", "Klaviyo"]);
  assert.equal(plan.phase_1_parallel_preparation.required_before_real_store_use, "A6-OPS-SHOPIFY-01_isolation_gate");
});

test("engineering progress cannot substitute synthetic fixtures for native product capability or final acceptance", () => {
  const engineering = plan.phase_1_engineering;
  assert.equal(engineering.real_account_absence_blocks_independent_engineering, false);
  assert.equal(engineering.parallel_active_parents_allowed, false);
  assert.equal(engineering.EO07C_before_EO07D_and_EO07E_evidence_gates_preserved, true);
  assert.equal(engineering.EO08_engineering_reached_means_formally_accepted, false);
  assert.equal(engineering.unverified_product_graphs_may_activate, false);
  assert.equal(engineering.package_delta_integrity_required, true);
  for (const id of engineering.packages) assert.equal(master.packages.find(p => p.id === id).status, "Not started");
  assert.equal(engineering.EO05_first_gate, master.packages.find(p => p.id === "A6-EO-05").mandatory_first_gate.id);
  assert.equal(master.packages.find(p => p.id === "A6-EO-05").mandatory_first_gate.current_tree_may_backfill_historical_snapshot_or_channel, false);
});

test("real validation preserves sales and cost grains but requires explicit acceptance before reduced-scope activation", () => {
  const validation = plan.phase_1_real_validation;
  assert.deepEqual(validation.providers, ["meta", "google_ads", "klaviyo"]);
  assert.equal(validation.missing_real_evidence, "pending_not_pass_not_unsupported_not_zero");
  assert.equal(validation.independent_research_is_live_runtime_proof, false);
  assert.equal(validation.unavailable_Sales_Role_or_Ad_Cost_alone_forces_project_stop, false);
  assert.ok(validation.reduced_scope_requires.includes("explicit_product_owner_acceptance"));
  assert.ok(validation.reduced_scope_requires.includes("affected_contract_and_UI_gates_reconciled_before_activation"));
  assert.equal(validation.security_and_data_integrity_exceptions_allowed, false);
  assert.deepEqual(validation.cost_grains_remain_separate, ["Channel_Ad_Cost", "Provider_Product_Ad_Cost", "Allocated_Ad_Cost"]);
});

test("real validation precedes assurance and review; EO09 and retirement retain separate gates", () => {
  const position = item => quality.sequence.indexOf(item);
  assert.ok(position("ZeyRose_real_account_validation_and_capability_scope_GO_NO_GO") > position("A6-EO-05_through_A6-EO-08_with_delta_integrity_gates"));
  assert.ok(position("A6-ASSURE-01") > position("ZeyRose_real_account_validation_and_capability_scope_GO_NO_GO"));
  assert.ok(position("review_submissions") > position("product_owner_GO_NO_GO"));
  assert.ok(position("A6-EO-09") > position("real_store_pilot"));
  assert.equal(plan.phase_2.all_packages_must_finish_before_review, false);
  assert.equal(plan.phase_2.EO09_requires_applicable_reviews_pilot_and_separate_cutover_GO, true);
  assert.equal(plan.phase_2.EO10_requires_EO09_consumer_zero_and_separate_destructive_approval, true);
  assert.ok(master.packages.find(p => p.id === "A6-EO-09").depends_on.includes("separate_cutover_GO"));
});

test("OpenAI remains a research candidate, not a fourth active provider or an inferred sales-role capability", () => {
  const candidate = plan.openai_ads_candidate;
  assert.equal(candidate.status, "research_candidate_only");
  assert.equal(candidate.current_provider_allowlist_changed, false);
  assert.equal(candidate.integration_authorized, false);
  assert.equal(candidate.business_application_authorized, false);
  assert.ok(candidate.not_proven.includes("native_sold_product_attribution_and_Sales_Role"));
  assert.ok(candidate.required_before_separate_integration_decision.includes("explicit_scope_approval"));
  assert.equal(plan.phase_2.review_or_access_approval_guaranteed, false);
});
