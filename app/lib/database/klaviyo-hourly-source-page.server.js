import {canonicalSourceJson, sourceStoreOwner} from "./source-evidence-store.server.js";

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
