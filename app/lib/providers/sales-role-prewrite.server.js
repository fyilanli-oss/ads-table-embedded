import {stableJson} from "./common-adapter.server.js";

const copy = v => v === null || typeof v !== "object" ? v : Object.freeze(Array.isArray(v)
  ? v.map(copy) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])));
const text = v => typeof v === "string" && v.length > 0 && v === v.trim();
const fail = () => {throw Error("SALES_ROLE_PREWRITE_INPUT_INVALID");};
const families = {
  google_ads: ["shopping_cart_data_product_sales_daily", "pmax_cart_data_product_sales_daily", "search_cart_data_product_sales_daily"],
  klaviyo: ["ordered_product_event"],
};
const dimensions = {
  google_ads: ["campaign_id", "ad_group_id", "merchant_id", "feed_label", "language", "advertised_item_id", "sold_item_id"],
  klaviyo: ["event_id"],
};
const cohortFields = ["workspace_id", "installation_id", "installation_generation", "provider_connection_id", "provider",
  "platform_account_id", "business_date", "source_currency", "source_timezone", "reporting_time_basis", "fact_family", "conversion_scope", "unit_kind"];

export function salesRoleMetricState(value) {
  if (value === null || value === undefined) return "absent";
  if (typeof value === "number") return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
    ? value === 0 ? "zero" : "present" : "invalid";
  if (typeof value !== "string" || value.length > 256 || !/^-?\d+(?:\.\d+)?$/.test(value)) return "invalid";
  return /^-?0+(?:\.0+)?$/.test(value) ? "zero" : "present";
}

// Pure, bounded structural review, never an observation/identity/write capability.
// Callers must establish private source proof first. No arithmetic or FX occurs.
// This in-memory native key is not the future durable Dataset key or a cross-run ledger.
export function reviewSalesRoleCohort({cohort, rows, ...extra} = {}) {
  if (Object.keys(extra).length || !cohort || Object.keys(cohort).some(k => !cohortFields.includes(k))
    || !Object.hasOwn(families, cohort.provider) || !families[cohort.provider].includes(cohort.fact_family) || cohort.unit_kind !== "product_unit"
    || !Number.isSafeInteger(cohort.installation_generation) || cohort.installation_generation < 1
    || cohortFields.filter(k => k !== "installation_generation").some(k => !text(cohort[k]))
    || !/^\d{4}-\d{2}-\d{2}$/.test(cohort.business_date) || !Number.isFinite(Date.parse(cohort.business_date))
    || new Date(cohort.business_date).toISOString().slice(0, 10) !== cohort.business_date
    || !/^[A-Z]{3}$/.test(cohort.source_currency)
    || cohort.conversion_scope !== (cohort.provider === "google_ads" ? "normal" : "event_attribution")
    || !Array.isArray(rows) || rows.length > 20_000) fail();
  const fields = dimensions[cohort.provider], reviewed = [], seen = new Map();
  let duplicates = 0, conflicts = 0, held = 0;
  for (const input of rows) {
    if (!input || stableJson(input.cohort) !== stableJson(cohort) || !input.native_identity
      || Object.keys(input.native_identity).some(k => !fields.includes(k))
      || fields.some(k => !Object.hasOwn(input.native_identity, k))
      || !input.source_reference || input.source_reference.family !== cohort.fact_family
      || !text(input.source_reference.native_reference) || !input.observed || !input.metrics
      || !Object.hasOwn(input.metrics, "quantity") || !Object.hasOwn(input.metrics, "value")
      || !["Advertised", "Cross-sell", "Assisted", "Triggered", "Unclassified"].includes(input.sales_role)
      || cohort.provider === "klaviyo" && ["Advertised", "Cross-sell"].includes(input.sales_role)
      || cohort.provider === "google_ads" && input.sales_role === "Triggered") fail();
    const identity = input.native_identity;
    const required = cohort.provider === "klaviyo" ? ["event_id"] : ["campaign_id", "merchant_id", "feed_label", "sold_item_id",
      ...(cohort.fact_family === "pmax_cart_data_product_sales_daily" ? ["language"] : ["ad_group_id"])];
    const states = Object.fromEntries(Object.entries(input.metrics).map(([k, v]) => [k, salesRoleMetricState(v)]));
    const reasons = [];
    if (!(text(input.source_product_id) || typeof input.source_product_id === "number"
      && Number.isSafeInteger(input.source_product_id) && input.source_product_id >= 0)) reasons.push("native_product_reference_missing_or_invalid");
    if (required.some(k => !text(identity[k]))) reasons.push("native_sale_identity_incomplete");
    if (Object.values(identity).some(v => v !== null && !text(v))) reasons.push("native_sale_identity_invalid");
    if (Object.values(states).includes("invalid")) reasons.push("native_metric_invalid_or_unsafe");
    if (states.quantity === "absent" || states.value === "absent") reasons.push("native_quantity_or_value_missing");
    // Neither amount, role, resolved Channel/product name nor execution ID defines uniqueness.
    const key = stableJson([cohort, fields.map(k => [k, identity[k]])]);
    const signature = stableJson([input.source_product_id, input.metrics, input.sales_role, input.source_payload]);
    const previous = seen.get(key);
    if (previous) {
      if (previous.signature !== signature) {
        if (previous.row.state !== "conflicting") conflicts++;
        previous.row.state = "conflicting";
        previous.row.conflicting_observations.push(input.observed);
        previous.row.reasons = [...new Set([...previous.row.reasons, "same_native_sale_conflicting_evidence"])];
      } else duplicates++;
      previous.row.source_references.push(input.source_reference);
      continue;
    }
    if (reasons.length) held++;
    const row = {native_sale_key: key, state: reasons.length ? "held" : "reviewed", reasons, conflicting_observations: [],
      sales_role: input.sales_role, metric_states: states, source_references: [input.source_reference], observed: input.observed};
    seen.set(key, {signature, row}); reviewed.push(row);
  }
  return copy({status: conflicts || held ? "blocked" : "role_reviewed_not_written", complete: conflicts === 0 && held === 0,
    cohort, rows: reviewed, counts: {source_rows: rows.length, unique_rows: reviewed.length, duplicate_rows: duplicates,
      conflicting_rows: conflicts, held_rows: held}, totals_computed: false, metrics_allocated: false,
    provider_claim_verified: false, Shopify_last_touch_used_as_role: false, order_counts_used_as_product_units: false,
    canonical_scope_ready: false, persistable: false, publishable: false, Dataset_write_performed: false});
}
