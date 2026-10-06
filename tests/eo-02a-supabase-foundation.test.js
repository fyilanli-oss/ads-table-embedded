import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const contract = JSON.parse(read("contracts/eo-02a-supabase-foundation-v1.json"));
const migration = read(contract.migration).toLowerCase();

test("EO-02-A target is the isolated Frankfurt Supabase project", () => {
  assert.equal(contract.target.project_id, "podpwkrpmjiksskxhwsu");
  assert.equal(contract.target.region, "eu-central-1");
  assert.equal(contract.target.postgres_engine, "17");
  assert.equal(contract.target.plan_cost.amount_usd, 0);
});

test("all seven private schemas are created under the owner role", () => {
  assert.deepEqual(contract.schemas, ["app","shopify","integrations","analytics","operations","privacy","billing"]);
  for (const schema of contract.schemas) {
    assert.match(migration, new RegExp(`create schema if not exists ${schema} authorization adstable_owner;`));
  }
  assert.doesNotMatch(migration, /create\s+table\s+public\./);
});

test("owner, migrator and runtime roles are created fail-closed", () => {
  const ownerBlock = migration.match(/create role adstable_owner[\s\S]*?nobypassrls;/)?.[0] ?? "";
  const migratorBlock = migration.match(/create role adstable_migrator[\s\S]*?nobypassrls;/)?.[0] ?? "";
  const runtimeBlock = migration.match(/create role adstable_runtime[\s\S]*?nobypassrls;/)?.[0] ?? "";
  for (const block of [ownerBlock, migratorBlock, runtimeBlock]) {
    for (const capability of ["noinherit","nosuperuser","nocreatedb","nocreaterole","noreplication","nobypassrls"]) {
      assert.match(block, new RegExp(capability));
    }
  }
  assert.match(ownerBlock, /nologin/);
  assert.match(migratorBlock, /login[\s\S]*?password null/);
  assert.match(runtimeBlock, /login[\s\S]*?password null/);
  assert.doesNotMatch(migration, /password\s+'[^']+'/);
  assert.doesNotMatch(migration, /alter role/);
});

test("pre-existing role drift fails closed instead of being silently rewritten", () => {
  for (const role of ["adstable_owner","adstable_migrator","adstable_runtime"]) {
    assert.match(migration, new RegExp(`${role} exists with unsafe attributes`));
  }
});

test("Data API roles receive no private schema or default object grants", () => {
  assert.match(migration, /revoke all on schema app, shopify, integrations, analytics, operations, privacy, billing[\s\S]*?from public, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /grant\s+[^;]+\s+to\s+(?:anon|authenticated|service_role)/);
  assert.equal(contract.runtime_boundary.data_api_runtime, false);
  assert.equal(contract.runtime_boundary.service_role_runtime, false);
});

test("live data, credentials and legacy mutations remain out of scope", () => {
  for (const item of ["live_data_carry","token_carry","vercel_database_credentials","legacy_project_mutation"]) {
    assert.ok(contract.out_of_scope.includes(item));
  }
  assert.doesNotMatch(migration, /insert\s+into|update\s+[^;]+\s+set|delete\s+from/);
});
