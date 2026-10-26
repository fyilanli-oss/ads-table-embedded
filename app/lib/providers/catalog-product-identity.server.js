import {ProductIdentityReadError, matchMerchantProductIdentity, matchMetaCatalogProductIdentity} from "./product-identity-readers.server.js";
import {verifyShopifyProductCandidate} from "../shopify/product-identity-verification.server.js";

function fail(code) { throw new ProductIdentityReadError(code); }
function decimal(value) {
  return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value)
    && BigInt(value) <= 18446744073709551615n;
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// A source rule is trusted INTERNAL configuration backed by reviewed publisher
// evidence. A browser DTO, matching prefix, or a Gemini example is not authority.
// No production rule is registered here; neither provider guarantees these formats.
function checkedRule(rule, snapshot, record, context) {
  if (rule?.state !== "verified_source_rule") return null;
  const keys = ["state", "source_reference", "scope", "product_context", "shop_id", "format",
    ...(rule.format === "shopify_market_product_variant" ? ["market"] : [])];
  if (Object.keys(rule).length !== keys.length || keys.some(key => !Object.hasOwn(rule, key))
    || !rule.scope || Object.keys(rule.scope).length !== Object.keys(snapshot.scope).length) {
    fail("CATALOG_IDENTITY_RULE_SCHEMA_INVALID");
  }
  if (typeof rule.source_reference !== "string" || !rule.source_reference.trim()
    || rule.source_reference.length > 2048) fail("CATALOG_IDENTITY_RULE_EVIDENCE_REQUIRED");
  for (const key of ["workspace_id", "installation_id", "installation_generation", "provider_connection_id", "platform", "platform_account_id"]) {
    if (rule.scope?.[key] !== snapshot.scope[key]) fail("CATALOG_IDENTITY_RULE_SCOPE_MISMATCH");
  }
  const expected = record.product_context;
  if (!rule.product_context || Object.keys(rule.product_context).length !== Object.keys(expected).length
    || Object.keys(expected).some(key => rule.product_context[key] !== expected[key])) {
    fail("CATALOG_IDENTITY_RULE_CONTEXT_MISMATCH");
  }
  if (rule.shop_id !== context?.shop?.shopId
    || snapshot.scope.workspace_id !== context?.installation?.workspaceId
    || snapshot.scope.installation_generation !== context?.installation?.installGeneration) {
    fail("CATALOG_IDENTITY_SHOP_SCOPE_MISMATCH");
  }
  if (!["shopify_market_product_variant", "shopify_product_id", "shopify_variant_id"].includes(rule.format)) {
    fail("CATALOG_IDENTITY_RULE_FORMAT_INVALID");
  }
  if (rule.format === "shopify_market_product_variant" && !/^[A-Z]{2}$/.test(rule.market ?? "")) {
    fail("CATALOG_IDENTITY_RULE_MARKET_INVALID");
  }
  return rule;
}

function candidateFrom(nativeId, rule) {
  if (rule.format === "shopify_product_id") return decimal(nativeId) ? {productId: nativeId, variantId: null} : null;
  if (rule.format === "shopify_variant_id") return decimal(nativeId) ? {productId: null, variantId: nativeId} : null;
  const match = /^shopify_([A-Z]{2})_([1-9][0-9]*)_([1-9][0-9]*)$/.exec(nativeId);
  if (!match || match[1] !== rule.market || !decimal(match[2]) || !decimal(match[3])) return null;
  return {productId: match[2], variantId: match[3]};
}

// Resolve one native performance/sale identity without changing its metric or role.
// Callers must keep advertised and sold references separate; this never creates facts.
export async function resolveCatalogProductIdentity({snapshot, lookup, context, sourceRule = null}) {
  lookup = structuredClone(lookup);
  sourceRule = structuredClone(sourceRule);
  context = {...context, shop: structuredClone(context?.shop), installation: structuredClone(context?.installation)};
  const platform = snapshot?.scope?.platform;
  if (!["google_ads", "meta"].includes(platform)) fail("CATALOG_IDENTITY_PLATFORM_INVALID");
  // Resolve synchronously, then copy only the selected record before awaiting Shopify.
  // Do not clone the entire catalog for every product lookup.
  const match = structuredClone(platform === "google_ads" ? matchMerchantProductIdentity(snapshot, lookup)
    : matchMetaCatalogProductIdentity(snapshot, lookup));
  snapshot = {scope: structuredClone(snapshot.scope)};
  const result = (state, reason, extra = {}) => freeze({version: "1.0.0", platform, state, reason,
    lookup, source_record: match.record, shopify_product_id: null, shopify_variant_id: null,
    provider_link_verified: false, mapping: null, mapping_write_performed: false,
    source_facts_changed: false, ...extra});
  if (match.state !== "exact_source_record") return result(match.state, "native_source_not_unique_or_observed");
  const rule = checkedRule(sourceRule, snapshot, match.record, context);
  if (!rule) return result("unresolved", "verified_source_rule_required");
  // Meta internal catalog IDs are never parsed as Shopify IDs.
  const nativeId = platform === "google_ads" ? match.record.native_product_id : match.record.retailer_id;
  const candidate = candidateFrom(nativeId, rule);
  if (!candidate) return result("unresolved", "native_id_does_not_match_verified_rule");
  const verification = await verifyShopifyProductCandidate({...context, ...candidate});
  if (verification.state !== "candidate_verified_in_shop") {
    return result(verification.state, verification.reason, {candidate, shopify_verification: verification});
  }
  const mapping = {platform, workspace_id: snapshot.scope.workspace_id, installation_id: snapshot.scope.installation_id,
    installation_generation: snapshot.scope.installation_generation, provider_connection_id: snapshot.scope.provider_connection_id,
    platform_account_id: snapshot.scope.platform_account_id,
    native_product_id: platform === "google_ads" ? lookup.itemId : lookup.productId,
    product_context: {...match.record.product_context, ...(platform === "meta" ? {identity_namespace: lookup.namespace} : {})},
    shopify_product_id: verification.candidate.product_id, shopify_variant_id: verification.candidate.variant_id,
    mapping_state: "verified", mapping_evidence: {reader_version: "1.0.0", source_rule: rule,
      source_record_key: match.record.key, source_id_field: platform === "google_ads" ? "offerId" : "retailer_id",
      source_id_value: nativeId, source_record: match.record.source_record,
      shopify: verification.evidence, shop_scope: verification.scope}};
  return result("verified", "verified_source_rule_and_same_shop_identity", {
    candidate, shopify_product_id: mapping.shopify_product_id, shopify_variant_id: mapping.shopify_variant_id,
    provider_link_verified: true, mapping});
}
