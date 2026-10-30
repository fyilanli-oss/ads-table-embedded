import {createHash, randomUUID} from "node:crypto";
import {stableJson} from "./common-adapter.server.js";
import {META_PD_METRIC_SOURCES} from "./meta-reporting.server.js";
import {normalizeKlaviyoReportRow} from "./klaviyo-reporting.server.js";

const BINDING = ["workspace_id", "installation_id", "installation_generation", "provider", "provider_connection_id",
  "connection_version", "reporting_selection_epoch", "platform_account_id", "canonical_reporting_account_id", "business_date",
  "source_timezone", "source_currency", "job_or_run_id", "claim_fence"];
const hash = v => createHash("sha256").update(stableJson(v)).digest("hex");
const same = (a, b) => stableJson(a) === stableJson(b);
const text = v => typeof v === "string" && v.length > 0 && v.length < 2048 && v === v.trim();
const days = v => /^(0|[1-9][0-9]{0,3})$/.test(String(v ?? ""));
const knownEnum = v => text(v) && /^[A-Z][A-Z_]+$/.test(v) && !["UNKNOWN", "UNSPECIFIED"].includes(v);
const ref = v => `sha256:${hash(v)}`;
function copy(v) {return v === null || typeof v !== "object" ? v : Object.freeze(Array.isArray(v) ? v.map(copy)
  : Object.fromEntries(Object.entries(v).map(([k, value]) => [k, copy(value)])));}

function accountMatches(account, context) {
  return account?.id === context.platform_account_id && account.currency === context.source_currency && account.timezone === context.source_timezone;
}
function googleSettings(native, context) {
  const rows = native?.account?.rows;
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const c = rows[0].customer;
  const account = {id: c?.id, currency: c?.currencyCode, timezone: c?.timeZone};
  if (!accountMatches(account, context) || !Array.isArray(native.actions?.rows)) return null;
  const actions = [];
  const seen = new Set();
  for (const row of native.actions.rows) {
    const a = row.conversionAction;
    if (!/^customers\/[0-9]+\/conversionActions\/[0-9]+$/.test(a?.resourceName ?? "") || seen.has(a.resourceName)
      || !["ADD_TO_CART", "BEGIN_CHECKOUT", "PURCHASE"].includes(a.category)
      || !/^customers\/[0-9]+$/.test(a.ownerCustomer ?? "") || !knownEnum(a.attributionModelSettings?.attributionModel)
      || !knownEnum(a.countingType) || !days(a.clickThroughLookbackWindowDays) || !days(a.viewThroughLookbackWindowDays)) return null;
    seen.add(a.resourceName);
    actions.push({resource: a.resourceName, owner: a.ownerCustomer, category: a.category,
      model: a.attributionModelSettings.attributionModel, counting: a.countingType,
      click_days: Number(a.clickThroughLookbackWindowDays), view_days: Number(a.viewThroughLookbackWindowDays)});
  }
  return {account, actions: actions.sort((a, b) => a.resource.localeCompare(b.resource))};
}

/** Native read-time metadata only. No current setting is a proof of a historical
 * configuration or transactionally stable provider snapshot. No FX/target choice.
 */
