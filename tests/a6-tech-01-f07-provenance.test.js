import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const evidence = read("docs/evidence/A6_TECH_01_F07_PROVENANCE_2026-10-18.json");
const prior = read("docs/evidence/A6_TECH_01_F06_CLOSURE_2026-10-18.json");
const metadataPaths = new Set([
  "contracts/a6-eo-implementation-master-v1.json",
  "contracts/a6-tech-01-engineering-integrity-audit-v1.json",
  "docs/A6_TECH_01_ENGINEERING_INTEGRITY_AUDIT.md",
  "docs/EXECUTION_PLAN.md",
  "docs/evidence/A6_TECH_01_F06_CLOSURE_2026-10-18.json",
  "tests/a6-tech-01-engineering-integrity-audit.test.js",
]);

function assertHistoricalComparison(record) {
  assert.equal(record.deployed_commit_is_main_ancestor, true);
  assert.equal(record.behind_by, 0);
  assert.equal(record.ahead_by, 1);
  assert.equal(record.same_commit_as_live, false);
  assert.equal(record.same_full_tree_as_live, false);
  assert.deepEqual(new Set(record.exact_non_runtime_changes), metadataPaths);
  assert.equal(record.exact_non_runtime_changes.length, metadataPaths.size);
  assert.match(record.deployed_filtered_tree_sha256, /^[a-f0-9]{64}$/);
  assert.equal(record.main_filtered_tree_sha256, record.deployed_filtered_tree_sha256);
  assert.equal(record.other_source_entries_compared, 371);
}

test("F07 point-in-time evidence binds the actual Production deployment to approved main and F06 CI", () => {
  const live = evidence.deployment;
  assert.equal(live.id, prior.deployment.id);
  assert.equal(live.project_id, prior.deployment.project_id);
  assert.equal(live.source_commit, prior.implementation_merge_commit);
  assert.equal(live.source_tree, prior.tested_and_merge_tree);
  assert.equal(live.tested_source_commit, prior.tested_source_commit);
  assert.equal(live.tested_source_governance_run_id, prior.governance_run_id);
  assert.equal(live.target, "production");
  assert.equal(live.state, "READY");
  assert.equal(live.verified_alias, "embedded.adstable.app");
  assert.equal(live.alias_error, null);
  assert.equal(live.exact_approved_main_commit_at_deployment, true);
  assertHistoricalComparison(evidence.comparison);
  assert.equal(evidence.scope.new_deployment, false);
  assert.equal(evidence.scope.runtime_or_workflow_change, false);
  assert.equal(evidence.F08_execution_authorized, false);
});

test("runtime/config/workflow/migration changes, ancestry gaps and fingerprint drift cannot be called metadata-only", () => {
  for (const path of ["app/entry.server.tsx", "package.json", "pnpm-lock.yaml", ".github/workflows/repository-governance.yml", "supabase/migrations/new.sql", "contracts/runtime.json"]) {
    assert.throws(() => assertHistoricalComparison({...evidence.comparison, exact_non_runtime_changes: [...evidence.comparison.exact_non_runtime_changes, path]}));
  }
  assert.throws(() => assertHistoricalComparison({...evidence.comparison, deployed_commit_is_main_ancestor: false}));
  assert.throws(() => assertHistoricalComparison({...evidence.comparison, main_filtered_tree_sha256: "0".repeat(64)}));
  assert.throws(() => assertHistoricalComparison({...evidence.comparison, same_commit_as_live: true}));
});
