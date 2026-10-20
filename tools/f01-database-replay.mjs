import assert from "node:assert/strict";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import pg from "pg";
import {loadMigrationFiles, validateMigrationLineage, validExecutionContext} from "./check-migration-lineage.mjs";
import {buildScopedRecovery, definitionHash} from "./f01-scoped-recovery.mjs";
import {privacyIndexPlanProbe, assertPrivacyIndexes} from "./f08-privacy-index-probe.mjs";
import {refreshWorkTrackingProbe} from "./eo05-refresh-work-probe.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");
const manifest = JSON.parse(read("contracts/a6-tech-01-f01-migration-lineage-v1.json"));
const inventorySql = read("tools/f01-schema-inventory.sql");
const retirementSql = read(manifest.forward_migrations[0].file);
const recoverySnapshot = JSON.parse(read("contracts/a6-tech-01-f01c-scoped-recovery-v1.json"));
const historicalReference = JSON.parse(read("docs/evidence/A6_TECH_01_F01_LIVE_SCHEMA_2026-10-18.json")).inventory;
// Within rollback-only scenario transactions, preserve the SQL body exactly.
const retirementBody = retirementSql.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "");

export const replayConnection = Object.freeze({
  host: "127.0.0.1", port: 54322, database: "postgres",
  user: "postgres", password: "postgres", connectionTimeoutMillis: 10000,
  application_name: "adstable-f01b-isolated-replay",
});

export function assertReplayEnvironment(environment) {
  assert.equal(environment.GITHUB_ACTIONS, "true", "F01-B runs only on an ephemeral GitHub runner");
  assert.ok(environment.RUNNER_TEMP, "runner temporary directory required");
  // The database address is compiled above; no URL/secret/environment override is accepted.
  assert.equal(replayConnection.host, "127.0.0.1");
}

