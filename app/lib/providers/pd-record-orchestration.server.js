import {bridgePdSourceToCanonical} from "./pd-canonical-bridge.server.js";
import {checkPdCompositionCompatibility} from "./pd-composition-scope.server.js";
import {mapMetaPdMetrics, META_PD_METRIC_SOURCES} from "./meta-reporting.server.js";
import {stableJson} from "./common-adapter.server.js";

const BINDING = ["workspace_id", "installation_id", "installation_generation", "provider", "provider_connection_id",
  "connection_version", "reporting_selection_epoch", "platform_account_id", "canonical_reporting_account_id",
  "business_date", "source_timezone", "source_currency", "job_or_run_id", "claim_fence"];
const EXECUTION = ["connection_version", "reporting_selection_epoch", "claim_fence"];
const record = v => v !== null && typeof v === "object" && !Array.isArray(v);
const text = v => typeof v === "string" && v.length > 0 && v === v.trim();
const same = (a, b) => stableJson(a) === stableJson(b);
function copy(v) {
  return v === null || typeof v !== "object" ? v : Object.freeze(Array.isArray(v) ? v.map(copy)
    : Object.fromEntries(Object.entries(v).map(([k, value]) => [k, copy(value)])));
}
const identity = s => stableJson([s?.flow, s?.entity_type, s?.entity_id]);

function metaFacts(context, evidence, entries) {
  const page = evidence?.channel;
  if (evidence?.provider !== "meta" || evidence.authority?.connection_id !== context.provider_connection_id
    || evidence.authority.reporting_account_id !== context.platform_account_id
    || page?.fact_family !== "ad_channel_daily_insights" || page.next_cursor !== null || !Array.isArray(page.rows)
    || page.rows.length > 20_000) {
    return {reason: "meta_source_incomplete_or_mismatched"};
  }
  const facts = [], seen = new Set();
  for (const [index, row] of page.rows.entries()) {
    if (!record(row) || ![row.ad_id, row.adset_id, row.campaign_id].every(v => typeof v === "string" && /^[0-9]+$/.test(v))
      || row.account_id !== context.platform_account_id.slice(4) || row.date_start !== context.business_date
      || row.date_stop !== context.business_date || row.product_id != null
      || row.account_currency != null && row.account_currency !== context.source_currency
      || seen.has(row.ad_id)) return {reason: "meta_native_identity_or_duplicate"};
    seen.add(row.ad_id);
    const entry = entries.get(stableJson(["ads", "ad", row.ad_id]));
    if (!entry) return {reason: "entity_metadata_required"};
    // IDs and ancestors come from the native row. Attribution/time/units require
    // explicit server metadata; the request's defaults do not prove them.
    const scope = {...Object.fromEntries(["reporting_time_basis", "conversion_scope", "composition_attempt_id", "snapshot_id",
      "attribution_fingerprint", "metric_units_fingerprint"].map(k => [k, entry.scope[k]])),
      ...Object.fromEntries(BINDING.filter(k => !EXECUTION.includes(k)).map(k => [k, context[k]])),
      flow: "ads", entity_type: "ad", entity_id: row.ad_id,
      ancestors: [{entity_type: "campaign", entity_id: row.campaign_id}, {entity_type: "adset", entity_id: row.adset_id}],
      completeness: "complete", bounded: true};
    if (scope.conversion_scope !== "normal" || !text(scope.reporting_time_basis)
      || !checkPdCompositionCompatibility(scope, [{source_family: "metadata", source_reference: "metadata", scope: entry.scope}]).compatible) {
      return {reason: "meta_scope_metadata_invalid"};
    }
    const names = entry.enrichment?.entity;
    if ([["ad_name", "entity_name"], ["adset_name", "parent_entity_name"], ["campaign_name", "root_entity_name"]]
      .some(([native, target]) => row[native] != null && row[native] !== names?.[target])) return {reason: "native_entity_name_conflict"};
    let mapped;
    try { mapped = mapMetaPdMetrics(row); } catch { return {reason: "meta_metric_projection_invalid"}; }
    const reference = stableJson([scope.snapshot_id, page.fact_family, row.ad_id]);
    const projection = {source_family: page.fact_family, source_reference: reference, scope, rows: [row]};
    const metric_evidence = Object.fromEntries(Object.entries(META_PD_METRIC_SOURCES).map(([metric, source]) => [metric,
      mapped.raw_metrics[metric] === null ? [] : [{source_family: page.fact_family, source_reference: reference,
        source_row_index: 0, native_field: source.field, ...(source.action_type ? {action_type: source.action_type} : {})}]]));
    facts.push({...mapped, scope, metric_evidence, source_projections: [projection],
      source_execution: {...Object.fromEntries(EXECUTION.map(k => [k, context[k]])),
        metadata_references: {attribution: entry.metadata_references?.attribution, metric_units: entry.metadata_references?.metric_units},
        slices: [{source_family: page.fact_family, source_reference: reference, native_row_indices: [index]}]}});
  }
  return {facts};
}

