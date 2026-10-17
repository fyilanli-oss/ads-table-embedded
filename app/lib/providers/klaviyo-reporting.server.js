export const KLAVIYO_REPORTING_API_REVISION = "2026-10-15";
export const KLAVIYO_REPORTING_STATISTICS = Object.freeze([
  "recipients",
  "delivered",
  "opens",
  "opens_unique",
  "clicks",
  "clicks_unique",
  "conversions",
  "conversion_uniques",
  "conversion_value",
]);

const API_ROOT = "https://a.klaviyo.com/api";
const MEDIUM_LABELS = Object.freeze({
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  push: "Push",
});

export class KlaviyoReportingError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "KlaviyoReportingError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new KlaviyoReportingError(code, message, details);
}

function record(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, code);
  return value;
}

function text(value, code, maximum = 4096) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim()
  ) fail(code, code);
  return value;
}

function optionalText(value, code, maximum = 4096) {
  if (value == null) return null;
  return text(value, code, maximum);
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) fail("KLAVIYO_BUSINESS_DATE_INVALID", "Business date must be YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) fail("KLAVIYO_BUSINESS_DATE_INVALID", "Business date is not a calendar date");
  return {year, month, day};
}

function offsetMinutesAt(timeZone, instant) {
  let name;
  try {
    name = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      year: "numeric",
    }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value;
  } catch {
    fail("KLAVIYO_TIMEZONE_INVALID", "Klaviyo account timezone is invalid");
  }
  if (name === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name ?? "");
  if (!match) fail("KLAVIYO_TIMEZONE_INVALID", "Klaviyo account timezone offset is unavailable");
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "+" ? minutes : -minutes;
}

function localInstant({year, month, day, hour, minute, second}, timeZone) {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = localAsUtc;
  for (let index = 0; index < 4; index += 1) {
    const next = localAsUtc - offsetMinutesAt(timeZone, new Date(candidate)) * 60_000;
    if (next === candidate) break;
    candidate = next;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
  );
  if (
    Number(parts.year) !== year ||
    Number(parts.month) !== month ||
    Number(parts.day) !== day ||
    Number(parts.hour) !== hour ||
    Number(parts.minute) !== minute ||
    Number(parts.second) !== second
  ) fail("KLAVIYO_BUSINESS_DAY_BOUNDARY_INVALID", "Business-day boundary is ambiguous or unavailable");
  return new Date(candidate);
}