export async function executeMigration(client, entry, sql) {
  assert.ok(validExecutionContext(entry), "unsupported migration execution context");
  if (!entry.execution_context) return client.query(sql);
  await client.query("begin");
  try {
    // Literal, allowlisted role: never interpolate manifest data into SQL.
    await client.query("set local role adstable_owner");
    await client.query(sql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

const replayRoleSql = Object.freeze({
  postgres: "set local role postgres",
  adstable_owner: "set local role adstable_owner",
  adstable_runtime: "set local role adstable_runtime",
});
let roleScope = 0;

// An active transaction is mandatory: SAVEPOINT deliberately refuses autocommit.
export async function withReplayRole(client, role, operation) {
  assert.ok(Object.hasOwn(replayRoleSql, role), "unsupported replay role");
  const previous = (await client.query("select current_user as role")).rows[0].role;
  assert.ok(Object.hasOwn(replayRoleSql, previous), "unsupported previous replay role");
  const savepoint = `f01b_role_${++roleScope}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await client.query(replayRoleSql[role]);
    const result = await operation();
    await client.query(replayRoleSql[previous]);
    await client.query(`release savepoint ${savepoint}`);
    return result;
  } catch (error) {
    // Also restores SET LOCAL changes and clears an aborted SQL subtransaction.
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    throw error;
  }
}

export function inventoryDifferences(expected, actual) {
  return Object.keys(expected).flatMap((category) => {
    const left = expected[category] ?? [];
    const right = actual[category] ?? [];
    return JSON.stringify(left) === JSON.stringify(right) ? [] : [{
      category, expected_count: left.length, actual_count: right.length,
      missing_or_changed: left.filter((item) => !right.some((other) => JSON.stringify(item) === JSON.stringify(other))).slice(0, 20),
      extra_or_changed: right.filter((item) => !left.some((other) => JSON.stringify(item) === JSON.stringify(other))).slice(0, 20),
    }];
  });
}

const inventory = async (client) => (await client.query(inventorySql)).rows[0].inventory;
const countHistory = async (client) => withReplayRole(client, "adstable_owner", async () =>
  Number((await client.query("select count(*) as count from integrations.provider_authorization_handoffs")).rows[0].count));
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const membershipSql = `select member.rolname as member, grantor.rolname as grantor,
  m.admin_option, m.inherit_option, m.set_option
  from pg_auth_members m join pg_roles role on role.oid=m.roleid
  join pg_roles member on member.oid=m.member join pg_roles grantor on grantor.oid=m.grantor
  where role.rolname='adstable_runtime' order by member.rolname,grantor.rolname`;

export async function withTestRuntimeMembership(client, run, environment = process.env) {
  assertReplayEnvironment(environment);
  assert.equal((await client.query("select session_user as role")).rows[0].role, "postgres");
  const before = (await client.query(membershipSql)).rows;
  assert.ok(!before.some(row => row.member === "postgres" && row.grantor === "postgres"),
    "unexpected existing test grant; do not overwrite it");
  await client.query("begin");
  try {
    // Test-only, uncommitted membership. No application object grant is changed.
    await client.query("grant adstable_runtime to postgres with inherit false, set true, admin false");
    const during = (await client.query(membershipSql)).rows;
    assert.deepEqual(during.filter(row => !(row.member === "postgres" && row.grantor === "postgres")), before);
    assert.deepEqual(during.filter(row => row.member === "postgres" && row.grantor === "postgres"),
      [{member: "postgres", grantor: "postgres", admin_option: false, inherit_option: false, set_option: true}]);
    return await run();
  } finally {
    await client.query("rollback");
    assert.deepEqual((await client.query(membershipSql)).rows, before, "test role membership must be restored exactly");
    console.log("F01B_TEST_MEMBERSHIP_RESTORED");
  }
}

async function rollbackScenario(client, name, run) {
  await withTestRuntimeMembership(client, run);
  console.log(`F01B_SCENARIO_PASS ${name}`);
}

async function expectSqlFailure(client, name, operation, expected) {
  await client.query("savepoint expected_failure");
  let failure;
  try { await operation(); } catch (error) { failure = error; }
  await client.query("rollback to savepoint expected_failure");
  await client.query("release savepoint expected_failure");
  assert.ok(failure, `${name} unexpectedly succeeded`);
  if (expected.code) assert.equal(failure.code, expected.code, name);
  if (expected.message) assert.equal(failure.message, expected.message, name);
}

async function fixture(client, statuses = []) {
  return withReplayRole(client, "adstable_owner", () => fixtureAsOwner(client, statuses));
}

async function fixtureAsOwner(client, statuses) {
  const shopId = `gid://shopify/Shop/99${Date.now()}${randomBytes(3).readUIntBE(0, 3)}`;
  const domain = `f01b-${randomBytes(6).toString("hex")}.myshopify.com`;
  const identity = randomBytes(32);
  const authority = await withReplayRole(client, "adstable_runtime", async () => (await client.query(
    "select * from shopify.bootstrap_installation($1,$2,$3,statement_timestamp())", [shopId, domain, identity],
  )).rows[0]);
  const workspace = authority.workspace_id;
  const generation = authority.install_generation;
  const installation = (await client.query("select id from shopify.installations where workspace_id=$1", [workspace])).rows[0].id;
  const credentials = [];
  for (const mode of statuses) {
    const tx = randomUUID();
    await client.query(`insert into integrations.oauth_transactions
      (id,installation_id,workspace_id,install_generation,provider,state_digest,transaction_nonce,callback_uri,
       pkce_required,pkce_challenge,status,created_at,expires_at,completed_at)
      values ($1,$2,$3,$4,'google_ads',$5,$6,'https://embedded.adstable.app/auth/google-ads/callback',true,$7,
       'exchanged',statement_timestamp(),statement_timestamp()+interval '10 minutes',statement_timestamp())`,
    [tx,installation,workspace,generation,randomBytes(32),randomBytes(32),"A".repeat(43)]);
    let credential = null;
    if (mode === "awaiting_selection" || mode === "consumed_with_credential") {
      credential = await insertCredential(client, {workspace, generation, installation});
      credentials.push(credential);
    }
    const status = mode === "consumed_with_credential" ? "consumed" : mode;
    await client.query(`insert into integrations.provider_authorization_handoffs
      (oauth_transaction_id,installation_id,workspace_id,install_generation,provider,credential_id,status,
       failure_code,created_at,expires_at,consumed_at)
      values ($1,$2,$3,$4,'google_ads',$5,$6,$7,statement_timestamp(),null,
       case when $6='consumed' then statement_timestamp() else null end)`,
    [tx,installation,workspace,generation,credential,status,["failed","expired"].includes(status)?"F01B_SYNTHETIC_TERMINAL":null]);
  }
  return {shopId, domain, identity, workspace, generation, installation, credentials};
}

async function insertCredential(client, authority) {
  return withReplayRole(client, "adstable_owner", () => insertCredentialAsOwner(client, authority));
}

async function insertCredentialAsOwner(client, authority) {
  const id = randomUUID();
  await client.query(`insert into integrations.provider_credential_envelopes
    (id,installation_id,workspace_id,install_generation,provider,purpose,payload_ciphertext,nonce,auth_tag,key_version)
    values ($1,$2,$3,$4,'google_ads','provider_token_set',$5,$6,$7,1)`,
  [id,authority.installation,authority.workspace,authority.generation,
    Buffer.from("F01B_SYNTHETIC_NOT_A_PROVIDER_TOKEN"),randomBytes(12),randomBytes(16)]);
  return id;
}

async function assertRetired(client, authority) {
  for (const signature of manifest.retired_function_signatures) {
    assert.equal((await client.query("select to_regprocedure($1)::text as signature", [signature])).rows[0].signature, null);
  }
  await withReplayRole(client, "adstable_runtime", async () => {
  const callback = (await client.query("select * from shopify.resolve_active_installation_callback_return($1,$2)",
    [authority.workspace,authority.generation])).rows;
  assert.equal(callback[0].shop_domain, authority.domain);
  await expectSqlFailure(client,"runtime_table_access",() => client.query("select * from integrations.provider_authorization_handoffs"),{code:"42501"});
  });
}

async function rolePreflight(client) {
  for (const role of Object.keys(replayRoleSql)) {
    await rollbackScenario(client, `role_boundary_${role}`, async () => {
      assert.equal((await client.query("select pg_has_role(session_user,$1,'SET') as allowed", [role])).rows[0].allowed,
        true, `prepared test SET membership required: ${role}`);
      await withReplayRole(client, role, async () => {
        assert.equal((await client.query("select current_user as role")).rows[0].role, role);
        if (role === "adstable_runtime") {
          await expectSqlFailure(client, "runtime_fixture_insert_denied", () => client.query(
            "insert into app.workspaces default values"), {code: "42501"});
        }
      });
      assert.equal((await client.query("select current_user as role")).rows[0].role, "postgres");
    });
  }
  for (const schema of ["app", "shopify", "integrations", "privacy", "billing", "analytics", "operations"]) {
    for (const role of ["adstable_owner", "adstable_runtime"]) {
      assert.equal((await client.query("select has_schema_privilege($1,$2,'USAGE') as allowed", [role,schema])).rows[0].allowed, true,
        `schema usage required: ${role}/${schema}`);
    }
  }
  assert.equal((await client.query("select has_schema_privilege('postgres','privacy','USAGE') as allowed")).rows[0].allowed, true,
    "privacy worker schema access required; never mask a missing application permission");
  const functions = [
    ["adstable_runtime", "shopify.bootstrap_installation(text,text,bytea,timestamptz)"],
    ["adstable_runtime", "shopify.resolve_active_installation_callback_return(uuid,bigint)"],
    ["adstable_runtime", "integrations.stage_provider_account_selection(uuid,uuid,bigint,text,uuid,text[],timestamptz)"],
    ["adstable_runtime", "integrations.complete_pending_provider_account_selection(uuid,uuid,bigint,text,bigint,jsonb,timestamptz)"],
    ["adstable_runtime", "integrations.transition_provider_connection_lifecycle(uuid,uuid,uuid,bigint,text,bigint,text,text,text,timestamptz)"],
    ["adstable_runtime", "integrations.finalize_provider_disconnect(uuid,uuid,uuid,bigint,text,bigint,text,text,timestamptz)"],
    ["adstable_runtime", "privacy.request_workspace_deletion(text,text,text,bigint,bytea,timestamptz)"],
    ["postgres", "privacy.process_deletion_queue(integer)"],
  ];
  for (const [role, signature] of functions) {
    assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role,signature])).rows[0].allowed, true,
      `function execute required: ${role}/${signature}`);
  }
  await rollbackScenario(client, "fixture_contract_preflight", () => fixture(client,
    ["consumed", "failed", "expired", "awaiting_selection", "consumed_with_credential"]));
  await rollbackScenario(client, "historical_lifecycle_privacy_baseline", async () => {
    await canonicalDisconnectAndPrivacy(client, await fixture(client));
  });
}

