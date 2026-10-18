import assert from "node:assert/strict";
import test from "node:test";
import {
  KLAVIYO_REPORTING_API_REVISION,
  buildKlaviyoCampaignValuesRequest,
  buildKlaviyoFlowValuesRequest,
  buildKlaviyoOrderedProductEventsRequest,
  buildKlaviyoShopifyMetricsRequest,
  classifyKlaviyoCampaignSalesRole,
  klaviyoBusinessDayTimeframe,
  normalizeKlaviyoOrderedProductEvent,
  normalizeKlaviyoReportRow,
  resolveKlaviyoMessageChannel,
  runKlaviyoReportingFamilies,
  selectKlaviyoShopifyMetrics,
} from "../app/lib/providers/klaviyo-reporting.server.js";

const accessToken = "test-access-token";

function reportRow(kind, overrides = {}) {
  return {
    groupings: {
      [`${kind}_id`]: `${kind}-1`,
      [`${kind}_name`]: kind === "campaign" ? "Sonbahar Kampanyası" : "Sepeti Terk Etme",
      [`${kind}_message_id`]: `${kind}-message-1`,
      [`${kind}_message_name`]: kind === "campaign" ? "Sonbahar Takıları" : "İlk Hatırlatma",
      send_channel: "email",
      variation: "variation-1",
      variation_name: "Küpe Görseli",
      ...overrides,
    },
    statistics: {recipients: 20, conversions: 1, conversion_value: 450},
  };
}

test("Klaviyo reporting uses the accepted GA revision and exact Shopify metric filter", () => {
  assert.equal(KLAVIYO_REPORTING_API_REVISION, "2026-10-15");
  const request = buildKlaviyoShopifyMetricsRequest({accessToken});
  const url = new URL(request.url);
  assert.equal(request.method, "GET");
  assert.equal(request.headers.revision, "2026-10-15");
  assert.equal(request.headers.authorization, `Bearer ${accessToken}`);
  assert.equal(url.searchParams.get("filter"), "equals(integration.name,'Shopify')");
});

test("Shopify Placed Order and Ordered Product metrics must each resolve once", () => {
  const metrics = selectKlaviyoShopifyMetrics([
    {type: "metric", id: "placed", attributes: {name: "Placed Order", integration: {name: "Shopify"}}},
    {type: "metric", id: "product", attributes: {name: "Ordered Product", integration: {name: "Shopify"}}},
    {type: "metric", id: "custom", attributes: {name: "Placed Order", integration: {name: "API"}}},
  ]);
  assert.deepEqual(metrics, {
    placed_order_metric_id: "placed",
    ordered_product_metric_id: "product",
  });
  assert.throws(
    () => selectKlaviyoShopifyMetrics([]),
    (error) => error.code === "KLAVIYO_SHOPIFY_METRIC_CARDINALITY_INVALID",
  );
});

test("business-day boundaries use the Klaviyo account timezone including DST offset changes", () => {
  assert.deepEqual(
    klaviyoBusinessDayTimeframe({businessDate: "2026-10-17", timeZone: "Atlantic/Reykjavik"}),
    {
      start: "2026-10-17T00:00:00+00:00",
      end: "2026-10-17T23:59:59+00:00",
      source_timezone: "Atlantic/Reykjavik",
      business_date: "2026-10-17",
    },
  );
  const transition = klaviyoBusinessDayTimeframe({
    businessDate: "2026-11-01",
    timeZone: "America/New_York",
  });
  assert.equal(transition.start, "2026-11-01T00:00:00-04:00");
  assert.equal(transition.end, "2026-11-01T23:59:59-05:00");
});

