import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {reportRetentionPolicy, readReportRetentionPolicy, resolveReportRetentionPolicy} from "../app/lib/database/report-retention-policy.server.js";
import {prepareDatasetWrite} from "../app/lib/database/dataset-storage.server.js";
import {datasetStorageFixture} from "./fixtures/dataset-storage-fixture.js";
import {datasetSourceBindingFixture} from "./fixtures/dataset-source-binding-fixture.js";
import {bindStoredDatasetSources} from "../app/lib/database/dataset-source-binding.server.js";
import {prepareDatasetRetentionSweep, createDatasetRetentionRepository} from "../app/lib/database/dataset-retention.server.js";

for (const [businessDate, timeZone, until] of [
  ["2024-02-29", "UTC", "2027-03-01T00:00:00.000Z"],
  ["2023-11-08", "UTC", "2026-11-09T00:00:00.000Z"],
  ["2026-11-01", "America/Los_Angeles", "2029-11-02T07:00:00.000Z"],
  ["2021-03-31", "Europe/Berlin", "2024-03-31T22:00:00.000Z"],
  ["2097-02-28", "UTC", "2100-03-01T00:00:00.000Z"],
]) test(`three calendar years use the original local business day: ${businessDate} ${timeZone}`, () => {
  assert.equal(resolveReportRetentionPolicy({businessDate, timeZone}).until, until);
});

test("missing/invalid day or timezone never falls back to ingestion time", () => {
  for (const [businessDate, timeZone] of [[null, "UTC"], ["2026-02-30", "UTC"], ["2026-11-01", null], ["2026-11-01", "Not/AZone"], ["9996-12-31", "UTC"]])
    assert.throws(() => resolveReportRetentionPolicy({businessDate, timeZone}), /REPORT_RETENTION_POLICY_INVALID/);
  for (const p of [{version: "report-source-3y-v1", calendarYears: 4}, {...reportRetentionPolicy(), until: "2099-01-01T00:00:00.000Z"}, {version: "unknown", calendarYears: 3}])
    assert.throws(() => readReportRetentionPolicy(p));
});

test("read/replay/correction clock cannot renew the original report lifetime", () => {
  const x = datasetStorageFixture(); x.policy = reportRetentionPolicy();
  x.rows[0].row.business_date = "2026-11-01"; x.rows[0].row.source_timezone = "UTC";
  const a = prepareDatasetWrite({...x, now: "2026-11-02T00:00:00.000Z"});
  const b = prepareDatasetWrite({...x, now: "2028-11-02T00:00:00.000Z"});
  assert.deepEqual(a.body.policy, b.body.policy); assert.equal(a.body.policy.until, "2029-11-02T00:00:00.000Z");
  assert.throws(() => prepareDatasetWrite({...x, policy: {...a.body.policy, until: "2030-01-01T00:00:00.000Z"}}));
  assert.throws(() => prepareDatasetWrite({...x, now: "2029-11-02T00:00:00.000Z"}));
  const second = structuredClone(x.rows[0]); second.row.entity_id = "second"; second.row.source_identity.native.entity_id = "second";
  second.row.business_date = "2026-11-02";
  assert.throws(() => prepareDatasetWrite({...x, rows: [x.rows[0], second]}), /REPORT_RETENTION_POLICY_INVALID/);
});

test("the physical-source binding cannot accept an arbitrary short or extended reporting policy", async () => {
  const f = await datasetSourceBindingFixture(); f.policy = {version: "arbitrary", until: "2030-01-01T00:00:00.000Z"};
  await assert.rejects(bindStoredDatasetSources(f), /REPORT_RETENTION_POLICY_INVALID/); assert.equal(f.queries.length, 0);
});

test("successful empty physical sources retain their evidence without a placeholder fact or consumer receipt", async () => {
  const f = await datasetSourceBindingFixture("google_ads", {nonempty: false});
  const result = await bindStoredDatasetSources(f);
  assert.equal(result.status, "empty"); assert.equal(result.storageReceipt, null); assert.equal(result.retentionReceipt.status, "retained_empty");
  assert.equal(result.retentionReceipt.until, "2029-11-02T00:00:00.000Z"); assert.equal(result.consumerReceipt, false); assert.equal(f.writes.length, 0);
});

test("partial empty source is held and cannot be certified as a complete zero", async () => {
  const f = await datasetSourceBindingFixture("google_ads", {nonempty: false});
  f.envelopes.get(f.batches[0].attemptId).receipt.sourceState = "partial";
  const result = await bindStoredDatasetSources(f); assert.equal(result.status, "held"); assert.equal(result.empty, null);
  assert.equal(f.queries.some(q => q.includes("commit_dataset_empty_retention")), false);
});

test("lost empty-retention write is unknown without automatic readback or replay", async () => {
  const f = await datasetSourceBindingFixture("meta", {nonempty: false}); let sent = 0;
  f.hooks.query = sql => {if (sql.includes("commit_dataset_empty_retention")) {sent++; throw Error("synthetic lost reply");}};
  await assert.rejects(bindStoredDatasetSources(f), /WRITE_UNCONFIRMED/); assert.equal(sent, 1);
  assert.equal(f.queries.some(q => q.includes("inspect_dataset_empty_retention")), false);
});

const sweepInput = () => ({workspaceId: randomUUID(), installationId: "1", generation: "1", table: "pd_facts", after: "0", limit: 10,
  deadlineAt: new Date(Date.now() + 60000).toISOString(), auditPolicy: {version: "synthetic-only", until: new Date(Date.now() + 86400000).toISOString(), maxReceipts: 100}});
test("normal Dataset maintenance is bounded and cannot accept another table, arbitrary SQL or widened audit", () => {
  for (const patch of [{table: "source_pages"}, {limit: 201}, {after: "-1"}, {sql: "delete"}, {auditPolicy: {version: "x", until: "infinity", maxReceipts: 100}}])
    assert.throws(() => prepareDatasetRetentionSweep({...sweepInput(), ...patch}), /INPUT_INVALID/);
});
test("maintenance acknowledgement is not a source delete or consumer checkpoint; plans are single-use", async () => {
  const p = prepareDatasetRetentionSweep(sweepInput()); let calls = 0;
  const repo = createDatasetRetentionRepository({async query() {calls++; return {rows: [{result: {status: "completed", scope: "bounded_scan_only", operationId: p.operationId,
    kind: "dataset:pd_facts", after: "0", lastScannedId: "2", scanned: 2, held: 1, deleted: 1, digest: "a".repeat(64), completedAt: new Date().toISOString(),
    expiresAt: p.auditPolicy.until, policyVersion: p.auditPolicy.version, consumerReceipt: false, sourceDeleted: false}}]};}});
  assert.equal((await repo.cleanup(p)).held, 1);
  await assert.rejects(repo.cleanup(p), /CAPABILITY_REQUIRED/); await assert.rejects(repo.cleanup(structuredClone(p)), /CAPABILITY_REQUIRED/); assert.equal(calls, 1);
});
test("unknown maintenance write is not inspected or retried automatically", async () => {
  const p = prepareDatasetRetentionSweep(sweepInput()); const calls = [];
  const repo = createDatasetRetentionRepository({async query(sql) {calls.push(sql); throw Error("synthetic reply lost");}});
  await assert.rejects(repo.cleanup(p), /WRITE_UNCONFIRMED/); assert.equal(calls.length, 1); assert.ok(calls[0].includes("cleanup_dataset_retention"));
});
