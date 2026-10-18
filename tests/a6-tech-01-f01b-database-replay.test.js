import assert from "node:assert/strict";
import test from "node:test";
import {assertReplayEnvironment, executeMigration, inventoryDifferences, replayConnection, withReplayRole} from "../tools/f01-database-replay.mjs";
import {readFileSync} from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../contracts/a6-tech-01-f01-migration-lineage-v1.json", import.meta.url), "utf8"));
const ownerEntries = manifest.historical_migrations.filter(entry => entry.execution_context);

function roleClient(initialRole = "postgres") {
  const client = {role: initialRole, queries: [], savepoints: new Map(), failOn: null};
  client.query = async sql => {
    client.queries.push(sql);
    if (sql === client.failOn) throw new Error("synthetic SQL failure");
    if (sql === "select current_user as role") return {rows: [{role: client.role}]};
    const savepoint = sql.match(/^savepoint (\w+)$/);
    const rollback = sql.match(/^rollback to savepoint (\w+)$/);
    const release = sql.match(/^release savepoint (\w+)$/);
    if (savepoint) client.savepoints.set(savepoint[1], client.role);
    if (rollback) client.role = client.savepoints.get(rollback[1]);
    if (release) client.savepoints.delete(release[1]);
    if (sql.startsWith("set local role ")) client.role = sql.slice("set local role ".length);
    return {rows: []};
  };
  return client;
}

test("replay role scopes restore the caller and preserve successful results", async () => {
  const client = roleClient();
  assert.equal(await withReplayRole(client, "adstable_owner", async () => {
    assert.equal(client.role, "adstable_owner");
    return 42;
  }), 42);
  assert.equal(client.role, "postgres");
  assert.equal(client.savepoints.size, 0);
  assert.ok(!client.queries.some(sql => /^(begin|commit|reset role)$/.test(sql)));
});

test("nested runtime and worker scopes return to owner, not to a broader session role", async () => {
  const client = roleClient();
  await withReplayRole(client, "adstable_owner", async () => {
    for (const role of ["adstable_runtime", "postgres"]) {
      await withReplayRole(client, role, async () => assert.equal(client.role, role));
      assert.equal(client.role, "adstable_owner");
    }
  });
  assert.equal(client.role, "postgres");
  assert.equal(client.savepoints.size, 0);
});

test("SQL or role-switch failure rolls back its scope once and propagates without retry", async () => {
  for (const failOn of ["set local role adstable_runtime", "synthetic statement"]) {
    const client = roleClient("adstable_owner");
    client.failOn = failOn;
    await assert.rejects(withReplayRole(client, "adstable_runtime", () => client.query("synthetic statement")), /synthetic SQL failure/);
    assert.equal(client.role, "adstable_owner");
    assert.equal(client.savepoints.size, 0);
    assert.equal(client.queries.filter(sql => sql === failOn).length, 1);
    assert.equal(client.queries.filter(sql => sql.startsWith("rollback to savepoint ")).length, 1);
  }
});

test("unapproved roles and unexpected caller roles are rejected before any mutation", async () => {
  for (const role of ["service_role", "adstable_owner; reset role", "constructor", "__proto__"]) {
    const client = roleClient();
    await assert.rejects(withReplayRole(client, role, () => assert.fail("must not execute")), /unsupported replay role/);
    assert.deepEqual(client.queries, []);
  }
  const client = roleClient("service_role");
  await assert.rejects(withReplayRole(client, "adstable_owner", () => assert.fail("must not execute")), /unsupported previous replay role/);
  assert.deepEqual(client.queries, ["select current_user as role"]);
});

test("only the four historical owner-context migrations use transaction-local role", async () => {
  assert.equal(ownerEntries.length, 4);
  for (const entry of ownerEntries) {
    const sql = readFileSync(new URL(`../${entry.file}`, import.meta.url), "utf8");
    const queries = [];
    await executeMigration({query: async query => queries.push(query)}, entry, sql);
    assert.deepEqual(queries, ["begin", "set local role adstable_owner", sql, "commit"]);
  }
});

test("ordinary migrations keep their original SQL and transaction boundaries", async () => {
  const queries = [];
  const sql = "begin; select 1; commit;";
  await executeMigration({query: async query => queries.push(query)}, manifest.historical_migrations[0], sql);
  assert.deepEqual(queries, [sql]);
});

test("owner-context failures roll back without retrying or committing", async () => {
  for (const failingQuery of ["set local role adstable_owner", "original SQL", "commit"]) {
    const queries = [];
    const failure = new Error("synthetic execution failure");
    const client = {query: async query => {
      queries.push(query);
      if (query === failingQuery) throw failure;
    }};
    await assert.rejects(executeMigration(client, ownerEntries[0], "original SQL"), error => error === failure);
    assert.equal(queries.at(-1), "rollback");
    assert.equal(queries.filter(query => query === failingQuery).length, 1);
    if (failingQuery !== "commit") assert.ok(!queries.includes("commit"));
  }
});

test("missing, foreign and injected execution contexts fail before issuing SQL", async () => {
  const original = ownerEntries[0];
  const candidates = [
    {...original, execution_context: undefined},
    {...original, execution_context: {role: "postgres", scope: "transaction_local"}},
    {...original, execution_context: {role: "adstable_owner; reset role", scope: "transaction_local"}},
    {...original, execution_context: {role: "adstable_owner", scope: "session"}},
    {...manifest.historical_migrations[0], execution_context: original.execution_context},
  ];
  for (const entry of candidates) {
    const queries = [];
    await assert.rejects(executeMigration({query: async query => queries.push(query)}, entry, "select 1"), /unsupported migration execution context/);
    assert.deepEqual(queries, []);
  }
});

test("database replay refuses non-runner execution and fixes its target to loopback",()=>{
  assert.throws(()=>assertReplayEnvironment({}),/ephemeral GitHub runner/);
  assert.throws(()=>assertReplayEnvironment({GITHUB_ACTIONS:"true"}),/temporary directory/);
  assert.doesNotThrow(()=>assertReplayEnvironment({GITHUB_ACTIONS:"true",RUNNER_TEMP:"temporary"}));
  assert.equal(replayConnection.host,"127.0.0.1");
  assert.equal(replayConnection.port,54322);
});

test("schema comparator detects changed definitions, removed rows and extra grants",()=>{
  const reference={functions:[{name:"callback",hash:"original"}],relations:[{name:"history",acl:"owner_only"}]};
  assert.deepEqual(inventoryDifferences(reference,structuredClone(reference)),[]);
  assert.deepEqual(inventoryDifferences(reference,{functions:[{name:"callback",hash:"changed"}],relations:reference.relations}).map(x=>x.category),["functions"]);
  assert.deepEqual(inventoryDifferences(reference,{functions:[],relations:[{name:"history",acl:"public"}]}).map(x=>x.category),["functions","relations"]);
});