async function securityProbes(client) {
  const unsafeTables=await client.query(`select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('app','shopify','integrations','analytics','operations','privacy','billing') and c.relkind='r'
    and (not c.relrowsecurity or not c.relforcerowsecurity or exists (
      select 1 from unnest(array['anon','authenticated','service_role','adstable_runtime']) as r(name)
      where has_table_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))) `);
  assert.deepEqual(unsafeTables.rows,[],"private tables must remain forced-RLS and function-only");
  const unsafeFunctions=await client.query(`select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('app','shopify','integrations','analytics','operations','privacy','billing') and p.prokind='f'
    and (exists (select 1 from unnest(array['anon','authenticated','service_role']) as r(name)
      where has_function_privilege(r.name,p.oid,'EXECUTE'))
      or (p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'],false)))`);
  assert.deepEqual(unsafeFunctions.rows,[],"private function grants and security-definer search_path must stay bounded");
}

async function canonicalDisconnectAndPrivacy(client, authority) {
  const credential = await insertCredential(client, authority);
  const orphan = await insertCredential(client, authority);
  const connection = randomUUID();
  await withReplayRole(client, "adstable_runtime", async () => {
  await client.query(`select * from integrations.stage_provider_account_selection(
    $1,$2,$3,'google_ads',$4,array['adwords'],statement_timestamp())`,
  [connection,authority.workspace,authority.generation,credential]);
  const connected = (await client.query(`select * from integrations.complete_pending_provider_account_selection(
    $1,$2,$3,'google_ads',1,$4::jsonb,statement_timestamp())`,
  [connection,authority.workspace,authority.generation,JSON.stringify([{id:"999000111",name:"F01B synthetic advertiser",kind:"advertiser",reporting_eligible:true}])])).rows[0];
  assert.equal(connected.lifecycle_status,"connected");
  const pending = (await client.query(`select * from integrations.transition_provider_connection_lifecycle(
    $1,$2,$3,$4,'google_ads',$5,'disconnect_requested','F01B_SYNTHETIC_REVOKED',null,statement_timestamp())`,
  [randomUUID(),connection,authority.workspace,authority.generation,connected.connection_version])).rows[0];
  const event = randomUUID();
  const args = [event,connection,authority.workspace,authority.generation,pending.connection_version];
  const sql = `select * from integrations.finalize_provider_disconnect(
    $1,$2,$3,$4,'google_ads',$5,'revoked','F01B_SYNTHETIC_REVOKED',statement_timestamp())`;
  const disconnected = (await client.query(sql,args)).rows[0];
  assert.equal(disconnected.lifecycle_status,"disconnected");
  assert.deepEqual((await client.query(sql,args)).rows[0],disconnected,"disconnect replay must be idempotent");
  });
  await withReplayRole(client, "adstable_owner", async () => {
  assert.equal((await client.query("select count(*)::int as n from integrations.provider_credential_envelopes where id=$1",[credential])).rows[0].n,0);
  assert.equal((await client.query("select count(*)::int as n from integrations.provider_credential_envelopes where id=$1",[orphan])).rows[0].n,1,"F02 orphan must remain untouched");
  });
  await withReplayRole(client, "adstable_runtime", async () => {
  await client.query(`select privacy.request_workspace_deletion($1,$2,$3,$4,$5,statement_timestamp())`,
    [`f01b-delete-${randomUUID()}`,authority.shopId,authority.domain,authority.generation,authority.identity]);
  });
  const worker = await withReplayRole(client, "postgres", async () =>
    (await client.query("select * from privacy.process_deletion_queue(25)")).rows[0]);
  assert.equal(worker.failed_count,0);
  assert.equal(worker.completed_count,1);
  assert.equal(await countHistory(client),0,"privacy cascade must remove historical handoffs");
}

