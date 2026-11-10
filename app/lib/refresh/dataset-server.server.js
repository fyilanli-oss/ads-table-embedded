import {sourceStoreOwner, sourcePayloadHash} from "../database/source-evidence-store.server.js";
import {createConfiguredSourceEvidenceCipher} from "../database/source-evidence-config.server.js";
import {createDatasetPostgresClient} from "../database/dataset-postgres.server.js";
import {bindStoredDatasetSources} from "../database/dataset-source-binding.server.js";
import {createDatasetFxResolver} from "../database/dataset-fx-resolver.server.js";
import {reconcileStoredDatasetSources} from "../database/dataset-reconciliation.server.js";
import {createResourceMeter} from "./observability.server.js";
const fail = () => {throw Error("DATASET_SERVER_CONFIGURATION_REQUIRED");};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === keys.slice().sort().join();

export function readDatasetWritePlan(environment, now = Date.now()) {
  if (environment?.ADSTABLE_DATASET_WRITE_ENABLED !== "true") return null;
  try {
    const text = environment.ADSTABLE_DATASET_WRITE_PLAN;
    if (typeof text !== "string" || Buffer.byteLength(text) > 16384 || !Number.isSafeInteger(now)) fail();
    const p = JSON.parse(text);
    if (!exact(p, ["version", "operationId", "expiresAt", "owner", "batches", "limits", "useFx", ...p.version === 2 ? ["expectedRevision"] : []])
      || ![1, 2].includes(p.version) || p.version === 2 && (!Number.isSafeInteger(p.expectedRevision) || p.expectedRevision < 0 || p.expectedRevision > 999999999) || !uuid.test(p.operationId)
      || typeof p.expiresAt !== "string" || new Date(p.expiresAt).toISOString() !== p.expiresAt || Date.parse(p.expiresAt) <= now
      || Date.parse(p.expiresAt) > now + 600000 || typeof p.useFx !== "boolean") fail();
    p.owner = sourceStoreOwner(p.owner);
    if (!["google_ads", "meta", "klaviyo"].includes(p.owner.provider) || !Array.isArray(p.batches) || p.batches.length < 1 || p.batches.length > 3
      || new Set(p.batches.map(b => b?.attemptId)).size !== p.batches.length
      || p.batches.some(b => !exact(b, ["attemptId", "ordinal"]) || !uuid.test(b.attemptId) || b.ordinal !== 0)
      || !exact(p.limits, ["maxPages", "maxRows", "maxBytes", "maxElapsedMs"]) || Object.values(p.limits).some(n => !Number.isSafeInteger(n) || n < 1)
      || p.limits.maxPages > 300 || p.limits.maxRows > 20000 || p.limits.maxBytes > 16777216 || p.limits.maxElapsedMs > 120000) fail();
    return p;
  } catch {fail();}
}

// This executable is shared by the three existing private request handlers.
// It only consumes already-stored envelopes; there is no ads-provider call,
// token refresh, caller-chosen row/projection or automatic write retry.
export function createDatasetServerExecution({environment, operationId, signal, now = Date.now, poolFactory, fetchFn = globalThis.fetch} = {}) {
  const env = {...environment}, plan = readDatasetWritePlan(env, now());
  if (!plan || plan.operationId !== operationId || typeof now !== "function" || typeof fetchFn !== "function" || signal !== undefined && !(signal instanceof AbortSignal)) fail();
  const cipher = createConfiguredSourceEvidenceCipher(env);
  const controller = new AbortController(), deadlineAt = Math.min(Date.parse(plan.expiresAt), now() + plan.limits.maxElapsedMs);
  const transport = createDatasetPostgresClient({environment: env, provider: plan.owner.provider, deadlineAt, signal: controller.signal, reconciliation: plan.version === 2, now, poolFactory});
  let meter, measurement = null, outcome = "unknown";
  const database = {query(sql, args) {meter?.count("databaseQueries"); return transport.query(sql, args);}};
  let used = false, running = false, closed = false;
  return Object.freeze({
    async run(...args) {
      if (args.length || used || closed) throw Error("DATASET_SERVER_EXECUTION_USED"); used = true; running = true;
      meter = createResourceMeter();
      const forward = () => controller.abort(), timer = setTimeout(forward, Math.max(1, deadlineAt - now()));
      signal?.addEventListener("abort", forward, {once: true}); if (signal?.aborted) forward();
      try {
        const digest = sourcePayloadHash(plan);
        const claim = (await database.query("select evidence.begin_dataset_storage_operation($1::jsonb,$2::uuid,$3::uuid,$4::text,$5::timestamptz) as result",
          [JSON.stringify(plan.owner), plan.batches[0].attemptId, operationId, digest, new Date(deadlineAt).toISOString()])).rows?.[0]?.result;
        if (claim?.status !== "accepted" || claim.operationId !== operationId || claim.digest !== digest) throw Error("DATASET_SERVER_WRITE_UNCONFIRMED");
        const {maxElapsedMs, ...limits} = plan.limits;
        const writer = plan.version === 2 ? reconcileStoredDatasetSources : bindStoredDatasetSources;
        const result = await writer({database, cipher, owner: plan.owner, batches: plan.batches, limits: {...limits, deadlineAt}, operationId, signal: controller.signal, now,
          ...plan.version === 2 ? {expectedRevision: plan.expectedRevision} : {},
          ...plan.useFx ? {fxResolver: createDatasetFxResolver({database, fetchImpl: fetchFn, now})} : {}});
        outcome = result.consumerReceipt === true ? "verified" : "held";
        return Object.freeze({...result, operationId, hourlyRefreshActivated: false});
      } finally {
        // Process-only sampling: NEVER another database call after an unknown write.
        try {measurement = meter.finish(outcome);} catch {measurement = null;}
        clearTimeout(timer); signal?.removeEventListener("abort", forward); running = false; controller.abort();
      }
    },
    measurement() {return measurement;},
    async close() {if (running) throw Error("DATASET_SERVER_BUSY"); if (closed) return; closed = true; controller.abort(); await transport.close();},
  });
}
