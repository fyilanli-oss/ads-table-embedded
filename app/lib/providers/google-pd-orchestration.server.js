import {composeGooglePdLeaf} from "./google-pd-composition.server.js";
import {checkPdCompositionCompatibility} from "./pd-composition-scope.server.js";
import {stableJson} from "./common-adapter.server.js";

export const GOOGLE_PD_FLOW_FAMILIES = Object.freeze({
  search: Object.freeze(["search_ad_channel_daily", "search_ad_conversion_action_daily"]),
  shopping: Object.freeze(["ad_group_channel_daily", "shopping_ad_group_conversion_action_daily"]),
  retail_pmax: Object.freeze(["pmax_asset_group_channel_daily", "pmax_asset_group_conversion_action_daily"]),
});
const BINDING = ["workspace_id", "installation_id", "installation_generation", "provider",
  "provider_connection_id", "connection_version", "reporting_selection_epoch", "platform_account_id",
  "canonical_reporting_account_id", "business_date", "source_timezone", "source_currency", "job_or_run_id", "claim_fence"];
const text = v => typeof v === "string" && v.length > 0 && v === v.trim();
const id = v => typeof v === "string" && /^[0-9]+$/.test(v);
function copy(v) {
  return v === null || typeof v !== "object" ? v : Object.freeze(Array.isArray(v) ? v.map(copy)
    : Object.fromEntries(Object.entries(v).map(([k, value]) => [k, copy(value)])));
}
const blocked = reason => Object.freeze({status: "blocked", reason, rows: Object.freeze([]), publishable: false});

/** Runtime grouping of complete native PD families. Metadata is a trusted server
 * input bound to the execution, not native attribution evidence by virtue of its shape.
 * Missing metadata is blocked; this never invents fingerprints, FX or source rules.
 */
export function composeGooglePdSnapshot({sourceContext, evidence, compositionContext} = {}) {
  const pair = Object.hasOwn(GOOGLE_PD_FLOW_FAMILIES, evidence?.flow ?? "") ? GOOGLE_PD_FLOW_FAMILIES[evidence.flow] : null;
  if (!pair || sourceContext?.provider !== "google_ads" || evidence.provider !== "google_ads"
    || sourceContext.platform_account_id !== sourceContext.canonical_reporting_account_id
    || evidence.authority?.connection_id !== sourceContext.provider_connection_id
    || evidence.authority.reporting_account_id !== sourceContext.platform_account_id
    || evidence.date_window?.start !== sourceContext.business_date || evidence.date_window.end !== sourceContext.business_date) return blocked("source_scope_mismatch");
  if (!compositionContext) return blocked("composition_context_required");
  if (!compositionContext.binding || BINDING.some(k => sourceContext[k] === undefined
    || stableJson(compositionContext.binding[k]) !== stableJson(sourceContext[k]))) return blocked("composition_context_mismatch");
  if (compositionContext.flow !== evidence.flow || compositionContext.conversion_scope !== "normal" || compositionContext.reporting_time_basis !== "interaction_date"
    || !text(compositionContext.references?.attribution) || !text(compositionContext.references?.metric_units)) return blocked("composition_metadata_required");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(compositionContext.composition_attempt_id ?? "")
    || !text(compositionContext.snapshot_id)
    || ![compositionContext.attribution_fingerprint, compositionContext.metric_units_fingerprint].every(v => typeof v === "string" && /^[0-9a-f]{64}$/.test(v))) return blocked("composition_metadata_invalid");
  const pages = [evidence.results?.performance, evidence.results?.conversions];
  if (pages.some((p, i) => p?.fact_family !== pair[i] || p.next_cursor !== null || !Array.isArray(p.rows)
    || p.rows.length > 20_000 || !Array.isArray(p.evidence?.page_spans))) return blocked("source_family_or_completeness_invalid");
  const leaves = new Map();
  for (const [familyIndex, page] of pages.entries()) {
    for (const [index, row] of page.rows.entries()) {
      const flow = evidence.flow, entityType = {search: "ad", shopping: "ad_group", retail_pmax: "asset_group"}[flow];
      const entityId = flow === "search" ? row.adGroupAd?.ad?.id : flow === "shopping" ? row.adGroup?.id : row.assetGroup?.id;
      const ancestors = [{entity_type: "campaign", entity_id: row.campaign?.id},
        ...(flow === "search" ? [{entity_type: "ad_group", entity_id: row.adGroup?.id}] : [])];
      if (!id(entityId) || ancestors.some(a => !id(a.entity_id)) || row.customer?.id !== sourceContext.platform_account_id
        || row.segments?.date !== sourceContext.business_date) return blocked("native_identity_invalid");
      const leaf = leaves.get(entityId) ?? {entityType, entityId, ancestors, rows: [[], []], indices: [[], []]};
      if (stableJson(leaf.ancestors) !== stableJson(ancestors)) return blocked("native_hierarchy_conflict");
      leaf.rows[familyIndex].push(row); leaf.indices[familyIndex].push(index); leaves.set(entityId, leaf);
    }
  }
  const facts = [];
  let partial = false;
  for (const leaf of leaves.values()) {
    const expected = Object.fromEntries(BINDING.filter(k => !["connection_version", "reporting_selection_epoch", "claim_fence"].includes(k))
      .map(k => [k, sourceContext[k]]));
    Object.assign(expected, {flow: evidence.flow, entity_type: leaf.entityType, entity_id: leaf.entityId, ancestors: leaf.ancestors,
      reporting_time_basis: "interaction_date", conversion_scope: "normal", completeness: "complete", bounded: true,
      composition_attempt_id: compositionContext.composition_attempt_id, snapshot_id: compositionContext.snapshot_id,
      metric_units_fingerprint: compositionContext.metric_units_fingerprint, attribution_fingerprint: compositionContext.attribution_fingerprint});
    if (!checkPdCompositionCompatibility(expected, [{source_family: "scope", source_reference: "scope", scope: expected}]).compatible) return blocked("composition_metadata_invalid");
    const projections = pages.map((page, i) => ({source_family: pair[i],
      source_reference: stableJson([compositionContext.snapshot_id, pair[i], leaf.entityId]), scope: expected, rows: leaf.rows[i]}));
    const result = composeGooglePdLeaf({expected_scope: expected, performance: projections[0], conversions: projections[1]});
    if (result.status === "rejected") return blocked(result.reason);
    partial ||= result.status === "partial";
    facts.push(copy({...result.rows[0], source_execution: {connection_version: sourceContext.connection_version,
      reporting_selection_epoch: sourceContext.reporting_selection_epoch, claim_fence: sourceContext.claim_fence,
      metadata_references: {attribution: compositionContext.references.attribution, metric_units: compositionContext.references.metric_units},
      slices: pages.map((page, i) => ({source_family: pair[i], source_reference: projections[i].source_reference,
        native_row_indices: leaf.indices[i], page_spans: page.evidence.page_spans}))}}));
  }
  return copy({status: facts.length ? partial ? "partial" : "composed" : "not_observed", reason: null, rows: facts, publishable: false});
}
