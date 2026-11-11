import {createServer} from "node:http";
import {pathToFileURL} from "node:url";
import {runGmailQueueCanary} from "../../app/lib/refresh/gmail-canary.server.js";
import {readQueueWitness} from "../../app/lib/refresh/observability.server.js";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;
const unavailable = () => new Error("QUEUE_OBSERVER_UNAVAILABLE");
const timeoutMs = 5_000;
const retentionMs = 86_400_000;
const minuteMs = 60_000;
const syntheticRecoveryDelayMs = 5 * minuteMs;

export function firestoreStores({project, database, scopeRef, stopAt, getToken, fetchFn = fetch}) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
      !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(database) || !uuid.test(scopeRef) || !Number.isFinite(stopAt)) throw unavailable();
  const root = `https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/documents`;

  function document(path, valueKey, expiresAtMs) {
    // This version belongs to one observer invocation. A concurrent invocation
    // must win the server-side precondition, even if both read the same revision.
    let version;
    async function request(url, options, signal) {
      return fetchFn(url, {...options, redirect: "error", signal, headers: {
        authorization: `Bearer ${await getToken(signal)}`,
        "content-type": "application/json",
      }});
    }
    return {
      async read({signal}) {
        const response = await request(`${root}/${path}`, {}, signal);
        if (response.status === 404 && valueKey === "incident") {
          await response.body?.cancel();
          version = {revision: 0, updateTime: null};
          return {revision: 0, incident: null};
        }
        if (!response.ok) throw unavailable();
        const {fields, updateTime} = await response.json();
        const revision = Number(fields?.revision?.integerValue);
        const value = JSON.parse(fields?.payload?.stringValue);
        if (!Number.isSafeInteger(revision) || revision < 0 || typeof updateTime !== "string" || !timestamp.test(updateTime) ||
            !value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
        version = {revision, updateTime};
        return {revision, [valueKey]: value};
      },
      async commit({expectedRevision, signal, [valueKey]: value}) {
        if (version?.revision !== expectedRevision || !Number.isSafeInteger(expectedRevision + 1)) throw unavailable();
        const url = new URL(`${root}/${path}`);
        if (version.updateTime === null) url.searchParams.set("currentDocument.exists", "false");
        else url.searchParams.set("currentDocument.updateTime", version.updateTime);
        version = undefined;
        const revision = expectedRevision + 1;
        const fields = {revision: {integerValue: String(revision)}, payload: {stringValue: JSON.stringify(value)}};
        if (expiresAtMs) fields.expiresAt = {timestampValue: new Date(expiresAtMs(value)).toISOString()};
        const response = await request(url, {method: "PATCH", body: JSON.stringify({fields})}, signal);
        if (!response.ok) throw unavailable();
        const result = await response.json();
        if (result.fields?.revision?.integerValue !== String(revision) ||
            result.fields?.payload?.stringValue !== fields.payload.stringValue ||
            !timestamp.test(result.updateTime)) throw unavailable();
        version = {revision, updateTime: result.updateTime};
        return {committed: true, revision};
      },
    };
  }

  const incidents = new Map();
  function incident(fingerprint) {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw unavailable();
    if (!incidents.has(fingerprint)) incidents.set(fingerprint, document(
      `queueObserverIncidents/${fingerprint}`, "incident", value => value.expiresAtMs,
    ));
    return incidents.get(fingerprint);
  }
  return {
    witnessStore: document(`queueObserverWitnesses/${scopeRef}`, "state", () => stopAt),
    incidentStore: {
      read: input => incident(input.fingerprint).read(input),
      commit: input => incident(input.fingerprint).commit(input),
    },
  };
}

