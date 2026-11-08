import {normalizeKlaviyoReportRow, normalizeKlaviyoOrderedProductEvent, selectKlaviyoPdShopifyMetrics, klaviyoBusinessDayTimeframe} from "./klaviyo-reporting.server.js";
import {resolveKlaviyoOrderedProductSales} from "./klaviyo-attribution-resolution.server.js";
import {baseStoredFact, setStoredMetric, validateStoredProjectionScope, finalizeStoredProjection} from "./stored-dataset-projection.server.js";
import {sourceText, sourceDecimal} from "../database/dataset-source-values.server.js";
import {canonicalSourceJson} from "../database/source-evidence-store.server.js";

const fail = code => {throw Error("DATASET_PROJECTION_" + code);};
const pdSources = {"Placed Order": {impression: "delivered", ad_click: "clicks", purchase: "conversions", purchase_value: "conversion_value"},
  "Added to Cart": {add_to_cart: "conversions", add_to_cart_value: "conversion_value"}, "Checkout Started": {checkout: "conversions", checkout_value: "conversion_value"}};
const mergeRefs = refs => [...new Map(refs.map(ref => [ref.batch_id + ":" + ref.page_id, ref])).values()];
function nativeAttributions(event, included) {
  const own = event.relationships?.attributions?.data ?? [];
  if (!Array.isArray(own)) fail("ATTRIBUTION_INVALID");
  return own.map(ref => {
    if (ref?.type !== "attribution" || typeof ref.id !== "string") fail("ATTRIBUTION_INVALID");
    const row = included.get(ref.id); if (!row) return {};
    for (const name of ["event", "attributed-event"]) {
      const linked = row.relationships?.[name]?.data;
      if (linked && (linked.type !== "event" || linked.id !== event.id)) fail("ATTRIBUTION_SCOPE_MISMATCH");
    }
    const out = {};
    for (const [key, name] of [["campaign", "campaign_id"], ["campaign-message", "campaign_message_id"], ["flow", "flow_id"], ["flow-message", "flow_message_id"], ["flow-message-variation", "flow_message_variation_id"]]) {
      const value = row.relationships?.[key]?.data;
      if (value) {if (value.type !== key || typeof value.id !== "string" || !value.id) fail("ATTRIBUTION_INVALID"); out[name] = value.id;}
    }
    return out;
  });
}
export function projectStoredKlaviyoDataset(bundle) {
  validateStoredProjectionScope(bundle); if (bundle.owner.provider !== "klaviyo") fail("PROVIDER_MISMATCH");
  const config = bundle.datasets.find(d => d.dataset === "configuration"), pd = bundle.datasets.find(d => d.dataset === "account_performance"), sales = bundle.datasets.find(d => d.dataset === "product_performance");
  if (!config || !pd || !sales) fail("DATASET_MISSING");
  const metricMap = new Map(), included = new Map(), accountPages = new Map(), rows = [], holds = [], channels = [], groups = new Map();
  for (const dataset of bundle.datasets) for (const page of dataset.pages) {
    if (page.family === "klaviyo_account") {
      if (page.payload.records.length !== 1) fail("ACCOUNT_CONTEXT_INVALID");
      const a = page.payload.records[0];
      if (a.type !== "account" || a.id !== bundle.owner.accountId || a.attributes?.timezone !== dataset.source.timezone || a.attributes?.preferred_currency !== dataset.source.currency) fail("ACCOUNT_CONTEXT_INVALID");
      accountPages.set(dataset.dataset, page);
    }
    if (page.family === "klaviyo_metrics") for (const m of page.payload.records) {
      if (m.type !== "metric" || typeof m.id !== "string" || !m.id || typeof m.attributes?.name !== "string") fail("METRIC_CONTEXT_INVALID");
      const prior = metricMap.get(m.id); if (prior && canonicalSourceJson(prior) !== canonicalSourceJson(m)) fail("METRIC_CONTEXT_INVALID"); metricMap.set(m.id, m);
    }
    for (const a of page.payload.included ?? []) if (a.type === "attribution") {
      const prior = included.get(a.id); if (prior && canonicalSourceJson(prior) !== canonicalSourceJson(a)) fail("ATTRIBUTION_INVALID"); included.set(a.id, a);
    }
  }
  if (bundle.datasets.some(d => !accountPages.has(d.dataset))) fail("ACCOUNT_CONTEXT_MISSING");
  const selected = selectKlaviyoPdShopifyMetrics([...metricMap.values()]);
  const named = new Map(Object.entries(selected).filter(([, v]) => v.state === "present").map(([name, v]) => [v.metric_id, name]));
  const coverage = pd.read.coverage;
  if (!Array.isArray(coverage)) fail("COVERAGE_MISSING");
  for (const page of pd.pages) {
    if (["klaviyo_account", "klaviyo_metrics"].includes(page.family)) continue;
    const kind = page.family === "klaviyo_campaign_report" ? "campaign" : page.family === "klaviyo_flow_report" ? "flow" : null;
    if (!kind) fail("FAMILY_INVALID");
    const attrs = page.payload.request?.body?.data?.attributes, name = named.get(attrs?.conversion_metric_id);
    if (!name || !pdSources[name] || !coverage.some(c => c.family === kind + ":" + name && c.metricId === attrs.conversion_metric_id && c.state === "present")) fail("COVERAGE_MISMATCH");
    const timeframe = klaviyoBusinessDayTimeframe({businessDate: bundle.scope.window.from, timeZone: pd.source.timezone});
    if (attrs.timeframe?.start !== timeframe.start || attrs.timeframe?.end !== timeframe.end
      || Object.values(pdSources[name]).some(k => !attrs.statistics?.includes(k))) fail("QUERY_CHANGED");
    for (const record of page.payload.records) {
      const channel = normalizeKlaviyoReportRow(kind, record); channels.push({...channel, page});
      const native = {entity_type: kind + "_message", entity_id: channel.channel_id};
      const breakdowns = {source_entity_id: channel.source_entity_id, provider_medium: channel.provider_medium, variation_id: channel.variation_id};
      const key = canonicalSourceJson([native, breakdowns]); let group = groups.get(key);
      if (!group) {
        const row = baseStoredFact(bundle, pd, "pd_facts", [page, accountPages.get(pd.dataset)], breakdowns);
        Object.assign(row, {entity_type: native.entity_type, entity_id: native.entity_id, entity_name: channel.channel_name,
          root_entity_type: kind, root_entity_id: channel.source_entity_id, root_entity_name: channel.source_entity_name,
          parent_entity_type: kind, parent_entity_id: channel.source_entity_id, parent_entity_name: channel.source_entity_name,
          source_identity: {kind: "daily", namespace: "entity_performance", native}});
        row.metric_support.spend_value = "unsupported"; row.observation_state.spend_value = "unsupported";
        for (const [metricName, mapping] of Object.entries(pdSources)) if (selected[metricName].state !== "present") for (const target of Object.keys(mapping)) {
          row.metric_support[target] = "unknown"; row.observation_state[target] = "unknown";
        }
        group = {row, observations: new Map()}; groups.set(key, group);
      }
      const fp = canonicalSourceJson(record), old = group.observations.get(name);
      if (old) {if (old !== fp) fail("DUPLICATE_CONFLICT"); continue;} group.observations.set(name, fp);
      for (const [target, source] of Object.entries(pdSources[name])) setStoredMetric(group.row, target, sourceDecimal(record.statistics?.[source]));
      group.row.provenance.sources = mergeRefs([...group.row.provenance.sources, page.ref]);
    }
  }
  for (const [name, state] of Object.entries(selected)) if (state.state !== "present") holds.push({reason: "klaviyo_metric_unavailable", metric: name});
  for (const group of groups.values()) rows.push({table: "pd_facts", row: group.row});
  const ordered = [...metricMap.values()].filter(m => m.attributes.name === "Ordered Product" && m.attributes.integration?.name === "Shopify");
  if (ordered.length > 1) fail("METRIC_CONTEXT_INVALID");
  if (!ordered.length) holds.push({reason: "klaviyo_ordered_product_unavailable"});
  else {
    let observed = false;
    const timeframe = klaviyoBusinessDayTimeframe({businessDate: bundle.scope.window.from, timeZone: sales.source.timezone});
    for (const page of sales.pages) {
      if (["klaviyo_account", "klaviyo_metrics"].includes(page.family)) continue;
      if (page.family !== "klaviyo_ordered_product_events") fail("FAMILY_INVALID"); observed = true;
      for (const record of page.payload.records) {
        const event = normalizeKlaviyoOrderedProductEvent(record);
        if (event.provider_metric_id !== ordered[0].id || Date.parse(event.occurred_at) < Date.parse(timeframe.start)
          || Date.parse(event.occurred_at) > Date.parse(timeframe.end) || !Number.isFinite(Date.parse(event.occurred_at))) fail("EVENT_SCOPE_MISMATCH");
        const quantity = sourceDecimal(record.attributes?.event_properties?.Quantity), value = sourceDecimal(record.attributes?.event_properties?.$value);
        if (quantity === null || quantity === "0") fail("SALE_QUANTITY_UNPROVEN");
        const productId = sourceText(record.attributes?.event_properties?.ProductID, {nullable: true});
        const resolutionInput = {...event, provider_attributions: nativeAttributions(record, included)};
        const resolved = resolveKlaviyoOrderedProductSales({campaignChannels: channels.filter(c => c.source === "campaign"), flowChannels: channels.filter(c => c.source === "flow"),
          orderedProductEvents: [resolutionInput]}).rows[0].attribution_resolution;
        const matching = channels.filter(c => c.source === resolved.source && c.channel_id === resolved.channel_id);
        const used = [page, accountPages.get(sales.dataset), ...matching.map(c => c.page)];
        const r = baseStoredFact(bundle, sales, "cpd_product_sales_facts", used);
        if (matching.length && pd.receipt.sourceState === "partial") r.source_completeness = "partial";
        Object.assign(r, {provider_event_id: event.provider_event_id, occurred_at: event.occurred_at, native_sold_product_id: productId,
          product_context: {metric_id: event.provider_metric_id, product_id: productId, variant_id: sourceText(record.attributes?.event_properties?.VariantID ?? record.attributes?.event_properties?.["Variant ID"], {nullable: true})},
          source_identity: {kind: "event", namespace: "ordered_product", native: {event_id: event.provider_event_id}},
          sales_role: resolved.sales_role, sales_role_evidence: {rule: "existing_klaviyo_ordered_product_attribution", reason: resolved.reason},
          native_sales_metrics: {Quantity: quantity, native_event_value: value}});
        if (resolved.channel_id) Object.assign(r, {channel_type: resolved.channel_type, channel_id: resolved.channel_id, channel_resolution: "verified",
          root_entity_type: resolved.source, root_entity_id: resolved.source_entity_id, parent_entity_type: resolved.source, parent_entity_id: resolved.source_entity_id});
        setStoredMetric(r, "sales_quantity", quantity); setStoredMetric(r, "sales_value", value); rows.push({table: "cpd_product_sales_facts", row: r});
      }
    }
    if (!observed) fail("FAMILY_MISSING");
  }
  return finalizeStoredProjection(bundle, {rows, holds, auxiliary: ["klaviyo_account", "klaviyo_metrics"], estimatedSpendAllocated: false});
}
