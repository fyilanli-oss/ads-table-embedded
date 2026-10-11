import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20261011193000_eo04c_disconnect_handoff_credential_release.sql",
  import.meta.url,
);

test("disconnect finalization releases handoff credential references before deleting the credential", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const release = sql.indexOf(
    "update integrations.provider_authorization_handoffs as handoff",
  );
  const disconnect = sql.indexOf(
    "update integrations.provider_connections as connection",
  );
  const removeCredential = sql.indexOf(
    "delete from integrations.provider_credential_envelopes",
  );

  assert.ok(release >= 0, "handoff credential reference release is required");
  assert.ok(disconnect > release, "handoff reference must be released first");
  assert.ok(
    removeCredential > disconnect,
    "credential deletion must follow durable disconnect state",
  );
  assert.match(
    sql,
    /set credential_id = null,[\s\S]*where handoff\.credential_id = current_connection\.credential_id;/,
  );
  assert.doesNotMatch(
    sql,
    /delete from integrations\.provider_authorization_handoffs/,
  );
});
