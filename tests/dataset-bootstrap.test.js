import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {planDatasetBootstrap, executeDatasetBootstrap} from "../app/lib/refresh/dataset-bootstrap.server.js";
import {inspectDatasetReconciliation} from "../app/lib/database/dataset-reconciliation.server.js";
import {datasetStorageFixture} from "./fixtures/dataset-storage-fixture.js";

test("bootstrap orders yesterday then today in provider calendar, including DST", () => {
  const p = planDatasetBootstrap({now: "2026-11-02T02:00:00.000Z", timeZone: "America/New_York", eligibleFromMs: 0});
  assert.deepEqual(p.days.map(d => d.businessDate), ["2026-10-31", "2026-11-01"]);
  assert.equal(p.authorizesDispatch, false); assert.equal(p.hourlyRefreshActivated, false);
});
test("bootstrap never rounds eligibility backwards or fabricates disconnected days", () => {
  const p = planDatasetBootstrap({now: "2026-11-10T14:00:00.000Z", timeZone: "UTC", eligibleFromMs: Date.parse("2026-11-09T12:00:00Z")});
  assert.deepEqual(p.days.map(d => d.state), ["unavailable_eligibility_boundary", "requires_current_admission"]);
  for (const extra of [{eligibleFromMs: NaN}, {eligibleFromMs: Date.parse("2026-11-11T00:00:00Z")}, {timeZone: "not/a/zone"}, {now: "invalid"}]) assert.throws(() => planDatasetBootstrap({now: "2026-11-10T14:00:00.000Z", timeZone: "UTC", eligibleFromMs: 0, ...extra}));
});
test("first day failure, unknown or a forged receipt cannot start the second day", async () => {
  const owner = datasetStorageFixture().owner;
  for (const mode of ["unknown", "forged"]) {
    const plan = planDatasetBootstrap({now: "2026-11-10T12:00:00.000Z", timeZone: "UTC", eligibleFromMs: 0}); let calls = 0;
    await assert.rejects(executeDatasetBootstrap({plan, owner, runDay: async () => {calls++; if (mode === "unknown") throw Error("WRITE_UNCONFIRMED");return {status: "consumed", consumerReceipt: true, checkpointAdvanced: true};}}));
    assert.equal(calls, 1);
    await assert.rejects(executeDatasetBootstrap({plan, owner, runDay() {calls++;}}), /CAPABILITY_REQUIRED/); assert.equal(calls, 1);
  }
});
test("bootstrap requires exact owner/day/timezone DB-confirmed receipts and rejects JSON clones", async () => {
  const owner = datasetStorageFixture().owner, seen = [];
  const plan = planDatasetBootstrap({now: "2026-11-10T12:00:00.000Z", timeZone: "UTC", eligibleFromMs: 0});
  const r = await executeDatasetBootstrap({plan, owner, runDay: async ({businessDate, timeZone}) => {
    seen.push(businessDate); const operationId = randomUUID();
    return inspectDatasetReconciliation({owner, operationId, database: {async query() {return {rows: [{result: {status: "consumed", operationId, businessDate, timeZone, consumerReceipt: true, checkpointAdvanced: true, comparison: "matched"}}]};}}});
  }});
  assert.deepEqual(seen, ["2026-11-09", "2026-11-10"]); assert.equal(r.results.length, 2);
  await assert.rejects(executeDatasetBootstrap({plan: structuredClone(plan), owner, runDay() {}}), /CAPABILITY_REQUIRED/);
  for (const type of ["owner", "date", "zone", "clone"]) {
    const p = planDatasetBootstrap({now: "2026-11-10T12:00:00.000Z", timeZone: "UTC", eligibleFromMs: 0}); let calls = 0;
    await assert.rejects(executeDatasetBootstrap({plan: p, owner, runDay: async ({businessDate, timeZone}) => {
      calls++; const operationId = randomUUID(); const receipt = await inspectDatasetReconciliation({owner: type === "owner" ? {...owner, credentialId: randomUUID()} : owner, operationId,
        database: {async query() {return {rows: [{result: {status: "consumed", operationId, businessDate: type === "date" ? "2026-11-01" : businessDate, timeZone: type === "zone" ? "Europe/Istanbul" : timeZone, consumerReceipt: true, checkpointAdvanced: true, comparison: "matched"}}]};}}});
      return type === "clone" ? structuredClone(receipt) : receipt;
    }}));assert.equal(calls, 1);
  }
});
