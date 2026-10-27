import {RAW_METRICS, stableJson} from "./common-adapter.server.js";
import {checkPdCompositionCompatibility} from "./pd-composition-scope.server.js";
import {KLAVIYO_REPORTING_API_REVISION, KLAVIYO_REPORTING_STATISTICS, KLAVIYO_PD_CONVERSION_METRICS,
  klaviyoBusinessDayTimeframe, normalizeKlaviyoReportRow, mapKlaviyoPdMetrics} from "./klaviyo-reporting.server.js";

const OWNERS = {
  "Placed Order": {impression: "delivered", ad_click: "clicks", purchase: "conversions", purchase_value: "conversion_value"},
  "Added to Cart": {add_to_cart: "conversions", add_to_cart_value: "conversion_value"},
  "Checkout Started": {checkout: "conversions", checkout_value: "conversion_value"},
};
const text = value => typeof value === "string" && value.length > 0 && value === value.trim();
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
function reject(reason, compatibility = null) {
  return Object.freeze({status: "rejected", rows: Object.freeze([]), reason, compatibility, publishable: false});
}
function copy(value) {
  if (value === null || typeof value !== "object") return value;
  return Object.freeze(Array.isArray(value) ? value.map(copy)
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)])));
}

function requestMatches(projection, expected) {
  const data = projection.evidence?.request_body?.data;
  const attributes = data?.attributes;
  if (projection.evidence?.revision !== KLAVIYO_REPORTING_API_REVISION ||
      data?.type !== `${expected.flow}-values-report` || !record(attributes)) return false;
  const timeframe = klaviyoBusinessDayTimeframe({businessDate: expected.business_date, timeZone: expected.source_timezone});
  if (attributes.timeframe?.start !== timeframe.start || attributes.timeframe?.end !== timeframe.end ||
      Object.keys(attributes.timeframe).some(key => !["start", "end"].includes(key)) ||
      attributes.conversion_metric_id !== projection.conversion_metric_id) return false;
  const groupBy = [`${expected.flow}_id`, `${expected.flow}_message_id`, `${expected.flow}_message_name`,
    "send_channel", "variation", "variation_name", ...(expected.flow === "flow" ? ["flow_name"] : [])];
  if (!Array.isArray(attributes.group_by) || attributes.group_by.length !== groupBy.length ||
      new Set(attributes.group_by).size !== groupBy.length || groupBy.some(key => !attributes.group_by.includes(key))) return false;
  const statistics = Object.values(OWNERS[projection.conversion_metric_name]);
  if (!Array.isArray(attributes.statistics) || new Set(attributes.statistics).size !== attributes.statistics.length ||
      statistics.some(key => !attributes.statistics.includes(key)) ||
      attributes.statistics.some(key => !KLAVIYO_REPORTING_STATISTICS.includes(key))) return false;
  return Object.keys(attributes).every(key => ["timeframe", "conversion_metric_id", "statistics", "group_by"].includes(key));
}

/** Compose one message/day. send_channel and variation remain details of that message,
 * never separate hierarchy levels. Source scopes/discovery come from trusted orchestration;
 * this function performs no provider call, FX enrichment, role classification or write.
 */
