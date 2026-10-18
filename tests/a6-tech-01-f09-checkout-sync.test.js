import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const evidence = JSON.parse(readFileSync(new URL(
  "../docs/evidence/A6_TECH_01_F09_CHECKOUT_SYNC_2026-10-18.json", import.meta.url,
), "utf8"));

function assertSafeSnapshot(record) {
  assert.equal(record.before.branch, "main");
  assert.equal(record.before.ahead, 0);
  assert.equal(record.before.ancestor_of_target, true);
  for (const key of ["tracked_changes", "untracked_files", "ignored_entries", "stash_entries"]) assert.equal(record.before[key], 0);
  assert.equal(record.operation.fast_forward, true);
  assert.equal(record.operation.history_rewritten, false);
  assert.equal(record.operation.reset_clean_force_or_auth_repair_used, false);
  assert.equal(record.after.commit, record.after.remote_main_commit);
  assert.equal(record.after.local_tree, record.after.github_commit_tree);
  assert.equal(record.after.ahead, 0);
  assert.equal(record.after.behind, 0);
  assert.equal(record.after.tracked_changes, 0);
  assert.equal(record.after.untracked_files, 0);
}

test("F09 historical snapshot records clean non-destructive fast-forward and exact remote source equality", () => {
  assertSafeSnapshot(evidence);
  assert.equal(evidence.operation.observed_ORIG_HEAD, evidence.before.commit);
  assert.match(evidence.operation.command, /^git merge --ff-only --no-overwrite-ignore [a-f0-9]{40}$/);
  assert.equal(evidence.post_merge_final_sync_required, true);
  assert.equal(evidence.F10_execution_authorized, false);
  assert.equal(evidence.scope.worktree_archived_or_removed, false);
});

test("local work, divergence and unverified post-sync source cannot pass the F09 evidence guard", () => {
  for (const key of ["tracked_changes", "untracked_files", "ignored_entries", "stash_entries", "ahead"]) {
    const changed = structuredClone(evidence);
    changed.before[key] = 1;
    assert.throws(() => assertSafeSnapshot(changed));
  }
  const changed = structuredClone(evidence);
  changed.after.remote_main_commit = "0".repeat(40);
  assert.throws(() => assertSafeSnapshot(changed));
  changed.after.remote_main_commit = changed.after.commit;
  changed.before.ancestor_of_target = false;
  assert.throws(() => assertSafeSnapshot(changed));
});
