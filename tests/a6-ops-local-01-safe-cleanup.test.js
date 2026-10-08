import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const cleanup = readJson("contracts/a6-ops-local-01-safe-cleanup-v1.json");
const master = readJson("contracts/a6-eo-implementation-master-v1.json");
const workflow = readJson("contracts/repository-delivery-workflow-v1.json");
const doc = fs.readFileSync(path.join(root, "docs/A6_OPS_LOCAL_01_SAFE_CLEANUP.md"), "utf8");
const plan = fs.readFileSync(path.join(root, "docs/EXECUTION_PLAN.md"), "utf8");

test("opens one independent package without changing the EO plan", () => {
  assert.equal(cleanup.type, "independent_one_time_operational_package");
  assert.equal(cleanup.advances_eo_status, false);
  assert.equal(cleanup.opens_cleanup_execution_authority, false);
  assert.equal(master.counts.parent_packages, 10);
  assert.equal(master.counts.stable_child_packages, 43);
  assert.equal(master.counts.independent_operational_packages, 1);
  const eoChildIds = master.packages
    .flatMap((parent) => parent.children ?? [])
    .map((child) => child.id);
  assert.ok(eoChildIds.includes(master.current_active_child));
  assert.notEqual(master.current_active_child, cleanup.id);
});

test("requires inventory and remote equivalence before cleanup", () => {
  assert.equal(cleanup.steps[0].id, "A6-OPS-LOCAL-01-A");
  assert.equal(cleanup.steps[0].mutation_authorized, false);
  assert.equal(cleanup.steps[1].id, "A6-OPS-LOCAL-01-B");
  assert.equal(cleanup.safety.remote_equivalence_before_removal, true);
  assert.equal(cleanup.safety.unknown_ownership_fails_closed, true);
});

test("permits cleanup only through a recoverable separately approved gate", () => {
  assert.equal(cleanup.steps[2].mutation_authorized_only_after_separate_explicit_user_approval, true);
  assert.equal(cleanup.safety.force_worktree_remove_forbidden, true);
  assert.equal(cleanup.safety.dry_run_before_stale_metadata_prune, true);
  assert.equal(cleanup.safety.codex_recoverable_archive_preferred, true);
  assert.ok(cleanup.safety.forbidden_mutations.includes("broad_recursive_delete"));
});

test("closes only at zero meaningful local-only work and keeps the recurring gate", () => {
  assert.ok(cleanup.closure_requires.includes("zero_meaningful_local_only_project_work"));
  assert.equal(cleanup.recurrence_control, "contracts/repository-delivery-workflow-v1.json.package_end_gate");
  assert.equal(workflow.package_end_gate.package_may_close_before_gate_passes, false);
  assert.match(doc, /Deletion authority:\*\* None at package opening/);
  assert.match(plan, /A6-OPS-LOCAL-01 — One-time local safety cleanup/);
});
