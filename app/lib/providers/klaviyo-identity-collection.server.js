import {createIdentityRuntimeAuthorityLoader} from "./identity-runtime-authority.server.js";
import {discoverKlaviyoAccount, KLAVIYO_OAUTH_SCOPES} from "./klaviyo-api.server.js";
import {buildKlaviyoShopifyMetricsRequest, buildKlaviyoOrderedProductEventsRequest,
  buildKlaviyoCampaignValuesRequest, buildKlaviyoFlowValuesRequest, normalizeKlaviyoReportRow, KlaviyoReportingError,
  normalizeKlaviyoOrderedProductEvent, klaviyoBusinessDayTimeframe} from "./klaviyo-reporting.server.js";
import {attachAttributionEvidence} from "./klaviyo-reporting-authority.server.js";
import {resolveKlaviyoOrderedProductSales} from "./klaviyo-attribution-resolution.server.js";
import {verifyKlaviyoProductCandidateRows} from "./klaviyo-product-identity.server.js";
import {quotaBoundaryControl} from "../refresh/quota-native-fetch.server.js";
import {runIdentityReadDeadline} from "./identity-read-deadline.server.js";
import {buildKlaviyoAttributedEventRequest, readKlaviyoAttributedInteractions} from "./klaviyo-attributed-interaction.server.js";

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
  for (const key of ["event", "attributed-event"]) {
    if (!Object.hasOwn(item.relationships ?? {}, key)) continue;
    const data = item.relationships[key]?.data;
    if (data !== null && data?.type !== "event") fail("KLAVIYO_IDENTITY_ATTRIBUTION_INVALID");
    relationships[key] = {data: data === null ? null : {type: "event", id: id(data.id)}};
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
  for (const [key, entry] of Object.entries({...row.provider_product_properties,...row.provider_order_properties})) {
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
function cursorOf(body, path, parameter = "page[cursor]") {
  if (!body.links || !Object.hasOwn(body.links, "next")) fail("KLAVIYO_IDENTITY_PAGINATION_INVALID");
  if (body.links.next === null) return null;
  let next;
  try {next = new URL(body.links.next);} catch {fail("KLAVIYO_IDENTITY_PAGINATION_INVALID");}
  if (next.origin !== "https://a.klaviyo.com" || next.pathname !== path
    || next.username || next.password || next.hash || next.searchParams.getAll(parameter).length !== 1) fail("KLAVIYO_IDENTITY_PAGINATION_INVALID");
  const cursor = next.searchParams.get(parameter);
  if (typeof cursor !== "string" || !cursor || cursor.length > 4096 || cursor !== cursor.trim()) fail("KLAVIYO_IDENTITY_PAGINATION_INVALID");
  return cursor;
}

// Prepared server-only collection. No route, persistence or Shopify query.
// Uses concrete SQL/vault authority; callers cannot substitute a browser-supplied loadCurrent.
async function collectKlaviyoIdentitySource({verified, database, tokenVault, businessDate,
  fetchFn = fetch, now = () => new Date(), signal, maxPages = 100, maxEvents = 10000,
  maxMetrics = 10000, maxIncluded = 20000, maxMessageRows = 10000, maxElapsedMs = 120000,
  maxInteractions = 1000, maxInteractionBytes = 2_000_000, withMessages, withShopify, withInteractions} = {}) {
  if (typeof fetchFn !== "function" || typeof now !== "function"
    || ![maxPages, maxEvents, maxMetrics, maxIncluded, maxMessageRows, maxElapsedMs].every(Number.isSafeInteger)
    || maxPages < 1 || maxPages > 1000 || maxEvents < 1 || maxEvents > 100000
    || maxMetrics < 1 || maxMetrics > 100000 || maxIncluded < 1 || maxIncluded > 100000
    || maxMessageRows < 1 || maxMessageRows > 100000
    || maxElapsedMs < 1 || maxElapsedMs > 600000
    || withInteractions && (!Number.isSafeInteger(maxInteractions) || maxInteractions < 1 || maxInteractions > 10000
      || !Number.isSafeInteger(maxInteractionBytes) || maxInteractionBytes < 1 || maxInteractionBytes > 20_000_000)) fail("KLAVIYO_IDENTITY_COLLECTION_INPUT_INVALID");
  // Validate the requested calendar date before any authority or provider read.
  klaviyoBusinessDayTimeframe({businessDate, timeZone: "UTC"});
  function clock() {const t = now(); if (!(t instanceof Date) || !Number.isFinite(t.valueOf())) fail("KLAVIYO_IDENTITY_TIME_INVALID"); return t.valueOf();}
  const start = clock();
  function check() {
    if (signal?.aborted) fail("KLAVIYO_IDENTITY_ABORTED");
    const t = clock(); if (t < start || t - start > maxElapsedMs) fail("KLAVIYO_IDENTITY_OBSERVATION_STALE");
  }
  const loader = createIdentityRuntimeAuthorityLoader({verified, database, tokenVault, provider: "klaviyo", now, signal});
  const nativeGraphql = withShopify ? verified.context.admin.graphql.bind(verified.context.admin) : null;
  let current, shopifyQuotaControl = null;
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
    async function collect(path, build, maximum, onRows, onIncluded = () => {}, reportKind = null) {
      const seen = new Set(); let cursor = null, rawCount = 0, includedCount = 0;
      for (let pages = 1; pages <= maxPages; pages++) {
        check(); const request = build(cursor);
        const response = await boundFetch(request.url, {method: request.method, headers: request.headers,
          ...(request.body == null ? {} : {body: request.body})});
        if (!response?.ok) fail("KLAVIYO_IDENTITY_HTTP_FAILED");
        let body; try {body = await response.json();} catch (error) {
          if (error instanceof KlaviyoIdentityCollectionError) throw error;
          fail("KLAVIYO_IDENTITY_JSON_INVALID");
        }
        check();
        const rows = reportKind === null ? body?.data : body?.data?.attributes?.results;
        if (!Array.isArray(rows) || (reportKind !== null && body?.data?.type !== `${reportKind}-values-report`)
          || (Object.hasOwn(body, "included") && !Array.isArray(body.included))
          || (Object.hasOwn(body, "errors") && (!Array.isArray(body.errors) || body.errors.length))) fail("KLAVIYO_IDENTITY_RESPONSE_INVALID");
        rawCount += rows.length; includedCount += body.included?.length ?? 0;
        if (rawCount > maximum || includedCount > maxIncluded) fail("KLAVIYO_IDENTITY_ROW_LIMIT");
        onRows(rows); onIncluded(body.included ?? []);
        const requestId = response.headers?.get?.("x-request-id");
        if (typeof requestId === "string" && requestId.length <= 256 && !/[\u0000-\u0020\u007f]/.test(requestId)) requestIds.push(requestId);
        const next = cursorOf(body, path, reportKind === null ? "page[cursor]" : "page_cursor");
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
    let placedMetric = null;
    if (withMessages) {
      const placed = [...metrics.values()].filter(m => m.attributes.name === "Placed Order" && m.attributes.integration.name === "Shopify");
      if (placed.length !== 1) fail("KLAVIYO_IDENTITY_PLACED_ORDER_METRIC_AMBIGUOUS_OR_MISSING");
      placedMetric = placed[0];
    }
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
    let interactionEvidence = null;
    if (withInteractions) interactionEvidence = await readKlaviyoAttributedInteractions({events: [...events.values()],
      attributions: [...attributions.values()], check, maxInteractions, maxBytes: maxInteractionBytes,
      fetchEvent: async eventId => {
        const request = buildKlaviyoAttributedEventRequest({eventId, accessToken: current.tokenSet.access_token});
        const response = await boundFetch(request.url, {method: request.method, headers: request.headers});
        const body = await response.json(); await recheck();
        const requestId = response.headers?.get?.("x-request-id");
        if (typeof requestId === "string" && requestId.length <= 256 && !/[\u0000-\u0020\u007f]/.test(requestId)) requestIds.push(requestId);
        return body;
      }});
    let productCandidates = null;
    if (withShopify) {
      const admin = {async graphql(query, options) {
        await recheck();
        let response;
        try {response = await nativeGraphql(query, {...options, tries: 1, signal});}
        catch (error) {if (quotaBoundaryControl(error)) shopifyQuotaControl = error; throw error;}
        check();
        return {ok: response?.ok, status: response?.status, async json() {
          const body = await response.json(); check(); await recheck(); return body;
        }};
      }};
      productCandidates = await verifyKlaviyoProductCandidateRows({events: [...events.values()], metric,
        context: {installation: current.installation, shop: current.shop, admin}, signal, maxEvents});
      await recheck();
    }
    let messageEvidence = null;
    if (withMessages) {
      const channels = {}, pages = {};
      for (const kind of ["campaign", "flow"]) {
        const unique = new Map();
        const build = kind === "campaign" ? buildKlaviyoCampaignValuesRequest : buildKlaviyoFlowValuesRequest;
        pages[kind] = await collect(`/api/${kind}-values-reports`, pageCursor => build({accessToken: current.tokenSet.access_token,
          businessDate, timeZone: account.timezone, conversionMetricId: placedMetric.id, pageCursor}), maxMessageRows,
        rows => {for (const row of rows) {
          const {statistics, ...channel} = normalizeKlaviyoReportRow(kind, row);
          // Statistics are deliberately not joined to Ordered Product sale facts or returned here.
          unique.set(JSON.stringify(channel), channel);
        }}, undefined, kind);
        channels[kind] = [...unique.values()];
      }
      const candidateRows = new Map((productCandidates?.rows ?? []).map(row => [row.provider_event_id, row]));
      const normalized = attachAttributionEvidence([...events.values()], [...attributions.values()]).map(row => {
        const candidate = candidateRows.get(row.provider_event_id);
        return candidate ? {...row, product_identity_verification: candidate.product_identity_verification} : row;
      });
      messageEvidence = {reporting_metric: placedMetric, channels,
        resolved_product_sales: resolveKlaviyoOrderedProductSales({campaignChannels: channels.campaign,
          flowChannels: channels.flow, orderedProductEvents: normalized}), pages,
        composition_scope: "same_native_account_credential_and_business_day_collection",
        product_sale_statistics_source: "Ordered Product", reporting_statistics_used_as_product_sales: false};
    }
    const accountAfter = await discoverKlaviyoAccount({accessToken: current.tokenSet.access_token,
      scopes: current.grantedScopes, fetchFn: boundFetch, now});
    const after = accountAfter.accounts[0];
    if (after.id !== account.id || after.timezone !== account.timezone || after.currency !== account.currency) fail("KLAVIYO_IDENTITY_ACCOUNT_CHANGED");
    await recheck();
    return freeze({provider: "klaviyo", source: withInteractions ? "native_identity_message_and_attributed_interaction_collection"
      : withShopify ? "native_identity_message_and_shopify_candidate_collection"
      : withMessages ? "native_identity_and_message_collection" : "native_account_metric_and_event_collection", account: {id: account.id,
      timezone: account.timezone, currency: account.currency}, installation: current.installation, shop: current.shop,
      connection_id: current.connectionId, connection_version: current.connectionVersion,
      metric, events: [...events.values()], attributions: [...attributions.values()], timeframe,
      ...(withInteractions ? {attributed_interactions: interactionEvidence} : {}),
      ...(withMessages ? {message_evidence: messageEvidence} : {}),
      ...(withShopify ? {product_identity_candidates: productCandidates} : {}),
      evidence: {metric_pages: metricPages, event_pages: eventPages, request_ids: requestIds,
        started_at: new Date(start).toISOString(), completed_at: new Date(clock()).toISOString()},
      provider_account_observed: true, Shopify_store_integration_binding_verified: false,
      canonical_scope_ready: false, installation_id: current.installation_id, reporting_selection_epoch: current.reporting_selection_epoch, persistable: false,
      authorizes_activation: false, mapping_write_performed: false, sales_roles_changed: false,
      remaining: ["canonical_authority_scope_to_source_binding",
        ...(withShopify ? [] : ["Shopify_Admin_candidate_verification_composition"]),
        ...(withMessages ? [] : ["Message_channel_join"])]});
  } catch (error) {
    if (shopifyQuotaControl !== null) throw shopifyQuotaControl;
    if (quotaBoundaryControl(error)) throw error;
    if (error instanceof KlaviyoIdentityCollectionError) throw error;
    if (error instanceof KlaviyoReportingError && /^KLAVIYO_INTERACTION_[A-Z_]+$/.test(error.code)) fail(error.code);
    fail(signal?.aborted ? "KLAVIYO_IDENTITY_ABORTED" : "KLAVIYO_IDENTITY_COLLECTION_FAILED");
  }
}

// Public entry points lock their own mode; caller options cannot silently add report requests.
export function collectKlaviyoNativeIdentityEvidence(options = {}) {
  return runIdentityReadDeadline({signal: options.signal, timeoutMs: options.maxElapsedMs,
    run: signal => collectKlaviyoIdentitySource({...options, signal, withMessages: false, withShopify: false, withInteractions: false})});
}
export function collectKlaviyoIdentityMessageEvidence(options = {}) {
  return runIdentityReadDeadline({signal: options.signal, timeoutMs: options.maxElapsedMs,
    run: signal => collectKlaviyoIdentitySource({...options, signal, withMessages: true, withShopify: false, withInteractions: false})});
}
export function collectKlaviyoVerifiedProductCandidateEvidence(options = {}) {
  return runIdentityReadDeadline({signal: options.signal, timeoutMs: options.maxElapsedMs,
    run: signal => collectKlaviyoIdentitySource({...options, signal, withMessages: true, withShopify: true, withInteractions: false})});
}

// Explicit inactive entry. Existing modes never follow references implicitly.
export function collectKlaviyoInteractionEvidence(options = {}) {
  return runIdentityReadDeadline({signal: options.signal, timeoutMs: options.maxElapsedMs,
    run: signal => collectKlaviyoIdentitySource({...options, signal, withMessages: true, withShopify: false, withInteractions: true})});
}
