import {META_GRAPH_VERSION} from "./meta-graph.server.js";
import {fetchMetaProductBreakdownInsightsPage, META_PRODUCT_BREAKDOWN_ID_LIMIT} from "./meta-reporting.server.js";
import {metaCandidateOwnerScope} from "./meta-source-candidates.server.js";
import {exactIdentityContext} from "./catalog-shopify-candidate.server.js";

// Neither SDK field availability nor a matching string proves the report namespace.
const REVIEWED_REPORT_RULES = Object.freeze([]), loaders = new WeakSet();
const REPORT = Object.freeze({source_family: "ad_product_breakdown_daily_insights", graph_version: META_GRAPH_VERSION});
export class MetaReportCandidateError extends Error {
  constructor(code) {super(code); this.name = "MetaReportCandidateError"; this.code = code;}
}
function fail(code) {throw new MetaReportCandidateError(code);}
function freeze(v) {if (v && typeof v === "object") {for (const x of Object.values(v)) freeze(x); Object.freeze(v);} return v;}
function id(v) {return typeof v === "string" && /^[1-9][0-9]{0,29}$/.test(v);}
function text(v) {return typeof v === "string" && v.length > 0 && v.length <= 8192 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);}
function day(v) {return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;}
export function metaIdentityReportWindow(v) {
  if (!day(v?.start) || !day(v?.end) || v.start > v.end) fail("META_REPORT_CANDIDATE_WINDOW_INVALID");
  return {start: v.start, end: v.end};
}
function targetOf(v) {
  const fields = ["ad_id", "adset_id", "campaign_id", "catalog_id"];
  if (!v || Object.keys(v).length !== fields.length || fields.some(k => !id(v[k]))) fail("META_REPORT_CANDIDATE_TARGET_INVALID");
  return Object.fromEntries(fields.map(k => [k, v[k]]));
}
function key(v) {return JSON.stringify([metaCandidateOwnerScope(v.scope), targetOf(v.target), REPORT]);}

// Reviewed server registry only, detached before any async work. No production rules registered.
export function createMetaReportIdentityRuleLoader({rules = REVIEWED_REPORT_RULES} = {}) {
  if (!Array.isArray(rules) || rules.length > 10000) fail("META_REPORT_CANDIDATE_RULES_INVALID");
  const registry = new Map();
  for (const input of rules) {
    const r = structuredClone(input), fields = ["state", "scope", "target", "report_context", "identity_namespace", "source_reference"];
    if (!r || Object.keys(r).length !== fields.length || fields.some(k => !Object.hasOwn(r, k))
      || r.state !== "verified_report_identity_rule" || !text(r.source_reference) || r.source_reference.length > 2048
      || !exactIdentityContext(r.report_context, REPORT)
      || !["catalog_product_id", "retailer_id"].includes(r.identity_namespace)) fail("META_REPORT_CANDIDATE_RULE_INVALID");
    const k = key(r); if (registry.has(k)) fail("META_REPORT_CANDIDATE_RULE_CONFLICT");
    registry.set(k, freeze(r));
  }
  const loader = Object.freeze({load(query) {return registry.get(key(query)) ?? null;}});
  loaders.add(loader); return loader;
}