export function composeKlaviyoPdMessage({expected_scope: expected, metric_selection: selection, projections} = {}) {
  const compatibility = checkPdCompositionCompatibility(expected, projections);
  if (!compatibility.compatible) return reject("scope_incompatible", compatibility);
  if (expected.provider !== "klaviyo" || expected.conversion_scope !== "normal" ||
      expected.reporting_time_basis !== "send_date") return reject("klaviyo_send_date_scope_required");
  if (!record(selection) || projections.length !== 3) return reject("metric_families_required");
  const byName = new Map(), metricIds = new Set();
  for (const projection of projections) {
    const name = projection.conversion_metric_name;
    if (!KLAVIYO_PD_CONVERSION_METRICS.includes(name) || byName.has(name) ||
        projection.source_family !== `${expected.flow}:${name}` || projection.source !== expected.flow) return reject("metric_family_mismatch");
    const selected = selection[name];
    if (!record(selected) || !["present", "account_configuration_missing"].includes(selected.state) ||
        projection.conversion_metric_id !== selected.metric_id ||
        !Array.isArray(projection.rows) || projection.rows.length > 20_000) return reject("metric_selection_or_bound_invalid");
    if (selected.state === "present") {
      if (!text(selected.metric_id) || metricIds.has(selected.metric_id)) return reject("metric_identity_ambiguous");
      metricIds.add(selected.metric_id);
      let validRequest = false;
      try { validRequest = requestMatches(projection, expected); } catch { /* Invalid day boundaries stay closed. */ }
      if (projection.observation !== (projection.rows.length ? "observed" : "not_observed_in_this_execution") ||
          !validRequest) return reject("report_request_or_observation_mismatch");
    } else if (selected.metric_id !== null || projection.observation !== "account_configuration_missing" || projection.rows.length ||
        projection.evidence?.request_body != null) {
      return reject("missing_configuration_contradiction");
    }
    byName.set(name, projection);
  }

  const details = new Map(), families = new Map(), variationKinds = new Map();
  for (const name of KLAVIYO_PD_CONVERSION_METRICS) {
    const projection = byName.get(name), family = new Map();
    families.set(name, family);
    for (const [index, row] of projection.rows.entries()) {
      let normalized, mapped;
      try {
        normalized = normalizeKlaviyoReportRow(expected.flow, row);
        mapped = mapKlaviyoPdMetrics(row, name);
      } catch { return reject("native_row_invalid"); }
      const allowed = [`${expected.flow}_id`, `${expected.flow}_message_id`, `${expected.flow}_message_name`,
        "send_channel", "variation", "variation_name", ...(expected.flow === "flow" ? ["flow_name"] : [])];
      if (normalized.source_entity_id !== expected.ancestors[0].entity_id || normalized.channel_id !== expected.entity_id ||
          Object.keys(row.groupings).some(key => !allowed.includes(key))) return reject("native_identity_or_grain_mismatch");
      if (Object.values(mapped.raw_metrics).some(value => value !== null && Number.isInteger(value) && !Number.isSafeInteger(value))) {
        return reject("metric_number_unsafe");
      }
      const key = stableJson([normalized.medium, normalized.variation_id]);
      if (family.has(key)) return reject("duplicate_detail");
      const kinds = variationKinds.get(normalized.medium) ?? new Set();
      kinds.add(normalized.variation_id === null ? "unspecified" : "variant");
      variationKinds.set(normalized.medium, kinds);
      if (kinds.size > 1) return reject("mixed_message_and_variation_grain");
      family.set(key, {index, mapped});
      if (!details.has(key)) details.set(key, {medium: normalized.medium, variation_id: normalized.variation_id});
    }
  }
  if (!details.size) return reject("message_not_observed");
  const detailRows = [];
  for (const [key, detail] of [...details].sort(([a], [b]) => a.localeCompare(b))) {
    const raw_metrics = {}, metric_support = {}, observation_state = {}, metric_evidence = {};
    for (const metric of RAW_METRICS) {
      raw_metrics[metric] = null; metric_support[metric] = "unknown";
      observation_state[metric] = metric === "spend_value" ? "not_requested" : "absent";
      metric_evidence[metric] = Object.freeze([]);
    }
    for (const name of KLAVIYO_PD_CONVERSION_METRICS) {
      const source = byName.get(name), observed = families.get(name).get(key);
      for (const [metric, nativeField] of Object.entries(OWNERS[name])) {
        if (selection[name].state === "account_configuration_missing") {
          observation_state[metric] = "account_configuration_missing";
        } else if (observed) {
          raw_metrics[metric] = observed.mapped.raw_metrics[metric];
          metric_support[metric] = observed.mapped.metric_support[metric];
          observation_state[metric] = observed.mapped.observation_state[metric];
          metric_evidence[metric] = Object.freeze([Object.freeze({source_family: source.source_family,
            source_reference: source.source_reference, source_row_index: observed.index, native_field: nativeField})]);
        }
      }
    }
    detailRows.push(Object.freeze({...detail, raw_metrics: Object.freeze(raw_metrics), metric_support: Object.freeze(metric_support),
      observation_state: Object.freeze(observation_state), metric_evidence: Object.freeze(metric_evidence)}));
  }
  const raw_metrics = {}, metric_support = {}, observation_state = {}, metric_evidence = {};
  for (const metric of RAW_METRICS) {
    const values = detailRows.map(row => row.raw_metrics[metric]);
    const sum = values.every(value => value !== null) ? values.reduce((total, value) => total + value, 0) : null;
    if (sum !== null && (!Number.isFinite(sum) || (Number.isInteger(sum) && !Number.isSafeInteger(sum)))) return reject("metric_sum_unsafe");
    raw_metrics[metric] = sum;
    metric_support[metric] = sum === null ? "unknown" : "supported";
    observation_state[metric] = metric === "spend_value" ? "not_requested" : sum === 0 ? "zero" : sum !== null ? "present" :
      detailRows.every(row => row.observation_state[metric] === "account_configuration_missing") ? "account_configuration_missing" :
      values.some(value => value !== null) ? "partial" : "absent";
    metric_evidence[metric] = Object.freeze(detailRows.flatMap(row => row.metric_evidence[metric]));
  }
  const fact = Object.freeze({scope: copy(expected), raw_metrics: Object.freeze(raw_metrics),
    metric_support: Object.freeze(metric_support), observation_state: Object.freeze(observation_state),
    metric_evidence: Object.freeze(metric_evidence), details: Object.freeze(detailRows), spend_state: "open_no_calculation",
    source_projections: Object.freeze(projections.map(source => Object.freeze({source_family: source.source_family,
      source_reference: source.source_reference, conversion_metric_name: source.conversion_metric_name,
      conversion_metric_id: source.conversion_metric_id, observation: source.observation, rows: copy(source.rows),
      request_body: source.evidence?.request_body ? copy({data: {
        type: source.evidence.request_body.data.type, attributes: source.evidence.request_body.data.attributes,
      }}) : null})))});
  const covered = RAW_METRICS.filter(metric => metric !== "spend_value").every(metric => raw_metrics[metric] !== null);
  return Object.freeze({status: covered ? "composed" : "partial", rows: Object.freeze([fact]),
    reason: null, compatibility, publishable: false});
}
