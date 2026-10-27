import {createIdentityRuntimeAuthorityLoader} from "./identity-runtime-authority.server.js";
import {discoverKlaviyoAccount, KLAVIYO_OAUTH_SCOPES} from "./klaviyo-api.server.js";
import {buildKlaviyoShopifyMetricsRequest, buildKlaviyoOrderedProductEventsRequest,
  normalizeKlaviyoOrderedProductEvent, klaviyoBusinessDayTimeframe} from "./klaviyo-reporting.server.js";
import {quotaBoundaryControl} from "../refresh/quota-native-fetch.server.js";

export class KlaviyoIdentityCollectionError extends Error {
  constructor(code) {super(code); this.name = "KlaviyoIdentityCollectionError"; this.code = code;}
}
function fail(code) {throw new KlaviyoIdentityCollectionError(code);}
function freeze(value) {
  if (value && typeof value === "object") {for (const v of Object.values(value)) freeze(v); Object.freeze(value);}
  return value;
}
function id(value) {
  if (typeof value !== "string" || !value || value.length > 256 || /[\u0000-\u0020\u007f]/.test(value)) fail("KLAVIYO_IDENTITY_RESOURCE_ID_INVALID");
  return value;
}
function metricProjection(item) {
  if (item?.type !== "metric" || !item.attributes || typeof item.attributes.name !== "string"
    || typeof item.attributes.integration?.name !== "string") fail("KLAVIYO_IDENTITY_METRIC_INVALID");
  return {type: "metric", id: id(item.id), attributes: {name: item.attributes.name,
    integration: {name: item.attributes.integration.name,
      ...(Object.hasOwn(item.attributes.integration, "id")
        ? {id: item.attributes.integration.id === null ? null : id(item.attributes.integration.id)} : {})}}};
}
const ATTRIBUTION_RELATIONS = ["campaign", "campaign-message", "flow", "flow-message", "flow-message-variation"];
function attributionProjection(item) {
  const relationships = {};
  for (const key of ATTRIBUTION_RELATIONS) {
    if (!Object.hasOwn(item.relationships ?? {}, key)) continue;
    const data = item.relationships[key]?.data;
    if (data !== null && (data?.type !== key || typeof data.id !== "string")) fail("KLAVIYO_IDENTITY_ATTRIBUTION_INVALID");
    relationships[key] = {data: data === null ? null : {type: key, id: id(data.id)}};
  }
  return {type: "attribution", id: id(item.id), relationships};
}
function eventProjection(item, metricId, timeframe) {
  const row = normalizeKlaviyoOrderedProductEvent(item);
  if (row.provider_metric_id !== metricId) fail("KLAVIYO_IDENTITY_EVENT_METRIC_MISMATCH");
  const occurred = Date.parse(row.occurred_at);
  if (!Number.isFinite(occurred) || occurred < Date.parse(timeframe.start) || occurred > Date.parse(timeframe.end)) fail("KLAVIYO_IDENTITY_EVENT_DATE_MISMATCH");
  const properties = {};
  // Project only fields already retained by the reporting normalizer; never return profile/customer fields.
  for (const [key, entry] of Object.entries(row.provider_product_properties)) {
    if (entry.state === "present") {
      if (entry.value !== null && !["string", "number", "boolean"].includes(typeof entry.value)
        || typeof entry.value === "string" && entry.value.length > 8192
        || typeof entry.value === "number" && !Number.isFinite(entry.value)) fail("KLAVIYO_IDENTITY_EVENT_PROPERTY_INVALID");
      properties[key] = entry.value;
    }
  }
  const relationships = {metric: {data: {type: "metric", id: row.provider_metric_id}}};
  if (Object.hasOwn(item.relationships ?? {}, "attributions")) {
    const references = item.relationships.attributions?.data;
    if (!Array.isArray(references) || references.length > 100) fail("KLAVIYO_IDENTITY_ATTRIBUTION_INVALID");
    relationships.attributions = {data: references.map(r => {
      if (r?.type !== "attribution") fail("KLAVIYO_IDENTITY_ATTRIBUTION_INVALID");
      return {type: "attribution", id: id(r.id)};
    })};
  }
  return {type: "event", id: row.provider_event_id, attributes: {datetime: row.occurred_at,
    uuid: row.provider_event_uuid, event_properties: properties}, relationships};
}
function addUnique(map, item, code) {
  const old = map.get(item.id);
  if (old && JSON.stringify(old) !== JSON.stringify(item)) fail(code);
  map.set(item.id, item);
}
function cursorOf(body, path) {
  if (!body.links || !Object.hasOwn(body.links, "next")) fail("KLAVIYO_IDENTITY_PAGINATION_INVALID");
  if (body.links.next === null) return null;
  let next;
  try {next = new URL(body.links.next);} catch {fail("KLAVIYO_IDENTITY_PAGINATION_INVALID");}
  if (next.origin !== "https://a.klaviyo.com" || next.pathname !== path
    || next.username || next.password || next.hash || next.searchParams.getAll("page[cursor]").length !== 1) fail("KLAVIYO_IDENTITY_PAGINATION_INVALID");
  const cursor = next.searchParams.get("page[cursor]");
  if (typeof cursor !== "string" || !cursor || cursor.length > 4096 || cursor !== cursor.trim()) fail("KLAVIYO_IDENTITY_PAGINATION_INVALID");
  return cursor;
}

