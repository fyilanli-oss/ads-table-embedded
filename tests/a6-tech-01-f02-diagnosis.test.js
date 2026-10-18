import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const evidence = JSON.parse(read("docs/evidence/A6_TECH_01_F02_DIAGNOSIS_2026-10-18.json"));

test("F02 diagnosis preserves proof limits and authorizes neither deletion nor provider revocation", () => {
  assert.equal(evidence.candidate_count, 1);
  assert.equal(evidence.candidate.connection_references, 0);
  assert.equal(evidence.candidate.handoff_references, 0);
  assert.equal(evidence.valid_inflight_oauth_same_owner, 0);
  assert.equal(evidence.proposed_cleanup.live_cleanup_authorized, false);
  assert.equal(evidence.proposed_cleanup.provider_revocation_authorized, false);
  assert.equal(evidence.verification.real_token_decryption, false);
  assert.equal(evidence.F02_closed, false);
  assert.match(evidence.causality.candidate_link_to_historical_event, /not_direct_ID_lineage/);
  assert.match(evidence.proposed_cleanup.after_commit_envelope_restore, /not_available/);
});

test("current stage captures the old ID before replacement and deletes that exact previous ID", () => {
  const sql = read("supabase/migrations/20261011183443_eo04c_qualify_account_selection_columns.sql");
  const stage = sql.slice(0, sql.indexOf("create or replace function integrations.complete_pending_provider_account_selection"));
  assert.ok(stage.indexOf("previous_credential_id := current_connection.credential_id") < stage.indexOf("set credential_id = p_credential_id"));
  assert.match(stage, /delete from integrations\.provider_credential_envelopes as credential\s+where credential.id = previous_credential_id/);
  const runner = read("tools/f01-database-replay.mjs");
  assert.match(runner, /await credentialReplacementRegression\(client\);/);
  assert.match(runner, /F02_REPLACEMENT_PASS old_removed new_preserved foreign_preserved invalid_replacement_rolled_back/);
});

test("F02 live receipt proves one authorized deletion without changing bound credentials or history", () => {
  const receipt = JSON.parse(read("docs/evidence/A6_TECH_01_F02_LIVE_CLEANUP_2026-10-18.json"));
  assert.equal(receipt.approval.one_record_cleanup_approved, true);
  assert.equal(receipt.approval.after_commit_envelope_restore_unavailable_explicitly_accepted, true);
  assert.equal(receipt.approval.repeat_mutation_authorized, false);
  assert.equal(receipt.execution.deleted_records, 1);
  assert.equal(receipt.before.candidate_count, 1);
  assert.equal(receipt.after.candidate_count, 0);
  assert.equal(receipt.after.credentials, receipt.before.credentials - 1);
  assert.equal(receipt.after.orphan_google_credentials, 0);
  for (const key of ["bound_credentials", "connections", "history_rows", "other_credentials_sha256", "connections_sha256", "history_sha256"]) {
    assert.equal(receipt.before[key], receipt.after[key], key);
  }
  assert.equal(receipt.security_advisor_findings, 0);
  assert.equal(receipt.F02_closed, false);
  const sql = read(receipt.execution.sql_evidence);
  assert.match(sql, /F02_PRECONDITION_DRIFT/);
  assert.match(sql, /F02_EXACT_DELETE_COUNT_INVALID/);
  assert.match(sql, /F02_POSTCONDITION_FAILED/);
  assert.ok(sql.indexOf("F02_POSTCONDITION_FAILED") < sql.indexOf("commit;"));
  assert.equal((sql.match(/delete from /g) ?? []).length, 1);
});
