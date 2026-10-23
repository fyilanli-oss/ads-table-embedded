import {
  KlaviyoReportingError,
  classifyKlaviyoCampaignSalesRole,
} from "./klaviyo-reporting.server.js";

function fail(code, message, details = null) {
  throw new KlaviyoReportingError(code, message, details);
}

function nonEmptyText(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null))];
}

function unknown(reason) {
  return Object.freeze({
    source: null,
    source_entity_id: null,
    channel_type: "Unclassified Channel",
    channel_id: null,
    channel_name: null,
    medium: null,
    provider_medium: null,
    medium_resolution: "unresolved",
    variation_id: null,
    variation_name: null,
    variation_resolution: "unresolved",
    sales_role: "Unclassified",
    reason,
  });
}

function attributionCandidate(attribution) {
  if (!attribution || typeof attribution !== "object" || Array.isArray(attribution)) {
    fail("KLAVIYO_ATTRIBUTION_EVIDENCE_INVALID", "Klaviyo attribution evidence is invalid");
  }
  const campaignObserved = attribution.campaign_id != null || attribution.campaign_message_id != null;
  const flowObserved = attribution.flow_id != null
    || attribution.flow_message_id != null
    || attribution.flow_message_variation_id != null;
  if (campaignObserved && flowObserved) return {conflict: "campaign_flow_attribution_conflict"};
  if (campaignObserved) {
    if (!nonEmptyText(attribution.campaign_message_id)) {
      return {conflict: "campaign_message_attribution_missing"};
    }
    return {
      source: "campaign",
      sourceEntityId: nonEmptyText(attribution.campaign_id) ? attribution.campaign_id : null,
      messageId: attribution.campaign_message_id,
      variationId: null,
    };
  }
  if (flowObserved) {
    if (!nonEmptyText(attribution.flow_message_id)) {
      return {conflict: "flow_message_attribution_missing"};
    }
    return {
      source: "flow",
      sourceEntityId: nonEmptyText(attribution.flow_id) ? attribution.flow_id : null,
      messageId: attribution.flow_message_id,
      variationId: nonEmptyText(attribution.flow_message_variation_id)
        ? attribution.flow_message_variation_id
        : null,
    };
  }
  return null;
}

function collapseEventAttribution(providerAttributions) {
  if (!Array.isArray(providerAttributions)) {
    fail("KLAVIYO_EVENT_ATTRIBUTION_EVIDENCE_INVALID", "Event attribution evidence must be an array");
  }
  if (providerAttributions.length === 0) return {resolution: null, reason: "attribution_not_observed"};
  const candidates = [];
  for (const attribution of providerAttributions) {
    const candidate = attributionCandidate(attribution);
    if (candidate?.conflict) return {resolution: null, reason: candidate.conflict};
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) return {resolution: null, reason: "message_attribution_not_observed"};
  const messageKeys = unique(candidates.map(({source, messageId}) => `${source}|${messageId}`));
  if (messageKeys.length !== 1) {
    return {resolution: null, reason: "multiple_message_attribution_conflict"};
  }
  const sourceEntityIds = unique(candidates.map(({sourceEntityId}) => sourceEntityId));
  if (sourceEntityIds.length > 1) {
    return {resolution: null, reason: "source_entity_attribution_conflict"};
  }
  const variationIds = unique(candidates.map(({variationId}) => variationId));
  const first = candidates[0];
  return {
    resolution: {
      source: first.source,
      sourceEntityId: sourceEntityIds[0] ?? null,
      messageId: first.messageId,
      variationId: variationIds.length === 1 ? variationIds[0] : null,
      variationAmbiguous: variationIds.length > 1,
    },
    reason: null,
  };
}

function resolveCatalog({candidate, campaignChannels, flowChannels}) {
  const channels = candidate.source === "campaign" ? campaignChannels : flowChannels;
  if (!Array.isArray(channels)) {
    fail("KLAVIYO_CHANNEL_CATALOG_INVALID", "Klaviyo Channel catalog must be an array");
  }
  const messageRows = channels.filter((channel) => (
    channel?.source === candidate.source && channel?.channel_id === candidate.messageId
  ));
  if (
    candidate.sourceEntityId != null
    && messageRows.length > 0
    && messageRows.every((channel) => channel.source_entity_id !== candidate.sourceEntityId)
  ) return {conflict: "message_parent_relationship_conflict"};

  const parentRows = candidate.sourceEntityId == null
    ? messageRows
    : messageRows.filter((channel) => channel.source_entity_id === candidate.sourceEntityId);
  const variationRows = candidate.variationId == null
    ? []
    : channels.filter((channel) => (
      channel?.source === candidate.source && channel?.variation_id === candidate.variationId
    ));
  if (
    candidate.variationId != null
    && variationRows.length > 0
    && variationRows.every((channel) => channel.channel_id !== candidate.messageId)
  ) return {conflict: "message_variation_relationship_conflict"};

  const exactVariationRows = candidate.variationId == null
    ? []
    : parentRows.filter((channel) => channel.variation_id === candidate.variationId);
  const mediumRows = exactVariationRows.length > 0 ? exactVariationRows : parentRows;
  const media = new Map(mediumRows.map((channel) => [
    `${channel.provider_medium}|${channel.medium}`,
    {medium: channel.medium, providerMedium: channel.provider_medium},
  ]));
  const names = unique(parentRows.map((channel) => channel.channel_name));
  const variationNames = unique(exactVariationRows.map((channel) => channel.variation_name));
  const medium = media.size === 1 ? [...media.values()][0] : null;
  return {
    conflict: null,
    channelName: names.length === 1 ? names[0] : null,
    medium: medium?.medium ?? null,
    providerMedium: medium?.providerMedium ?? null,
    mediumResolution: medium == null ? "unresolved" : "exact",
    variationName: variationNames.length === 1 ? variationNames[0] : null,
    catalogObserved: parentRows.length > 0,
    catalogMetadataConflict: names.length > 1,
  };
}

