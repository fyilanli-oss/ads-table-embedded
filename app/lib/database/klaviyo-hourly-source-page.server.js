import {canonicalSourceJson, sourcePayloadHash, sourceStoreOwner} from "./source-evidence-store.server.js";

const pageFormat = Object.freeze({
  family:"klaviyo_ordered_product_events",
  origin:"klaviyo",
  captureLayer:"native_response_projection",
  numericFidelity:"lossless_token",
  schemaVersion:"klaviyo-ordered-product-hourly-v1",
  sanitizerVersion:"klaviyo-native-fields-v1",
  fieldCoverage:Object.freeze(["projection", "scope"]),
});
const scopeKeys = ["version","provider","workspaceId","installGeneration","accountId","jobId","fence",
  "timeZone","metricId","timeframe","endExclusive","revision"].sort().join();
const fail = () => {throw Error("KLAVIYO_HOURLY_SOURCE_SCOPE_INVALID");};
const preparedBatches = new WeakMap();
const verifiedReports = new WeakMap();

function hourlyScope({owner, scope, attemptId, pageOrdinal}) {
  const bound = sourceStoreOwner(owner);
  if (bound.provider !== "klaviyo" || !scope || Object.keys(scope).sort().join() !== scopeKeys
    || scope.workspaceId !== bound.workspaceId || scope.installGeneration !== bound.generation
    || scope.accountId !== bound.accountId || scope.provider !== bound.provider
    || scope.version !== pageFormat.schemaVersion || scope.endExclusive !== true
    || !Number.isSafeInteger(scope.fence) || scope.fence < 1
    || ![scope.jobId, scope.metricId, scope.timeZone, scope.revision].every(value =>
      typeof value === "string" && value.length > 0 && value.length <= 256)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)
    || !Number.isSafeInteger(pageOrdinal) || pageOrdinal < 0) fail();
  if (!scope.timeframe || Object.keys(scope.timeframe).sort().join() !== "end,start") fail();
  const {start, end} = scope.timeframe;
  if (![start,end].every(value => typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value) || Date.parse(end) - Date.parse(start) !== 7_200_000) fail();
  return {owner:bound, attemptId, ordinal:0, page:{...pageFormat, ordinal:pageOrdinal}};
}

function validateProjection(projection, scope) {
  if (!projection || !["included,records,revision", "hasNext,included,records,revision"]
    .includes(Object.keys(projection).sort().join())
    || projection.revision !== scope.revision || !Array.isArray(projection.included)
    || !Array.isArray(projection.records) || projection.records.length > 200
    || (Object.hasOwn(projection,"hasNext") && typeof projection.hasNext !== "boolean")) fail();
  const lower = Date.parse(scope.timeframe.start), upper = Date.parse(scope.timeframe.end);
  for (const record of projection.records) {
    const event = record?.attributes;
    const time = Date.parse(event?.datetime);
    if (record?.type !== "event" || record.relationships?.metric?.data?.id !== scope.metricId
      || !Number.isFinite(time) || time < lower || time >= upper) fail();
  }
}

// The input must come from the fixed native projection. Sealing a page does not
// grant admission, verify completeness or record a durable receipt.
export function sealKlaviyoHourlySourcePage({cipher, projection, ...input}) {
  const context = hourlyScope(input);
  validateProjection(projection, input.scope);
  return cipher.seal({...context, payload:{scope:input.scope, projection}});
}

export function openKlaviyoHourlySourcePage({cipher, page, ...input}) {
  const context = hourlyScope(input);
  if (!page || Object.keys(context.page).some(key =>
    canonicalSourceJson(page[key]) !== canonicalSourceJson(context.page[key]))) fail();
  const payload = cipher.open({...context, page});
  if (canonicalSourceJson(payload.scope) !== canonicalSourceJson(input.scope)) fail();
  validateProjection(payload.projection, input.scope);
  return payload.projection;
}