async function credentialReplacementRegression(client) {
  await rollbackScenario(client, "F02_pending_credential_replacement", async () => {
    const authority = await fixture(client);
    const foreignAuthority = await fixture(client);
    const oldCredential = await insertCredential(client, authority);
    const newCredential = await insertCredential(client, authority);
    const unrelatedCredential = await insertCredential(client, foreignAuthority);
    const connection = randomUUID();
    const stage = credential => withReplayRole(client, "adstable_runtime", () => client.query(
      `select * from integrations.stage_provider_account_selection(
        $1,$2,$3,'google_ads',$4,array['adwords'],statement_timestamp())`,
      [connection,authority.workspace,authority.generation,credential]));
    const present = credential => withReplayRole(client, "adstable_owner", async () =>
      (await client.query("select count(*)::int as n from integrations.provider_credential_envelopes where id=$1", [credential])).rows[0].n);
    await stage(oldCredential);
    await expectSqlFailure(client, "F02_foreign_credential_refused", () => stage(unrelatedCredential),
      {message: "PROVIDER_CREDENTIAL_AUTHORITY_MISMATCH"});
    assert.equal(await present(oldCredential), 1, "failed replacement must retain the current credential");
    const replaced = (await stage(newCredential)).rows[0];
    assert.equal(replaced.connection_id, connection);
    assert.equal(replaced.credential_id, newCredential);
    assert.equal(await present(oldCredential), 0, "superseded credential must be deleted using its previous identity");
    assert.equal(await present(newCredential), 1, "replacement credential must remain");
    assert.equal(await present(unrelatedCredential), 1, "another workspace credential must remain");
    console.log("F02_REPLACEMENT_PASS old_removed new_preserved foreign_preserved invalid_replacement_rolled_back");
  });
}

