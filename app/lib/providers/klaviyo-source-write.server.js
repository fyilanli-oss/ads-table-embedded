import {takeKlaviyoIdentitySourceCapture} from "./klaviyo-identity-collection.server.js";
import {prepareSourceWrite, sourcePayloadHash} from "../database/source-evidence-store.server.js";

const scalar = v => typeof v === "string" ? v : v && Object.keys(v).join() === "jsonNumber" && /^[1-9][0-9]*$/.test(v.jsonNumber) ? v.jsonNumber : null;
const state = (v, k) => !Object.hasOwn(v, k) ? {state: "missing"} : v[k] === null ? {state: "null"}
  : {state: v[k] === "" ? "empty" : "observed", sourceType: typeof v[k] === "object" ? "number" : typeof v[k], value: v[k]};

// Genuine completed capture only. Event observations remain unlinked claims;
// product candidates never become reviewed rules or accepted Shopify identities.
export function prepareKlaviyoIdentitySourceWrite({observation, attemptId, policy, cipher, limits, now, ...extra} = {}) {
  if (Object.keys(extra).length) throw Error("KLAVIYO_SOURCE_WRITE_INPUT_INVALID");
  const capture = takeKlaviyoIdentitySourceCapture(observation), pages = [];
  const records = {references: [], rules: [], mappings: [], orders: [], lines: [], journeys: [], claims: [], links: []};
  const events = new Map(), metrics = new Map(), attributions = new Map(), interactions = new Map(), reports = new Map(), accounts = [], mappings = new Map();
  const links = new Set();
  const link = (reference, targetType, target, role) => {const k = JSON.stringify([reference, targetType, target, role]);
    if (!links.has(k)) {links.add(k); records.links.push({reference, targetType, target, role});}};
  function page(family, payload, fidelity = "lossless_token") {
    const key = "p" + pages.length;
    pages.push({key, family, ordinal: pages.length, origin: "klaviyo", captureLayer: "native_response_projection", numericFidelity: fidelity,
      fieldCoverage: Object.keys(payload), schemaVersion: "klaviyo-source-allowlist-v1", sanitizerVersion: "klaviyo-source-v1", payload}); return key;
  }
  function ref(key, locator, row, type, nativeId = row.id) {
    const name = "r" + records.references.length;
    records.references.push({key: name, page: key, locatorKind: "row", locator, nativeType: type, nativeId, state: "present"}); return name;
  }
  function index(map, id, reference) {if (!map.has(id)) map.set(id, []); map.get(id).push(reference);}
  for (const p of capture.pages) {
    const key = page(p.family, p.payload);
    for (const [i, row] of p.payload.records.entries()) {
      const nativeType = p.family === "klaviyo_account" ? "KlaviyoAccount" : p.family === "klaviyo_metrics" ? "KlaviyoMetric"
        : p.family === "klaviyo_ordered_product_events" ? "KlaviyoOrderedProductEvent"
        : p.family === "klaviyo_interaction" ? "KlaviyoInteractionEvent" : "KlaviyoMessageReportRow";
      const reference = ref(key, "/records/" + i, row, nativeType, row.id ?? null);
      if (p.family === "klaviyo_account") accounts.push(reference);
      else if (p.family === "klaviyo_metrics") index(metrics, row.id, reference);
      else if (p.family === "klaviyo_interaction") index(interactions, row.id, reference);
      else if (["klaviyo_campaign_report", "klaviyo_flow_report"].includes(p.family)) {
        const kind = p.family === "klaviyo_campaign_report" ? "campaign" : "flow";
        index(reports, kind + ":" + row.groupings[kind + "_message_id"], reference);
      }
      else if (p.family === "klaviyo_ordered_product_events") {
        const hash = sourcePayloadHash(row), previous = events.get(row.id);
        if (previous && previous.hash !== hash) throw Error("KLAVIYO_SOURCE_EVENT_CONFLICT");
        if (previous) {previous.references.push(reference); continue;}
        events.set(row.id, {row, hash, references: [reference]});
      }
    }
    for (const [i, row] of p.payload.included.entries()) {
      const reference = ref(key, "/included/" + i, row, row.type === "metric" ? "KlaviyoMetric" : "KlaviyoAttribution");
      index(row.type === "metric" ? metrics : attributions, row.id, reference);
    }
  }
  if (accounts.length !== 2) throw Error("KLAVIYO_SOURCE_ACCOUNT_EVIDENCE_REQUIRED");
  for (const [eventId, e] of events) {
    const p = e.row.attributes.event_properties, claim = "c" + records.claims.length;
    const nativeOrder = scalar(p.OrderId), claimKey = sourcePayloadHash({accountId: capture.owner.accountId, metricId: capture.metricId, eventId});
    records.claims.push({key: claim, reference: e.references[0], provider: "klaviyo", accountId: capture.owner.accountId, claimKey,
      nativeId: eventId, nativeOrderId: nativeOrder && nativeOrder.length <= 256 ? nativeOrder : null, order: null, linkState: "unlinked", data: e.row});
    for (const r of e.references) link(r, "claim", claim, "native_event");
    for (const r of accounts) link(r, "claim", claim, "account");
    for (const r of metrics.get(capture.metricId) ?? []) link(r, "claim", claim, "metric");
    for (const a of e.row.relationships.attributions?.data ?? []) for (const r of attributions.get(a.id) ?? []) link(r, "claim", claim, "attribution");
    const message = observation.message_evidence?.resolved_product_sales.rows.find(r => r.provider_event_id === eventId)?.attribution_resolution;
    if (message?.reason === "message_channel_exact") for (const r of reports.get(message.source + ":" + message.channel_id) ?? []) link(r, "claim", claim, "message_context");
    for (const interaction of observation.attributed_interactions?.links.filter(r => r.sale_event_id === eventId) ?? [])
      for (const r of interactions.get(interaction.interaction_event_id) ?? []) link(r, "claim", claim, "observed_interaction");
    const nativeProduct = scalar(p.ProductID);
    if (!nativeProduct || nativeProduct.length > 256 || nativeProduct !== nativeProduct.trim() || /[\u0000-\u001f]/.test(nativeProduct)) continue;
    const context = {metric_id: capture.metricId, integration: "Shopify", product_property: "ProductID",
      product_id_source_type: typeof p.ProductID === "string" ? "string" : "number", variant: state(p, "Variant ID"), legacy_variant: state(p, "VariantID")};
    const identity = {provider: "klaviyo", accountId: capture.owner.accountId, nativeId: nativeProduct, context}, identityKey = sourcePayloadHash(identity);
    let mapping = mappings.get(identityKey);
    if (!mapping) {
      const candidate = observation.product_identity_candidates?.rows.find(r => r.provider_event_id === eventId);
      const conflicting = candidate?.product_identity_verification.state === "conflicting"
        || Object.hasOwn(p, "Variant ID") && Object.hasOwn(p, "VariantID") && scalar(p["Variant ID"]) !== scalar(p.VariantID);
      mapping = "m" + records.mappings.length; mappings.set(identityKey, mapping);
      records.mappings.push({key: mapping, rule: null, identity, revision: "1", nativeId: nativeProduct, context,
        productId: null, variantId: null, state: conflicting ? "conflicting" : "unresolved", verifiedAt: null,
        applicability: {state: "verification_pending", reason: conflicting ? "observed_variant_conflict"
          : "native_source_and_same_shop_mapping_review_required"}});
      for (const r of accounts) link(r, "mapping", mapping, "account");
      for (const r of metrics.get(capture.metricId) ?? []) link(r, "mapping", mapping, "metric");
    }
    for (const r of e.references) link(r, "mapping", mapping, "native_product_observation");
  }
  if (observation.product_identity_candidates) {
    const rows = observation.product_identity_candidates.rows.map(row => ({eventId: row.provider_event_id,
      state: row.product_identity_verification.state, reason: row.product_identity_verification.reason,
      productId: row.product_identity_verification.shopify_product_id, variantId: row.product_identity_verification.shopify_variant_id}));
    const key = page("klaviyo_candidate_checks", {records: rows, included: []}, "decoded_only");
    for (const [i, row] of rows.entries()) {
      const reference = ref(key, "/records/" + i, row, "CandidateCheck", row.eventId), target = records.claims.find(c => c.nativeId === row.eventId);
      if (!target) throw Error("KLAVIYO_SOURCE_CANDIDATE_REFERENCE_INVALID"); link(reference, "claim", target.key, "candidate_check");
    }
  }
  if (observation.attributed_interactions) {
    const rows = observation.attributed_interactions.links.map(r => ({eventId: r.sale_event_id, attributionId: r.attribution_id,
      interactionId: r.interaction_event_id, status: r.status, kind: r.interaction_kind ?? null}));
    const key = page("klaviyo_interaction_checks", {records: rows, included: []}, "decoded_only");
    for (const [i, row] of rows.entries()) {
      const reference = ref(key, "/records/" + i, row, "InteractionCheck", row.eventId), target = records.claims.find(c => c.nativeId === row.eventId);
      if (!target) throw Error("KLAVIYO_SOURCE_INTERACTION_REFERENCE_INVALID"); link(reference, "claim", target.key, "interaction_check");
    }
  }
  const write = prepareSourceWrite({owner: capture.owner, attemptId, ordinal: 0, sourceState: "complete", policy, cipher, limits, now, pages, records});
  return Object.freeze({write, completedAt: capture.completedAt, permissionExpiresAt: capture.permissionExpiresAt,
    sourceContext: {metricId: capture.metricId, businessDate: capture.businessDate, timeframe: capture.timeframe, account: capture.account, mode: capture.mode}});
}