// Reuse the existing complete product query unchanged, including all four converted fields.
// Transport/authority/time/quota controls are supplied by the concrete collector's bound fetch.
export async function readMetaIdentityProductReport({adAccountId, dateWindow, accessToken, appSecret, fetchFn,
  signal, maxPages = 100, maxRows = 10000} = {}) {
  const window = metaIdentityReportWindow(dateWindow);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000 || !Number.isSafeInteger(maxRows)
    || maxRows < 1 || maxRows > 100000 || typeof fetchFn !== "function"
    || typeof adAccountId !== "string" || !/^act_[1-9][0-9]{0,29}$/.test(adAccountId)) fail("META_REPORT_CANDIDATE_INPUT_INVALID");
  const reportFetch = async (...args) => {
    const response = await fetchFn(...args);
    return {ok: response?.ok, status: response?.status, headers: response?.headers, async json() {
      const body = await response.json();
      if (body && Object.hasOwn(body, "error")) fail("META_REPORT_CANDIDATE_NATIVE_ERROR");
      return body;
    }};
  };
  const rows = [], pageEvidence = [], seen = new Set(), keys = new Set(); let after = null, pages = 0;
  for (;;) {
    if (signal?.aborted) fail("META_REPORT_CANDIDATE_ABORTED");
    if (pages >= maxPages) fail("META_REPORT_CANDIDATE_PAGE_LIMIT");
    const page = await fetchMetaProductBreakdownInsightsPage({accessToken, appSecret, adAccountId,
      dateWindow: window, after, graphVersion: META_GRAPH_VERSION, fetchFn: reportFetch});
    pages++;
    pageEvidence.push({page_number: pages, provider_request_id: page.provider_request_id, evidence: structuredClone(page.evidence)});
    for (const value of page.rows) {
      const r = structuredClone(value);
      if (r.account_id !== adAccountId.slice(4) || ![r.ad_id, r.adset_id, r.campaign_id].every(id)
        || !text(r.product_id) || !day(r.date_start) || r.date_stop !== r.date_start
        || r.date_start < window.start || r.date_start > window.end) fail("META_REPORT_CANDIDATE_ROW_CONTEXT_INVALID");
      const k = JSON.stringify([r.account_id, r.ad_id, r.date_start, r.product_id]);
      if (keys.has(k)) fail("META_REPORT_CANDIDATE_DUPLICATE_ROW"); keys.add(k);
      if (rows.length >= maxRows) fail("META_REPORT_CANDIDATE_ROW_LIMIT"); rows.push(r);
    }
    if (page.next_cursor === null) break;
    if (seen.has(page.next_cursor)) fail("META_REPORT_CANDIDATE_CURSOR_REPEATED");
    seen.add(page.next_cursor); after = page.next_cursor;
  }
  if (signal?.aborted) fail("META_REPORT_CANDIDATE_ABORTED");
  return freeze({rows, pages, page_evidence: pageEvidence, date_window: window, report_context: REPORT, pagination_complete: true,
    product_id_limit: META_PRODUCT_BREAKDOWN_ID_LIMIT, exhaustive_product_coverage_proven: false,
    metrics_interpreted: false, publishable: false});
}

