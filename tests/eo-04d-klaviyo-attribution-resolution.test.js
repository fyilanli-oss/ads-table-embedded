import assert from "node:assert/strict";
import test from "node:test";
import {resolveKlaviyoOrderedProductSales} from "../app/lib/providers/klaviyo-attribution-resolution.server.js";

function channel(source, overrides = {}) {
  return {
    provider: "klaviyo",
    source,
    source_entity_id: `${source}-1`,
    channel_entity: `${source}_message`,
    channel_id: `${source}-message-1`,
    channel_name: source === "campaign" ? "Sonbahar Takıları" : "Sepet Hatırlatma",
    medium: "Email",
    provider_medium: "email",
    variation_id: `${source}-variation-1`,
    variation_name: "Küpe Görseli",
    variation_resolution: "exact",
    statistics: {},
    ...overrides,
  };
}

function attribution(overrides = {}) {
  return {
    attribution_id: "attribution-1",
    campaign_id: null,
    campaign_message_id: null,
    flow_id: null,
    flow_message_id: null,
    flow_message_variation_id: null,
    ...overrides,
  };
}

function event(id, providerAttributions, productId = "necklace") {
  return {
    provider_event_id: id,
    provider_event_uuid: `uuid-${id}`,
    occurred_at: "2026-10-17T12:00:00+03:00",
    provider_product_properties: {
      ProductID: {state: productId == null ? "absent" : "present", value: productId},
      ProductName: {state: "present", value: "Kolye"},
    },
    product_identity_state: productId == null ? "missing" : "provider_native_observed",
    standardized_product_id: null,
    provider_attributions: providerAttributions,
  };
}

function resolve({events, campaignChannels = [], flowChannels = [], evidence = {}}) {
  return resolveKlaviyoOrderedProductSales({
    campaignChannels,
    flowChannels,
    orderedProductEvents: events,
    campaignProductEvidenceByMessageId: evidence,
  });
}

test("Campaign Message stays exact while unavailable content produces Assisted and Variation stays unresolved", () => {
  const result = resolve({
    campaignChannels: [channel("campaign")],
    events: [event("event-1", [attribution({
      campaign_id: "campaign-1",
      campaign_message_id: "campaign-message-1",
    })])],
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].attribution_resolution.channel_name, "Sonbahar Takıları");
  assert.equal(result.rows[0].attribution_resolution.medium, "Email");
  assert.equal(result.rows[0].attribution_resolution.variation_id, null);
  assert.equal(result.rows[0].attribution_resolution.variation_resolution, "unresolved");
  assert.equal(result.rows[0].attribution_resolution.sales_role, "Assisted");
});

test("Flow Message, Medium and provider variation resolve exactly as Triggered", () => {
  const result = resolve({
    flowChannels: [channel("flow")],
    events: [event("event-1", [attribution({
      flow_id: "flow-1",
      flow_message_id: "flow-message-1",
      flow_message_variation_id: "flow-variation-1",
    })])],
  });
  const resolution = result.rows[0].attribution_resolution;
  assert.equal(resolution.channel_name, "Sepet Hatırlatma");
  assert.equal(resolution.medium, "Email");
  assert.equal(resolution.variation_id, "flow-variation-1");
  assert.equal(resolution.variation_name, "Küpe Görseli");
  assert.equal(resolution.variation_resolution, "exact");
  assert.equal(resolution.sales_role, "Triggered");
});

test("known Message never becomes Unknown merely because catalog, Medium or Variation is unresolved", () => {
  const noCatalog = resolve({
    events: [event("event-1", [attribution({campaign_message_id: "campaign-message-1"})])],
  }).rows[0].attribution_resolution;
  assert.equal(noCatalog.channel_type, "campaign_message");
  assert.equal(noCatalog.channel_id, "campaign-message-1");
  assert.equal(noCatalog.channel_name, null);
  assert.equal(noCatalog.medium_resolution, "unresolved");
  assert.equal(noCatalog.sales_role, "Assisted");

  const multiMedium = resolve({
    campaignChannels: [
      channel("campaign"),
      channel("campaign", {
        medium: "SMS",
        provider_medium: "sms",
        variation_id: "campaign-variation-2",
        variation_name: "Kolye Metni",
      }),
    ],
    events: [event("event-2", [attribution({campaign_message_id: "campaign-message-1"})])],
  }).rows[0].attribution_resolution;
  assert.equal(multiMedium.channel_type, "campaign_message");
  assert.equal(multiMedium.channel_name, "Sonbahar Takıları");
  assert.equal(multiMedium.medium, null);
  assert.equal(multiMedium.medium_resolution, "unresolved");
  assert.equal(multiMedium.variation_resolution, "unresolved");
});