export function preparePdNativeMetadata({sourceContext: context, evidence} = {}) {
  const units = {registry: "pd-native-units-v1", provider: context?.provider, source_currency: context?.source_currency,
    fields: context?.provider === "meta" ? META_PD_METRIC_SOURCES : context?.provider === "google_ads"
      ? {performance: ["impressions", "clicks", "costMicros"], cost_divisor: 1000000,
        conversions: ["conversions", "conversionsValue"], count: "fractional_allowed", conversion_scope: "normal"}
      : {impression: "delivered", click: "clicks", count: "conversions", value: "conversion_value", spend: "not_requested"}};
  const blocked = reason => copy({status: "blocked", reason, units, entries: [], composition_context: null,
    persistable: false, publishable: false});
  if (!context || BINDING.some(k => context[k] === undefined) || evidence?.provider !== context.provider) return blocked("native_metadata_scope_missing");
  const binding = Object.fromEntries(BINDING.map(k => [k, context[k]]));
  let attribution;
  if (context.provider === "google_ads") {
    const before = googleSettings(evidence.native_metadata?.before, context), after = googleSettings(evidence.native_metadata?.after, context);
    if (!before || !after) return blocked("native_conversion_settings_or_account_missing");
    if (!same(before, after)) return blocked("native_settings_changed_during_read");
    const actions = new Map(before.actions.map(a => [a.resource, a]));
    for (const row of evidence.results?.conversions?.rows ?? []) {
      if (actions.get(row.segments?.conversionAction)?.category !== row.segments?.conversionActionCategory) return blocked("conversion_action_metadata_coverage_missing");
    }
    attribution = {kind: "native_conversion_actions", conversion_scope: "normal", settings: before,
      consistency: "equal_before_after_observations_not_transactional"};
  } else if (context.provider === "klaviyo") {
    const before = evidence.native_metadata?.before?.account, after = evidence.native_metadata?.after?.account;
    if (!accountMatches(before, context) || !accountMatches(after, context)) return blocked("native_account_metadata_missing_or_conflicting");
    if (!same(before, after)) return blocked("native_settings_changed_during_read");
    // Owner-approved reference policy, NOT an observation of this account's
    // attribution configuration. Native provider sales/claims remain unchanged.
    attribution = {kind: "documented_default_reference", policy_version: "klaviyo-email-default-v1",
      source: "official_documented_default", account_settings_verified: false,
      model: "last_touch", channels: {email: {click_days: 5, open_days: 5}},
      other_channels: "not_modelled", exclusions: "not_verified",
      source_document: "https://help.klaviyo.com/hc/en-us/articles/11118357030555",
      checked_on: "2026-10-30", usage: "comparison_reference_only_no_sales_or_claim_recalculation"};
  } else if (context.provider === "meta") {
    const request = evidence.channel?.evidence;
    if (request?.action_report_time !== "impression" || request.use_unified_attribution_setting !== true
      || !request.requested_fields?.includes("attribution_setting") || !request.requested_fields.includes("account_currency")) return blocked("native_report_settings_not_explicit");
    for (const row of evidence.channel.rows) {
      if (!text(row.attribution_setting) || /^(unknown|unspecified|none|default|unavailable|not set|-)$/i.test(row.attribution_setting)) return blocked("native_attribution_setting_not_returned");
      if (row.account_currency !== context.source_currency) return blocked("native_account_currency_mismatch");
    }
    attribution = {kind: "native_insights_per_ad", request: {action_report_time: "impression", use_unified_attribution_setting: true}};
  } else return blocked("native_provider_not_supported");
  const composition_attempt_id = randomUUID(), snapshot_id = ref({binding, evidence});
  const metric_units_fingerprint = hash(units), references = {attribution: ref(attribution), metric_units: ref(units)};
  const composition_context = {binding, flow: evidence.flow, conversion_scope: "normal", reporting_time_basis: context.provider === "klaviyo" ? "send_date" : "interaction_date",
    composition_attempt_id, snapshot_id, metric_units_fingerprint, attribution_fingerprint: hash(attribution), references};
  const entries = [];
  if (context.provider === "meta") for (const row of evidence.channel.rows) {
    const settings = {...attribution, setting: row.attribution_setting};
    const scope = {...binding, flow: "ads", entity_type: "ad", entity_id: row.ad_id,
      ancestors: [{entity_type: "campaign", entity_id: row.campaign_id}, {entity_type: "adset", entity_id: row.adset_id}],
      conversion_scope: "normal", reporting_time_basis: "impression_date", composition_attempt_id, snapshot_id,
      metric_units_fingerprint, attribution_fingerprint: hash(settings), completeness: "complete", bounded: true};
    const entity = {root_entity_type: "campaign", root_entity_id: row.campaign_id, root_entity_name: row.campaign_name,
      parent_entity_type: "adset", parent_entity_id: row.adset_id, parent_entity_name: row.adset_name,
      entity_type: "ad", entity_id: row.ad_id, entity_name: row.ad_name};
    entries.push({scope, entity, metadata_references: {attribution: ref({settings, ad_id: row.ad_id, adset_id: row.adset_id}), metric_units: ref(units)}});
  }
  const composition_contexts = context.provider === "klaviyo" ? Object.fromEntries(["campaign", "flow"]
    .map(flow => [flow, {...composition_context, flow, attribution_reference: attribution}])) : null;
  return copy({status: "prepared", reason: null, units, attribution, composition_context, composition_contexts, entries,
    persistable: false, publishable: false});
}

