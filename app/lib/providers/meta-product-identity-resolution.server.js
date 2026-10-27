import {matchMetaCatalogProductIdentity, metaCatalogIdentityScopeContext} from "./meta-catalog-identity-reader.server.js";
import {checkedCatalogSourceRule, exactIdentityContext, extractShopifyCandidate} from "./catalog-shopify-candidate.server.js";
import {verifyShopifyProductCandidate} from "../shopify/product-identity-verification.server.js";
import {META_GRAPH_VERSION} from "./meta-graph.server.js";

export class MetaProductIdentityResolutionError extends Error {
  constructor(code) { super(code); this.name = "MetaProductIdentityResolutionError"; this.code = code; }
}
function fail(code) { throw new MetaProductIdentityResolutionError(code); }
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function reference(value) { return typeof value === "string" && value.trim().length > 0 && value.length <= 2048; }

// Both loaders are trusted server dependencies. No report namespace or source-format rule is registered here.
export async function resolveMetaProductIdentity({snapshot, lookup, reportContext, context,
  loadReportIdentityRule, loadSourceRule, signal} = {}) {
  if (typeof loadReportIdentityRule !== "function" || typeof loadSourceRule !== "function") fail("META_PRODUCT_IDENTITY_RULE_LOADERS_REQUIRED");
  const scope = metaCatalogIdentityScopeContext(snapshot?.scope);
  lookup = structuredClone(lookup); reportContext = structuredClone(reportContext);
  if (!lookup || !["catalog_product_id", "retailer_id"].includes(lookup.namespace)
    || typeof lookup.productId !== "string" || !lookup.productId || lookup.catalogId !== snapshot?.context?.catalog_id
    || !/^[1-9][0-9]{0,29}$/.test(lookup.catalogId ?? "") || snapshot.complete !== true
    || snapshot.context.graph_version !== META_GRAPH_VERSION
    || reportContext?.source_family !== "ad_product_breakdown_daily_insights"
    || reportContext.graph_version !== snapshot.context.graph_version || !reference(reportContext.source_reference)) fail("META_PRODUCT_IDENTITY_REPORT_CONTEXT_INVALID");
  // Copy only the selected native record before awaiting either trusted rule loader.
  const selected = structuredClone(matchMetaCatalogProductIdentity(snapshot, lookup));
  const shop = structuredClone(context?.shop), installation = structuredClone(context?.installation);
  const admin = typeof context?.admin?.graphql === "function" ? Object.freeze({graphql: context.admin.graphql.bind(context.admin)}) : null;
  if (shop?.authority !== "shopify_admin_verified" || installation?.authority !== "shopify_installation_verified"
    || installation.status !== "active" || scope.workspace_id !== installation.workspaceId
    || scope.installation_generation !== installation.installGeneration) fail("META_PRODUCT_IDENTITY_SHOP_SCOPE_MISMATCH");
  const result = (state, reason, extra = {}) => freeze({version: "1.0.0", platform: "meta", state, reason, scope,
    lookup, report_context: reportContext, source_record: selected.record, shopify_product_id: null, shopify_variant_id: null,
    provider_link_verified: false, authorizes_activation: false, mapping_write_performed: false,
    source_facts_changed: false, persistable: false, mapping: null, ...extra});
  if (signal?.aborted) fail("META_PRODUCT_IDENTITY_ABORTED");
  const reportShape = {source_family: reportContext.source_family, graph_version: reportContext.graph_version};
  let reportRule;
  try { reportRule = structuredClone(await loadReportIdentityRule(freeze({scope: structuredClone(scope),
    report_context: {...reportShape}, catalog_id: lookup.catalogId, identity_namespace: lookup.namespace}))); }
  catch { fail("META_PRODUCT_IDENTITY_REPORT_RULE_READ_FAILED"); }
  if (signal?.aborted) fail("META_PRODUCT_IDENTITY_ABORTED");
  if (reportRule?.state !== "verified_report_identity_rule") return result("unresolved", "verified_report_identity_rule_required");
  const fields = ["state", "source_reference", "scope", "report_context", "catalog_id", "identity_namespace"];
  if (Object.keys(reportRule).length !== fields.length || fields.some(key => !Object.hasOwn(reportRule, key))
    || !reference(reportRule.source_reference)) fail("META_PRODUCT_IDENTITY_REPORT_RULE_INVALID");
  if (!exactIdentityContext(reportRule.scope, scope) || !exactIdentityContext(reportRule.report_context, reportShape)
    || reportRule.catalog_id !== lookup.catalogId || reportRule.identity_namespace !== lookup.namespace) fail("META_PRODUCT_IDENTITY_REPORT_RULE_CONTEXT_MISMATCH");
  if (selected.state !== "exact_source_record") return result(selected.state, "native_source_not_unique_or_observed");
  let sourceRule;
  try { sourceRule = structuredClone(await loadSourceRule(freeze({scope: structuredClone(scope),
    product_context: structuredClone(selected.record.product_context), shop_id: shop.shopId}))); }
  catch { fail("META_PRODUCT_IDENTITY_SOURCE_RULE_READ_FAILED"); }
  if (signal?.aborted) fail("META_PRODUCT_IDENTITY_ABORTED");
  sourceRule = checkedCatalogSourceRule(sourceRule, {scope, productContext: selected.record.product_context, shopId: shop.shopId},
    code => fail(`META_PRODUCT_IDENTITY_SOURCE_${code}`));
  if (!sourceRule) return result("unresolved", "verified_source_rule_required");
  // Only retailer_id is a source-format candidate. Meta's internal catalog ID is never parsed.
  const proposed = extractShopifyCandidate(selected.record.retailer_id, sourceRule);
  if (!proposed) return result("unresolved", "retailer_id_does_not_match_verified_rule");
  const verified = await verifyShopifyProductCandidate({admin, shop, installation, ...proposed, signal});
  if (verified.state !== "candidate_verified_in_shop") return result(verified.state, verified.reason,
    {candidate: proposed, shopify_verification: verified});
  const mapping = {...scope, native_product_id: lookup.productId,
    product_context: {...selected.record.product_context, identity_namespace: lookup.namespace},
    shopify_product_id: verified.candidate.product_id, shopify_variant_id: verified.candidate.variant_id,
    mapping_state: "candidate_verified_source_and_shop", mapping_evidence: {report_identity_rule: reportRule,
      source_rule: sourceRule, report_context: reportContext, source_record_key: selected.record.key,
      source_id_field: "retailer_id", source_id_value: selected.record.retailer_id,
      shopify: verified.evidence, shop_scope: verified.scope}};
  return result("candidate_verified_source_and_shop", "Ad_catalog_link_and_current_lifecycle_composition_still_required",
    {candidate: proposed, shopify_product_id: mapping.shopify_product_id, shopify_variant_id: mapping.shopify_variant_id, mapping});
}
