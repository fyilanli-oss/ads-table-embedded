import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const design = read("contracts/eo-05a-global-refresh-design-v1.json");
const brief = read("contracts/eo-05-start-brief-v1.json");

test("global refresh design bounds all workers rather than assuming process-local concurrency is a DB budget", () => {
  assert.equal(design.global_admission.process_local_counter_is_sufficient, false);
  assert.equal(design.global_admission.shared_atomic_reservation_required, true);
  assert.equal(design.global_admission.interactive_read_capacity_reserved, true);
  assert.equal(design.global_admission.unknown_budget, "fail_closed_do_not_start_work");
  assert.equal(design.global_admission.database_transaction_held_across_provider_HTTP, false);
  assert.deepEqual(design.global_admission.allocation_dimensions, ["global", "provider", "workspace", "reporting_account"]);
  assert.equal(design.fairness_and_cadence.large_workspace_may_monopolize_queue, false);
  assert.equal(design.fairness_and_cadence.bounded_page_or_date_chunks_then_yield, true);
  assert.equal(design.fairness_and_cadence.top_of_hour_fanout, false);
});

test("design requires atomic claim, fencing, replay safety and no purpose bypass of account single-flight", () => {
  assert.equal(design.job_safety.claim_and_reservation_atomic, true);
  assert.equal(design.job_safety.lease_expiry_and_fencing_required, true);
  assert.equal(design.job_safety.expired_worker_can_write_or_finish_new_owner_job, false);
  assert.equal(design.job_safety.purpose_can_bypass_single_flight, false);
  assert.equal(design.job_safety.crash_after_commit_before_checkpoint_must_replay_safely, true);
  assert.equal(design.job_safety.checkpoint_after_durable_commit_only, true);
  assert.equal(design.job_safety.partial_page_or_date_run_is_complete, false);
  assert.equal(design.failure_policy.automatic_retry_or_alternative_route_authorized, false);
  assert.equal(design.failure_policy.cooldown_expiry_alone_authorizes_retry_after_first_error, false);
});

test("paid reconnection and bootstrap cannot authorize the disconnected month or invent involuntary recovery policy", () => {
  assert.equal(design.eligibility.paid_entitlement_alone_is_fetch_permission, false);
  assert.equal(design.eligibility.intentional_disconnect_gap_fetch_or_backfill, false);
  assert.equal(design.eligibility.bootstrap_can_override_connection_window, false);
  assert.match(design.eligibility.involuntary_authorization_failure, /policy_not_yet_accepted/);
  assert.match(design.eligibility.daily_grain_straddling_disconnected_window, /require_explicit_EO05D_policy/);
  assert.ok(design.required_implementation_scenarios.includes("intentional_disconnect_month_is_never_requested_on_reconnect"));
});

test("design keeps legacy idea-only, Dataset product storage undecided and live scheduler unauthorized", () => {
  assert.equal(design.legacy_reference.copy_runtime_or_architecture, false);
  assert.equal(design.legacy_reference.unimplemented_legacy_contract_is_working_scheduler_evidence, false);
  assert.equal(design.legacy_reference.legacy_retry_policy_inherited, false);
  assert.equal(brief.scope_clarifications_2026_10_20.global_refresh_design, "contracts/eo-05a-global-refresh-design-v1.json");
  assert.equal(brief.scope_clarifications_2026_10_20.product_level_physical_table_selected, false);
  assert.equal(brief.scope_clarifications_2026_10_20.EO05_is_only_a_PMax_slice, false);
  for (const key of ["runtime_implementation_authorized", "migration_or_live_DB_authorized", "provider_calls_authorized", "deployment_authorized", "merge_authorized"]) assert.equal(design[key], false);
  assert.match(design.verification_limit, /not executable scheduling/);
});
