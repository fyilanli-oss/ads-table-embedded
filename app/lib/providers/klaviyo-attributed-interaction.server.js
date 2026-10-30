import {KLAVIYO_REPORTING_API_REVISION, KlaviyoReportingError} from "./klaviyo-reporting.server.js";

const fail = code => {throw new KlaviyoReportingError(code, code);};
const id = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(v);
const text = v => typeof v === "string" && v.length > 0 && v.length <= 256 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
export const KLAVIYO_INTERACTION_FIELDS = Object.freeze({event: "id,datetime,timestamp", metric: "id,name,integration"});

/** Only an exact referenced event; no properties/profile, product lookup or search. */
export function buildKlaviyoAttributedEventRequest({eventId, accessToken} = {}) {
  if (!id(eventId) || typeof accessToken !== "string" || !accessToken || /[\r\n]/.test(accessToken)) fail("KLAVIYO_INTERACTION_REQUEST_INVALID");
  const address = new URL(`https://a.klaviyo.com/api/events/${eventId}`);
  address.searchParams.set("include", "metric");
  address.searchParams.set("fields[event]", KLAVIYO_INTERACTION_FIELDS.event);
  address.searchParams.set("fields[metric]", KLAVIYO_INTERACTION_FIELDS.metric);
  return {url: address.toString(), method: "GET", headers: {authorization: `Bearer ${accessToken}`,
    accept: "application/vnd.api+json", revision: KLAVIYO_REPORTING_API_REVISION}};
}

function projectEvent(body, expectedId) {
  const event = body?.data, metricId = event?.relationships?.metric?.data;
  if (event?.type !== "event" || event.id !== expectedId || metricId?.type !== "metric" || !id(metricId.id)
    || !Array.isArray(body.included)) fail("KLAVIYO_INTERACTION_RESPONSE_INVALID");
  const metrics = body.included.filter(v => v?.type === "metric");
  if (metrics.length !== 1 || metrics[0].id !== metricId.id || !text(metrics[0].attributes?.name)) fail("KLAVIYO_INTERACTION_METRIC_CONFLICT");
  const time = event.attributes?.datetime;
  if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(time) || !Number.isFinite(Date.parse(time))) fail("KLAVIYO_INTERACTION_TIME_INVALID");
  if (new Date(`${time.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== time.slice(0, 10)) fail("KLAVIYO_INTERACTION_TIME_INVALID");
  const timestamp = event.attributes.timestamp;
  if (timestamp != null && (typeof timestamp !== "number" || !Number.isFinite(timestamp)
    || Math.abs(timestamp * 1000 - Date.parse(time)) > 1)) fail("KLAVIYO_INTERACTION_TIME_CONFLICT");
  const integration = metrics[0].attributes.integration;
  if (integration != null && (typeof integration !== "object" || Array.isArray(integration)
    || !text(integration.name))) fail("KLAVIYO_INTERACTION_METRIC_CONFLICT");
  const name = metrics[0].attributes.name;
  // Only these two observed Klaviyo native names receive a click/open label.
  const kind = integration?.name === "Klaviyo" ? {"Clicked Email": "click", "Opened Email": "open"}[name] ?? "other" : "other";
  return Object.freeze({event_id: event.id, metric_id: metricId.id, metric_name: name,
    metric_integration: integration?.name ?? null, occurred_at: time, timestamp: timestamp ?? null, kind});
}

/** Same-account caller owns transport/authority/deadline. Only sale-referenced
 * attributions are followed. Missing links remain explicit; conflicts do not get
 * an alternative search. Provider/read/schema errors stop the entire collection.
 */
export async function readKlaviyoAttributedInteractions({events, attributions, fetchEvent, check,
  maxInteractions = 1000, maxBytes = 2_000_000} = {}) {
  if (!Array.isArray(events) || !Array.isArray(attributions) || typeof fetchEvent !== "function" || typeof check !== "function"
    || !Number.isSafeInteger(maxInteractions) || maxInteractions < 1 || maxInteractions > 10000
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 20_000_000) fail("KLAVIYO_INTERACTION_INPUT_INVALID");
  const byId = new Map(), pending = [], links = [], fetched = new Map();
  for (const a of attributions) {
    if (a?.type !== "attribution" || !id(a.id)) fail("KLAVIYO_INTERACTION_ATTRIBUTION_INVALID");
    if (byId.has(a.id) && JSON.stringify(byId.get(a.id)) !== JSON.stringify(a)) fail("KLAVIYO_INTERACTION_ATTRIBUTION_CONFLICT");
    byId.set(a.id, a);
  }
  const reference = (a, key) => a.relationships?.[key]?.data;
  for (const sale of events) {
    if (!Object.hasOwn(sale.relationships ?? {}, "attributions")) {
      links.push({sale_event_id: sale.id, attribution_id: null, interaction_event_id: null, status: "missing_reference"}); continue;
    }
    const refs = sale.relationships?.attributions?.data ?? [];
    if (!refs.length) links.push({sale_event_id: sale.id, attribution_id: null, interaction_event_id: null, status: "no_attribution"});
    const seen = new Set();
    for (const ref of refs) {
      if (pending.length + links.length >= 100000) fail("KLAVIYO_INTERACTION_LINK_LIMIT_EXCEEDED");
      if (ref?.type !== "attribution" || !id(ref.id)) fail("KLAVIYO_INTERACTION_ATTRIBUTION_INVALID");
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      const a = byId.get(ref.id);
      if (!a) fail("KLAVIYO_INTERACTION_ATTRIBUTION_MISSING");
      const saleRef = reference(a, "event"), interaction = reference(a, "attributed-event");
      const base = {sale_event_id: sale.id, attribution_id: a.id, interaction_event_id: interaction?.id ?? null};
      if (!saleRef || !interaction) {links.push({...base, status: "missing_reference"}); continue;}
      if (saleRef.type !== "event" || saleRef.id !== sale.id || interaction.type !== "event"
        || !id(interaction.id) || interaction.id === sale.id) {links.push({...base, status: "reference_conflict"}); continue;}
      pending.push({sale, base});
    }
  }
  if (new Set(pending.map(p => p.base.interaction_event_id)).size > maxInteractions) fail("KLAVIYO_INTERACTION_LIMIT_EXCEEDED");
  let bytes = 0;
  for (const {sale, base} of pending) {
    check();
    let interaction = fetched.get(base.interaction_event_id);
    if (!interaction) {
      const body = await fetchEvent(base.interaction_event_id); check();
      bytes += Buffer.byteLength(JSON.stringify(body), "utf8");
      if (bytes > maxBytes) fail("KLAVIYO_INTERACTION_BYTE_LIMIT_EXCEEDED");
      interaction = projectEvent(body, base.interaction_event_id); fetched.set(interaction.event_id, interaction);
    }
    const saleTime = Date.parse(sale.attributes?.datetime);
    if (!Number.isFinite(saleTime)) fail("KLAVIYO_INTERACTION_SALE_TIME_INVALID");
    links.push(Object.freeze({...base, status: Date.parse(interaction.occurred_at) > saleTime ? "time_conflict" : "linked",
      interaction_kind: interaction.kind}));
  }
  return Object.freeze({links: Object.freeze(links.map(Object.freeze)), events: Object.freeze([...fetched.values()]),
    requests: fetched.size, observed_response_bytes: bytes, clicked_product_verified: false,
    sales_roles_changed: false, persistable: false, publishable: false});
}