test("multiple variations of the same Flow Message preserve exact Channel without listing every variation", () => {
  const result = resolve({
    flowChannels: [
      channel("flow"),
      channel("flow", {variation_id: "flow-variation-2", variation_name: "Kolye Görseli"}),
    ],
    events: [event("event-1", [
      attribution({
        attribution_id: "attribution-1",
        flow_message_id: "flow-message-1",
        flow_message_variation_id: "flow-variation-1",
      }),
      attribution({
        attribution_id: "attribution-2",
        flow_message_id: "flow-message-1",
        flow_message_variation_id: "flow-variation-2",
      }),
    ])],
  });
  const resolution = result.rows[0].attribution_resolution;
  assert.equal(resolution.channel_name, "Sepet Hatırlatma");
  assert.equal(resolution.variation_id, null);
  assert.equal(resolution.variation_resolution, "unresolved");
  assert.equal(resolution.sales_role, "Triggered");
});

test("missing or conflicting Message attribution preserves one sale under Unknown Channel", () => {
  const events = [
    event("missing", []),
    event("conflict", [
      attribution({attribution_id: "a", campaign_message_id: "campaign-message-1"}),
      attribution({attribution_id: "b", campaign_message_id: "campaign-message-2"}),
    ]),
    event("cross-source", [attribution({
      campaign_message_id: "campaign-message-1",
      flow_message_id: "flow-message-1",
    })]),
  ];
  const result = resolve({events});
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows.map((row) => row.provider_event_id), ["missing", "conflict", "cross-source"]);
  for (const row of result.rows) {
    assert.equal(row.attribution_resolution.channel_type, "Unknown Channel");
    assert.equal(row.attribution_resolution.sales_role, "Unclassified");
  }
});

test("verified campaign content may refine Assisted into Advertised or Cross-sell", () => {
  const base = {
    campaignChannels: [channel("campaign")],
    evidence: {
      "campaign-message-1": {
        contentEvidence: "exact_product_set",
        advertisedProductIds: ["earrings"],
      },
    },
  };
  const crossSell = resolve({
    ...base,
    events: [event("event-1", [attribution({campaign_message_id: "campaign-message-1"})], "necklace")],
  });
  assert.equal(crossSell.rows[0].attribution_resolution.sales_role, "Cross-sell");

  const advertised = resolve({
    ...base,
    evidence: {
      "campaign-message-1": {
        contentEvidence: "exact_product_set",
        advertisedProductIds: ["necklace"],
      },
    },
    events: [event("event-2", [attribution({campaign_message_id: "campaign-message-1"})], "necklace")],
  });
  assert.equal(advertised.rows[0].attribution_resolution.sales_role, "Advertised");
});

test("Ordered Product is the only sale fact and duplicate event IDs cannot double count", () => {
  const duplicate = event("event-1", [attribution({campaign_message_id: "campaign-message-1"})]);
  const result = resolve({events: [duplicate, structuredClone(duplicate)]});
  assert.equal(result.rows.length, 1);
  assert.equal(result.sale_fact_source, "Ordered Product");
  assert.equal(result.reporting_conversion_source, "Placed Order");
  assert.equal(result.reporting_conversions_counted_as_product_sales, false);

  assert.throws(
    () => resolve({events: [duplicate, {...duplicate, occurred_at: "2026-10-17T13:00:00+03:00"}]}),
    (error) => error.code === "KLAVIYO_EVENT_DUPLICATE_CONFLICT",
  );
});

test("empty successful event input remains not observed rather than numeric zero", () => {
  const result = resolve({events: []});
  assert.deepEqual(result.rows, []);
  assert.equal(result.observation, "not_observed_in_this_execution");
  assert.equal(Object.hasOwn(result, "sales"), false);
  assert.equal(Object.hasOwn(result, "count"), false);
});