test("Campaign and Flow reports require Message Channel, Medium and separate Variation", () => {
  for (const [kind, build] of [
    ["campaign", buildKlaviyoCampaignValuesRequest],
    ["flow", buildKlaviyoFlowValuesRequest],
  ]) {
    const request = build({
      accessToken,
      businessDate: "2026-10-17",
      timeZone: "Atlantic/Reykjavik",
      conversionMetricId: "placed",
    });
    const body = JSON.parse(request.body);
    assert.equal(request.method, "POST");
    assert.equal(request.headers.accept, "application/vnd.api+json");
    assert.equal(request.headers["content-type"], "application/vnd.api+json");
    assert.equal(body.data.type, `${kind}-values-report`);
    assert.deepEqual(body.data.attributes.timeframe, {
      start: "2026-10-17T00:00:00+00:00",
      end: "2026-10-17T23:59:59+00:00",
    });
    assert.ok(body.data.attributes.group_by.includes(`${kind}_message_id`));
    assert.ok(body.data.attributes.group_by.includes(`${kind}_message_name`));
    assert.ok(body.data.attributes.group_by.includes("send_channel"));
    assert.ok(body.data.attributes.group_by.includes("variation"));
    assert.ok(body.data.attributes.group_by.includes("variation_name"));
    if (kind === "campaign") {
      assert.equal(body.data.attributes.group_by.includes("campaign_name"), false);
    } else {
      assert.ok(body.data.attributes.group_by.includes("flow_name"));
    }
  }
});

test("Campaign Message is Channel, send_channel is mandatory Medium, Variation stays subordinate", () => {
  const exact = normalizeKlaviyoReportRow("campaign", reportRow("campaign"));
  assert.equal(exact.channel_entity, "campaign_message");
  assert.equal(exact.channel_name, "Sonbahar Takıları");
  assert.equal(exact.medium, "Email");
  assert.equal(exact.provider_medium, "email");
  assert.equal(exact.variation_name, "Küpe Görseli");
  assert.equal(exact.variation_resolution, "exact");

  const unresolved = normalizeKlaviyoReportRow(
    "campaign",
    reportRow("campaign", {variation: null, variation_name: null}),
  );
  assert.equal(unresolved.channel_name, "Sonbahar Takıları");
  assert.equal(unresolved.medium, "Email");
  assert.equal(unresolved.variation_resolution, "unresolved");
  assert.throws(
    () => normalizeKlaviyoReportRow("campaign", reportRow("campaign", {send_channel: null})),
    (error) => error.code === "KLAVIYO_MEDIUM_REQUIRED",
  );
});

test("Flow Message is Channel and exact Flow variation never replaces it", () => {
  const channel = normalizeKlaviyoReportRow("flow", reportRow("flow", {
    send_channel: "whatsapp",
    variation_name: "Kolye Şablonu",
  }));
  const resolved = resolveKlaviyoMessageChannel({
    source: "flow",
    messageId: "flow-message-1",
    variationId: "variation-1",
    channels: [channel],
    variationToMessage: {"variation-1": "flow-message-1"},
  });
  assert.equal(resolved.channel_type, "flow_message");
  assert.equal(resolved.channel_name, "İlk Hatırlatma");
  assert.equal(resolved.medium, "WhatsApp");
  assert.equal(resolved.variation_id, "variation-1");
  assert.equal(resolved.sales_role, "Triggered");
});

test("message-known multi-variation sales do not create Unclassified Channel", () => {
  const channel = normalizeKlaviyoReportRow(
    "campaign",
    reportRow("campaign", {variation: null, variation_name: null}),
  );
  const resolved = resolveKlaviyoMessageChannel({
    source: "campaign",
    messageId: "campaign-message-1",
    channels: [channel],
    campaignProductEvidence: {
      soldProductId: "necklace",
      contentEvidence: "unavailable",
    },
  });
  assert.equal(resolved.channel_type, "campaign_message");
  assert.equal(resolved.channel_name, "Sonbahar Takıları");
  assert.equal(resolved.medium, "Email");
  assert.equal(resolved.variation_resolution, "unresolved");
  assert.equal(resolved.sales_role, "Assisted");
});

test("Campaign Sales Role uses only verified content product evidence", () => {
  assert.equal(classifyKlaviyoCampaignSalesRole({
    soldProductId: "necklace",
    advertisedProductIds: ["necklace"],
    contentEvidence: "exact_product_set",
  }), "Advertised");
  assert.equal(classifyKlaviyoCampaignSalesRole({
    soldProductId: "necklace",
    advertisedProductIds: ["earrings"],
    contentEvidence: "exact_product_set",
  }), "Cross-sell");
  assert.equal(classifyKlaviyoCampaignSalesRole({
    soldProductId: "necklace",
    contentEvidence: "unavailable",
  }), "Assisted");
  assert.equal(classifyKlaviyoCampaignSalesRole({
    soldProductId: "necklace",
    contentEvidence: "contradictory",
  }), "Unclassified");
});