// Internal candidate references only; caller data is never installation or mapping authority.
export function attachMetaReportCandidateReferences({report, source, productCandidates, ownerScope, target, reportRules, signal} = {}) {
  const scope = metaCandidateOwnerScope(ownerScope), nativeTarget = targetOf(target);
  if (signal?.aborted) fail("META_REPORT_CANDIDATE_ABORTED");
  if (!loaders.has(reportRules) || report?.pagination_complete !== true || !Array.isArray(report.rows)
    || !exactIdentityContext(report.report_context, REPORT) || source?.complete !== true
    || source.context?.catalog_id !== nativeTarget.catalog_id || source.context?.graph_version !== META_GRAPH_VERSION
    || !Array.isArray(source.records) || !Array.isArray(productCandidates?.rows) || !Array.isArray(productCandidates.candidates)
    || !exactIdentityContext(productCandidates.candidate_scope, scope)) fail("META_REPORT_CANDIDATE_INPUT_INVALID");
  const resolutionByKey = new Map(productCandidates.rows.map(r => [r.source_record_key, r]));
  if (resolutionByKey.size !== productCandidates.rows.length || resolutionByKey.size !== source.records.length) fail("META_REPORT_CANDIDATE_SOURCE_INVALID");
  const rule = reportRules.load({scope, target: nativeTarget}), links = [];
  const window = metaIdentityReportWindow(report.date_window), nativeIndex = new Map(), sourceKeys = new Set();
  for (const r of source.records) {
    const resolved = resolutionByKey.get(r.key);
    if (sourceKeys.has(r.key) || r.key !== JSON.stringify([nativeTarget.catalog_id, r.catalog_product_id])
      || !id(r.catalog_product_id) || !text(r.retailer_id) || r.product_context?.catalog_id !== nativeTarget.catalog_id
      || r.source_record?.id !== r.catalog_product_id || r.source_record?.retailer_id !== r.retailer_id
      || r.source_record?.product_catalog?.id !== nativeTarget.catalog_id || !resolved
      || resolved.catalog_product_id !== r.catalog_product_id || resolved.retailer_id !== r.retailer_id
      || !exactIdentityContext(resolved.product_context, r.product_context)) fail("META_REPORT_CANDIDATE_SOURCE_INVALID");
    sourceKeys.add(r.key);
    if (rule !== null) {
      const k = r[rule.identity_namespace], matches = nativeIndex.get(k) ?? [];
      matches.push(r); nativeIndex.set(k, matches);
    }
  }
  const reportKeys = new Set();
  for (let index = 0; index < report.rows.length; index++) {
    const row = report.rows[index];
    if (row?.account_id !== scope.platform_account_id.slice(4) || ![row.ad_id, row.adset_id, row.campaign_id].every(id)
      || !text(row.product_id) || !day(row.date_start) || row.date_stop !== row.date_start
      || row.date_start < window.start || row.date_start > window.end) fail("META_REPORT_CANDIDATE_ROW_CONTEXT_INVALID");
    const reportKey = JSON.stringify([row.account_id, row.ad_id, row.date_start, row.product_id]);
    if (reportKeys.has(reportKey)) fail("META_REPORT_CANDIDATE_DUPLICATE_ROW"); reportKeys.add(reportKey);
    if (row.ad_id === nativeTarget.ad_id && (row.adset_id !== nativeTarget.adset_id || row.campaign_id !== nativeTarget.campaign_id)) fail("META_REPORT_CANDIDATE_HIERARCHY_CONFLICT");
    let state = "unresolved", reason = "verified_report_identity_rule_required", record = null, candidateIndex = null;
    if (row.ad_id !== nativeTarget.ad_id) reason = "outside_selected_Ad_catalog_observation";
    else if (rule !== null) {
      const matches = nativeIndex.get(row.product_id) ?? [];
      if (matches.length > 1) {state = "ambiguous"; reason = "multiple_native_catalog_records_for_verified_namespace";}
      else if (!matches.length) reason = "native_catalog_record_not_observed";
      else {
        record = matches[0]; const resolved = resolutionByKey.get(record.key);
        if (!resolved || resolved.catalog_product_id !== record.catalog_product_id || resolved.retailer_id !== record.retailer_id) fail("META_REPORT_CANDIDATE_SOURCE_INVALID");
        const verification = resolved.product_identity_verification;
        state = verification.state; reason = verification.reason;
        if (verification.candidate_index !== null) {
          const c = productCandidates.candidates[verification.candidate_index];
          if (!Number.isSafeInteger(verification.candidate_index) || verification.candidate_index < 0
            || c?.catalog_product_id !== record.catalog_product_id || c?.retailer_id !== record.retailer_id
            || c?.candidate_evidence?.source_record_key !== record.key || c?.candidate_state !== "candidate_verified_source_and_shop"
            || verification.state !== "candidate_verified_in_shop"
            || !exactIdentityContext(c.product_context, record.product_context)) fail("META_REPORT_CANDIDATE_SOURCE_INVALID");
          candidateIndex = verification.candidate_index; state = "catalog_candidate_reference";
          reason = "reviewed_report_namespace_and_catalog_Shopify_candidate_linked_not_canonical_mapping";
        }
      }
    }
    links.push({report_row_index: index, provider_product_id: row.product_id, ad_id: row.ad_id,
      business_date: row.date_start, state, reason, identity_namespace: row.ad_id === nativeTarget.ad_id ? rule?.identity_namespace ?? null : null,
      source_record_key: record?.key ?? null, candidate_index: candidateIndex, standardized_product_id: null,
      report_identity_rule: row.ad_id === nativeTarget.ad_id ? rule : null});
  }
  return freeze({links, candidate_scope: scope, target: nativeTarget, report_context: REPORT,
    report_namespace_registered_by_default: false, publishable: false, canonical_scope_ready: false,
    provider_link_verified: false, persistable: false, mapping_write_performed: false,
    authorizes_activation: false, sales_role_assigned: false});
}