async function scenarios(client) {
  for (const [name,statuses] of [["empty",[]],["terminal_history",["consumed","consumed",...Array(6).fill("failed")]]]) {
    await rollbackScenario(client,name,async()=>{
      const authority=await fixture(client,statuses);
      const rowsBefore=await countHistory(client);
      await client.query(retirementBody);
      assert.equal(await countHistory(client),rowsBefore);
      await assertRetired(client,authority);
      if (name === "terminal_history") await canonicalDisconnectAndPrivacy(client,authority);
    });
  }
  for (const mode of ["awaiting_selection","consumed_with_credential"]) {
    await rollbackScenario(client,mode,async()=>{
      await fixture(client,[mode]);
      const before=await inventory(client);
      const rowsBefore=await countHistory(client);
      await expectSqlFailure(client,mode,()=>client.query(retirementBody),{
        message:"A6TECH01_HANDOFF_RETIREMENT_PRECONDITION_FAILED",
      });
      assert.deepEqual(await inventory(client),before,"failed retirement must preserve all schema/grants");
      assert.equal(await countHistory(client),rowsBefore);
    });
  }
  await rollbackScenario(client,"restrict_dependency_rollback",async()=>{
    await fixture(client);
    await withReplayRole(client, "adstable_owner", () => client.query(`create view integrations.f01b_dependency as select * from integrations.load_current_provider_authorization_handoff(null::uuid,null::bigint,null::text,null::timestamptz)`));
    const before=await inventory(client);
    await expectSqlFailure(client,"restrict_dependency",()=>client.query(retirementBody),{code:"2BP01"});
    assert.deepEqual(await inventory(client),before,"late DDL failure must roll back earlier replacement and drops");
  });
  const blocker=new pg.Client(replayConnection);
  const contender=new pg.Client(replayConnection);
  await blocker.connect(); await contender.connect();
  try {
    await blocker.query("begin");
    await withReplayRole(blocker, "adstable_owner", () => blocker.query("lock table integrations.provider_authorization_handoffs in access share mode"));
    await contender.query("begin");
    await expectSqlFailure(contender,"concurrent_lock",()=>contender.query(retirementBody),{code:"55P03"});
    console.log("F01B_SCENARIO_PASS concurrent_lock_timeout");
  } finally {
    await blocker.query("rollback"); await contender.query("rollback");
    await blocker.end(); await contender.end();
  }
}