function offsetLabel(minutes) {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function klaviyoBusinessDayTimeframe({businessDate, timeZone}) {
  const parts = dateParts(businessDate);
  text(timeZone, "KLAVIYO_TIMEZONE_INVALID", 100);
  const startInstant = localInstant({...parts, hour: 0, minute: 0, second: 0}, timeZone);
  const endInstant = localInstant({...parts, hour: 23, minute: 59, second: 59}, timeZone);
  const startOffset = offsetLabel(offsetMinutesAt(timeZone, startInstant));
  const endOffset = offsetLabel(offsetMinutesAt(timeZone, endInstant));
  return Object.freeze({
    start: `${businessDate}T00:00:00${startOffset}`,
    end: `${businessDate}T23:59:59${endOffset}`,
    source_timezone: timeZone,
    business_date: businessDate,
  });
}

function bearer(accessToken) {
  return `Bearer ${text(accessToken, "KLAVIYO_ACCESS_TOKEN_REQUIRED", 16384)}`;
}

function headers(accessToken, contentType = null, accept = "application/vnd.api+json") {
  return Object.freeze({
    accept,
    authorization: bearer(accessToken),
    ...(contentType == null ? {} : {"content-type": contentType}),
    revision: KLAVIYO_REPORTING_API_REVISION,
  });
}

function request(method, url, accessToken, body = null, media = {}) {
  return Object.freeze({
    method,
    url: url.toString(),
    headers: headers(
      accessToken,
      body == null ? null : (media.contentType ?? "application/vnd.api+json"),
      media.accept,
    ),
    ...(body == null ? {} : {body: JSON.stringify(body)}),
  });
}

export function buildKlaviyoShopifyMetricsRequest({accessToken, cursor = null}) {
  const url = new URL(`${API_ROOT}/metrics`);
  url.searchParams.set("filter", "equals(integration.name,'Shopify')");
  url.searchParams.set("fields[metric]", "id,name,integration");
  if (cursor != null) url.searchParams.set("page[cursor]", text(cursor, "KLAVIYO_CURSOR_INVALID"));
  return request("GET", url, accessToken);
}

function reportBody(type, {businessDate, timeZone, conversionMetricId}) {
  const prefix = type === "campaign-values-report" ? "campaign" : "flow";
  const timeframe = klaviyoBusinessDayTimeframe({businessDate, timeZone});
  const groupBy = [
    `${prefix}_id`,
    `${prefix}_message_id`,
    `${prefix}_message_name`,
    "send_channel",
    "variation",
    "variation_name",
  ];
  if (prefix === "flow") groupBy.splice(1, 0, "flow_name");
  return {
    data: {
      type,
      attributes: {
        timeframe: {start: timeframe.start, end: timeframe.end},
        conversion_metric_id: text(conversionMetricId, "KLAVIYO_CONVERSION_METRIC_ID_REQUIRED", 256),
        statistics: [...KLAVIYO_REPORTING_STATISTICS],
        group_by: groupBy,
      },
    },
  };
}

function reportRequest(kind, input) {
  const type = `${kind}-values-report`;
  const url = new URL(`${API_ROOT}/${kind}-values-reports`);
  if (input.pageCursor != null) {
    url.searchParams.set("page_cursor", text(input.pageCursor, "KLAVIYO_CURSOR_INVALID"));
  }
  return request("POST", url, input.accessToken, reportBody(type, input), {
    accept: "application/vnd.api+json",
    contentType: "application/vnd.api+json",
  });
}

export function buildKlaviyoCampaignValuesRequest(input) {
  return reportRequest("campaign", input);
}

export function buildKlaviyoFlowValuesRequest(input) {
  return reportRequest("flow", input);
}

export function buildKlaviyoOrderedProductEventsRequest({
  accessToken,
  orderedProductMetricId,
  businessDate,
  timeZone,
  cursor = null,
}) {
  const timeframe = klaviyoBusinessDayTimeframe({businessDate, timeZone});
  const metricId = text(orderedProductMetricId, "KLAVIYO_ORDERED_PRODUCT_METRIC_ID_REQUIRED", 256);
  const url = new URL(`${API_ROOT}/events`);
  url.searchParams.set(
    "filter",
    [
      `equals(metric_id,'${metricId.replaceAll("'", "\\'")}')`,
      `greater-or-equal(datetime,${timeframe.start})`,
      `less-or-equal(datetime,${timeframe.end})`,
    ].join(","),
  );
  url.searchParams.set("include", "attributions,metric");
  url.searchParams.set("fields[event]", "id,datetime,timestamp,uuid,event_properties");
  url.searchParams.set("fields[attribution]", "id");
  url.searchParams.set("fields[metric]", "id,name,integration");
  url.searchParams.set("page[size]", "200");
  url.searchParams.set("sort", "datetime");
  if (cursor != null) url.searchParams.set("page[cursor]", text(cursor, "KLAVIYO_CURSOR_INVALID"));
  return request("GET", url, accessToken);
}

export function selectKlaviyoShopifyMetrics(items) {
  if (!Array.isArray(items)) fail("KLAVIYO_METRICS_SCHEMA_INVALID", "Metric data must be an array");
  const matches = new Map([
    ["Placed Order", []],
    ["Ordered Product", []],
  ]);
  for (const item of items) {
    if (item?.type !== "metric" || item?.attributes?.integration?.name !== "Shopify") continue;
    if (matches.has(item.attributes.name)) {
      matches.get(item.attributes.name).push(text(item.id, "KLAVIYO_METRIC_ID_INVALID", 256));
    }
  }
  for (const [name, ids] of matches) {
    if (ids.length !== 1) {
      fail("KLAVIYO_SHOPIFY_METRIC_CARDINALITY_INVALID", `${name} must resolve to exactly one Shopify metric`, {
        metric_name: name,
        count: ids.length,
      });
    }
  }
  return Object.freeze({
    placed_order_metric_id: matches.get("Placed Order")[0],
    ordered_product_metric_id: matches.get("Ordered Product")[0],
  });
}

export function normalizeKlaviyoMedium(value) {
  const providerMedium = text(value, "KLAVIYO_MEDIUM_REQUIRED", 64).toLowerCase();
  const label = MEDIUM_LABELS[providerMedium];
  if (!label) fail("KLAVIYO_MEDIUM_UNSUPPORTED", "Klaviyo returned an unsupported send_channel", {
    provider_medium: providerMedium,
  });
  return Object.freeze({provider_medium: providerMedium, medium: label});
}

export function normalizeKlaviyoReportRow(kind, row) {
  if (!['campaign', 'flow'].includes(kind)) fail("KLAVIYO_REPORT_KIND_INVALID", "Report kind is invalid");
  const value = record(row, "KLAVIYO_REPORT_ROW_INVALID");
  const groupings = record(value.groupings, "KLAVIYO_REPORT_GROUPINGS_INVALID");
  const statistics = record(value.statistics, "KLAVIYO_REPORT_STATISTICS_INVALID");
  const entityId = text(groupings[`${kind}_id`], `KLAVIYO_${kind.toUpperCase()}_ID_REQUIRED`, 256);
  const messageId = text(
    groupings[`${kind}_message_id`],
    `KLAVIYO_${kind.toUpperCase()}_MESSAGE_ID_REQUIRED`,
    256,
  );
  const messageName = text(
    groupings[`${kind}_message_name`],
    `KLAVIYO_${kind.toUpperCase()}_MESSAGE_NAME_REQUIRED`,
    512,
  );
  const variationId = optionalText(groupings.variation, "KLAVIYO_VARIATION_ID_INVALID", 256);
  const variationName = optionalText(groupings.variation_name, "KLAVIYO_VARIATION_NAME_INVALID", 512);
  if ((variationId == null) !== (variationName == null)) {
    fail("KLAVIYO_VARIATION_EVIDENCE_PARTIAL", "Variation ID and name must be present together");
  }
  const medium = normalizeKlaviyoMedium(groupings.send_channel);
  return Object.freeze({
    provider: "klaviyo",
    source: kind,
    source_entity_id: entityId,
    source_entity_name: optionalText(groupings[`${kind}_name`], `KLAVIYO_${kind.toUpperCase()}_NAME_INVALID`, 512),
    channel_entity: `${kind}_message`,
    channel_id: messageId,
    channel_name: messageName,
    ...medium,
    variation_id: variationId,
    variation_name: variationName,
    variation_resolution: variationId == null ? "unresolved" : "exact",
    statistics: Object.freeze({...statistics}),
  });
}

export function classifyKlaviyoCampaignSalesRole({
  soldProductId,
  advertisedProductIds = null,
  contentEvidence = "unavailable",
}) {
  text(soldProductId, "KLAVIYO_SOLD_PRODUCT_ID_REQUIRED", 1024);
  if (contentEvidence === "contradictory") return "Unclassified";
  if (contentEvidence !== "exact_product_set") return "Assisted";
  if (!Array.isArray(advertisedProductIds) || advertisedProductIds.length === 0) {
    fail("KLAVIYO_ADVERTISED_PRODUCT_EVIDENCE_INVALID", "Exact content evidence requires products");
  }
  return advertisedProductIds.includes(soldProductId) ? "Advertised" : "Cross-sell";
}

export function resolveKlaviyoMessageChannel({
  source,
  messageId = null,
  variationId = null,
  channels,
  variationToMessage = {},
  campaignProductEvidence = null,
}) {
  if (!['campaign', 'flow'].includes(source)) fail("KLAVIYO_ATTRIBUTION_SOURCE_INVALID", "Source is invalid");
  if (!Array.isArray(channels)) fail("KLAVIYO_CHANNEL_CATALOG_INVALID", "Channels must be an array");
  let resolvedMessageId = messageId;
  if (variationId != null) {
    const parent = variationToMessage[variationId] ?? null;
    if (resolvedMessageId != null && parent != null && parent !== resolvedMessageId) {
      return Object.freeze({
        channel_type: "Unknown Channel",
        channel_id: null,
        channel_name: null,
        medium: null,
        provider_medium: null,
        variation_id: variationId,
        variation_resolution: "conflicting",
        sales_role: "Unclassified",
        reason: "message_variation_relationship_conflict",
      });
    }
    resolvedMessageId ??= parent;
  }
  const candidates = channels.filter(
    (channel) => channel.source === source && channel.channel_id === resolvedMessageId,
  );
  const unique = new Map(candidates.map((channel) => [
    `${channel.channel_id}|${channel.provider_medium}`,
    channel,
  ]));
  if (resolvedMessageId == null || unique.size !== 1) {
    return Object.freeze({
      channel_type: "Unknown Channel",
      channel_id: null,
      channel_name: null,
      medium: null,
      provider_medium: null,
      variation_id: variationId,
      variation_resolution: variationId == null ? "unresolved" : "orphaned",
      sales_role: source === "flow" ? "Triggered" : "Unclassified",
      reason: resolvedMessageId == null ? "message_attribution_missing" : "message_catalog_unresolved",
    });
  }
  const channel = [...unique.values()][0];
  let salesRole = "Triggered";
  if (source === "campaign") {
    salesRole = classifyKlaviyoCampaignSalesRole(campaignProductEvidence ?? {});
  }
  return Object.freeze({
    channel_type: channel.channel_entity,
    channel_id: channel.channel_id,
    channel_name: channel.channel_name,
    medium: channel.medium,
    provider_medium: channel.provider_medium,
    variation_id: variationId,
    variation_resolution: variationId == null ? "unresolved" : "exact",
    sales_role: salesRole,
    reason: "message_channel_exact",
  });
}

export function normalizeKlaviyoOrderedProductEvent(event) {
  const value = record(event, "KLAVIYO_EVENT_INVALID");
  if (value.type !== "event") fail("KLAVIYO_EVENT_TYPE_INVALID", "Expected an event resource");
  const attributes = record(value.attributes, "KLAVIYO_EVENT_ATTRIBUTES_INVALID");
  const properties = record(attributes.event_properties, "KLAVIYO_EVENT_PROPERTIES_INVALID");
  const observed = {};
  for (const key of [
    "ProductID",
    "VariantID",
    "SKU",
    "ProductName",
    "Name",
    "Variant Name",
    "Quantity",
    "$value",
  ]) {
    observed[key] = Object.hasOwn(properties, key)
      ? Object.freeze({state: "present", value: properties[key]})
      : Object.freeze({state: "absent", value: null});
  }
  return Object.freeze({
    provider_event_id: text(value.id, "KLAVIYO_EVENT_ID_REQUIRED", 256),
    provider_event_uuid: optionalText(attributes.uuid, "KLAVIYO_EVENT_UUID_INVALID", 256),
    occurred_at: text(attributes.datetime, "KLAVIYO_EVENT_DATETIME_REQUIRED", 128),
    provider_product_properties: Object.freeze(observed),
    product_identity_state: observed.ProductID.state === "present" ? "provider_native_observed" : "missing",
    standardized_product_id: null,
  });
}

export async function runKlaviyoReportingFamilies({
  discoverMetrics,
  fetchCampaignValues,
  fetchFlowValues,
  fetchOrderedProductEvents,
}) {
  const families = [
    ["metrics", discoverMetrics],
    ["campaign_values", fetchCampaignValues],
    ["flow_values", fetchFlowValues],
    ["ordered_product_events", fetchOrderedProductEvents],
  ];
  if (families.some(([, operation]) => typeof operation !== "function")) {
    fail("KLAVIYO_REPORTING_FAMILY_INVALID", "Every Klaviyo reporting family must be a function");
  }
  const completed = [];
  const staged = {};
  try {
    for (const [name, operation] of families) {
      const value = await operation(Object.freeze({...staged}));
      staged[name] = value;
      completed.push(name);
    }
  } catch (error) {
    const safeCode = typeof error?.code === "string" && /^KLAVIYO_[A-Z0-9_]{1,80}$/.test(error.code)
      ? error.code
      : "KLAVIYO_REPORTING_FAMILY_FAILED";
    return Object.freeze({
      status: "failed",
      publishable: false,
      completed_families: Object.freeze([...completed]),
      results: null,
      error: Object.freeze({
        code: safeCode,
        message: "Klaviyo reporting family failed",
      }),
    });
  }
  return Object.freeze({
    status: "completed",
    publishable: true,
    completed_families: Object.freeze([...completed]),
    results: Object.freeze({...staged}),
    error: null,
  });
}
