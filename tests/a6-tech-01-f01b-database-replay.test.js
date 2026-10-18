import assert from "node:assert/strict";
import test from "node:test";
import {assertReplayEnvironment, executeMigration, inventoryDifferences, replayConnection} from "../tools/f01-database-replay.mjs";
import {readFileSync} from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../contracts/a6-tech-01-f01-migration-lineage-v1.json", import.meta.url), "utf8"));
const ownerEntries = manifest.historical_migrations.filter(entry => entry.execution_context);

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
