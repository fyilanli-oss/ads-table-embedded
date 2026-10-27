import {createIdentityRuntimeAuthorityLoader} from "./identity-runtime-authority.server.js";
import {inspectMetaAccessToken, META_GRAPH_VERSION} from "./meta-graph.server.js";
import {readMetaAdCatalogSourceReference} from "./meta-adset-catalog-reference.server.js";
import {readMetaCatalogSourceSnapshot} from "./meta-catalog-identity-reader.server.js";
import {quotaBoundaryControl} from "../refresh/quota-native-fetch.server.js";
import {createMetaCandidateSourceRuleLoader, verifyMetaCatalogSourceCandidates} from "./meta-source-candidates.server.js";
import {createMetaReportIdentityRuleLoader, readMetaIdentityProductReport, attachMetaReportCandidateReferences,
  metaIdentityReportWindow} from "./meta-report-candidates.server.js";

export class MetaIdentityCollectionError extends Error {
  constructor(code) {super(code); this.name = "MetaIdentityCollectionError"; this.code = code;}
}
function fail(code) {throw new MetaIdentityCollectionError(code);}
function freeze(value) {
  if (value && typeof value === "object") {for (const v of Object.values(value)) freeze(v); Object.freeze(value);}
  return value;
}
function nodeId(value) {return typeof value === "string" && /^[1-9][0-9]{0,29}$/.test(value);}