test("Unclassified Channel is reserved for missing or conflicting Message evidence", () => {
  const channel = normalizeKlaviyoReportRow("flow", reportRow("flow"));
  const missing = resolveKlaviyoMessageChannel({source: "flow", channels: [channel]});
  assert.equal(missing.channel_type, "Unclassified Channel");
  assert.equal(missing.sales_role, "Triggered");

  const conflicting = resolveKlaviyoMessageChannel({
    source: "flow",
    messageId: "flow-message-1",
    variationId: "variation-2",
    variationToMessage: {"variation-2": "flow-message-2"},
    channels: [channel],
  });
  assert.equal(conflicting.channel_type, "Unclassified Channel");
  assert.equal(conflicting.sales_role, "Unclassified");
});

test("Ordered Product request excludes profiles and preserves raw provider product fields", () => {
  const request = buildKlaviyoOrderedProductEventsRequest({
    accessToken,
    orderedProductMetricId: "ordered-product",
    businessDate: "2026-10-17",
    timeZone: "Atlantic/Reykjavik",
  });
  const url = new URL(request.url);
  assert.equal(url.searchParams.get("include"), "attributions,metric");
  assert.equal(url.searchParams.get("page[size]"), "200");
  assert.equal(url.searchParams.has("fields[profile]"), false);
  assert.match(url.searchParams.get("filter"), /equals\(metric_id,'ordered-product'\)/);

  const event = normalizeKlaviyoOrderedProductEvent({
    type: "event",
    id: "event-1",
    attributes: {
      uuid: "uuid-1",
      datetime: "2026-10-17T12:00:00+00:00",
      event_properties: {
        ProductID: "shopify-product-1",
        VariantID: "shopify-variant-1",
        SKU: "NECKLACE-1",
        ProductName: "Kolye",
        Quantity: 1,
        "$value": 450,
      },
    },
  });
  assert.equal(event.provider_event_id, "event-1");
  assert.deepEqual(event.provider_product_properties.ProductID, {
    state: "present",
    value: "shopify-product-1",
  });
  assert.equal(event.provider_product_properties["Variant Name"].state, "absent");
  assert.equal(event.standardized_product_id, null);
});

test("the first provider error stops every remaining family without retry or partial publish", async () => {
  const calls = [];
  const result = await runKlaviyoReportingFamilies({
    discoverMetrics: async () => {
      calls.push("metrics");
      return ["placed", "product"];
    },
    fetchCampaignValues: async () => {
      calls.push("campaign");
      const error = new Error("provider rejected campaign report");
      error.code = "KLAVIYO_CAMPAIGN_REPORT_FAILED";
      throw error;
    },
    fetchFlowValues: async () => calls.push("flow"),
    fetchOrderedProductEvents: async () => calls.push("events"),
  });
  assert.deepEqual(calls, ["metrics", "campaign"]);
  assert.equal(result.status, "failed");
  assert.equal(result.publishable, false);
  assert.equal(result.results, null);
  assert.deepEqual(result.completed_families, ["metrics"]);
  assert.equal(result.error.code, "KLAVIYO_CAMPAIGN_REPORT_FAILED");
  assert.equal(result.error.message, "Klaviyo reporting family failed");
});

test("local attribution resolution failure makes the complete provider snapshot non-publishable", async () => {
  const calls = [];
  const result = await runKlaviyoReportingFamilies({
    discoverMetrics: async () => calls.push("metrics"),
    fetchCampaignValues: async () => calls.push("campaign"),
    fetchFlowValues: async () => calls.push("flow"),
    fetchOrderedProductEvents: async () => calls.push("events"),
    resolveProductSales: async () => {
      calls.push("resolution");
      const error = new Error("contradictory attribution");
      error.code = "KLAVIYO_ATTRIBUTION_RESOLUTION_FAILED";
      throw error;
    },
  });
  assert.deepEqual(calls, ["metrics", "campaign", "flow", "events", "resolution"]);
  assert.equal(result.status, "failed");
  assert.equal(result.publishable, false);
  assert.equal(result.results, null);
  assert.deepEqual(result.completed_families, [
    "metrics",
    "campaign_values",
    "flow_values",
    "ordered_product_events",
  ]);
  assert.equal(result.error.code, "KLAVIYO_ATTRIBUTION_RESOLUTION_FAILED");
});
