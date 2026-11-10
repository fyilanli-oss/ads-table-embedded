import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {createConfiguredSourceEvidenceCipher} from "../app/lib/database/source-evidence-config.server.js";
import {createDatasetServerExecution, readDatasetWritePlan} from "../app/lib/refresh/dataset-server.server.js";
import {createDatasetPostgresClient} from "../app/lib/database/dataset-postgres.server.js";
import {datasetSourceBindingFixture} from "./fixtures/dataset-source-binding-fixture.js";
import {sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";
import {DATASET_RECONCILE_SQL, DATASET_RECONCILE_READ_SQL} from "../app/lib/database/dataset-reconciliation.server.js";
import {handleGoogleRawCaptureRequest} from "../app/lib/refresh/google-raw-request.server.js";
import {handleMetaRawCaptureRequest} from "../app/lib/refresh/meta-raw-request.server.js";
import {handleKlaviyoRawCaptureRequest} from "../app/lib/refresh/klaviyo-raw-request.server.js";

const providers = {google_ads: {name: "google", role: "adstable_google_source_runner", handle: handleGoogleRawCaptureRequest},
  meta: {name: "meta", role: "adstable_meta_source_runner", handle: handleMetaRawCaptureRequest},
  klaviyo: {name: "klaviyo", role: "adstable_klaviyo_source_runner", handle: handleKlaviyoRawCaptureRequest}};
export async function datasetServerFixture(provider, options = {}) {
  const spec = providers[provider], key = () => randomBytes(32).toString("base64url"), prefix = spec.name.toUpperCase();
  const environment = {VERCEL_ENV: "production", SHOPIFY_APP_URL: "https://embedded.adstable.app",
    ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION: "1", ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1: key(),
    ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION: "1", ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1: key(), ADSTABLE_SESSION_ENCRYPTION_KEY_V1: key(),
    ADSTABLE_DATASET_WRITE_ENABLED: "true", ["ADSTABLE_" + prefix + "_RAW_CAPTURE_SERVER_SECRET"]: key(),
    ["ADSTABLE_" + prefix + "_SOURCE_DATABASE_URL"]: "postgresql://" + spec.role + ".podpwkrpmjiksskxhwsu:" + "x".repeat(32) + "@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",
    ["ADSTABLE_" + prefix + "_SOURCE_DB_TIMEOUT_MS"]: "1000"};
  const fixture = await datasetSourceBindingFixture(provider, {...options, cipher: createConfiguredSourceEvidenceCipher(environment)});
  const operations = new Set(), originalQuery = fixture.database.query.bind(fixture.database);
  fixture.database.query = async (sql, args) => {
    if (sql.includes("begin_dataset_storage_operation")) {
      if (operations.has(args[2])) throw Error("DATASET_OPERATION_ALREADY_STARTED"); operations.add(args[2]);
      return {rows: [{result: {status: "accepted", operationId: args[2], digest: args[3]}}]};
    }
    return originalQuery(sql, args);
  };
  const plan = {version: 1, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString(), owner: fixture.owner, batches: fixture.batches,
    limits: {maxPages: 100, maxRows: 1000, maxBytes: 1000000, maxElapsedMs: 60000}, useFx: false};
  environment.ADSTABLE_DATASET_WRITE_PLAN = JSON.stringify(plan);
  const trace = []; let pools = 0, native = 0, ended = 0;
  const poolFactory = () => {pools++; return {on() {}, async end() {ended++;}, async connect() {return {release() {}, async query(sql, args) {
    trace.push(sql);
    if (["begin", "commit", "rollback"].includes(sql) || sql.startsWith("select pg_catalog.set_config")) return {rows: []};
    if (sql.includes("as profile_ready")) return {rows: [{role: spec.role, profile_ready: true}]};
    if (sql.includes("app.read_reporting_currency")) return {rows: [{result: null}]};
    return fixture.database.query(sql, args);
  }};}};};
  const fetchFn = async () => {native++; throw Error("UNEXPECTED_NATIVE_HTTP");};
  const request = (changes = {}) => new Request("https://embedded.adstable.app/internal/" + spec.name + "/raw-capture", {
    method: "POST", headers: {"content-type": "application/json", authorization: "Bearer " + environment["ADSTABLE_" + prefix + "_RAW_CAPTURE_SERVER_SECRET"]},
    body: JSON.stringify({operationId: plan.operationId}), ...changes});
  const handle = request => spec.handle(request, {environment, createExecution() {throw Error("NATIVE_CAPTURE_MUST_NOT_START");},
    createDatasetExecution: options => createDatasetServerExecution({...options, poolFactory, fetchFn})});
  return {...fixture, environment, plan, spec, trace, poolFactory, fetchFn, request, handle,
    counts: () => ({pools, native, ended})};
}

for (const provider of Object.keys(providers)) {
  test(`${provider}: existing private handler executes real AEAD/projection/storage/readback through the common narrow client`, async () => {
    const f = await datasetServerFixture(provider), response = await f.handle(f.request()), body = await response.json();
    assert.equal(response.status, provider === "meta" ? 207 : 200); assert.equal(body.rowsStored, provider === "google_ads" ? 3 : 2);
    assert.equal(body.DatasetWritePerformed, true); assert.equal(body.receiptVerified, true); assert.equal(body.consumerReceipt, false);
    assert.equal(body.hourlyRefreshActivated, false); assert.equal(body.publishable, false);
    assert.equal(f.writes.length, 1); assert.equal(f.counts().native, 0); assert.equal(f.counts().ended, 1);
    assert.ok(f.trace.some(q => q.includes("read_dataset_source_context"))); assert.ok(f.trace.some(q => q.includes("inspect_dataset_storage")));
    const output = JSON.stringify(body); for (const secret of [f.owner.credentialId, f.owner.workspaceId, f.environment.ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1]) assert.ok(!output.includes(secret));
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  });
  test(`${provider}: physical empty source retains proof without inventing zero facts`, async () => {
    const f = await datasetServerFixture(provider, {nonempty: false}), r = await f.handle(f.request()), b = await r.json();
    assert.equal(r.status, 200); assert.equal(b.empty, true); assert.equal(b.rowsStored, 0); assert.equal(b.DatasetWritePerformed, false);
    assert.equal(b.receiptVerified, true); assert.equal(f.writes.length, 0); assert.equal(f.counts().native, 0);
  });
  test(`${provider}: request auth, origin, body and wrong provider cannot begin a database operation`, async () => {
    for (const change of ["auth", "body", "provider", "origin", "expired", "disabled"]) {
      const f = await datasetServerFixture(provider); let req = f.request();
      if (change === "auth") req = f.request({headers: {"content-type": "application/json", authorization: "Bearer " + "z".repeat(43)}});
      if (change === "body") req = f.request({body: JSON.stringify({operationId: f.plan.operationId, owner: f.owner})});
      if (change === "provider") {f.plan.owner.provider = provider === "meta" ? "google_ads" : "meta"; f.environment.ADSTABLE_DATASET_WRITE_PLAN = JSON.stringify(f.plan);}
      if (change === "origin") req = new Request("https://other.example/internal/" + f.spec.name + "/raw-capture", req);
      if (change === "expired") {f.plan.expiresAt = new Date(Date.now() - 1).toISOString(); f.environment.ADSTABLE_DATASET_WRITE_PLAN = JSON.stringify(f.plan);}
      if (change === "disabled") f.environment.ADSTABLE_DATASET_WRITE_ENABLED = "false";
      const result = await f.handle(req); assert.ok(result.status >= 400, change); assert.equal(f.counts().pools, 0, change); assert.equal(f.counts().native, 0, change);
    }
  });
}

test("server plan is exact, finite, provider-bound and never contains caller rows/query/URL", async () => {
  const f = await datasetServerFixture("google_ads"); assert.equal(readDatasetWritePlan({}), null);
  for (const mutate of [p => p.rows = [], p => p.useFx = "true", p => p.batches[0].ordinal = 1, p => p.batches.push(p.batches[0]),
    p => p.limits.maxPages = 301, p => p.limits.maxElapsedMs = 120001, p => p.expiresAt = new Date(Date.now() + 700000).toISOString()]) {
    const p = structuredClone(f.plan); mutate(p); assert.throws(() => readDatasetWritePlan({...f.environment, ADSTABLE_DATASET_WRITE_PLAN: JSON.stringify(p)}));
  }
});
test("server execution is single-use; an absent merchant currency holds conversion and does not query a provider", async () => {
  const f = await datasetServerFixture("google_ads"); f.plan.useFx = true; f.environment.ADSTABLE_DATASET_WRITE_PLAN = JSON.stringify(f.plan);
  const e = createDatasetServerExecution({...f, operationId: f.plan.operationId}); const r = await e.run();
  assert.equal(r.status, "partially_stored"); assert.ok(r.holds.some(h => h.reason === "reporting_currency_required"));
  assert.equal(f.counts().native, 0); await assert.rejects(e.run(), /EXECUTION_USED/); await e.close();
});
test("narrow transport rejects direct table SQL, cleanup, currency mutation, wrong role and stops after unknown COMMIT", async () => {
  const f = await datasetServerFixture("google_ads"); const client = createDatasetPostgresClient({...f, provider: "google_ads", deadlineAt: Date.now() + 60000});
  for (const sql of ["select * from evidence.source_pages", "set role adstable_owner", "select analytics.cleanup_dataset_retention()", "select app.select_reporting_currency($1)"]) await assert.rejects(client.query(sql));
  assert.equal(f.trace.length, 0); await client.close();
  for (const failure of ["profile", "commit"]) {
    const trace = []; const poolFactory = () => ({on() {}, async end() {}, async connect() {return {release() {}, async query(sql) {
      trace.push(sql); if (sql.includes("as profile_ready")) return {rows: [{role: f.spec.role, profile_ready: failure !== "profile"}]};
      if (sql === "commit" && failure === "commit") throw Error("lost commit"); return {rows: []};
    }};}});
    const c = createDatasetPostgresClient({...f, provider: "google_ads", poolFactory, deadlineAt: Date.now() + 60000});
    await assert.rejects(c.query("select evidence.assert_source_owner($1::jsonb)", [JSON.stringify(f.owner)])); const n = trace.length;
    await assert.rejects(c.query("select evidence.assert_source_owner($1::jsonb)", [JSON.stringify(f.owner)])); assert.equal(trace.length, n); await c.close();
  }
});
test("lost Dataset write acknowledgement causes no inspection, second write or native capture", async () => {
  const f = await datasetServerFixture("google_ads"), original = f.database.query.bind(f.database);
  f.database.query = async (sql, args) => {const r = await original(sql, args); if (sql.includes("commit_dataset_storage")) throw Error("lost reply"); return r;};
  const e = createDatasetServerExecution({...f, operationId: f.plan.operationId}); await assert.rejects(e.run(), /WRITE_UNCONFIRMED/);
  assert.equal(f.writes.length, 1); assert.equal(f.trace.some(q => q.startsWith("select analytics.inspect_dataset_storage(")), false); assert.equal(f.counts().native, 0); await e.close();
  const retry = createDatasetServerExecution({...f, operationId: f.plan.operationId}); await assert.rejects(retry.run()); await retry.close();
  assert.equal(f.writes.length, 1, "a new process/execution cannot replay the same durable plan");
});
test("a lost durable-start reply cannot reach source inspection or be restarted by another execution", async () => {
  const f = await datasetServerFixture("google_ads"), original = f.database.query.bind(f.database);
  f.database.query = async (sql, args) => {const result = await original(sql, args); if (sql.includes("begin_dataset_storage_operation")) throw Error("lost start reply"); return result;};
  for (let i = 0; i < 2; i++) {
    const e = createDatasetServerExecution({...f, operationId: f.plan.operationId}); await assert.rejects(e.run()); await e.close();
  }
  assert.equal(f.writes.length, 0); assert.equal(f.trace.some(q => q.startsWith("select evidence.read_source_receipt(")), false);
  assert.equal(f.counts().native, 0);
});
test("private HTTP lost-write response reports unknown, never a fabricated no-write/rollback", async () => {
  const f = await datasetServerFixture("google_ads"), original = f.database.query.bind(f.database);
  f.database.query = async (sql, args) => {const result = await original(sql, args); if (sql.includes("commit_dataset_storage")) throw Error("lost acknowledgement"); return result;};
  const response = await f.handle(f.request()), body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.status, "unconfirmed"); assert.equal(body.DatasetWritePerformed, null); assert.equal(body.rowsStored, null);
  assert.equal(f.writes.length, 1); assert.equal(f.trace.some(q => q.startsWith("select analytics.inspect_dataset_storage(")), false);
  assert.equal(f.counts().ended, 1); assert.equal(f.counts().native, 0);
});

