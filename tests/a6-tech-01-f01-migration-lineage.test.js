import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {loadMigrationFiles, sqlHash, validateMigrationLineage} from "../tools/check-migration-lineage.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("contracts/a6-tech-01-f01-migration-lineage-v1.json"));
const evidence = JSON.parse(read(manifest.live_ledger_evidence));
const files = loadMigrationFiles(root);
const validate = (overrides = {}) => validateMigrationLineage({manifest, files, liveLedger: evidence.migrations, ...overrides});

test("lineage rejects missing owner context and context assigned to an unrelated migration", () => {
  const changed = structuredClone(manifest);
  const owner = changed.historical_migrations.find(entry => entry.execution_context);
  changed.historical_migrations[0].execution_context = owner.execution_context;
  delete owner.execution_context;
  assert.equal(validate({manifest: changed}).filter(error => error.startsWith("INVALID_EXECUTION_CONTEXT:")).length, 2);
});

test("historical migration versions, names and SQL fingerprints match the captured applied ledger", () => {
  assert.equal(manifest.historical_migrations.length, 38);
  assert.deepEqual(validate(), []);
  assert.equal(manifest.f01_closed, true);
  assert.equal(manifest.next_finding_may_start, true);
  const closure = JSON.parse(read(manifest.closure_evidence));
  assert.equal(closure.product_owner_closure_accepted, true);
  assert.equal(closure.F02_execution_authorized, false);
  assert.deepEqual(manifest.required_remaining_gates, []);
  assert.equal(manifest.live_mutation_authorized, false);
});

test("a same-name different-version migration cannot silently pass", () => {
  const changed = structuredClone(manifest);
  changed.historical_migrations[0].version = "20261006123846";
  assert.ok(validate({manifest: changed}).some((error) => error.startsWith("LIVE_LEDGER_MISMATCH:")));
  assert.ok(validate({manifest: changed}).some((error) => error.startsWith("PATH_VERSION_NAME_MISMATCH:")));
});

test("missing historical migrations and unauthorized SQL edits fail", () => {
  const first = manifest.historical_migrations[0].file;
  const changed = {...files, [first]: `${files[first]}\nselect 'changed';`};
  assert.ok(validate({files: changed}).includes(`SQL_CONTENT_CHANGED:${first}`));
  delete changed[first];
  assert.ok(validate({files: changed}).includes(`MISSING_FILE:${first}`));
});

test("extra local migrations, duplicate names and unexpected live history fail", () => {
  assert.ok(validate({files: {...files, "supabase/migrations/20261018140000_extra.sql": "select 1;"}})
    .some((error) => error.startsWith("UNREGISTERED_FILE:")));
  const changed = structuredClone(manifest);
  changed.historical_migrations.push(changed.historical_migrations[0]);
  assert.ok(validate({manifest: changed}).includes("DUPLICATE_VERSION"));
  assert.ok(validate({manifest: changed}).includes("DUPLICATE_NAME"));
  assert.ok(validate({liveLedger: [...evidence.migrations, {version: "20261018150000", name: "unexpected"}]})
    .some((error) => error.startsWith("UNREGISTERED_LIVE_MIGRATION:")));
});

test("captured applied SQL cannot change behind an unchanged version and name", () => {
  const changed = structuredClone(evidence.migrations);
  changed[0].applied_sql_sha256 = "0".repeat(64);
  assert.ok(validate({liveLedger: changed}).some((error) => error.startsWith("LIVE_LEDGER_MISMATCH:")));
  assert.equal(sqlHash(" begin;\r\ncommit;\r\n"), sqlHash("begin;\ncommit;"));
});

test("missing fingerprints cannot bypass historical or pending SQL protection", () => {
  const changed = structuredClone(manifest);
  delete changed.historical_migrations[0].repository_sql_sha256;
  delete changed.forward_migrations[0].repository_sql_sha256;
  assert.equal(validate({manifest: changed}).filter((error) => error.startsWith("SQL_HASH_REQUIRED:")).length, 2);
  const pending = manifest.forward_migrations[0].file;
  assert.ok(validate({files: {...files, [pending]: `${files[pending]}\nselect 1;`}})
    .includes(`SQL_CONTENT_CHANGED:${pending}`));
});

