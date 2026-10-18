import assert from "node:assert/strict";
import {createHash} from "node:crypto";

const normalized = value => value.replaceAll("timestamp with time zone", "timestamptz").replaceAll(" ", "");
export const definitionHash = sql => createHash("sha256").update(sql).digest("hex");

export function buildScopedRecovery({snapshot, lineage, reference, retiredFinalizeHash, transaction = true}) {
  assert.equal(snapshot.live_execution_authorized, false, "artifact must not authorize live execution");
  assert.match(retiredFinalizeHash, /^[a-f0-9]{64}$/);
  const finalize = "integrations.finalize_provider_disconnect(uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz)";
  const expected = [...lineage.retired_function_signatures, finalize].map(normalized).sort();
  assert.deepEqual(snapshot.functions.map(row => normalized(row.signature)).sort(), expected, "exact seven-function scope required");
  for (const row of snapshot.functions) {
    assert.equal(row.owner, "adstable_owner");
    assert.equal(definitionHash(row.definition), row.definition_sha256, "captured function content changed");
    const name = row.signature.split("(")[0].split(".")[1];
    const original = reference.functions.filter(fn => fn.schema === "integrations" && fn.name === name);
    assert.equal(original.length, 1);
    assert.equal(row.definition_sha256, original[0].definition_sha256, "captured body must match immutable live metadata baseline");
  }
  const absenceChecks = lineage.retired_function_signatures.map(signature => `to_regprocedure('${signature}') is not null`).join(" or ");
  // pg_get_functiondef returns a definition, not a semicolon-terminated script.
  const bodies = snapshot.functions.map(row => `${row.definition};\nrevoke all on function ${row.signature} from public, anon, authenticated, service_role, adstable_runtime;\n${normalized(row.signature) === finalize ? `grant execute on function ${row.signature} to adstable_runtime;` : ""}`).join("\n");
  const body = `set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role adstable_owner;
lock table integrations.provider_authorization_handoffs in access exclusive mode;
do $f01c_guard$
begin
  if ${absenceChecks}
     or not exists (select 1 from pg_policies where schemaname='integrations' and tablename='provider_authorization_handoffs' and policyname='provider_authorization_handoffs_owner_read')
     or exists (select 1 from integrations.provider_authorization_handoffs where status not in ('consumed','failed','expired') or credential_id is not null)
     or encode(sha256(convert_to(pg_get_functiondef('${finalize}'::regprocedure),'UTF8')),'hex') <> '${retiredFinalizeHash}' then
    raise exception 'F01C_SCOPED_RECOVERY_PRECONDITION_FAILED';
  end if;
end
$f01c_guard$;
${bodies}
drop policy provider_authorization_handoffs_owner_read on integrations.provider_authorization_handoffs;
create policy provider_authorization_handoffs_owner_all on integrations.provider_authorization_handoffs for all to adstable_owner using (true) with check (true);
reset role;`;
  return transaction ? `begin;\n${body}\ncommit;` : body;
}
