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
    || batches.length < 1 || batches.length > (bound.provider === "klaviyo" ? 22 : 3)
    || !limits || !Number.isInteger(limits.maxPages) || limits.maxPages < 1 || limits.maxPages > 300
    || !Number.isInteger(limits.maxRows) || limits.maxRows < 1 || limits.maxRows > 20000
    || !Number.isInteger(limits.maxBytes) || limits.maxBytes < 1 || limits.maxBytes > 16777216
    || !Number.isSafeInteger(limits.deadlineAt)) fail("INPUT_INVALID");
  const stop = () => {if (signal?.aborted || now() >= limits.deadlineAt) fail("STOPPED");};
  const assertOwner = async () => {stop(); await database.query("select evidence.assert_source_owner($1::jsonb)", [JSON.stringify(bound)]); stop();};
  await assertOwner();
  const repository = createSourceEvidenceRepository(database), datasets = [], seenAttempts = new Set(), seenDatasets = new Set();
  let pagesRead = 0, rowsRead = 0, bytesRead = 0, scope = null, group = null;
  const seenBatchIds = new Set();
  for (const input of batches) {
    if (!input || Object.keys(input).sort().join() !== "attemptId,ordinal" || typeof input.attemptId !== "string"
      || (group ? input.attemptId !== group.attemptId || input.ordinal !== group.nextOrdinal
        : input.ordinal !== 0 || seenAttempts.has(input.attemptId))) fail("BATCH_INPUT_INVALID");
    if (!group) seenAttempts.add(input.attemptId);
    stop();
    const receipt = await repository.inspect({owner: bound, ...input}); stop();
    const read = receipt?.manifest?.[spec.read];
    if (receipt?.status !== "committed" || !id(receipt.batchId) || !hash.test(receipt.digest)
      || !hash.test(receipt.manifest?.[spec.digest] ?? "") || !["complete", "partial"].includes(receipt.sourceState)
      || !read || typeof read.operationId !== "string" || typeof read.jobId !== "string" || !id(read.fence)
      || read.window?.from !== read.window?.to || !/^\d{4}-\d\d-\d\d$/.test(read.window?.from ?? "")
      || seenBatchIds.has(receipt.batchId) || (!group && seenDatasets.has(read.dataset)) || !Number.isInteger(receipt.manifest?.counts?.pages)
      || receipt.manifest.counts.pages < 1) fail("RECEIPT_INVALID");
    seenBatchIds.add(receipt.batchId);
    const multipart = Object.hasOwn(read, "packageCount");
    if (multipart && (bound.provider !== "klaviyo" || read.dataset !== "product_performance"
      || receipt.sourceState !== "partial" || !Number.isInteger(read.packageCount) || read.packageCount < 2 || read.packageCount > 20)
      || group && (!multipart || canonicalSourceJson(read) !== group.binding)) fail("PACKAGE_BINDING_INVALID");
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
    const dataset = {dataset: read.dataset, receipt, read, source: structuredClone(source),
      sourceContext: {version: "eo05b-source-context-v1", snapshot: structuredClone(source), digest: context.rows[0].snapshot_hash,
        job_id: read.jobId, fence: read.fence, window: structuredClone(read.window)}, pages};
    if (!multipart) {
      datasets.push(dataset);
      continue;
    }
    group ??= {attemptId: input.attemptId, binding: canonicalSourceJson(read), dataset, nextOrdinal: 0,
      eventPages: 0, events: 0, eventIds: new Set(), receipts: []};
    if (group.dataset.sourceContext.digest !== dataset.sourceContext.digest) fail("PACKAGE_BINDING_INVALID");
    for (const page of pages) {
      if (page.family !== "klaviyo_ordered_product_events") continue;
      group.eventPages++;
      for (const event of page.payload.records) {
        if (typeof event?.id !== "string" || !event.id || group.eventIds.has(event.id)) fail("PACKAGE_EVENTS_INVALID");
        group.eventIds.add(event.id);
        group.events++;
      }
    }
    const coverage = receipt.manifest.klaviyoPackageCoverage;
    if (coverage?.pages !== group.eventPages || coverage?.events !== group.events) fail("PACKAGE_COVERAGE_INVALID");
    group.receipts.push(receipt);
    if (group.dataset !== dataset) group.dataset.pages.push(...pages);
    group.nextOrdinal++;
    if (group.nextOrdinal === read.packageCount) {
      const expected = read.coverage?.[0];
      if (read.coverage?.length !== 1 || expected?.family !== "ordered_product_events" || expected.state !== "present"
        || expected.pageCount !== group.eventPages || expected.recordCount !== group.events) fail("PACKAGE_COVERAGE_INVALID");
      datasets.push({...group.dataset, packageReceipts: group.receipts});
      group = null;
    }
  }
  if (group) fail("PACKAGE_INCOMPLETE");
  await assertOwner();
  const result = freeze({owner: bound, scope, datasets, pagesRead, rowsRead, bytesRead});
  verified.set(result, true); return result;
}

export function isStoredDatasetSource(value) {return verified.has(value);}
