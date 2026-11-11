import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {datasetSourceBindingFixture} from "./fixtures/dataset-source-binding-fixture.js";
import {sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";
import {reconcileStoredDatasetSources, canonicalDatasetEventTime, DATASET_RECONCILE_SQL, DATASET_RECONCILE_READ_SQL, SCHEDULED_DATASET_RECONCILE_SQL} from "../app/lib/database/dataset-reconciliation.server.js";
import {readDatasetWritePlan} from "../app/lib/refresh/dataset-server.server.js";
import {runScheduledRefreshCheck} from "../app/lib/refresh/scheduled-queue-check.server.js";

async function fixture(provider = "google_ads", options = {}) {
  const f = await datasetSourceBindingFixture(provider, options); const key = provider === "google_ads" ? "googleDatasetRead" : provider === "meta" ? "metaDatasetRead" : "klaviyoDatasetRead";
  for (const b of f.envelopes.values()) Object.assign(b.receipt.manifest[key], {observedAt: "2026-11-02T00:00:00.000Z", completedAt: "2026-11-02T00:01:00.000Z"});
  let receipt, request;
  f.hooks.query = (sql, args) => {
    if (sql === DATASET_RECONCILE_SQL || sql === SCHEDULED_DATASET_RECONCILE_SQL) {
      const write = JSON.parse(args[1]), context = JSON.parse(args[2]); request = {write, context};
      receipt = {status: "consumed", operationId: write.operationId, requestDigest: sourcePayloadHash(request), revision: context.expectedRevision + 1,
        rowCount: write.rows.length, consumerReceipt: true, checkpointAdvanced: true, comparison: "matched", businessDate: context.businessDate, timeZone: context.timeZone};
      return {rows: [{result: structuredClone(receipt)}]};
    }
    if (sql === DATASET_RECONCILE_READ_SQL) return {rows: [{result: structuredClone(receipt)}]};
  };
  return {...f, expectedRevision: 0, request: () => request};
}
test("event-time canonicalization preserves exact microseconds and timezone without changing source bytes", () => {
  assert.equal(canonicalDatasetEventTime("2026-11-01T12:00:00Z"), "2026-11-01T12:00:00.000000Z");
  assert.equal(canonicalDatasetEventTime("2026-11-01T12:00:00.123Z"), "2026-11-01T12:00:00.123000Z");
  assert.equal(canonicalDatasetEventTime("2026-11-01T15:00:00.123456+03:00"), "2026-11-01T12:00:00.123456Z");
  for (const value of ["2026-11-01T12:00:00.1234567Z", "2026-02-30T12:00:00Z", "2026-11-01T24:00:00Z", null, "invalid"]) assert.throws(() => canonicalDatasetEventTime(value));
});
for (const provider of ["google_ads", "meta", "klaviyo"]) test("reconciliation projects actual source pages and confirms receipt: " + provider, async () => {
  const f = await fixture(provider, {nonempty: provider !== "meta"}), r = await reconcileStoredDatasetSources(f);
  assert.equal(r.consumerReceipt, true); assert.equal(r.checkpointAdvanced, true); assert.equal(r.publishable, false);
  assert.equal(f.request().context.sources.length, [...f.envelopes.values()].reduce((n, b) => n + b.pages.length, 0));
  assert.equal(f.request().write.rows.length, provider === "google_ads" ? 3 : provider === "meta" ? 0 : 2);
});
test("Meta's existing nonempty sales evidence hold is preserved, never consumed", async () => {
  const f = await fixture("meta"); const r = await reconcileStoredDatasetSources(f);
  assert.equal(r.status, "held");assert.equal(r.consumerReceipt, false);assert.equal(f.request(), undefined);
});
test("verified empty submits no fake zero rows; missing metric never consumes", async () => {
  const e = await fixture("google_ads", {nonempty: false});
  assert.equal((await reconcileStoredDatasetSources(e)).rowCount, 0); assert.deepEqual(e.request().write.rows, []);
  const p = await fixture("klaviyo", {missingMetric: true});
  const r = await reconcileStoredDatasetSources(p); assert.equal(r.status, "held"); assert.equal(r.checkpointAdvanced, false); assert.equal(p.request(), undefined);
});
test("missing clocks, cancellation, limits and tampered ciphertext stop before writes", async () => {
  for (const mode of ["clock", "abort", "bytes", "cipher"]) {
    const f = await fixture();
    if (mode === "clock") delete f.envelopes.values().next().value.receipt.manifest.googleDatasetRead.observedAt;
    if (mode === "cipher") f.envelopes.values().next().value.pages[0].authTag = "0".repeat(32);
    await assert.rejects(reconcileStoredDatasetSources({...f, ...mode === "abort" ? {signal: AbortSignal.abort()} : {}, ...mode === "bytes" ? {limits: {...f.limits, maxBytes: 1}} : {}}));
    assert.equal(f.request(), undefined);
  }
});
test("unknown writes stop without any following readback or retry", async () => {
  const f = await fixture(); let lost = false, after = 0; const hook = f.hooks.query;
  f.hooks.query = (sql, args) => {if (lost) after++; if (sql === DATASET_RECONCILE_SQL) {lost = true; throw Error("lost");}return hook(sql, args);};
  await assert.rejects(reconcileStoredDatasetSources(f), /WRITE_UNCONFIRMED/); assert.equal(after, 0);
});
test("scheduled handoff consumes only its own admitted source and verifies readback", async () => {
  for (const mode of ["verified", "wrong_fence", "lost_write"]) {
    const input = await fixture();
    const {owner} = input;
    const generation = randomUUID();
    const time = Date.parse("2026-11-02T00:02:00.000Z");
    const window = {from: "2026-11-01", to: "2026-11-01"};
    const source = {...input.source, connectionVersion: Number(owner.connectionVersion), queuedAt: time, scheduledHour: time - time % 3600000 - 3600000};
    const cost = {requests: 2, dbWrites: 5, connections: 1, rows: 1000, bytes: 1000000};
    const snapshot = {configured: true, queueRevision: 2, candidates: [source],
      state: {revision: 3, nextFence: 1, nextTurn: 1, claims: [], lastServed: []},
      bounds: {maxCandidates: 5, maxClaims: 5, maxAdmissions: 5, maxWorkspaces: 5},
      budget: {global: cost, interactiveReserve: {requests: 0, dbWrites: 0, connections: 0, rows: 0, bytes: 0},
        providers: [{provider: owner.provider, limit: cost}], workspaces: [{workspaceId: owner.workspaceId, limit: cost}],
        accounts: [{provider: owner.provider, accountId: owner.accountId, limit: cost}]}};
    const store = {checkScheduledQueue: async () => ({status: "checked", generation, sequence: 1, queueRevision: 2, checkedAtMs: time}),
      reviewInterruptedWork: async () => ({status: "reviewed", stopped: 0, uncertain: 0}), readPreflightSnapshot: async () => snapshot,
      commitPreflight: async () => true, loadBoundAuthority: async () => ({...source, installationVerified: true, connected: true, setupComplete: true, allowedWindow: true}),
      advanceStage: async () => true, isClaimCurrent: async () => true, readAdmissionSnapshot: async () => snapshot,
      recordStop: async () => ({recorded: true})};
    const hook = input.hooks.query;
    input.hooks.query = (sql, args) => {
      if (mode === "lost_write" && sql === SCHEDULED_DATASET_RECONCILE_SQL) throw Error("lost commit acknowledgement");
      return hook(sql, args);
    };
    const work = {buildWorkPlan: async () => ({partitionId: "synthetic-one-day", workClass: "hourly_hot_window", window, cost,
      limits: {deadlineAt: time + 60000, requestTimeoutMs: 1000, finishReserveMs: 100, maxRows: cost.rows, maxBytes: cost.bytes}}),
      now: () => time, entitlementVerifier: {verify: async () => ({status: "verified", receipt: {}}), isCurrent: async () => true},
      readPage: async () => ({kind: "complete", payload: {}}), validatePage: () => ({complete: true, rows: []}),
      loadDatasetInputs: async ({claim}) => {
        for (const envelope of input.envelopes.values()) {
          Object.assign(envelope.receipt.manifest.googleDatasetRead, {jobId: claim.id, fence: String(claim.fence + (mode === "wrong_fence" ? 1 : 0))});
        }
        return input;
      }};
    const result = await runScheduledRefreshCheck({store, generation, work});
    assert.equal(result.status, "queue_checked");
    assert.equal(result.work.status, mode === "verified" ? "dataset_verified" : "needs_attention");
    assert.equal(input.queries.filter(sql => sql === DATASET_RECONCILE_SQL).length, 0);
    assert.equal(input.queries.filter(sql => sql === SCHEDULED_DATASET_RECONCILE_SQL).length, mode === "wrong_fence" ? 0 : 1);
    assert.equal(input.queries.filter(sql => sql === DATASET_RECONCILE_READ_SQL).length, mode === "verified" ? 1 : 0);
    if (mode === "verified") assert.equal(result.work.dataset.checkpointAdvanced, true);
  }
});
test("physical mismatch result is held and cannot claim consumption or checkpoint", async () => {
  const f = await fixture(), hook = f.hooks.query;
  f.hooks.query = (sql, args) => {const r = hook(sql, args);if (sql === DATASET_RECONCILE_SQL) Object.assign(r.rows[0].result, {status: "mismatch", comparison: "mismatch", consumerReceipt: false, checkpointAdvanced: false});return r;};
  const r = await reconcileStoredDatasetSources(f);assert.equal(r.status, "mismatch");assert.equal(r.checkpointAdvanced, false);
  assert.equal(f.queries.filter(q => q === DATASET_RECONCILE_READ_SQL).length, 0);
});
test("plan v1 remains storage-only; v2 explicitly requires expected revision", async () => {
  const f = await fixture();const p = {version: 2, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString(), owner: f.owner, batches: f.batches,
    limits: {maxPages: 100, maxRows: 1000, maxBytes: 1000000, maxElapsedMs: 60000}, useFx: false, expectedRevision: 0};
  const env = {ADSTABLE_DATASET_WRITE_ENABLED: "true", ADSTABLE_DATASET_WRITE_PLAN: JSON.stringify(p)};
  assert.equal(readDatasetWritePlan(env).version, 2);
  for (const expectedRevision of [undefined, -1, 1.2, 1000000000]) assert.throws(() => readDatasetWritePlan({...env, ADSTABLE_DATASET_WRITE_PLAN: JSON.stringify({...p, expectedRevision})}));
  delete p.expectedRevision;p.version = 1;assert.equal(readDatasetWritePlan({...env, ADSTABLE_DATASET_WRITE_PLAN: JSON.stringify(p)}).version, 1);
});