function validateBatchLimits(limits, pages) {
  if (!limits || !Number.isSafeInteger(limits.maxPages) || limits.maxPages < 1 || limits.maxPages > 300
    || !Number.isSafeInteger(limits.maxRows) || limits.maxRows < 1 || limits.maxRows > 20_000
    || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || limits.maxBytes > 16_777_216
    || !Array.isArray(pages) || pages.length === 0 || pages.length > limits.maxPages) fail();
}

function sourceBatchManifest(input, pages, open) {
  const {limits, scope, attemptId} = input;
  validateBatchLimits(limits, pages);
  let rows = 0, bytes = 0;
  const eventIds = new Set();
  const entries = pages.map((page, pageOrdinal) => {
    if (page?.ordinal !== pageOrdinal || !/^[a-f0-9]{64}$/.test(page.payloadHash)
      || !Number.isSafeInteger(page.plainBytes) || page.plainBytes < 1) fail();
    bytes += page.plainBytes;
    if (bytes > limits.maxBytes) fail();
    const projection = open(page, pageOrdinal);
    if (projection.hasNext !== (pageOrdinal + 1 < pages.length)) fail();
    for (const event of projection.records) {
      if (typeof event.id !== "string" || !event.id || eventIds.has(event.id)) fail();
      eventIds.add(event.id);
    }
    rows += projection.records.length;
    if (rows > limits.maxRows) fail();
    return Object.freeze({ordinal:pageOrdinal, payloadHash:page.payloadHash,
      plainBytes:page.plainBytes, rows:projection.records.length});
  });
  const manifest = {
    version:"klaviyo-hourly-source-batch-v1", attemptId, scopeDigest:sourcePayloadHash(scope),
    pages:Object.freeze(entries), rows, bytes,
  };
  return Object.freeze({...manifest, digest:sourcePayloadHash(manifest)});
}

// Prepared encrypted pages and their immutable manifest for the private writer.
// The returned digest identifies the complete batch but does not confirm a write.
export function prepareKlaviyoHourlySourceBatch({projections, ...input}) {
  validateBatchLimits(input.limits, projections);
  let bytes = 0, rows = 0;
  const pages = projections.map((projection, pageOrdinal) => {
    const page = sealKlaviyoHourlySourcePage({...input, projection, pageOrdinal});
    bytes += page.plainBytes;
    rows += projection.records.length;
    if (bytes > input.limits.maxBytes || rows > input.limits.maxRows) fail();
    return Object.freeze(page);
  });
  const manifest = sourceBatchManifest(input, pages, (_, index) => projections[index]);
  const batch = Object.freeze({pages:Object.freeze(pages), manifest});
  preparedBatches.set(batch, {cipher:input.cipher, owner:sourceStoreOwner(input.owner),
    scope:structuredClone(input.scope), attemptId:input.attemptId, limits:structuredClone(input.limits)});
  return batch;
}

// Run after the private writer returns its immutable manifest and physical pages.
// A successful comparison is content evidence only, independent of job closure.
export function verifyKlaviyoHourlySourceBatch({pages, manifest, expectedManifest, ...input}) {
  if (canonicalSourceJson(manifest) !== canonicalSourceJson(expectedManifest)) fail();
  const actual = sourceBatchManifest(input, pages, (page, pageOrdinal) =>
    openKlaviyoHourlySourcePage({...input, page, pageOrdinal}));
  if (canonicalSourceJson(actual) !== canonicalSourceJson(expectedManifest)) fail();
  return actual;
}