test("six recovered files match applied SQL while known historical wrapper differences remain explicit", () => {
  const recovered = manifest.historical_migrations.filter((entry) => entry.source_commit !== manifest.source_main_commit);
  assert.equal(recovered.length, 6);
  for (const entry of recovered) assert.equal(entry.repository_sql_sha256, entry.applied_sql_sha256);
  const differences = manifest.historical_migrations.filter((entry) => entry.applied_sql_difference);
  assert.equal(differences.length, 6);
  for (const entry of differences) assert.notEqual(entry.repository_sql_sha256, entry.applied_sql_sha256);
});

const retirement = read(manifest.forward_migrations[0].file);

test("applied forward migration cannot disappear from the live ledger or change its hash", () => {
  assert.deepEqual(manifest.pending_migrations.map(entry=>entry.name),["eo05a_refresh_work_tracking","eo05a_refresh_stop_records","eo05a_refresh_chunk_progress","eo05a_refresh_queue_check","eo05a_refresh_entitlement_check","eo05a_refresh_native_inventory","eo05a_refresh_preflight_bridge","eo05a_shared_api_quota","eo05a_quota_work_wait","eo05a_quota_stop_scope","eo05a_quota_scope_resolver","eo05a_quota_authority_binding","eo05a_quota_response_feedback","eo05a_google_quota_diagnostic","eo05a_refresh_scheduled_queue_check","eo05a_refresh_interrupted_work","eo05a_refresh_queue_entry_role","eo05a_admin_quota_context"]);
  assert.ok(manifest.pending_migrations.every(entry => entry.applied === false && entry.live_apply_authorized === false));
  assert.equal(manifest.forward_migrations[0].applied, true);
  assert.ok(validate({liveLedger: evidence.migrations.slice(0, 38)}).some(error => error.startsWith("LIVE_LEDGER_MISMATCH:")));
  const changed = structuredClone(evidence.migrations);
  changed.at(-1).applied_sql_sha256 = "0".repeat(64);
  assert.ok(validate({liveLedger: changed}).some(error => error.startsWith("LIVE_LEDGER_MISMATCH:")));
});
test("retirement requires terminal credential-free handoffs under a bounded exclusive lock", () => {
  assert.match(retirement, /set local lock_timeout = '5s'/);
  assert.match(retirement, /set local statement_timeout = '30s'/);
  assert.match(retirement, /lock table integrations\.provider_authorization_handoffs in access exclusive mode/);
  assert.match(retirement, /status not in \('consumed', 'failed', 'expired'\)\s+or credential_id is not null/);
  assert.ok(retirement.indexOf("A6TECH01_HANDOFF_RETIREMENT_PRECONDITION_FAILED") < retirement.indexOf("create or replace function"));
  assert.match(retirement, /for select to adstable_owner using \(true\)/);
});

test("retirement drops exactly six obsolete functions, retaining callback and canonical disconnect behavior", () => {
  const dropped = [...retirement.matchAll(/^drop function (.+) restrict;$/gm)].map((match) => match[1]);
  assert.deepEqual(dropped, manifest.retired_function_signatures);
  assert.doesNotMatch(retirement, /drop\s+(table|schema)|\bcascade\s*;/i);
  const canonical = Object.values(files).map((sql) => sql.replaceAll("\r\n", "\n")).find((sql) => sql.includes("on conflict on constraint provider_accounts_connection_account_unique")
    && sql.includes("create or replace function integrations.reconnect_provider_connection(")
    && !sql.includes("create table"));
  const signature = "create or replace function integrations.finalize_provider_disconnect(";
  const start = canonical.indexOf(signature);
  const expected = canonical.slice(start, canonical.indexOf("$function$;", start) + "$function$;".length);
  assert.ok(retirement.includes(expected), "canonical disconnect body must be preserved exactly");
  const outsideCanonical = retirement.replace(expected, "");
  assert.doesNotMatch(outsideCanonical, /\b(delete|truncate|insert|update)\s/i);
  assert.match(outsideCanonical, /shopify\.resolve_active_installation_callback_return/);
});

function walk(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) =>
    entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
}

test("active repositories use callback return but never call a retired handoff function", () => {
  const sources = walk(`${root}/app`).filter((file) => /\.[jt]sx?$/.test(file)).map((file) => readFileSync(file, "utf8"));
  for (const source of sources) assert.doesNotMatch(source, /integrations\.\w*authorization_handoff/);
  assert.equal(sources.filter((source) => source.includes("shopify.resolve_active_installation_callback_return(")).length, 3);
});
