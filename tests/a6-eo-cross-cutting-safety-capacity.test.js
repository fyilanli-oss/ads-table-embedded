import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(path.join(root, "contracts/a6-eo-cross-cutting-safety-capacity-v1.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(root, "contracts/a6-eo-implementation-master-v1.json"), "utf8"));
const plan = fs.readFileSync(path.join(root, "docs/EXECUTION_PLAN.md"), "utf8");

test("makes the embedded repository authoritative without promoting legacy evidence", () => {
  assert.equal(contract.active_authority.repository, "fyilanli-oss/ads-table-embedded");
  assert.equal(contract.active_authority.legacy_is_active_decision_authority, false);
  assert.match(plan, /Aktif karar kaynağı: bu repository/);
});

test("freezes reconciliation and bounded query semantics", () => {
  assert.deepEqual(contract.reconciliation.hourly_hot_window_provider_business_dates, ["today", "yesterday"]);
  assert.equal(contract.reconciliation.hourly_full_history_fetch, false);
  assert.equal(contract.reconciliation.deep_reconciliation_frequency_hours, 24);
  assert.equal(contract.reconciliation.klaviyo_global_five_day_constant_forbidden, true);
  assert.equal(contract.query_time_range.summary_and_table_max_calendar_days, 90);
  assert.equal(contract.query_time_range.daily_max_calendar_days, 31);
  assert.equal(contract.query_time_range.compare.equal_calendar_day_count, true);
  assert.equal(contract.query_time_range.compare.overlap_allowed, false);
});

test("freezes restore objectives and prevents deleted-data resurrection", () => {
  assert.equal(contract.restore_targets.critical_control_plane_database.rpo_minutes, 15);
  assert.equal(contract.restore_targets.replayable_dataset_v2.rpo_minutes, 60);
  assert.equal(contract.restore_targets.safe_degraded_service_rto_minutes, 60);
  assert.equal(contract.restore_targets.full_operational_rto_minutes, 240);
  assert.equal(contract.restore_targets.deleted_data_must_not_be_resurrected, true);
  assert.equal(contract.privacy_and_deletion.backup_restore_requires_deletion_ledger_replay_before_service, true);
});

test("certifies two thousand workspaces only through four thousand workspace stress evidence", () => {
  assert.equal(contract.capacity_envelope.target_certified_active_workspaces, 2000);
  assert.equal(contract.capacity_envelope.stress_test_workspaces, 4000);
  assert.equal(contract.capacity_envelope.scheduler_rules.top_of_hour_fanout_forbidden, true);
  assert.equal(contract.capacity_envelope.scheduler_rules.hourly_cycle_completion_target_minutes, 45);
  assert.equal(contract.capacity_envelope.pass_thresholds.capacity_headroom_percent_gte, 30);
  assert.equal(contract.capacity_envelope.no_unbounded_onboarding_beyond_certified_capacity, true);
});

test("keeps export asynchronous and preserves a planned PostgreSQL exit", () => {
  assert.equal(contract.first_review_scope.export, false);
  assert.equal(contract.capacity_envelope.query_and_export_rules.export_is_async_when_introduced, true);
  assert.equal(contract.portability.canonical_data_plane, "standard_PostgreSQL_first");
  assert.equal(contract.portability.periodic_neutral_PostgreSQL_restore_rehearsal_required, true);
  assert.equal(contract.migration_away_from_supabase_authorized, false);
});

test("routes the decision without advancing packages or mutating infrastructure", () => {
  const decision = master.cross_cutting_decisions.safety_capacity_portability_v1;
  assert.equal(decision.target_certified_active_workspaces, 2000);
  assert.deepEqual(decision.package_owners, ["A6-EO-02", "A6-EO-05", "A6-EO-06", "A6-EO-07", "A6-EO-08"]);
  assert.equal(decision.advances_package_status, false);
  assert.equal(decision.authorizes_infrastructure_mutation, false);
  assert.equal(contract.database_resize_or_replica_authorized, false);
});
