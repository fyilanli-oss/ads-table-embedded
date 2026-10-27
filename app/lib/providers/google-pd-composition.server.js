import {RAW_METRICS} from "./common-adapter.server.js";
import {checkPdCompositionCompatibility} from "./pd-composition-scope.server.js";
import {mapGooglePdMetrics} from "./google-reporting.server.js";

const PAIRS = {
  search: ["search_ad_channel_daily", "search_ad_conversion_action_daily"],
  shopping: ["ad_group_channel_daily", "shopping_ad_group_conversion_action_daily"],
  retail_pmax: ["pmax_asset_group_channel_daily", "pmax_asset_group_conversion_action_daily"],
};
const CATEGORY = {
  ADD_TO_CART: ["add_to_cart", "add_to_cart_value"],
  BEGIN_CHECKOUT: ["checkout", "checkout_value"],
  PURCHASE: ["purchase", "purchase_value"],
};
const PERFORMANCE = ["impression", "ad_click", "spend_value"];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const numericId = value => typeof value === "string" && /^[0-9]+$/.test(value);

function rejected(reason, compatibility = null) {
  return Object.freeze({status: "rejected", rows: Object.freeze([]), reason, compatibility, publishable: false});
}

function nativeRowMatches(row, scope, conversion) {
  if (!record(row) || row.customer?.id !== scope.platform_account_id ||
      scope.platform_account_id !== scope.canonical_reporting_account_id ||
      !numericId(row.customer?.id) || row.segments?.date !== scope.business_date ||
      row.campaign?.id !== scope.ancestors[0].entity_id || !numericId(row.campaign?.id)) return false;
  const campaignType = {search: "SEARCH", shopping: "SHOPPING", retail_pmax: "PERFORMANCE_MAX"}[scope.flow];
  if (row.campaign?.advertisingChannelType !== campaignType) return false;
  if (scope.flow === "search" && (row.adGroup?.id !== scope.ancestors[1].entity_id ||
      row.adGroupAd?.ad?.id !== scope.entity_id || !numericId(row.adGroup?.id))) return false;
  if (scope.flow === "shopping" && row.adGroup?.id !== scope.entity_id) return false;
  if (scope.flow === "retail_pmax" && row.assetGroup?.id !== scope.entity_id) return false;
  if (!numericId(scope.entity_id)) return false;
  // These source families select only date, plus action/category for conversions.
  // Additional segments must be handled by an explicit future reduction contract.
  const allowed = conversion ? ["date", "conversionAction", "conversionActionCategory"] : ["date"];
  if (Object.keys(row.segments).some(key => !allowed.includes(key))) return false;
  if (conversion && (!Object.hasOwn(CATEGORY, row.segments.conversionActionCategory) ||
      typeof row.segments.conversionAction !== "string" ||
      !new RegExp(`^customers/${scope.platform_account_id}/conversionActions/[0-9]+$`).test(row.segments.conversionAction))) return false;
  return true;
}

function safeMetricNumbers(row, conversion) {
  const fields = conversion ? ["conversions", "conversionsValue"] : ["impressions", "clicks", "costMicros"];
  return fields.every(field => {
    const value = row.metrics?.[field];
    if (value == null) return true;
    if ((typeof value !== "string" && typeof value !== "number") ||
        (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value))) return false;
    const number = Number(value);
    return Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number));
  });
}

function ref(source, index, nativeField) {
  return Object.freeze({source_family: source.source_family, source_reference: source.source_reference,
    source_row_index: index, native_field: nativeField});
}

function freezeCopy(value) {
  if (value === null || typeof value !== "object") return value;
  const copy = Array.isArray(value) ? value.map(freezeCopy)
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freezeCopy(child)]));
  return Object.freeze(copy);
}

/** Compose one observed PD leaf/day from complete native projections. This source fact
 * still needs metadata/FX enrichment and canonical validation before any Dataset write.
 * Projection scopes and their effective attribution evidence are supplied by orchestration.
 */
