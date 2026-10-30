import {composeKlaviyoPdMessage} from "./klaviyo-pd-composition.server.js";
import {normalizeKlaviyoReportRow, KLAVIYO_PD_CONVERSION_METRICS} from "./klaviyo-reporting.server.js";
import {checkPdCompositionCompatibility} from "./pd-composition-scope.server.js";
import {stableJson} from "./common-adapter.server.js";

const BINDING = ["workspace_id", "installation_id", "installation_generation", "provider", "provider_connection_id",
  "connection_version", "reporting_selection_epoch", "platform_account_id", "canonical_reporting_account_id",
  "business_date", "source_timezone", "source_currency", "job_or_run_id", "claim_fence"];
const text = v => typeof v === "string" && v.length > 0 && v === v.trim();
function copy(v) {
  return v === null || typeof v !== "object" ? v : Object.freeze(Array.isArray(v) ? v.map(copy)
    : Object.fromEntries(Object.entries(v).map(([k, value]) => [k, copy(value)])));
}
const blocked = reason => Object.freeze({status: "blocked", reason, rows: Object.freeze([]), publishable: false});

/** Group the existing six PD reports by Campaign/Flow Message. Trusted server
 * metadata remains distinct from native evidence; no role or cost is calculated.
 */
export function composeKlaviyoPdSnapshot({sourceContext, evidence, compositionContexts} = {}) {
  if (sourceContext?.provider !== "klaviyo" || evidence?.provider !== "klaviyo"
    || sourceContext.canonical_reporting_account_id !== null
    || evidence.authority?.connection_id !== sourceContext.provider_connection_id
    || evidence.authority.connected_account_id !== sourceContext.platform_account_id
    || evidence.business_date !== sourceContext.business_date
    || !["completed", "configuration_missing"].includes(evidence.status)) return blocked("source_scope_mismatch");
  for (const kind of ["campaign", "flow"]) {
    const metadata = compositionContexts?.[kind];
    if (!metadata) return blocked("composition_context_required");
    if (!metadata.binding || BINDING.some(k => sourceContext[k] === undefined
      || stableJson(metadata.binding[k]) !== stableJson(sourceContext[k]))) return blocked("composition_context_mismatch");
    if (metadata.flow !== kind || metadata.conversion_scope !== "normal" || metadata.reporting_time_basis !== "send_date"
      || !text(metadata.references?.attribution) || !text(metadata.references?.metric_units)) return blocked("composition_metadata_required");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(metadata.composition_attempt_id ?? "")
      || !text(metadata.snapshot_id) || ![metadata.attribution_fingerprint, metadata.metric_units_fingerprint]
        .every(v => typeof v === "string" && /^[0-9a-f]{64}$/.test(v))) return blocked("composition_metadata_invalid");
  }
  const reports = evidence.results?.reports, selection = evidence.results?.metrics?.selected;
  if (!Array.isArray(reports) || reports.length !== 6 || !selection) return blocked("metric_families_required");
  const byFamily = new Map(), messages = new Map();
  for (const report of reports) {
    const kind = report.source, name = report.conversion_metric_name;
    const family = `${kind}:${name}`;
    if (!["campaign", "flow"].includes(kind) || !KLAVIYO_PD_CONVERSION_METRICS.includes(name)
      || byFamily.has(family) || !Array.isArray(report.rows) || report.rows.length > 20_000
      || report.observation !== "account_configuration_missing" && !Array.isArray(report.page_spans)) return blocked("source_family_or_completeness_invalid");
    byFamily.set(family, report);
    for (const [index, row] of report.rows.entries()) {
      let normalized;
      try { normalized = normalizeKlaviyoReportRow(kind, row); }
      catch { return blocked("native_row_invalid"); }
      const key = stableJson([kind, normalized.channel_id]);
      const message = messages.get(key) ?? {kind, id: normalized.channel_id, parent: normalized.source_entity_id,
        rows: new Map(), indices: new Map()};
      if (message.parent !== normalized.source_entity_id) return blocked("native_hierarchy_conflict");
      if (!message.rows.has(name)) {message.rows.set(name, []); message.indices.set(name, []);}
      message.rows.get(name).push(row); message.indices.get(name).push(index); messages.set(key, message);
    }
  }
  const facts = [];
  let partial = false;
  for (const message of messages.values()) {
    const metadata = compositionContexts[message.kind];
    const expected = Object.fromEntries(BINDING.filter(k => !["connection_version", "reporting_selection_epoch", "claim_fence"].includes(k))
      .map(k => [k, sourceContext[k]]));
    Object.assign(expected, {flow: message.kind, entity_type: `${message.kind}_message`, entity_id: message.id,
      ancestors: [{entity_type: message.kind, entity_id: message.parent}], reporting_time_basis: "send_date", conversion_scope: "normal",
      completeness: "complete", bounded: true, composition_attempt_id: metadata.composition_attempt_id, snapshot_id: metadata.snapshot_id,
      attribution_fingerprint: metadata.attribution_fingerprint, metric_units_fingerprint: metadata.metric_units_fingerprint});
    if (!checkPdCompositionCompatibility(expected, [{source_family: "scope", source_reference: "scope", scope: expected}]).compatible) return blocked("composition_metadata_invalid");
    const projections = KLAVIYO_PD_CONVERSION_METRICS.map(name => {
      const family = `${message.kind}:${name}`, report = byFamily.get(family);
      const rows = message.rows.get(name) ?? [];
      return {...report, rows, observation: report.observation === "account_configuration_missing" ? report.observation
        : rows.length ? "observed" : "not_observed_in_this_execution", source_family: family,
      source_reference: stableJson([metadata.snapshot_id, family, message.id]), scope: expected};
    });
    const result = composeKlaviyoPdMessage({expected_scope: expected, metric_selection: selection, projections});
    if (result.status === "rejected") return blocked(result.reason);
    partial ||= result.status === "partial";
    facts.push(copy({...result.rows[0], source_execution: {connection_version: sourceContext.connection_version,
      reporting_selection_epoch: sourceContext.reporting_selection_epoch, claim_fence: sourceContext.claim_fence,
      metadata_references: {attribution: metadata.references.attribution, metric_units: metadata.references.metric_units},
      ...(metadata.attribution_reference ? {attribution_reference: metadata.attribution_reference} : {}),
      metric_selection: selection,
      slices: projections.map(p => ({source_family: p.source_family, source_reference: p.source_reference,
        native_row_indices: message.indices.get(p.conversion_metric_name) ?? [], page_spans: p.page_spans ?? []}))}}));
  }
  return copy({status: facts.length ? partial ? "partial" : "composed"
    : evidence.complete ? "not_observed" : "configuration_missing", reason: null, rows: facts, publishable: false});
}
