import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {maturityObservationFixture, maturityMemoryStore} from "./fixtures/maturity-fixture.js";
import {storeMaturityConfiguration, readMaturityConfiguration, recordMaturityDecision} from "../app/lib/database/maturity-store.server.js";
import {refreshPdMaturityObservation} from "../app/lib/refresh/pd-source-reader.server.js";

for (const provider of ["google_ads", "meta", "klaviyo"]) test(`${provider}: real private reader capability -> sanitized AEAD -> receipt/decrypt -> durable config registration`, async () => {
  const f = maturityObservationFixture(provider), observation = await f.read(), store = maturityMemoryStore(f.owner);
  const r = await storeMaturityConfiguration({...store, owner: f.owner, observation});
  assert.equal(r.sourceVerified, true); assert.equal(r.authorizesActivation, false);
  assert.equal(r.policy.state, provider === "klaviyo" ? "unknown" : "known");
  assert.equal(r.policy.horizonDays, provider === "google_ads" ? 0 : provider === "meta" ? 1 : null);
  const read = await readMaturityConfiguration({...store, owner: f.owner, attemptId: r.attemptId});
  assert.equal(read.registration.fingerprint, r.fingerprint);
  const bytes = JSON.stringify(store.batches.get(r.attemptId));
  assert.equal(bytes.includes("synthetic-only"), false);
  assert.equal(bytes.includes('"native":'), false, "native settings are encrypted, not copied into manifest");
  assert.equal(store.calls.filter(c => c.sql.includes("commit_source_batch")).length, 1);
  assert.equal(store.calls.filter(c => c.sql.includes("register_maturity_configuration")).length, 1);
  assert.equal(refreshPdMaturityObservation(structuredClone(observation), f.owner), null);
});

test("a copied observation or changed credential/account/workspace/generation cannot write configuration", async () => {
  const f = maturityObservationFixture(), observation = await f.read();
  for (const [owner, candidate] of [[f.owner, structuredClone(observation)], [{...f.owner, credentialId: randomUUID()}, observation],
    [{...f.owner, workspaceId: randomUUID()}, observation], [{...f.owner, generation: "2"}, observation], [{...f.owner, accountId: "act_999"}, observation]]) {
    const store = maturityMemoryStore(owner);
    await assert.rejects(storeMaturityConfiguration({...store, owner, observation: candidate}), /OBSERVATION_REQUIRED/);
    assert.equal(store.calls.length, 0);
  }
});
test("stale observation, cancellation and elapsed deadline stop before source persistence", async () => {
  const observedClock = Date.now(), f = maturityObservationFixture("meta", {now: () => observedClock}), observation = await f.read();
  for (const extra of [{now: () => observedClock + 60001}, {signal: AbortSignal.abort()}, {limits: {maxBytes: 1000000, maxRows: 100, maxObservationAgeMs: 60000, deadlineAt: observedClock - 1}}]) {
    const store = maturityMemoryStore(f.owner);
    await assert.rejects(storeMaturityConfiguration({...store, owner: f.owner, observation, ...extra}), /STOPPED|OBSERVATION_STALE/);
    assert.equal(store.calls.length, 0);
  }
});
test("unknown source commit and unknown registration never trigger readback, retry or alternative writes", async () => {
  for (const target of ["commit_source_batch", "register_maturity_configuration"]) {
    const f = maturityObservationFixture(), observation = await f.read(), store = maturityMemoryStore(f.owner); let lost = false, after = 0;
    store.hooks.query = sql => {if (lost) after++; if (sql.includes(target)) {lost = true; throw Error("synthetic lost reply");}};
    await assert.rejects(storeMaturityConfiguration({...store, owner: f.owner, observation}), /UNCONFIRMED/);
    assert.equal(after, 0); assert.equal(store.calls.filter(c => c.sql.includes(target)).length, 1);
  }
});
test("one authentic observation cannot be captured twice, including concurrent attempts", async () => {
  const f = maturityObservationFixture(), observation = await f.read(), store = maturityMemoryStore(f.owner);
  const results = await Promise.allSettled([storeMaturityConfiguration({...store, owner: f.owner, observation}), storeMaturityConfiguration({...store, owner: f.owner, observation})]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.match(results.find(r => r.status === "rejected").reason.message, /OBSERVATION_ALREADY_USED/);
  assert.equal(store.calls.filter(c => c.sql.includes("commit_source_batch")).length, 1);
});
test("tampered ciphertext, page hash, schema or registration cannot authorize configuration readback", async () => {
  for (const mutation of [b => {b.pages[0].payloadHash = "f".repeat(64);}, b => {b.pages[0].authTag = "0".repeat(32);},
    b => {b.pages[0].expired = true;}, b => {b.pages[0].schemaVersion = "other";}, b => {b.receipt.manifest.maturityConfiguration.policy = {...b.receipt.manifest.maturityConfiguration.policy, horizonDays: 90};}]) {
    const f = maturityObservationFixture(), observation = await f.read(), store = maturityMemoryStore(f.owner);
    const r = await storeMaturityConfiguration({...store, owner: f.owner, observation}); mutation(store.batches.get(r.attemptId));
    await assert.rejects(readMaturityConfiguration({...store, owner: f.owner, attemptId: r.attemptId}));
  }
});
test("configuration readback requires explicit finite resource bounds", async () => {
  const f = maturityObservationFixture(), store = maturityMemoryStore(f.owner);
  for (const maxBytes of [undefined, null, Infinity, -1, 16777217]) {
    await assert.rejects(readMaturityConfiguration({...store, owner: f.owner, attemptId: randomUUID(), limits: {...store.limits, maxBytes}}), /INPUT_INVALID/);
  }
});
test("decision input does not accept a forged configuration, arbitrary report rows or an invalid operation", async () => {
  const f = maturityObservationFixture(), store = maturityMemoryStore(f.owner);
  await assert.rejects(recordMaturityDecision({...store, owner: f.owner, configurationAttemptId: randomUUID(), anchorAttemptId: "invalid", operationId: randomUUID(), expectedRevision: 0}), /INPUT_INVALID/);
  assert.equal(store.calls.length, 0);
});
