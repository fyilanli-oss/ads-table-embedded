import assert from "node:assert/strict";
import test from "node:test";
import {firestoreStores, queueCanaryTick} from "../tools/queue-observer/service.mjs";

const scopeRef = "00000000-0000-4000-8000-000000000001";
const generation = "00000000-0000-4000-8000-000000000002";
const project = "adstable-gmail-alerts";
const database = "queue-observer-test";
const activatedAtMs = Date.UTC(2026, 10, 11);
const stopAt = activatedAtMs + 600_000;
const stamp = n => new Date(activatedAtMs + n).toISOString();
const response = (payload, status = 200) => Response.json(payload, {status});
const getToken = async () => "fake-metadata-token";

function fixture({seed = true, loseSendReply = false} = {}) {
  let now = activatedAtMs, receipt, sends = 0, version = 0;
  const documents = new Map();
  const witnessPath = `queueObserverWitnesses/${scopeRef}`;
  if (seed) documents.set(witnessPath, {updateTime: stamp(version++), fields: {
    revision: {integerValue: "0"},
    payload: {stringValue: JSON.stringify({environment: "test", generation, activatedAtMs,
      sequence: 0, checkedAtMs: null, queueRevision: 0, lastObserverAtMs: activatedAtMs})},
  }});
  const fetchFn = async (input, options) => {
    const url = new URL(input);
    assert.equal(options.redirect, "error");
    if (url.hostname === "oauth2.googleapis.com") return response({
      token_type: "Bearer", access_token: "fake-test-access-token",
    });
    if (url.hostname === "gmail.googleapis.com") {
      sends++;
      if (loseSendReply) throw new Error("transport unavailable");
      return response({id: "test-message"});
    }
    assert.equal(url.hostname, "firestore.googleapis.com");
    assert.equal(options.headers.authorization, "Bearer fake-metadata-token");
    const path = url.pathname.split("/documents/")[1], current = documents.get(path);
    if (options.method !== "PATCH") return current ? response(current) : response({}, 404);
    const updateTime = url.searchParams.get("currentDocument.updateTime");
    const createOnly = url.searchParams.get("currentDocument.exists") === "false";
    if (current ? updateTime !== current.updateTime : !createOnly) return response({}, 412);
    const saved = {...JSON.parse(options.body), updateTime: stamp(version++)};
    documents.set(path, saved);
    return response(saved);
  };
  const tick = queueCanaryTick({environment: {
    GOOGLE_CLOUD_PROJECT: project, ADSTABLE_FIRESTORE_DATABASE: database,
    ADSTABLE_QUEUE_OBSERVER_SCOPE: scopeRef, ADSTABLE_QUEUE_OBSERVER_STOP_AT: new Date(stopAt).toISOString(),
    ADSTABLE_GMAIL_CANARY_CLIENT_ID: "fake-client-id",
    ADSTABLE_GMAIL_CANARY_CLIENT_SECRET: "fake-client-secret",
    ADSTABLE_GMAIL_CANARY_REFRESH_TOKEN: "fake-refresh-token",
  }, database: {query: async sql => {
    assert.equal(sql, "select operations.read_refresh_queue_witness() as result");
    if (receipt instanceof Error) throw receipt;
    return {rows: [{result: receipt ?? null}]};
  }}, fetchFn, getToken, now: () => now});
  return {tick, fetchFn, documents, time: offset => { now = activatedAtMs + offset; },
    receipt: value => { receipt = value; }, sends: () => sends};
}

test("test queue sends once after the threshold and observes a newer receipt", async () => {
  const f = fixture();
  f.time(120_000);
  assert.equal((await f.tick()).status, "within_window");
  f.time(180_000);
  f.receipt(new Error("primary unavailable"));
  assert.deepEqual(await f.tick(), {status: "critical", durableWitness: true, receiptAccepted: false,
    primaryAvailable: false, notification: "accepted", recoveryObserved: undefined});
  f.time(240_000);
  assert.equal((await f.tick()).notification, "already_reserved");
  assert.equal(f.sends(), 1);
  f.time(300_000);
  f.receipt({generation, sequence: 1, queueRevision: 1, checkedAtMs: activatedAtMs + 290_000});
  assert.equal((await f.tick()).recoveryObserved, true);
  f.time(600_000);
  assert.deepEqual(await f.tick(), {status: "canary_expired"});
  assert.equal(f.sends(), 1);
});

test("Firestore uses server-side preconditions for simultaneous writes", async () => {
  const f = fixture();
  const options = {project, database, scopeRef, stopAt, getToken, fetchFn: f.fetchFn};
  const first = firestoreStores(options).witnessStore;
  const second = firestoreStores(options).witnessStore;
  const saved = await first.read({});
  await second.read({});
  const input = {expectedRevision: 0, state: saved.state};
  assert.deepEqual(await first.commit(input), {committed: true, revision: 1});
  await assert.rejects(second.commit(input), /QUEUE_OBSERVER_UNAVAILABLE/);
});

test("unseeded witness and unknown send result never cause a second send", async () => {
  const unseeded = fixture({seed: false});
  unseeded.time(180_000);
  assert.equal((await unseeded.tick()).durableWitness, false);
  assert.equal(unseeded.sends(), 0);

  const uncertain = fixture({loseSendReply: true});
  uncertain.time(180_000);
  assert.equal((await uncertain.tick()).notification, "unconfirmed");
  uncertain.time(240_000);
  assert.equal((await uncertain.tick()).notification, "already_reserved");
  assert.equal(uncertain.sends(), 1);
});