/** Replace only source-derived metadata. Currency/FX and reporting preference
 * stay explicit caller-owned inputs to the existing later bridge gate.
 */
export function bindNativePdRecordMetadata({prepared, composition, evidence, sourceContext, supplied} = {}) {
  if (prepared.status !== "prepared") return null;
  const sources = sourceContext.provider === "meta" ? prepared.entries : (composition?.rows ?? []).map(fact => {
    const s = fact.scope, rows = fact.source_projections.flatMap(p => p.rows);
    if (sourceContext.provider === "klaviyo") {
      const native = rows.map(row => normalizeKlaviyoReportRow(s.flow, row));
      const message = native.find(r => text(r.channel_name)), parent = native.find(r => text(r.source_entity_name));
      return {scope: s, metadata_references: fact.source_execution.metadata_references,
        entity: {root_entity_type: s.flow, root_entity_id: s.ancestors[0].entity_id,
          root_entity_name: parent?.source_entity_name, parent_entity_type: s.flow,
          parent_entity_id: s.ancestors[0].entity_id, parent_entity_name: parent?.source_entity_name,
          entity_type: s.entity_type, entity_id: s.entity_id, entity_name: message?.channel_name}};
    }
    const row = rows.find(r => text(r.campaign?.name));
    const parent = s.ancestors.at(-1);
    return {scope: s, metadata_references: fact.source_execution.metadata_references,
      entity: {campaign_type: s.flow === "retail_pmax" ? "performance_max" : "standard",
        root_entity_type: "campaign", root_entity_id: s.ancestors[0].entity_id, root_entity_name: row?.campaign?.name,
        parent_entity_type: parent.entity_type === "ad_group" ? "adgroup" : parent.entity_type,
        parent_entity_id: parent.entity_id, parent_entity_name: s.flow === "search" ? row?.adGroup?.name : row?.campaign?.name,
        entity_type: s.entity_type, entity_id: s.entity_id,
        entity_name: s.flow === "search" ? row?.adGroupAd?.ad?.name : s.flow === "shopping" ? row?.adGroup?.name : row?.assetGroup?.name}};
  });
  const trusted = supplied?.binding && BINDING.every(k => same(supplied.binding[k], sourceContext[k]));
  const entryKey = s => stableJson([s?.flow, s?.entity_type, s?.entity_id]);
  const provided = new Map();
  if (trusted) for (const e of supplied.entries ?? []) {
    const key = entryKey(e.scope);
    if (provided.has(key)) return null;
    provided.set(key, e);
  }
  return copy({binding: prepared.composition_context.binding, expected_target_currency: trusted ? supplied.expected_target_currency : null,
    entries: sources.map(({scope, entity, metadata_references}) => {
      const fx = provided.get(entryKey(scope))?.enrichment;
      return {scope, metadata_references, enrichment: {scope, entity,
        currency: fx?.currency ?? null, fx_for_business_date: fx?.fx_for_business_date ?? null,
        time: {source_timezone: scope.source_timezone, business_date: scope.business_date, time_engine_version: "native-business-day-v1"},
        references: {entity: ref(entity), time: ref([scope.source_timezone, scope.business_date]), fx: fx?.references?.fx ?? null,
          reporting_currency: fx?.references?.reporting_currency ?? null},
        provenance: {source_system: sourceContext.provider, adapter_version: "pd-native-metadata-v1", source_confidence: sourceContext.provider === "klaviyo" ? "fallback" : "real", synthetic: false,
          ...(sourceContext.provider === "klaviyo" ? {attribution_source: prepared.attribution.source, account_attribution_verified: false} : {})}}};
    })});
}