export function composeGooglePdLeaf({expected_scope: expected, performance, conversions} = {}) {
  const compatibility = checkPdCompositionCompatibility(expected, [performance, conversions]);
  if (!compatibility.compatible) return rejected("scope_incompatible", compatibility);
  if (expected.provider !== "google_ads" || expected.conversion_scope !== "normal" ||
      expected.reporting_time_basis !== "interaction_date") return rejected("google_normal_interaction_scope_required");
  const pair = PAIRS[expected.flow];
  if (!pair || performance.source_family !== pair[0] || conversions.source_family !== pair[1]) {
    return rejected("source_family_mismatch");
  }
  if (!Array.isArray(performance.rows) || !Array.isArray(conversions.rows) ||
      performance.rows.length > 1 || conversions.rows.length > 20_000) return rejected("source_grain_or_bound_invalid");
  if (performance.rows.length + conversions.rows.length === 0) return rejected("leaf_not_observed");
  for (const [source, conversion] of [[performance, false], [conversions, true]]) {
    if (source.rows.some(row => !nativeRowMatches(row, expected, conversion))) return rejected("native_identity_or_grain_mismatch");
    if (source.rows.some(row => !safeMetricNumbers(row, conversion))) return rejected("native_metric_invalid_or_unsafe");
  }
  const seenActions = new Set();
  for (const row of conversions.rows) {
    if (seenActions.has(row.segments.conversionAction)) return rejected("duplicate_or_conflicting_conversion_action");
    seenActions.add(row.segments.conversionAction);
  }

  const raw_metrics = {}, metric_support = {}, observation_state = {}, metric_evidence = {};
  const details = [];
  for (const metric of RAW_METRICS) {
    raw_metrics[metric] = null;
    metric_support[metric] = "unknown";
    observation_state[metric] = "absent";
    metric_evidence[metric] = [];
  }
  function assign(metric, value, evidence, incomplete = false) {
    raw_metrics[metric] = value;
    metric_support[metric] = value === null ? "unknown" : "supported";
    observation_state[metric] = incomplete ? "partial" : value === null ? "absent" : value === 0 ? "zero" : "present";
    metric_evidence[metric] = evidence;
  }
  if (performance.rows.length) {
    const mapped = mapGooglePdMetrics(performance.rows[0], performance.source_family);
    const native = {impression: "impressions", ad_click: "clicks", spend_value: "costMicros"};
    for (const metric of PERFORMANCE) assign(metric, mapped.raw_metrics[metric], [ref(performance, 0, native[metric])]);
  }
  const mappedConversions = conversions.rows.map((row, index) => {
    const mapped = mapGooglePdMetrics(row, conversions.source_family);
    details.push(Object.freeze({conversion_action: row.segments.conversionAction,
      category: row.segments.conversionActionCategory, source_row_index: index,
      raw_metrics: mapped.raw_metrics, observation_state: mapped.observation_state}));
    return mapped;
  });
  for (const [category, metrics] of Object.entries(CATEGORY)) {
    const indexes = conversions.rows.flatMap((row, index) => row.segments.conversionActionCategory === category ? [index] : []);
    for (const [position, metric] of metrics.entries()) {
      const values = indexes.map(index => mappedConversions[index].raw_metrics[metric]);
      const complete = values.length > 0 && values.every(value => value !== null);
      const sum = complete ? values.reduce((total, value) => total + value, 0) : null;
      if (sum !== null && (!Number.isFinite(sum) || (Number.isInteger(sum) && !Number.isSafeInteger(sum)))) {
        return rejected("metric_sum_unsafe");
      }
      assign(metric, sum, indexes.map(index => ref(conversions, index, position === 0 ? "conversions" : "conversionsValue")),
        values.length > 0 && !complete);
    }
  }
  for (const metric of RAW_METRICS) Object.freeze(metric_evidence[metric]);
  const complete = RAW_METRICS.every(metric => raw_metrics[metric] !== null);
  const scope = Object.freeze({...expected, ancestors: Object.freeze(expected.ancestors.map(a => Object.freeze({entity_type: a.entity_type, entity_id: a.entity_id})))});
  const fact = Object.freeze({scope, raw_metrics: Object.freeze(raw_metrics), metric_support: Object.freeze(metric_support),
    observation_state: Object.freeze(observation_state), metric_evidence: Object.freeze(metric_evidence),
    source_projections: Object.freeze([performance, conversions].map(source => Object.freeze({
      source_family: source.source_family, source_reference: source.source_reference, rows: freezeCopy(source.rows),
    }))),
    conversion_details: Object.freeze(details), source_currency_conversion: "none_cost_micros_unit_scale_only"});
  return Object.freeze({status: complete ? "composed" : "partial", rows: Object.freeze([fact]),
    reason: null, compatibility, publishable: false});
}
