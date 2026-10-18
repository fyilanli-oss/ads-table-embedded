import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {sqlHash} from "../tools/check-migration-lineage.mjs";
import {privacyIndexTargets, assertIndexPlan, privacyIndexPlanProbe} from "../tools/f08-privacy-index-probe.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("contracts/a6-tech-01-f01-migration-lineage-v1.json"));
const entry = [...manifest.forward_migrations, ...manifest.pending_migrations].find(item => item.name === "a6tech01_privacy_workspace_fk_indexes");
const sql = read(entry.file);

test("F08 migration adds only the two non-partial workspace FK B-trees with bounded owner context", () => {
  assert.equal(entry.repository_sql_sha256, sqlHash(sql));
  assert.match(sql, /^begin;/);
  assert.match(sql, /set local lock_timeout = '5s'/);
  assert.match(sql, /set local statement_timeout = '30s'/);
  assert.match(sql, /set local role adstable_owner/);
  const ddl = [...sql.matchAll(/create index (\w+)\s+on privacy\.(\w+) using btree \(workspace_id\);/g)];
  assert.deepEqual(ddl.map(match => ({table:match[2],index:match[1]})), privacyIndexTargets);
  assert.equal(sql.replace(/begin;|commit;|set local (lock_timeout = '5s'|statement_timeout = '30s'|role adstable_owner);|create index \w+\s+on privacy\.\w+ using btree \(workspace_id\);/g, "").trim(), "");
  assert.doesNotMatch(sql, /\b(delete|update|insert|truncate|drop|grant|revoke|concurrently|if not exists|where)\b/i);
});

test("F08 plan evidence requires the exact target index, not merely any scan", () => {
  assert.doesNotThrow(() => assertIndexPlan({"Node Type":"Bitmap Heap Scan",Plans:[{"Node Type":"Bitmap Index Scan","Index Name":privacyIndexTargets[0].index}]}, privacyIndexTargets[0].index));
  assert.throws(() => assertIndexPlan({"Node Type":"Seq Scan"}, privacyIndexTargets[0].index));
  assert.throws(() => assertIndexPlan({"Index Name":"wrong_index"}, privacyIndexTargets[0].index));
});

test("F08 synthetic insert/analyze/index rehearsal cannot run outside ephemeral CI", async () => {
  const client = {query() { assert.fail("no query outside ephemeral runner"); }};
  await assert.rejects(privacyIndexPlanProbe(client,sql,{}), /ephemeral GitHub runner/);
  await assert.rejects(privacyIndexPlanProbe(client,sql,{GITHUB_ACTIONS:"true"}));
  const source = read("tools/f08-privacy-index-probe.mjs");
  assert.match(source, /finally \{ await client\.query\("rollback"\)/);
  assert.doesNotMatch(source, /enable_seqscan|connectionString|process\.env\./);
  assert.match(source, /generate_series\(1,20000\)/);
  assert.match(read(".github/workflows/database-integrity.yml"), /tools\/f08-\*/);
});