function nativeLineage(fact, evidence, context) {
  const execution = fact.source_execution;
  if (!record(execution) || EXECUTION.some(k => !same(execution[k], context[k]))
    || !text(execution.metadata_references?.attribution) || !text(execution.metadata_references?.metric_units)
    || !Array.isArray(execution.slices) || !Array.isArray(fact.source_projections)
    || execution.slices.length !== fact.source_projections.length) return false;
  for (const [i, projection] of fact.source_projections.entries()) {
    if (!record(projection) || !Array.isArray(projection.rows)) return false;
    const slice = execution.slices[i];
    const page = context.provider === "meta" ? evidence.channel : context.provider === "google_ads"
      ? Object.values(evidence.results ?? {}).find(p => p.fact_family === projection.source_family)
      : evidence.results?.reports?.find(p => `${p.source}:${p.conversion_metric_name}` === projection.source_family);
    if (!page || !Array.isArray(page.rows) || !Array.isArray(slice?.native_row_indices)
      || slice.source_family !== projection.source_family || slice.source_reference !== projection.source_reference
      || slice.native_row_indices.length !== projection.rows.length
      || new Set(slice.native_row_indices).size !== slice.native_row_indices.length
      || slice.native_row_indices.some((index, j) => !Number.isSafeInteger(index) || index < 0 || index >= page.rows.length
        || !same(page.rows[index], projection.rows[j]))) return false;
  }
  return true;
}

/** Explicit server-only handoff. No metadata discovery, new provider request, FX
 * policy, persistence or publication. A structurally valid reference is not live
 * attribution proof. One blocked entity withholds the whole canonical batch.
 */
export function bridgePdReadSnapshot({sourceContext, evidence, composition, metadata} = {}) {
  const source_facts = [], decisions = [];
  const finish = (status, reason, rows = []) => copy({status, reason, rows, source_facts, decisions,
    canonical_validated: status === "validated", canonical_scope_ready: false,
    authorizes_activation: false, persistable: false, publishable: false});
  if (!record(metadata)) return finish("blocked", "record_metadata_required");
  if (!record(sourceContext) || !record(metadata.binding) || BINDING.some(k => sourceContext[k] === undefined
    || !same(sourceContext[k], metadata.binding[k]))) return finish("blocked", "record_metadata_binding_mismatch");
  if (!/^[A-Z]{3}$/.test(metadata.expected_target_currency ?? "") || !Array.isArray(metadata.entries)
    || metadata.entries.length > 20_000) return finish("blocked", "record_metadata_invalid");
  const entries = new Map();
  for (const entry of metadata.entries) {
    if (!record(entry) || !record(entry.scope) || entries.has(identity(entry.scope))) return finish("blocked", "duplicate_or_invalid_entity_metadata");
    entries.set(identity(entry.scope), entry);
  }
  if (sourceContext.provider === "meta") {
    const projected = metaFacts(sourceContext, evidence, entries);
    if (projected.reason) return finish("blocked", projected.reason);
    source_facts.push(...projected.facts);
  } else {
    if (!["google_ads", "klaviyo"].includes(sourceContext.provider) || !["composed", "partial", "not_observed"].includes(composition?.status)
      || !Array.isArray(composition.rows) || composition.rows.length > 20_000) return finish("blocked", "source_composition_required");
    source_facts.push(...composition.rows);
  }
  if (source_facts.length !== entries.size) return finish("blocked", "entity_metadata_coverage_mismatch");
  if (!source_facts.length) return finish("not_observed", null);
  const keys = new Set(), rows = [];
  for (const fact of source_facts) {
    if (!record(fact)) return finish("blocked", "source_record_scope_mismatch");
    const scope = fact.scope, key = identity(scope), entry = entries.get(key);
    if (keys.has(key)) return finish("blocked", "duplicate_source_entity");
    keys.add(key);
    if (!entry || BINDING.filter(k => !EXECUTION.includes(k)).some(k => !same(scope?.[k], sourceContext[k]))
      || scope.conversion_scope !== "normal" || sourceContext.provider !== "meta" && scope.reporting_time_basis !== sourceContext.reporting_time_basis
      || !checkPdCompositionCompatibility(scope, [{source_family: "metadata", source_reference: "metadata", scope: entry.scope}]).compatible) {
      return finish("blocked", "source_record_scope_mismatch");
    }
    if (!nativeLineage(fact, evidence, sourceContext)) return finish("blocked", "native_lineage_mismatch");
    if (!same(fact.source_execution.metadata_references, entry.metadata_references)) return finish("blocked", "source_metadata_reference_mismatch");
    if (entry.enrichment?.provenance?.source_system !== sourceContext.provider) return finish("blocked", "source_provenance_mismatch");
    const result = bridgePdSourceToCanonical({expected_scope: scope, source_fact: fact,
      expected_target_currency: metadata.expected_target_currency, enrichment: entry.enrichment});
    decisions.push({entity: key, status: result.status, reason: result.reason, fact_key: result.fact_key});
    if (result.status === "validated") rows.push(...result.rows);
  }
  return decisions.some(d => d.status !== "validated") ? finish("blocked", "entity_validation_blocked") : finish("validated", null, rows);
}