function soldProductId(event) {
  const field = event?.provider_product_properties?.ProductID;
  return field?.state === "present" && nonEmptyText(field.value) ? field.value : null;
}

function campaignSalesRole(event, candidate, campaignProductEvidenceByMessageId) {
  const evidence = campaignProductEvidenceByMessageId?.[candidate.messageId] ?? null;
  if (evidence == null || evidence.contentEvidence === "unavailable") return "Assisted";
  if (evidence.contentEvidence === "contradictory") return "Unclassified";
  if (evidence.contentEvidence !== "exact_product_set") return "Assisted";
  const productId = soldProductId(event);
  if (productId == null) return "Unclassified";
  return classifyKlaviyoCampaignSalesRole({...evidence, soldProductId: productId});
}

function resolveEvent(event, input) {
  const collapsed = collapseEventAttribution(event?.provider_attributions);
  if (collapsed.resolution == null) {
    return Object.freeze({...event, attribution_resolution: unknown(collapsed.reason)});
  }
  const candidate = collapsed.resolution;
  const catalog = resolveCatalog({
    candidate,
    campaignChannels: input.campaignChannels,
    flowChannels: input.flowChannels,
  });
  if (catalog.conflict) {
    return Object.freeze({...event, attribution_resolution: unknown(catalog.conflict)});
  }
  const salesRole = candidate.source === "flow"
    ? "Triggered"
    : campaignSalesRole(event, candidate, input.campaignProductEvidenceByMessageId);
  let reason = "message_channel_exact";
  if (!catalog.catalogObserved) reason = "message_exact_catalog_not_observed";
  else if (catalog.catalogMetadataConflict) reason = "message_exact_catalog_metadata_conflict";
  else if (catalog.mediumResolution !== "exact") reason = "message_exact_medium_unresolved";
  else if (candidate.variationAmbiguous) reason = "message_exact_variation_ambiguous";
  return Object.freeze({
    ...event,
    attribution_resolution: Object.freeze({
      source: candidate.source,
      source_entity_id: candidate.sourceEntityId,
      channel_type: `${candidate.source}_message`,
      channel_id: candidate.messageId,
      channel_name: catalog.channelName,
      medium: catalog.medium,
      provider_medium: catalog.providerMedium,
      medium_resolution: catalog.mediumResolution,
      variation_id: candidate.variationId,
      variation_name: catalog.variationName,
      variation_resolution: candidate.variationId == null ? "unresolved" : "exact",
      sales_role: salesRole,
      reason,
    }),
  });
}

export function resolveKlaviyoOrderedProductSales({
  campaignChannels,
  flowChannels,
  orderedProductEvents,
  campaignProductEvidenceByMessageId = {},
}) {
  if (!Array.isArray(orderedProductEvents)) {
    fail("KLAVIYO_ORDERED_PRODUCT_EVENTS_INVALID", "Ordered Product events must be an array");
  }
  const uniqueEvents = new Map();
  for (const event of orderedProductEvents) {
    if (!nonEmptyText(event?.provider_event_id)) {
      fail("KLAVIYO_EVENT_ID_REQUIRED", "Ordered Product event ID is required");
    }
    const existing = uniqueEvents.get(event.provider_event_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
      fail("KLAVIYO_EVENT_DUPLICATE_CONFLICT", "Klaviyo event duplicate is contradictory");
    }
    uniqueEvents.set(event.provider_event_id, event);
  }
  const rows = [...uniqueEvents.values()].map((event) => resolveEvent(event, {
    campaignChannels,
    flowChannels,
    campaignProductEvidenceByMessageId,
  }));
  return Object.freeze({
    rows: Object.freeze(rows),
    observation: rows.length === 0 ? "not_observed_in_this_execution" : "observed",
    sale_fact_source: "Ordered Product",
    reporting_conversion_source: "Placed Order",
    reporting_conversions_counted_as_product_sales: false,
  });
}
