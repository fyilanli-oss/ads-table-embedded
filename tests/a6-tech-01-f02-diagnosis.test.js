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
