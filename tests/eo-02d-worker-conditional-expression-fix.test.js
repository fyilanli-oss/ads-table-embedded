import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read(
  "supabase/migrations/20261009161000_eo02d_worker_conditional_expression_fix.sql",
);

test("PostgreSQL conditional expressions are not schema-qualified", () => {
  assert.match(migration, /least\(greatest\(run\.attempt_count - 1, 0\), 6\)/);
  assert.doesNotMatch(migration, /pg_catalog\.(?:greatest|least)\s*\(/i);
});

test("corrective migration preserves the bounded worker and least-privilege grant", () => {
  assert.match(migration, /pg_catalog\.pg_try_advisory_xact_lock/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /run\.attempt_count < 20/);
  assert.match(migration, /p_batch_size > 100/);
  assert.match(migration, /DELETION_EXECUTION_SQLSTATE_/);
  assert.match(
    migration,
    /revoke all on function privacy\.process_deletion_queue\(integer\)[\s\S]*adstable_runtime;/,
  );
  assert.match(
    migration,
    /grant execute on function privacy\.process_deletion_queue\(integer\)[\s\S]*to postgres;/,
  );
});