// The private repository must check the current claim and commit the manifest
// and all pages atomically. This orchestration handles acknowledgement and
// bounded physical readback. A source receipt never closes the report job.
export async function commitKlaviyoHourlySourceBatch({batch, repository, deadlineAt, now = Date.now, signal}) {
  const context = preparedBatches.get(batch);
  if (!context || typeof repository?.commitHourlySource !== "function"
    || typeof repository?.readHourlySource !== "function" || typeof now !== "function"
    || !Number.isSafeInteger(deadlineAt)) fail();
  const stop = () => {
    const current = now();
    if (signal?.aborted || !Number.isSafeInteger(current) || current >= deadlineAt) {
      throw Error("KLAVIYO_HOURLY_SOURCE_STOPPED");
    }
  };
  const {owner, scope, attemptId, limits} = context;
  const binding = {owner, scope, attemptId, deadlineAt};
  stop();
  preparedBatches.delete(batch);
  let receipt;
  try {
    receipt = await repository.commitHourlySource({...structuredClone(binding), batch});
    if (receipt?.status !== "committed" || receipt.attemptId !== attemptId
      || receipt.digest !== batch.manifest.digest) fail();
  } catch {
    throw Error("KLAVIYO_HOURLY_SOURCE_WRITE_UNCONFIRMED");
  }
  stop();
  try {
    const stored = await repository.readHourlySource({...structuredClone(binding), maxPages:limits.maxPages});
    stop();
    if (canonicalSourceJson(stored?.manifest) !== canonicalSourceJson(batch.manifest)) fail();
    const first = Date.parse(scope.timeframe.start);
    const boundary = first+3_600_000;
    const counts = [0,0];
    const manifest = sourceBatchManifest(context, stored.pages, (page,pageOrdinal) => {
      const projection = openKlaviyoHourlySourcePage({...context,page,pageOrdinal});
      for (const event of projection.records) counts[Date.parse(event.attributes.datetime)<boundary ? 0 : 1]++;
      return projection;
    });
    if (canonicalSourceJson(manifest) !== canonicalSourceJson(batch.manifest)) fail();
    const verified = Object.freeze({attemptId, digest:manifest.digest, pageCount:manifest.pages.length,
      rowCount:manifest.rows, contentVerified:true});
    verifiedReports.set(verified, {owner,attemptId,digest:manifest.digest,counts});
    return verified;
  } catch {
    throw Error("KLAVIYO_HOURLY_SOURCE_READBACK_UNCONFIRMED");
  }
}

export async function commitKlaviyoHourlyEventReport({database,sourceReceipt,deadlineAt,now = Date.now}) {
  const proof = verifiedReports.get(sourceReceipt);
  if (!proof || typeof database?.query !== "function" || typeof now !== "function"
    || !Number.isSafeInteger(deadlineAt)) fail();
  const current = now();
  if (!Number.isSafeInteger(current) || current >= deadlineAt) fail();
  verifiedReports.delete(sourceReceipt);
  let receipt;
  try {
    const {rows} = await database.query(
      "select analytics.commit_klaviyo_hourly_event_report($1::jsonb,$2::uuid,$3::text,$4::jsonb,$5::timestamptz) as result",
      [proof.owner,proof.attemptId,proof.digest,JSON.stringify(proof.counts),new Date(deadlineAt).toISOString()],
    );
    receipt = rows?.[0]?.result;
    if (rows?.length !== 1 || receipt?.attemptId !== proof.attemptId || receipt?.digest !== proof.digest
      || canonicalSourceJson(receipt.counts) !== canonicalSourceJson(proof.counts)) fail();
  } catch {throw Error("KLAVIYO_HOURLY_REPORT_WRITE_UNCONFIRMED");}
  try {
    if (now() >= deadlineAt) fail();
    const {rows} = await database.query(
      "select analytics.read_klaviyo_hourly_event_report($1::jsonb,$2::uuid) as result",
      [proof.owner,proof.attemptId],
    );
    if (rows?.length !== 1 || canonicalSourceJson(rows[0].result) !== canonicalSourceJson(receipt)) fail();
    return Object.freeze(receipt);
  } catch {throw Error("KLAVIYO_HOURLY_REPORT_READBACK_UNCONFIRMED");}
}
