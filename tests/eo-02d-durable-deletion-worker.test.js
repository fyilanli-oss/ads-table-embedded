import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read(
  "supabase/migrations/20261009160000_eo02d_durable_deletion_worker.sql",
);
const contract = JSON.parse(read(
  "contracts/eo-02d-durable-deletion-worker-v1.json",
));
const plan = read("docs/EXECUTION_PLAN.md");

test("corrective migration installs a durable five-minute database worker", () => {
  assert.match(migration, /create extension if not exists pg_cron/);
  assert.match(migration, /create or replace function privacy\.process_deletion_queue/);
  assert.match(migration, /'adstable-privacy-deletion-worker'/);
  assert.match(migration, /'\*\/5 \* \* \* \*'/);
  assert.match(migration, /select privacy\.process_deletion_queue\(25\)/);
  assert.doesNotMatch(migration, /pg_net|http_post|CRON_SECRET|vercel/i);
});

test("worker is bounded, overlap-safe and retry-visible", () => {
  assert.match(migration, /pg_try_advisory_xact_lock/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /p_batch_size > 100/);
  assert.match(migration, /run\.attempt_count < 20/);
  assert.match(migration, /pg_catalog\.least\(pg_catalog\.greatest\(run\.attempt_count - 1, 0\), 6\)/);
  assert.match(migration, /status = 'failed'/);
  assert.match(migration, /DELETION_EXECUTION_SQLSTATE_/);
  assert.doesNotMatch(migration, /sqlerrm/i);
});

test("application runtime cannot directly execute physical deletion", () => {
  assert.match(
    migration,
    /revoke all on function privacy\.execute_deletion_run\(uuid\)[\s\S]*adstable_runtime;/,
  );
  assert.match(
    migration,
    /revoke all on function privacy\.process_deletion_queue\(integer\)[\s\S]*adstable_runtime;/,
  );
  assert.match(
    migration,
    /grant execute on function privacy\.process_deletion_queue\(integer\)[\s\S]*to postgres;/,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function privacy\.process_deletion_queue\(integer\)[\s\S]*to adstable_runtime;/,
  );
});

test("cron history is bounded and the plan records verified live acceptance", () => {
  assert.match(migration, /'adstable-cron-history-cleanup'/);
  assert.match(migration, /interval '30 days'/);
  assert.equal(contract.architecture.engine, "Supabase Cron / pg_cron");
  assert.equal(contract.retry.maximum_attempts, 20);
  assert.equal(contract.security.application_runtime_can_execute_physical_deletion, false);
  assert.equal(contract.live_gate.repository_change_authorizes_live_mutation, false);
  assert.equal(contract.live_gate.explicit_user_approval_required, true);
  assert.match(plan, /EO-02-D — Verification/);
  assert.match(plan, /08:00 UTC doğal Cron koşusu/);
  assert.match(plan, /EO_02D_DURABLE_WORKER_LIVE_2026-10-09\.json/);
  assert.match(plan, /Teknik açık kalem sıfırdır/);
  assert.match(plan, /ürün sahibinin açık EO-02-D kapanış kabulü beklenmektedir/);
});