const finalizeMetadata = catalog => catalog.functions.find(fn => fn.schema === "integrations" && fn.name === "finalize_provider_disconnect");

async function dataFingerprint(client) {
  return (await client.query(`select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(h) order by oauth_transaction_id)::text,'[]'),'UTF8')),'hex') as history_hash,
    (select count(*) from integrations.provider_connections) as connections,
    (select count(*) from integrations.provider_credential_envelopes) as credentials
    from integrations.provider_authorization_handoffs h`)).rows[0];
}

function recoverySql(retired, transaction = true) {
  return buildScopedRecovery({snapshot: recoverySnapshot, lineage: manifest, reference: historicalReference,
    retiredFinalizeHash: finalizeMetadata(retired).definition_sha256, transaction});
}

function assertRecoveredCatalog(original, recovered) {
  const expected = structuredClone(original);
  const retiredNames = manifest.retired_function_signatures.map(signature => signature.split("(")[0].split(".")[1]);
  for (const fn of expected.functions) {
    if (fn.schema === "integrations" && retiredNames.includes(fn.name)) fn.acl = "{adstable_owner=X/adstable_owner}";
  }
  assert.deepEqual(inventoryDifferences(expected, recovered), [], "only six legacy runtime EXECUTE grants may differ from historical state");
}

async function scopedRecoveryScenarios(client) {
  await rollbackScenario(client, "scoped_recovery_terminal_history_and_failure_rollback", async () => {
    const authority = await fixture(client, ["consumed", "consumed", ...Array(6).fill("failed")]);
    const original = await inventory(client);
    const dataBefore = await withReplayRole(client, "adstable_owner", () => dataFingerprint(client));
    await client.query(retirementBody);
    const retired = await inventory(client);
    const body = recoverySql(retired, false);
    await expectSqlFailure(client, "late_recovery_failure", () => client.query(`${body}\nselect 1/0;`), {code: "22012"});
    assert.deepEqual(await inventory(client), retired, "late recovery error must undo all recovered DDL/grants");
    await client.query(body);
    assertRecoveredCatalog(original, await inventory(client));
    assert.deepEqual(await withReplayRole(client, "adstable_owner", () => dataFingerprint(client)), dataBefore);
    await canonicalDisconnectAndPrivacy(client, authority);
  });
}

async function committedRecoveryRoundtrip(client, original) {
  const retired = await inventory(client);
  // Both statements below are standalone full transactions on the isolated database.
  const sql = recoverySql(retired);
  await client.query(sql);
  assertRecoveredCatalog(original, await inventory(client));
  await securityProbes(client);
  await client.query(retirementSql);
  assert.deepEqual(inventoryDifferences(retired, await inventory(client)), [], "retire/recover/retire must converge exactly");
  console.log(`F01C_SCOPED_RECOVERY_PASS ${JSON.stringify({recovery_sql_sha256: definitionHash(sql),
    committed_roundtrip: true, restored_function_count: 7, legacy_runtime_execute_restored: false,
    database_backup: false, production_mutation: false})}`);
}

