import {KlaviyoReportingError, KLAVIYO_REPORTING_API_REVISION} from "./klaviyo-reporting.server.js";

export const KLAVIYO_ATTRIBUTED_EVENT_LIMIT = 100;

function fail(code) {
  throw new KlaviyoReportingError(code, code);
}

function eventId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) {
    fail("KLAVIYO_ATTRIBUTED_EVENT_ID_INVALID");
  }
  return value;
}

export function buildKlaviyoAttributedEventRequest({accessToken, id}) {
  const nativeId = eventId(id);
  if (typeof accessToken !== "string" || !accessToken || accessToken !== accessToken.trim()) {
    fail("KLAVIYO_ACCESS_TOKEN_REQUIRED");
  }
  const target = new URL(`https://a.klaviyo.com/api/events/${nativeId}`);
  target.searchParams.set("include", "metric");
  target.searchParams.set("fields[event]", "id,datetime,timestamp,uuid,event_properties");
  target.searchParams.set("fields[metric]", "id,name,integration");
  return Object.freeze({method: "GET", url: target.toString(), headers: Object.freeze({
    accept: "application/vnd.api+json", revision: KLAVIYO_REPORTING_API_REVISION,
    Authorization: `Bearer ${accessToken}`,
  })});
}

function normalizeDetail(payload, requestedId) {
  const data = payload?.data;
  if (data?.type !== "event" || data.id !== requestedId) fail("KLAVIYO_ATTRIBUTED_EVENT_RESPONSE_MISMATCH");
  const attributes = data.attributes;
  if (typeof attributes?.datetime !== "string" || !Number.isFinite(Date.parse(attributes.datetime))
    || !attributes.event_properties || typeof attributes.event_properties !== "object"
    || Array.isArray(attributes.event_properties)) fail("KLAVIYO_ATTRIBUTED_EVENT_ATTRIBUTES_INVALID");
  const relation = data.relationships?.metric?.data;
  if (relation?.type !== "metric" || typeof relation.id !== "string" || !relation.id) {
    fail("KLAVIYO_ATTRIBUTED_EVENT_METRIC_MISSING");
  }
  if (!Array.isArray(payload.included)) fail("KLAVIYO_ATTRIBUTED_EVENT_METRIC_MISSING");
  const metrics = payload.included.filter(item => item?.type === "metric" && item.id === relation.id);
  if (metrics.length !== 1 || typeof metrics[0].attributes?.name !== "string" || !metrics[0].attributes.name) {
    fail("KLAVIYO_ATTRIBUTED_EVENT_METRIC_MISSING");
  }
  // Native evidence only. Neither an event name nor an arbitrary property proves a product interaction.
  // This private snapshot can contain personal data; never log it or expose it in product reports.
  return Object.freeze({provider_event_id: requestedId, occurred_at: attributes.datetime,
    metric_id: relation.id, metric_name: metrics[0].attributes.name,
    raw_event: structuredClone(data), raw_metric: structuredClone(metrics[0]),
    product_interaction_verified: false});
}

export async function readKlaviyoAttributedEvents({sales, fetchEvent}) {
  if (!Array.isArray(sales) || typeof fetchEvent !== "function") fail("KLAVIYO_ATTRIBUTED_EVENT_INPUT_INVALID");
  const links = [];
  const ids = new Set();
  for (const sale of sales) {
    if (!Array.isArray(sale?.provider_attributions)) fail("KLAVIYO_ATTRIBUTED_EVENT_INPUT_INVALID");
    for (const attribution of sale.provider_attributions) {
      const id = attribution.attributed_event_id == null ? null : eventId(attribution.attributed_event_id);
      if (id != null) ids.add(id);
      links.push({sale_event_id: sale.provider_event_id, attribution_id: attribution.attribution_id,
        attributed_event_id: id, observation: id == null ? "not_observed_in_this_execution" : "observed"});
    }
  }
  // Check the complete fan-out before the first detail request; never truncate evidence silently.
  if (ids.size > KLAVIYO_ATTRIBUTED_EVENT_LIMIT) fail("KLAVIYO_ATTRIBUTED_EVENT_LIMIT_EXCEEDED");
  const rows = [];
  const requestIds = [];
  for (const id of ids) {
    const response = await fetchEvent(id);
    rows.push(normalizeDetail(response.payload, id));
    if (response.requestId) requestIds.push(response.requestId);
  }
  return Object.freeze({rows: Object.freeze(rows), sale_links: Object.freeze(links.map(Object.freeze)),
    observation: rows.length === 0 ? "not_observed_in_this_execution" : "observed",
    request_count: rows.length, request_ids: Object.freeze(requestIds),
    product_interaction_verified: false, dataset_publishable: false});
}