for (const provider of Object.keys(providers)) test(`${provider}: version2 HTTP reports actual consumption, known mismatch and unknown distinctly`, async () => {
  for (const mode of ["success", "mismatch", "unknown"]) {
    const f = await datasetServerFixture(provider, {nonempty: provider !== "meta"});
    Object.assign(f.plan, {version: 2, expectedRevision: 0}); f.environment.ADSTABLE_DATASET_WRITE_PLAN = JSON.stringify(f.plan);
    const key = provider === "google_ads" ? "googleDatasetRead" : provider === "meta" ? "metaDatasetRead" : "klaviyoDatasetRead";
    for (const b of f.envelopes.values()) Object.assign(b.receipt.manifest[key], {observedAt: "2026-11-02T00:00:00.000Z", completedAt: "2026-11-02T00:01:00.000Z"});
    let receipt, lost = false, after = 0;
    f.hooks.query = (sql, args) => {
      if (lost) after++;
      if (sql === DATASET_RECONCILE_SQL) {
        const write = JSON.parse(args[1]), context = JSON.parse(args[2]);
        receipt = {status: "consumed", operationId: write.operationId, requestDigest: sourcePayloadHash({write, context}), revision: 1, rowCount: write.rows.length,
          changes: write.rows.map(() => ({action: "inserted"})), consumerReceipt: true, checkpointAdvanced: true, comparison: "matched"};
        if (mode === "unknown") {lost = true;throw Error("lost acknowledgement");}
        if (mode === "mismatch") Object.assign(receipt, {status: "mismatch", comparison: "mismatch", consumerReceipt: false, checkpointAdvanced: false});
        return {rows: [{result: structuredClone(receipt)}]};
      }
      if (sql === DATASET_RECONCILE_READ_SQL) return {rows: [{result: structuredClone(receipt)}]};
    };
    const r = await f.handle(f.request()), b = await r.json();
    assert.equal(r.status, mode === "success" ? 200 : mode === "mismatch" ? 207 : 503);
    assert.equal(b.consumerReceipt, mode === "success" ? true : mode === "mismatch" ? false : null);
    assert.equal(b.checkpointAdvanced, mode === "success" ? true : mode === "mismatch" ? false : null);
    assert.equal(after, 0);assert.equal(f.counts().native, 0);
    for (const secret of [f.owner.workspaceId, f.owner.credentialId, f.environment.ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1]) assert.ok(!JSON.stringify(b).includes(secret));
  }
});
