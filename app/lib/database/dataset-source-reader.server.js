import {canonicalSourceJson, sourceStoreOwner, createSourceEvidenceRepository} from "./source-evidence-store.server.js";
import {DATASET_SOURCE_CONTEXT_SQL} from "./dataset-rpc.server.js";

const verified = new WeakMap();
const fail = code => {throw Error("DATASET_SOURCE_" + code);};
const id = v => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v);
const hash = /^[a-f0-9]{64}$/;
const specs = {
  google_ads: {read: "googleDatasetRead", digest: "googleDatasetInputDigest", schema: "google-raw-datasets-v2", sanitizer: "google-query-fields-v1"},
  meta: {read: "metaDatasetRead", digest: "metaDatasetInputDigest", schema: "meta-raw-datasets-v1", sanitizer: "meta-query-fields-v1"},
  klaviyo: {read: "klaviyoDatasetRead", digest: "klaviyoDatasetInputDigest", schema: "klaviyo-raw-datasets-v1", sanitizer: "klaviyo-native-fields-v1"},
};
const freeze = v => {if (v && typeof v === "object") {Object.values(v).forEach(freeze); Object.freeze(v);} return v;};

/** Private lookup of the immutable admission snapshot of the ORIGINAL read.
 * It does not reserve a new job or reauthorize an old provider request. A missing
 * historical binding is a hold, never permission to use today's account settings.
 */
const contextSql = DATASET_SOURCE_CONTEXT_SQL;

export async function readStoredDatasetSources({database, cipher, owner, batches, limits, signal, now = Date.now}) {
  batches = structuredClone(batches); limits = structuredClone(limits);
  const bound = sourceStoreOwner(owner), spec = specs[bound.provider];
  if (!spec || typeof database?.query !== "function" || typeof cipher?.open !== "function" || !Array.isArray(batches)
    || batches.length < 1 || batches.length > 3 || !limits || !Number.isInteger(limits.maxPages) || limits.maxPages < 1 || limits.maxPages > 300
    || !Number.isInteger(limits.maxRows) || limits.maxRows < 1 || limits.maxRows > 20000
    || !Number.isInteger(limits.maxBytes) || limits.maxBytes < 1 || limits.maxBytes > 16777216
    || !Number.isSafeInteger(limits.deadlineAt)) fail("INPUT_INVALID");
  const stop = () => {if (signal?.aborted || now() >= limits.deadlineAt) fail("STOPPED");};
  const assertOwner = async () => {stop(); await database.query("select evidence.assert_source_owner($1::jsonb)", [JSON.stringify(bound)]); stop();};
  await assertOwner();
  const repository = createSourceEvidenceRepository(database), datasets = [], seenAttempts = new Set(), seenDatasets = new Set();
  let pagesRead = 0, rowsRead = 0, bytesRead = 0, scope = null;
  for (const input of batches) {
    if (!input || Object.keys(input).sort().join() !== "attemptId,ordinal" || typeof input.attemptId !== "string"
      || input.ordinal !== 0 || seenAttempts.has(input.attemptId)) fail("BATCH_INPUT_INVALID");
    seenAttempts.add(input.attemptId); stop();
    const receipt = await repository.inspect({owner: bound, ...input}); stop();
    const read = receipt?.manifest?.[spec.read];
    if (receipt?.status !== "committed" || !id(receipt.batchId) || !hash.test(receipt.digest)
      || !hash.test(receipt.manifest?.[spec.digest] ?? "") || !["complete", "partial"].includes(receipt.sourceState)
      || !read || typeof read.operationId !== "string" || typeof read.jobId !== "string" || !id(read.fence)
      || read.window?.from !== read.window?.to || !/^\d{4}-\d\d-\d\d$/.test(read.window?.from ?? "")
      || seenDatasets.has(read.dataset) || !Number.isInteger(receipt.manifest?.counts?.pages)
      || receipt.manifest.counts.pages < 1) fail("RECEIPT_INVALID");
    const currentScope = {operationId: read.operationId, jobId: read.jobId, fence: read.fence, window: read.window};
    if (scope && canonicalSourceJson(scope) !== canonicalSourceJson(currentScope)) fail("SCOPE_MISMATCH");
    scope ??= structuredClone(currentScope); seenDatasets.add(read.dataset);
    const context = await database.query(contextSql, [JSON.stringify(bound), read.jobId, read.fence, read.window.from, read.window.to]); stop();
    if (context?.rows?.length !== 1 || !hash.test(context.rows[0].snapshot_hash)) fail("CONTEXT_UNAVAILABLE");
    const source = context.rows[0].source;
    if (!source || source.workspaceId !== bound.workspaceId || String(source.installGeneration) !== bound.generation
      || source.provider !== bound.provider || source.accountId !== bound.accountId || source.connectionId !== bound.connectionId
      || String(source.connectionVersion) !== bound.connectionVersion || !/^[A-Z]{3}$/.test(source.currency ?? "")
      || typeof source.timezone !== "string" || !source.timezone || !Number.isSafeInteger(source.eligibleFromMs)) fail("CONTEXT_MISMATCH");
    const pages = []; let after = "0";
    while (pages.length < receipt.manifest.counts.pages) {
      stop(); const stored = await repository.readPages({owner: bound, ...input, after, limit: Math.min(100, receipt.manifest.counts.pages - pages.length)}); stop();
      if (!stored.length) fail("PAGES_MISSING");
      for (const page of stored) {
        if (++pagesRead > limits.maxPages || !id(page.id) || BigInt(page.id) <= BigInt(after) || page.ordinal !== pages.length
          || page.origin !== bound.provider || page.schemaVersion !== spec.schema || page.sanitizerVersion !== spec.sanitizer
          || page.captureLayer !== "native_response_projection" || page.numericFidelity !== "lossless_token"
          || page.available !== true || page.expired !== false || page.retentionPruned !== false || !hash.test(page.payloadHash)) fail("PAGE_INVALID");
        bytesRead += page.plainBytes; if (!Number.isSafeInteger(bytesRead) || bytesRead > limits.maxBytes) fail("BYTE_LIMIT");
        const payload = cipher.open({owner: bound, ...input, page});
        if (payload.family !== undefined && payload.family !== page.family || !Array.isArray(payload.records)
          || payload.included !== undefined && !Array.isArray(payload.included)) fail("PAYLOAD_INVALID");
        rowsRead += payload.records.length + (payload.included?.length ?? 0); if (rowsRead > limits.maxRows) fail("ROW_LIMIT");
        pages.push({payload, ref: {batch_id: receipt.batchId, commit_id: receipt.commitId, request_digest: receipt.digest, page_id: page.id, payload_hash: page.payloadHash},
          family: page.family, ordinal: page.ordinal});
        after = page.id;
      }
    }
    if ((await repository.readPages({owner: bound, ...input, after, limit: 1})).length) fail("EXTRA_PAGE"); stop();
    const confirm = await repository.inspect({owner: bound, ...input}); stop();
    if (canonicalSourceJson(confirm) !== canonicalSourceJson(receipt)) fail("RECEIPT_CHANGED");
    datasets.push({dataset: read.dataset, receipt, read, source: structuredClone(source),
      sourceContext: {version: "eo05b-source-context-v1", snapshot: structuredClone(source), digest: context.rows[0].snapshot_hash,
        job_id: read.jobId, fence: read.fence, window: structuredClone(read.window)}, pages});
  }
  await assertOwner();
  const result = freeze({owner: bound, scope, datasets, pagesRead, rowsRead, bytesRead});
  verified.set(result, true); return result;
}

export function isStoredDatasetSource(value) {return verified.has(value);}
