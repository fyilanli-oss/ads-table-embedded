import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const brief = read("contracts/eo-05-start-brief-v1.json");
const master = read("contracts/a6-eo-implementation-master-v1.json");
const eo05 = master.packages.find(p => p.id === "A6-EO-05");

test("owner pause removes listing-tree work from independent refresh prerequisites without waiving historical truth", () => {
  const gate = eo05.mandatory_first_gate;
  const decision = brief.work_order_decision_2026_10_20;
  const design = read("contracts/eo-05a-global-refresh-design-v1.json");
  const engineering = read("contracts/a6-quality-and-assurance-gates-v1.json").staged_rollout.phase_1_engineering;
  assert.equal(gate.execution_status, "paused_by_product_owner_2026_10_20_not_passed");
  assert.equal(brief.first_repository_slice.mandatory_gate_execution_status, gate.execution_status);
  assert.equal(design.listing_tree_work_order.execution_status, gate.execution_status);
  assert.equal(engineering.EO05_first_gate_execution_status, gate.execution_status);
  assert.equal(gate.blocks_independent_refresh_work, false);
  assert.equal(brief.first_repository_slice.mandatory_gate_blocks_independent_refresh_work, false);
  assert.equal(design.listing_tree_work_order.blocks_independent_refresh_work, false);
  assert.equal(engineering.EO05_first_gate_blocks_independent_refresh_work, false);
  assert.equal(gate.resume_requires_explicit_product_owner_approval, true);
  assert.deepEqual(gate.must_pass_before, ["historical_PMax_exact_Channel_feature_acceptance"]);
  assert.equal(decision.next_work, "global_refresh_workload_budget_and_execution_design");
  for (const key of ["Google_reporting_runtime_or_sales_Channel_cost_semantics_changed", "historical_exact_evidence_gate_waived_or_passed", "unverified_historical_PMax_Channel_activation_authorized", "runtime_migration_live_or_deployment_authorized_by_work_order"]) assert.equal(decision[key], false);
  assert.equal(design.next_implementation_decisions.some(item => item.includes("PMax")), false);
});

test("EO05 brief is linked without starting implementation or creating a new parent or child", () => {
  assert.equal(eo05.start_contract, "contracts/eo-05-start-brief-v1.json");
  assert.equal(eo05.status, "Not started");
  assert.equal(master.current_active_parent, null);
  assert.deepEqual(brief.children_in_order.map(c => c.id), eo05.children.map(c => c.id));
  assert.equal(brief.first_repository_slice.mandatory_gate, eo05.mandatory_first_gate.id);
  for (const [name, allowed] of Object.entries(brief.authority)) assert.equal(allowed, name === "brief_preparation", name);
  assert.equal(brief.acceptance.capacity_runs_authorized_now, false);
});

test("snapshot observation cannot fabricate historical continuity or use sold products to pick Channel", () => {
  const first = brief.first_repository_slice;
  for (const key of ["observation_time_is_validity_interval", "matching_snapshots_prove_no_intermediate_change", "current_tree_can_reconstruct_missing_past", "sold_product_selects_Channel", "snapshot_capture_alone_closes_gate"]) assert.equal(first[key], false);
  assert.equal(first.continuity_proof_source, "not_yet_verified_do_not_infer");
  assert.equal(first.otherwise, "preserve_valid_sale_and_Sales_Role_keep_Unclassified_Channel");
  assert.ok(first.required_design_outputs.includes("historical_product_dimension_inputs_for_membership_not_current_feed_guess"));
});

test("EO05 preserves configured finality, bounded reauthorization recovery and no fabricated zero or FX", () => {
  const invariant = brief.invariants;
  assert.equal(invariant.failed_partial_or_quota_limited_run_advances_finality, false);
  assert.equal(invariant.missing_or_unsupported_becomes_zero, false);
  assert.equal(invariant.FX_provider_or_rate_is_assumed, false);
  assert.equal(invariant.hourly_full_history_fetch, false);
  assert.equal(invariant.deep_reconciliation_frequency_hours, 24);
  assert.equal(invariant.non_entitled_or_reauthorization_required_jobs_run, false);
  assert.equal(invariant.stale_job_can_write_after_account_or_generation_change, false);
  assert.equal(invariant.cost_allocation_formula_owner, "A6-EO-06-A");
  assert.ok(invariant.reauthorization_gap.includes("classify_disconnect_vs_involuntary_authorization_loss"));
  assert.equal(invariant.intentional_disconnect_interval_may_be_backfilled, false);
  assert.equal(invariant.paid_subscription_overrides_disconnected_interval, false);
  assert.equal(invariant.yesterday_today_bootstrap_may_cross_disconnected_interval, false);
});

test("brief preserves capacity prerequisites and staged real validation without declaring acceptance", () => {
  const capacity = read("contracts/a6-eo-cross-cutting-safety-capacity-v1.json");
  assert.deepEqual(brief.first_repository_slice.prerequisites, capacity.capacity_envelope.acceptance_tests.before_A6_EO_05);
  assert.deepEqual(brief.acceptance.capacity, capacity.capacity_envelope.acceptance_tests.A6_EO_05);
  assert.equal(brief.entry.real_account_validation_timing, read("contracts/a6-quality-and-assurance-gates-v1.json").staged_rollout.phase_1_real_validation.timing);
  const plan = readFileSync(new URL("../docs/EXECUTION_PLAN.md", import.meta.url), "utf8");
  assert.ok(plan.includes("contracts/eo-05-start-brief-v1.json"));
  assert.ok(plan.includes("gözlem"));
});