async function main() {
  assertReplayEnvironment(process.env);
  const mode=process.argv[2];
  assert.ok(["staged","full"].includes(mode),"mode must be staged or full");
  assert.deepEqual(validateMigrationLineage({manifest,files:loadMigrationFiles(root)}),[]);
  const client=new pg.Client(replayConnection);
  await client.connect();
  try {
    const version=Number((await client.query("show server_version_num")).rows[0].server_version_num);
    assert.ok(version>=170000 && version<180000,"PostgreSQL 17 required");
    assert.equal((await client.query("select count(*)::int as n from pg_namespace where nspname='app'")).rows[0].n,0,"database must be empty before replay");
    const migrations=mode==="staged"?manifest.historical_migrations:[...manifest.historical_migrations,...manifest.forward_migrations,...manifest.pending_migrations];
    for (const entry of migrations) {
      console.log(`F01B_APPLY ${entry.version} ${entry.name}`);
      await executeMigration(client, entry, read(entry.file));
    }
    let beforeDifferences=[];
    if(mode==="staged") {
      const before=await inventory(client);
      const live=JSON.parse(read("docs/evidence/A6_TECH_01_F01_LIVE_SCHEMA_2026-10-18.json")).inventory;
      beforeDifferences=inventoryDifferences(live,before);
      if(beforeDifferences.length) console.log(`F01B_LIVE_PARITY_DIFFERENCES ${JSON.stringify(beforeDifferences)}`);
      assert.equal(beforeDifferences.length,0,"historical replay differs from captured live schema; review required");
      console.log("F01B_LIVE_PARITY_PASS");
      await rolePreflight(client);
      await scenarios(client);
      await scopedRecoveryScenarios(client);
      await rollbackScenario(client, "fixtures_rolled_back", () => withReplayRole(client, "adstable_owner", async () => {
        assert.equal((await client.query("select count(*)::int as n from app.workspaces")).rows[0].n,0,"scenario fixtures must roll back to zero");
      }));
      await client.query(retirementSql);
      await committedRecoveryRoundtrip(client, before);
      const additionalMigrations = [...manifest.forward_migrations.slice(1), ...manifest.pending_migrations];
      const privacyIndexes = additionalMigrations.find(entry => entry.name === "a6tech01_privacy_workspace_fk_indexes");
      if (privacyIndexes) await privacyIndexPlanProbe(client, read(privacyIndexes.file));
      for (const entry of additionalMigrations) await executeMigration(client, entry, read(entry.file));
    }
    if ([...manifest.forward_migrations, ...manifest.pending_migrations].some(entry => entry.name === "a6tech01_privacy_workspace_fk_indexes")) {
      await assertPrivacyIndexes(client);
    }
    await credentialReplacementRegression(client);
    if (manifest.pending_migrations.some(entry => entry.name === "eo05a_refresh_work_tracking")) {
      await refreshWorkTrackingProbe(client, replayConnection);
    }
    const after=await inventory(client);
    await securityProbes(client);
    const output=path.join(process.env.RUNNER_TEMP,"f01b-staged-schema.json");
    if(mode==="staged") writeFileSync(output,JSON.stringify(after));
    else {
      const staged=JSON.parse(readFileSync(output,"utf8"));
      assert.deepEqual(inventoryDifferences(staged,after),[],"second clean replay must match staged final schema");
    }
    console.log(`F01B_EVIDENCE ${JSON.stringify({mode,postgres_version_num:version,migrations_applied:migrations.length+(mode==="staged"?manifest.forward_migrations.length+manifest.pending_migrations.length:0),
      schema_sha256:hash(after),live_parity:beforeDifferences.length===0,live_difference_categories:beforeDifferences.map(d=>d.category),
      business_data_source:"synthetic_only",production_mutation:false})}`);
    assert.equal(beforeDifferences.length,0,"historical replay differs from captured live schema; review required");
  } finally { await client.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch((error)=>{
    console.error(`F01B_STOP ${JSON.stringify({code:error.code??"REPLAY_ASSERTION_FAILED",message:error.message})}`);
    process.exitCode=1;
  });
}