// Target IDs are not authority: native Ad/account/parent/creative/catalog observations must agree.
// Prepared server collection only; no browser-supplied authority or loadCurrent override.
async function collectMetaIdentitySource({verified, database, tokenVault, adId, adSetId, campaignId, catalogId,
  config, fetchFn = fetch, now = () => new Date(), signal, maxPages = 100, maxRows = 10000, maxElapsedMs = 120000,
  sourceRules, withShopify, withReport, dateWindow, reportIdentityRules, maxReportPages = 100, maxReportRows = 10000} = {}) {
  if (![adId, adSetId, campaignId, catalogId].every(nodeId) || config?.graphVersion !== META_GRAPH_VERSION
    || !nodeId(config?.appId) || typeof config?.appSecret !== "string" || !config.appSecret || config.appSecret.length > 512
    || typeof fetchFn !== "function" || typeof now !== "function" || ![maxPages, maxRows, maxElapsedMs].every(Number.isSafeInteger)
    || maxPages < 1 || maxPages > 1000 || maxRows < 1 || maxRows > 100000
    || maxElapsedMs < 1 || maxElapsedMs > 600000) fail("META_IDENTITY_COLLECTION_INPUT_INVALID");
  config = Object.freeze({appId: config.appId, appSecret: config.appSecret, graphVersion: config.graphVersion});
  const loader = createIdentityRuntimeAuthorityLoader({verified, database, tokenVault, provider: "meta", now, signal});
  const rules = withShopify ? createMetaCandidateSourceRuleLoader({rules: sourceRules}) : null;
  const reportRules = withReport ? createMetaReportIdentityRuleLoader({rules: reportIdentityRules}) : null;
  const reportWindow = withReport ? metaIdentityReportWindow(dateWindow) : null;
  if (withReport && (!Number.isSafeInteger(maxReportPages) || maxReportPages < 1 || maxReportPages > 1000
    || !Number.isSafeInteger(maxReportRows) || maxReportRows < 1 || maxReportRows > 100000)) fail("META_IDENTITY_REPORT_LIMIT_INVALID");
  const nativeGraphql = withShopify ? verified.context.admin.graphql.bind(verified.context.admin) : null;
  let current, permission = null, nativeQuotaControl = null;
  function clock() {
    const t = now(); if (!(t instanceof Date) || !Number.isFinite(t.valueOf())) fail("META_IDENTITY_TIME_INVALID");
    return t.valueOf();
  }
  const started = clock();
  function check() {
    if (signal?.aborted) fail("META_IDENTITY_ABORTED");
    const time = clock(); if (time < started || time - started > maxElapsedMs) fail("META_IDENTITY_OBSERVATION_STALE");
    if (permission !== null && Date.parse(permission.expiresAt) <= time) fail("META_IDENTITY_NATIVE_PERMISSION_EXPIRED");
  }
  async function recheck() {
    check(); current = await loader.loadCurrent(); check();
    if (!/^act_[1-9][0-9]{0,29}$/.test(current.account.id)) fail("META_IDENTITY_ACCOUNT_INVALID");
  }
  const boundFetch = async (endpoint, init) => {
    await recheck(); let response;
    try {response = await fetchFn(endpoint, {...init, redirect: "error", signal});}
    catch (error) {if (quotaBoundaryControl(error)) nativeQuotaControl = error; throw error;}
    check();
    return {ok: response?.ok, status: response?.status, headers: response?.headers, async json() {
      const body = await response.json(); check(); await recheck(); return body;
    }};
  };
  try {
    await recheck();
    permission = await inspectMetaAccessToken({config, accessToken: current.tokenSet.access_token,
      permissionProfile: "identity_v1", fetchFn: boundFetch, now});
    check(); await recheck();
    const target = {accountId: current.account.id, adId, adSetId, campaignId, catalogId,
      grantedScopes: permission.scopes, accessToken: current.tokenSet.access_token, appSecret: config.appSecret, fetchFn: boundFetch, signal};
    const before = await readMetaAdCatalogSourceReference(target);
    if (before.state !== "confirmed") fail("META_IDENTITY_CATALOG_REFERENCE_NOT_CONFIRMED");
    await recheck();
    const source = await readMetaCatalogSourceSnapshot({...target, maxPages, maxRows});
    await recheck();
    let productCandidates = null;
    if (withShopify) {
      const admin = {async graphql(query, options) {
        await recheck(); let response;
        try {response = await nativeGraphql(query, {...options, tries: 1, signal});}
        catch (error) {if (quotaBoundaryControl(error)) nativeQuotaControl = error; throw error;}
        check();
        return {ok: response?.ok, status: response?.status, async json() {
          const body = await response.json(); check(); await recheck(); return body;
        }};
      }};
      productCandidates = await verifyMetaCatalogSourceCandidates({source, ownerScope: {
        workspace_id: current.installation.workspaceId, installation_generation: current.installation.installGeneration,
        provider_connection_id: current.connectionId, platform: "meta", platform_account_id: current.account.id},
      context: {installation: current.installation, shop: current.shop, admin}, sourceRules: rules, signal, maxRows});
      await recheck();
    }
    let report = null, reportLinks = null;
    if (withReport) {
      report = await readMetaIdentityProductReport({adAccountId: current.account.id, dateWindow: reportWindow,
        accessToken: current.tokenSet.access_token, appSecret: config.appSecret, fetchFn: boundFetch,
        signal, maxPages: maxReportPages, maxRows: maxReportRows});
      await recheck();
      reportLinks = attachMetaReportCandidateReferences({report, source, productCandidates,
        ownerScope: {workspace_id: current.installation.workspaceId, installation_generation: current.installation.installGeneration,
          provider_connection_id: current.connectionId, platform: "meta", platform_account_id: current.account.id},
        target: {ad_id: adId, adset_id: adSetId, campaign_id: campaignId, catalog_id: catalogId}, reportRules, signal});
    }
    const after = await readMetaAdCatalogSourceReference(target);
    if (after.state !== "confirmed" || JSON.stringify(before.evidence) !== JSON.stringify(after.evidence)) fail("META_IDENTITY_CATALOG_REFERENCE_CHANGED");
    await recheck();
    return freeze({provider: "meta", source: withReport ? "native_Ad_catalog_Shopify_candidate_and_product_report_collection"
      : withShopify ? "native_Ad_catalog_and_Shopify_candidate_collection" : "native_token_Ad_catalog_and_product_collection",
      account_id: current.account.id, connection_id: current.connectionId, connection_version: current.connectionVersion,
      installation: current.installation, shop: current.shop, native_source: source,
      ...(withShopify ? {product_identity_candidates: productCandidates} : {}),
      ...(withReport ? {native_product_report: report, product_report_candidate_links: reportLinks} : {}),
      link_evidence: {before, after, permission, started_at: new Date(started).toISOString(), completed_at: new Date(clock()).toISOString()},
      provider_link_verified: true, relationship_scope: "current_ad_parent_and_observed_creative_catalog_references_only",
      proves_product_delivery_or_Insights_namespace: false, installation_id: null, canonical_scope_ready: false,
      shopify_mapping_state: "not_resolved", persistable: false, authorizes_activation: false, mapping_write_performed: false,
      remaining: ["trusted_installation_primary_key_and_Ads_selection_epoch_reads", "real_Meta_Insights_identity_namespace_evidence_and_reviewed_rule_registration",
        "real_retailer_source_format_evidence_and_reviewed_rule_registration",
        ...(withShopify ? [] : ["Shopify_candidate_verification_composition"]), "quota_dispatch_and_prewrite_controls"]});
  } catch (error) {
    if (nativeQuotaControl !== null) throw nativeQuotaControl;
    if (quotaBoundaryControl(error)) throw error;
    if (error instanceof MetaIdentityCollectionError) throw error;
    fail(signal?.aborted ? "META_IDENTITY_ABORTED" : "META_IDENTITY_COLLECTION_FAILED");
  }
}

// Mode is server-owned. Supplying caller flags to the native-only entry cannot enable parsing.
export function collectMetaNativeIdentityEvidence(options = {}) {
  return collectMetaIdentitySource({...options, withShopify: false, withReport: false});
}
export function collectMetaVerifiedProductCandidateEvidence(options = {}) {
  return collectMetaIdentitySource({...options, withShopify: true, withReport: false});
}
export function collectMetaReportProductCandidateEvidence(options = {}) {
  return collectMetaIdentitySource({...options, withShopify: true, withReport: true});
}
