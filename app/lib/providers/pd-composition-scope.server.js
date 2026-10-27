import {stableJson} from "./common-adapter.server.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const FLOWS = {
  meta: {ads: "ad"},
  google_ads: {search: "ad", shopping: "ad_group", retail_pmax: "asset_group"},
  klaviyo: {campaign: "campaign_message", flow: "flow_message"},
};
const ANCESTORS = {
  ad: {meta: ["campaign", "adset"], google_ads: ["campaign", "ad_group"]},
  ad_group: {google_ads: ["campaign"]},
  asset_group: {google_ads: ["campaign"]},
  campaign_message: {klaviyo: ["campaign"]},
  flow_message: {klaviyo: ["flow"]},
};
const FIELDS = Object.freeze([
  "workspace_id", "installation_id", "installation_generation",
  "provider", "provider_connection_id", "platform_account_id", "canonical_reporting_account_id",
  "flow", "entity_type", "entity_id", "ancestors",
  "business_date", "source_timezone", "reporting_time_basis",
  "source_currency", "metric_units_fingerprint", "attribution_fingerprint", "conversion_scope",
  "job_or_run_id", "composition_attempt_id", "snapshot_id",
]);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.length > 0 && value === value.trim();

function invalidField(scope) {
  if (!record(scope)) return "scope";
  for (const field of ["workspace_id", "provider_connection_id", "composition_attempt_id"]) {
    if (!UUID.test(scope[field] ?? "")) return field;
  }
  if (typeof scope.installation_id !== "string" || !/^[1-9][0-9]{0,18}$/.test(scope.installation_id) ||
      BigInt(scope.installation_id) > 9223372036854775807n) return "installation_id";
  if (!Number.isSafeInteger(scope.installation_generation) || scope.installation_generation < 1) return "installation_generation";
  if (!Object.hasOwn(FLOWS, scope.provider)) return "provider";
  if (!Object.hasOwn(FLOWS[scope.provider], scope.flow)) return "flow";
  if (FLOWS[scope.provider][scope.flow] !== scope.entity_type) return "entity_type";
  for (const field of ["platform_account_id", "entity_id", "reporting_time_basis", "job_or_run_id", "snapshot_id"]) {
    if (!text(scope[field])) return field;
  }
  if (scope.provider === "klaviyo") {
    if (scope.canonical_reporting_account_id !== null) return "canonical_reporting_account_id";
  } else if (!text(scope.canonical_reporting_account_id)) return "canonical_reporting_account_id";
  const types = ANCESTORS[scope.entity_type][scope.provider];
  if (!Array.isArray(scope.ancestors) || scope.ancestors.length !== types.length ||
      scope.ancestors.some((ancestor, index) => !record(ancestor) || ancestor.entity_type !== types[index] || !text(ancestor.entity_id))) return "ancestors";
  if (typeof scope.business_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scope.business_date) ||
      !Number.isFinite(Date.parse(scope.business_date)) ||
      new Date(scope.business_date).toISOString().slice(0, 10) !== scope.business_date) return "business_date";
  if (!text(scope.source_timezone)) return "source_timezone";
  try { new Intl.DateTimeFormat("en", {timeZone: scope.source_timezone}); }
  catch { return "source_timezone"; }
  if (typeof scope.source_currency !== "string" || !/^[A-Z]{3}$/.test(scope.source_currency)) return "source_currency";
  for (const field of ["metric_units_fingerprint", "attribution_fingerprint"]) {
    if (typeof scope[field] !== "string" || !HASH.test(scope[field])) return field;
  }
  if (!["normal", "all"].includes(scope.conversion_scope)) return "conversion_scope";
  if (scope.completeness !== "complete") return "completeness";
  if (scope.bounded !== true) return "bounded";
  return null;
}

function reject(reason, sourceIndex, field) {
  // Rejection details contain no account IDs, source records or supplied metadata values.
  return Object.freeze({compatible: false, reason, source_index: sourceIndex, field, publishable: false});
}

/** Compare declared source scopes before composition. This does not verify native evidence,
 * metric ownership/coverage, FX, sales roles or canonical rows and never authorizes publication.
 * The expected scope must come from the orchestrator, not be selected from the first source.
 */
export function checkPdCompositionCompatibility(expected, sources) {
  const invalidExpected = invalidField(expected);
  if (invalidExpected) return reject("invalid_expected_scope", null, invalidExpected);
  if (!Array.isArray(sources) || sources.length === 0) return reject("missing_sources", null, "sources");
  const references = new Set();
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!record(source) || !text(source.source_family) || !text(source.source_reference)) {
      return reject("invalid_source_reference", index, "source_reference");
    }
    const invalid = invalidField(source.scope);
    if (invalid) return reject("invalid_source_scope", index, invalid);
    const reference = stableJson([source.source_family, source.source_reference]);
    if (references.has(reference)) return reject("duplicate_source_reference", index, "source_reference");
    references.add(reference);
    for (const field of FIELDS) {
      const identityValue = scope => field === "ancestors"
        ? scope.ancestors.map(({entity_type, entity_id}) => ({entity_type, entity_id}))
        : scope[field];
      if (stableJson(identityValue(expected)) !== stableJson(identityValue(source.scope))) {
        return reject("incompatible_scope", index, field);
      }
    }
  }
  return Object.freeze({compatible: true, reason: null, source_index: null, field: null, publishable: false});
}
