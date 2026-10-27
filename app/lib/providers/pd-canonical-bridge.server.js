import {RAW_METRICS, validateCanonicalFunnelFact, canonicalFactKey} from "./common-adapter.server.js";
import {checkPdCompositionCompatibility} from "./pd-composition-scope.server.js";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.length > 0 && value === value.trim();
function copy(value) {
  if (value === null || typeof value !== "object") return value;
  return Object.freeze(Array.isArray(value) ? value.map(copy)
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)])));
}
function blocked(reason, source, compatibility = null) {
  return Object.freeze({status: "blocked", rows: Object.freeze([]), canonical_validated: false,
    fact_key: null, reason, compatibility, source_fact: record(source) ? copy(source) : null, publishable: false});
}
function date(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

function entityMatches(entity, scope) {
  if (!record(entity) || entity.entity_type !== scope.entity_type || entity.entity_id !== scope.entity_id ||
      !text(entity.entity_name)) return false;
  const root = scope.ancestors[0], parent = scope.ancestors.at(-1);
  const parentType = parent.entity_type === "ad_group" ? "adgroup" : parent.entity_type;
  if (entity.root_entity_type !== root.entity_type || entity.root_entity_id !== root.entity_id ||
      !text(entity.root_entity_name) || entity.parent_entity_type !== parentType ||
      entity.parent_entity_id !== parent.entity_id || !text(entity.parent_entity_name)) return false;
  if (root.entity_type === parent.entity_type && root.entity_id === parent.entity_id &&
      entity.root_entity_name !== entity.parent_entity_name) return false;
  if (scope.provider === "google_ads" && entity.campaign_type !== (scope.flow === "retail_pmax" ? "performance_max" : "standard")) return false;
  return entity.campaign_type == null || ["standard", "performance_max"].includes(entity.campaign_type);
}

function lineageValid(source) {
  if (!record(source.metric_evidence) || !Array.isArray(source.source_projections) || !source.source_projections.length) return false;
  const projections = new Map();
  for (const projection of source.source_projections) {
    if (!record(projection) || !text(projection.source_family) || !text(projection.source_reference) || !Array.isArray(projection.rows)) return false;
    const key = JSON.stringify([projection.source_family, projection.source_reference]);
    if (projections.has(key)) return false;
    projections.set(key, projection);
  }
  if (Object.keys(source.metric_evidence).length !== RAW_METRICS.length) return false;
  for (const metric of RAW_METRICS) {
    const references = source.metric_evidence[metric];
    if (!Array.isArray(references)) return false;
    if (["present", "zero"].includes(source.observation_state?.[metric]) && references.length === 0) return false;
    const seen = new Set();
    for (const reference of references) {
      if (!record(reference) || !text(reference.native_field) || !Number.isSafeInteger(reference.source_row_index) || reference.source_row_index < 0) return false;
      const projection = projections.get(JSON.stringify([reference.source_family, reference.source_reference]));
      if (!projection || reference.source_row_index >= projection.rows.length) return false;
      const native = projection.rows[reference.source_row_index];
      const values = source.scope.provider === "klaviyo" ? native?.statistics : native?.metrics;
      if (["present", "zero"].includes(source.observation_state?.[metric]) && values?.[reference.native_field] == null) return false;
      const refKey = JSON.stringify([reference.source_family, reference.source_reference, reference.source_row_index, reference.native_field]);
      if (seen.has(refKey)) return false;
      seen.add(refKey);
    }
  }
  return true;
}

/** Enrich a source fact using explicit, scope-bound metadata, then call the existing
 * canonical validator. Validation is structural, not live authority or publication approval.
 * No FX lookup, fallback, multiplication, provider request or Dataset write occurs here.
 */
export function bridgePdSourceToCanonical({expected_scope: expected, source_fact: source,
  expected_target_currency: target, enrichment} = {}) {
  const compatibility = checkPdCompositionCompatibility(expected, [
    {source_family: "pd_source_fact", source_reference: "source", scope: source?.scope},
    {source_family: "pd_enrichment", source_reference: "metadata", scope: enrichment?.scope},
  ]);
  if (!compatibility.compatible) return blocked("scope_incompatible", source, compatibility);
  if (!lineageValid(source)) return blocked("source_lineage_invalid", source, compatibility);
  if (!record(source.raw_metrics) || !record(source.metric_support) || !record(source.observation_state)) return blocked("source_metrics_invalid", source, compatibility);
  for (const metric of RAW_METRICS) {
    if (["present", "zero"].includes(source.observation_state[metric]) && source.metric_support[metric] !== "supported") {
      return blocked("metric_state_inconsistent", source, compatibility);
    }
  }
  if (!entityMatches(enrichment.entity, expected)) return blocked("entity_metadata_missing_or_conflicting", source, compatibility);
  const references = enrichment.references;
  if (!record(references) || ["entity", "time", "fx", "reporting_currency"].some(key => !text(references[key]))) return blocked("enrichment_references_missing", source, compatibility);
  const currency = enrichment.currency;
  if (!record(currency) || !/^[A-Z]{3}$/.test(target ?? "") || currency.source_currency !== expected.source_currency ||
      currency.target_currency !== target || enrichment.fx_for_business_date !== expected.business_date ||
      typeof currency.fx_rate !== "number" || !Number.isFinite(currency.fx_rate) || currency.fx_rate <= 0 ||
      !date(currency.fx_rate_date) || !text(currency.fx_provider) || !text(currency.fx_engine_version)) return blocked("fx_metadata_missing_or_conflicting", source, compatibility);
  if (currency.source_currency === currency.target_currency && currency.fx_rate !== 1) return blocked("same_currency_rate_invalid", source, compatibility);
  const time = enrichment.time;
  if (!record(time) || time.source_timezone !== expected.source_timezone || time.business_date !== expected.business_date ||
      !text(time.time_engine_version)) return blocked("time_metadata_missing_or_conflicting", source, compatibility);
  const provenance = enrichment.provenance;
  if (!record(provenance) || !text(provenance.source_system) || !text(provenance.adapter_version) ||
      !["real", "fallback", "partial"].includes(provenance.source_confidence) || typeof provenance.synthetic !== "boolean") {
    return blocked("provenance_missing", source, compatibility);
  }
  const identity = {workspace_id: expected.workspace_id, installation_id: expected.installation_id,
    installation_generation: expected.installation_generation, provider_connection_id: expected.provider_connection_id,
    platform: expected.provider, platform_account_id: expected.platform_account_id,
    canonical_reporting_account_id: expected.canonical_reporting_account_id, business_date: expected.business_date};
  const entity = Object.fromEntries(["campaign_type", "root_entity_type", "root_entity_id", "root_entity_name",
    "parent_entity_type", "parent_entity_id", "parent_entity_name", "entity_type", "entity_id", "entity_name"]
    .filter(key => Object.hasOwn(enrichment.entity, key)).map(key => [key, enrichment.entity[key]]));
  const selectedCurrency = Object.fromEntries(["source_currency", "target_currency", "fx_rate", "fx_rate_date", "fx_provider", "fx_engine_version"].map(key => [key, currency[key]]));
  const selectedTime = Object.fromEntries(["source_timezone", "business_date", "time_engine_version"].map(key => [key, time[key]]));
  const selectedReferences = Object.fromEntries(["entity", "time", "fx", "reporting_currency"].map(key => [key, references[key]]));
  const row = {identity, entity, raw_metrics: {...source.raw_metrics}, metric_support: {...source.metric_support},
    observation_state: {...source.observation_state}, currency: selectedCurrency, time: selectedTime,
    provenance: {source_system: provenance.source_system, adapter_version: provenance.adapter_version,
      source_confidence: provenance.source_confidence, synthetic: provenance.synthetic,
      raw_reference: {source_fact: source, enrichment_references: selectedReferences,
        fx_for_business_date: enrichment.fx_for_business_date, expected_target_currency: target}}};
  let key;
  try { validateCanonicalFunnelFact(row); key = canonicalFactKey(row); }
  catch { return blocked("canonical_validation_failed", source, compatibility); }
  return Object.freeze({status: "validated", rows: Object.freeze([copy(row)]), canonical_validated: true,
    fact_key: key, reason: null, compatibility, source_fact: copy(source), publishable: false});
}