export function queueCanaryTick({environment, database, getToken, fetchFn = fetch, now = Date.now}) {
  const scopeRef = environment.ADSTABLE_QUEUE_OBSERVER_SCOPE;
  const stopAt = Date.parse(environment.ADSTABLE_QUEUE_OBSERVER_STOP_AT);
  const startAt = now();
  if (!Number.isFinite(stopAt) || stopAt - startAt > retentionMs / 2) throw unavailable();
  const mode = environment.ADSTABLE_QUEUE_OBSERVER_MODE ?? "supabase";
  const generation = environment.ADSTABLE_QUEUE_OBSERVER_SYNTHETIC_GENERATION;
  const activatedAtMs = Date.parse(environment.ADSTABLE_QUEUE_OBSERVER_SYNTHETIC_START_AT);
  let readReceipt;
  if (mode === "synthetic") {
    if (database || environment.ADSTABLE_QUEUE_OBSERVER_TEST_DATABASE_URL ||
        environment.ADSTABLE_QUEUE_OBSERVER_DATABASE_CA || !uuid.test(generation) ||
        !Number.isFinite(activatedAtMs) || stopAt - activatedAtMs < 7 * minuteMs) throw unavailable();
    readReceipt = () => {
      const elapsed = now() - activatedAtMs - syntheticRecoveryDelayMs;
      if (elapsed < 0) return undefined;
      const minute = Math.floor(elapsed / minuteMs);
      return {environment: "test", generation, sequence: minute + 1, queueRevision: minute + 1,
        checkedAtMs: activatedAtMs + syntheticRecoveryDelayMs + minute * minuteMs};
    };
  } else {
    if (mode !== "supabase" || typeof database?.query !== "function" ||
        generation !== undefined || environment.ADSTABLE_QUEUE_OBSERVER_SYNTHETIC_START_AT !== undefined) throw unavailable();
    readReceipt = () => readQueueWitness({database, environment: "test"});
  }

  return async () => {
    if (now() + 7 * timeoutMs >= stopAt) return {status: "canary_expired"};
    if (mode === "synthetic" && now() < activatedAtMs) return {status: "canary_waiting"};
    const stores = firestoreStores({
      project: environment.GOOGLE_CLOUD_PROJECT, database: environment.ADSTABLE_FIRESTORE_DATABASE,
      scopeRef, stopAt, getToken, fetchFn,
    });
    const witnessStore = mode === "synthetic" ? {
      async read(options) {
        const saved = await stores.witnessStore.read(options);
        if (saved.state.generation !== generation || saved.state.activatedAtMs !== activatedAtMs) throw unavailable();
        return saved;
      },
      commit: stores.witnessStore.commit,
    } : stores.witnessStore;
    const result = await runGmailQueueCanary({
      ...stores, witnessStore, environment, fetchFn, now, scopeRef, timeoutMs, retentionMs, readReceipt,
    });
    return {status: result.status, durableWitness: result.durableWitness,
      receiptAccepted: result.accepted, primaryAvailable: result.primaryAvailable,
      notification: result.notification, recoveryObserved: result.recoveryObserved,
      ...(mode === "synthetic" ? {receiptSource: "synthetic"} : {})};
  };
}

async function metadataToken(signal) {
  const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {headers: {"Metadata-Flavor": "Google"}, redirect: "error", signal});
  if (!response.ok) throw unavailable();
  const result = await response.json();
  if (result.token_type !== "Bearer" || !/^[A-Za-z0-9._~+/-]{16,4096}={0,2}$/.test(result.access_token ?? "")) throw unavailable();
  return result.access_token;
}

async function openTestDatabase(environment) {
  const {Pool} = await import("pg");
  const url = new URL(environment.ADSTABLE_QUEUE_OBSERVER_TEST_DATABASE_URL);
  if (url.protocol !== "postgresql:" || url.search || url.hash ||
      !/^adstable_queue_observer(?:\.[a-z0-9]+)?$/.test(url.username) ||
      !environment.ADSTABLE_QUEUE_OBSERVER_DATABASE_CA) throw unavailable();
  const pool = new Pool({
    connectionString: url.href, ssl: {ca: environment.ADSTABLE_QUEUE_OBSERVER_DATABASE_CA, rejectUnauthorized: true},
    max: 1, connectionTimeoutMillis: 2_000, query_timeout: 2_000,
  });
  pool.on("error", () => console.error("QUEUE_OBSERVER_DATABASE_UNAVAILABLE"));
  return pool;
}

async function start(environment) {
  const database = environment.ADSTABLE_QUEUE_OBSERVER_MODE === "synthetic" ?
    undefined : await openTestDatabase(environment);
  const tick = queueCanaryTick({environment, database, getToken: metadataToken});
  createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/tick") {
      response.writeHead(404).end();
      return;
    }
    request.resume();
    try {
      const result = await tick();
      const ok = result.status === "canary_expired" || result.status === "canary_waiting" ||
        (result.durableWitness && result.notification !== "unconfirmed");
      console.log(JSON.stringify(result));
      response.writeHead(ok ? 200 : 503, {"content-type": "application/json"}).end(JSON.stringify(result));
    } catch {
      response.writeHead(503).end("QUEUE_OBSERVER_UNAVAILABLE");
    }
  }).listen(Number(environment.PORT || 8080), "0.0.0.0");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  start(process.env).catch(() => {
    console.error("QUEUE_OBSERVER_CONFIGURATION_UNAVAILABLE");
    process.exitCode = 1;
  });
}
