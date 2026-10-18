import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {buildScopedRecovery, definitionHash} from "../tools/f01-scoped-recovery.mjs";

const json = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const snapshot = json("contracts/a6-tech-01-f01c-scoped-recovery-v1.json");
const lineage = json("contracts/a6-tech-01-f01-migration-lineage-v1.json");
const reference = json("docs/evidence/A6_TECH_01_F01_LIVE_SCHEMA_2026-10-18.json").inventory;
const build = overrides => buildScopedRecovery({snapshot, lineage, reference, retiredFinalizeHash: snapshot.expected_retired_finalize_definition_sha256, ...overrides});

test("scoped recovery preserves seven exact captured bodies without restoring legacy runtime grants", () => {
  const sql = build();
  assert.equal(definitionHash(sql), "954dc40d045601e2cc2600b76b65ecf05b2e284972e4d63ac183f5288706acec", "reconstructed SQL must match the real database-tested recovery artifact");
  for (const fn of snapshot.functions) {
    assert.ok(sql.includes(fn.definition));
    assert.ok(sql.includes(`${fn.definition};\nrevoke all on function ${fn.signature}`), "captured definitions must be separated from their REVOKE statements");
  }
  const grants = sql.match(/^grant execute.*$/gm);
  assert.equal(grants.length, 1);
  assert.match(grants[0], /integrations\.finalize_provider_disconnect/);
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;$/);
  assert.match(sql, /F01C_SCOPED_RECOVERY_PRECONDITION_FAILED/);
  assert.match(sql, /lock_timeout = '5s'/);
  assert.match(sql, /statement_timeout = '30s'/);
  const outsideFunctions = sql.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assert.doesNotMatch(outsideFunctions, /\b(delete from|insert into|update integrations\.|truncate|drop table|alter role|schema_migrations)\b/i);
  assert.equal(lineage.live_mutation_authorized, false);
  assert.equal(lineage.f01_closed, false);
});

test("changed content, changed owner, unexpected signatures and forged hashes fail closed", () => {
  const changed = structuredClone(snapshot);
  changed.functions[0].definition += "\nselect 1;";
  assert.throws(() => build({snapshot: changed}), /content changed/);
  changed.functions[0].definition = snapshot.functions[0].definition;
  changed.functions[0].owner = "postgres";
  assert.throws(() => build({snapshot: changed}));
  assert.throws(() => build({snapshot: {...snapshot, functions: snapshot.functions.slice(1)}}), /seven-function/);
  assert.throws(() => build({retiredFinalizeHash: "'; select 1;"}));
  assert.throws(() => build({retiredFinalizeHash: "0".repeat(64)}), /proven recovery source state/);
  assert.throws(() => build({snapshot: {...snapshot, live_execution_authorized: true}}));
  const forgedReference = structuredClone(reference);
  forgedReference.functions.find(fn => fn.name === "cancel_provider_authorization_handoff").definition_sha256 = "0".repeat(64);
  assert.throws(() => build({reference: forgedReference}), /immutable live metadata/);
});

test("scoped recovery body can be tested in a rollback-only scenario without nested transactions", () => {
  const sql = build({transaction: false});
  assert.doesNotMatch(sql, /^begin;|^commit;$/m);
  assert.match(sql, /set local role adstable_owner/);
  assert.equal(lineage.backup_restore_evidence_status, "not_satisfied_scoped_alternative_requires_explicit_acceptance");
});