// Prepared server-only collection. No route, persistence, Shopify query or role classification.
// Uses concrete SQL/vault authority; callers cannot substitute a browser-supplied loadCurrent.
export async function collectKlaviyoNativeIdentityEvidence({verified, database, tokenVault, businessDate,
  fetchFn = fetch, now = () => new Date(), signal, maxPages = 100, maxEvents = 10000,
  maxMetrics = 10000, maxIncluded = 20000, maxElapsedMs = 120000} = {}) {
  if (typeof fetchFn !== "function" || typeof now !== "function"
    || ![maxPages, maxEvents, maxMetrics, maxIncluded, maxElapsedMs].every(Number.isSafeInteger)
    || maxPages < 1 || maxPages > 1000 || maxEvents < 1 || maxEvents > 100000
    || maxMetrics < 1 || maxMetrics > 100000 || maxIncluded < 1 || maxIncluded > 100000
    || maxElapsedMs < 1 || maxElapsedMs > 600000) fail("KLAVIYO_IDENTITY_COLLECTION_INPUT_INVALID");
  // Validate the requested calendar date before any authority or provider read.
  klaviyoBusinessDayTimeframe({businessDate, timeZone: "UTC"});
  function clock() {const t = now(); if (!(t instanceof Date) || !Number.isFinite(t.valueOf())) fail("KLAVIYO_IDENTITY_TIME_INVALID"); return t.valueOf();}
  const start = clock();
  function check() {
    if (signal?.aborted) fail("KLAVIYO_IDENTITY_ABORTED");
    const t = clock(); if (t < start || t - start > maxElapsedMs) fail("KLAVIYO_IDENTITY_OBSERVATION_STALE");
  }
  const loader = createIdentityRuntimeAuthorityLoader({verified, database, tokenVault, provider: "klaviyo", now, signal});
  let current;
  async function recheck() {
    check(); current = await loader.loadCurrent(); check();
    if (KLAVIYO_OAUTH_SCOPES.some(s => !current.grantedScopes.includes(s))) fail("KLAVIYO_IDENTITY_SCOPE_MISSING");
  }
  const boundFetch = async (endpoint, init) => {
    await recheck();
    const response = await fetchFn(endpoint, {...init, redirect: "error", signal}); check();
    if (!response?.ok) fail("KLAVIYO_IDENTITY_HTTP_FAILED");
    return {ok: true, status: response.status, headers: response.headers, async json() {
      let body; try {body = await response.json();} catch {fail("KLAVIYO_IDENTITY_JSON_INVALID");}
      check();
      if (!body || typeof body !== "object" || Array.isArray(body)
        || (Object.hasOwn(body, "errors") && (!Array.isArray(body.errors) || body.errors.length))) fail("KLAVIYO_IDENTITY_RESPONSE_INVALID");
      return body;
    }};
  };
  try {
    await recheck();
    const accountBefore = await discoverKlaviyoAccount({accessToken: current.tokenSet.access_token,
      scopes: current.grantedScopes, fetchFn: boundFetch, now});
    const account = accountBefore.accounts[0];
    if (account.id !== current.account.id) fail("KLAVIYO_IDENTITY_ACCOUNT_MISMATCH");
    const timeframe = klaviyoBusinessDayTimeframe({businessDate, timeZone: account.timezone});
    const requestIds = [];
    async function collect(path, build, maximum, onRows, onIncluded = () => {}) {
      const seen = new Set(); let cursor = null, rawCount = 0, includedCount = 0;
      for (let pages = 1; pages <= maxPages; pages++) {
        check(); const request = build(cursor);
        const response = await boundFetch(request.url, {method: request.method, headers: request.headers});
        if (!response?.ok) fail("KLAVIYO_IDENTITY_HTTP_FAILED");
        let body; try {body = await response.json();} catch (error) {
          if (error instanceof KlaviyoIdentityCollectionError) throw error;
          fail("KLAVIYO_IDENTITY_JSON_INVALID");
        }
        check();
        if (!Array.isArray(body?.data) || (Object.hasOwn(body, "included") && !Array.isArray(body.included))
          || (Object.hasOwn(body, "errors") && (!Array.isArray(body.errors) || body.errors.length))) fail("KLAVIYO_IDENTITY_RESPONSE_INVALID");
        rawCount += body.data.length; includedCount += body.included?.length ?? 0;
        if (rawCount > maximum || includedCount > maxIncluded) fail("KLAVIYO_IDENTITY_ROW_LIMIT");
        onRows(body.data); onIncluded(body.included ?? []);
        const requestId = response.headers?.get?.("x-request-id");
        if (typeof requestId === "string" && requestId.length <= 256 && !/[\u0000-\u0020\u007f]/.test(requestId)) requestIds.push(requestId);
        const next = cursorOf(body, path);
        if (next === null) return pages;
        if (seen.has(next)) fail("KLAVIYO_IDENTITY_CURSOR_REPEATED");
        seen.add(next); cursor = next;
      }
      fail("KLAVIYO_IDENTITY_PAGE_LIMIT");
    }
    const metrics = new Map();
    const metricPages = await collect("/api/metrics", cursor => buildKlaviyoShopifyMetricsRequest({accessToken: current.tokenSet.access_token, cursor}),
      maxMetrics, rows => {for (const item of rows) addUnique(metrics, metricProjection(item), "KLAVIYO_IDENTITY_METRIC_CONFLICT");});
    const candidates = [...metrics.values()].filter(m => m.attributes.name === "Ordered Product" && m.attributes.integration.name === "Shopify");
    if (candidates.length !== 1) fail("KLAVIYO_IDENTITY_ORDERED_PRODUCT_METRIC_AMBIGUOUS_OR_MISSING");
    const metric = candidates[0], events = new Map(), attributions = new Map(), includedMetrics = new Map();
    const eventPages = await collect("/api/events", cursor => buildKlaviyoOrderedProductEventsRequest({accessToken: current.tokenSet.access_token,
      orderedProductMetricId: metric.id, businessDate, timeZone: account.timezone, cursor}), maxEvents,
    rows => {for (const item of rows) addUnique(events, eventProjection(item, metric.id, timeframe), "KLAVIYO_IDENTITY_EVENT_CONFLICT");},
    items => {for (const item of items) {
      if (item?.type === "metric") addUnique(includedMetrics, metricProjection(item), "KLAVIYO_IDENTITY_METRIC_CONFLICT");
      else if (item?.type === "attribution") addUnique(attributions, attributionProjection(item), "KLAVIYO_IDENTITY_ATTRIBUTION_CONFLICT");
    }});
    for (const m of includedMetrics.values()) {
      if (m.id !== metric.id || JSON.stringify(m) !== JSON.stringify(metric)) fail("KLAVIYO_IDENTITY_METRIC_CONFLICT");
    }
    for (const e of events.values()) for (const ref of e.relationships.attributions?.data ?? []) {
      if (!attributions.has(ref.id)) fail("KLAVIYO_IDENTITY_ATTRIBUTION_MISSING");
    }
    const accountAfter = await discoverKlaviyoAccount({accessToken: current.tokenSet.access_token,
      scopes: current.grantedScopes, fetchFn: boundFetch, now});
    const after = accountAfter.accounts[0];
    if (after.id !== account.id || after.timezone !== account.timezone || after.currency !== account.currency) fail("KLAVIYO_IDENTITY_ACCOUNT_CHANGED");
    await recheck();
    return freeze({provider: "klaviyo", source: "native_account_metric_and_event_collection", account: {id: account.id,
      timezone: account.timezone, currency: account.currency}, installation: current.installation, shop: current.shop,
      connection_id: current.connectionId, connection_version: current.connectionVersion,
      metric, events: [...events.values()], attributions: [...attributions.values()], timeframe,
      evidence: {metric_pages: metricPages, event_pages: eventPages, request_ids: requestIds,
        started_at: new Date(start).toISOString(), completed_at: new Date(clock()).toISOString()},
      provider_account_observed: true, Shopify_store_integration_binding_verified: false,
      canonical_scope_ready: false, installation_id: null, persistable: false,
      authorizes_activation: false, mapping_write_performed: false, sales_roles_changed: false,
      remaining: ["trusted_installation_primary_key_read", "Shopify_Admin_candidate_verification_composition", "Message_channel_join"]});
  } catch (error) {
    if (quotaBoundaryControl(error)) throw error;
    if (error instanceof KlaviyoIdentityCollectionError) throw error;
    fail(signal?.aborted ? "KLAVIYO_IDENTITY_ABORTED" : "KLAVIYO_IDENTITY_COLLECTION_FAILED");
  }
}
