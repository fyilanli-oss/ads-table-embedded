import {matchMerchantProductIdentity, merchantIdentityScopeContext} from "./google-product-identity-reader.server.js";
import {verifyShopifyProductCandidate} from "../shopify/product-identity-verification.server.js";
import {checkedCatalogSourceRule, extractShopifyCandidate} from "./catalog-shopify-candidate.server.js";

export class GoogleProductIdentityResolutionError extends Error {
  constructor(code) { super(code); this.name = "GoogleProductIdentityResolutionError"; this.code = code; }
}
function fail(code) { throw new GoogleProductIdentityResolutionError(code); }
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Dependencies and source rules come from trusted server composition, never browser input.
// No production source format rule is registered by this module.
export async function resolveGoogleProductIdentity({snapshot, lookup, context, loadSourceRule, signal} = {}) {
  if (typeof loadSourceRule !== "function") fail("GOOGLE_PRODUCT_IDENTITY_RULE_LOADER_REQUIRED");
  const scope = merchantIdentityScopeContext(snapshot?.scope);
  const selected = structuredClone(matchMerchantProductIdentity(snapshot, lookup));
  lookup = structuredClone(lookup);
  const shop = structuredClone(context?.shop), installation = structuredClone(context?.installation);
  const admin = typeof context?.admin?.graphql === "function"
    ? Object.freeze({graphql: context.admin.graphql.bind(context.admin)}) : null;
  if (shop?.authority !== "shopify_admin_verified" || installation?.authority !== "shopify_installation_verified"
    || installation.status !== "active" || scope.workspace_id !== installation.workspaceId
    || scope.installation_generation !== installation.installGeneration) fail("GOOGLE_PRODUCT_IDENTITY_SHOP_SCOPE_MISMATCH");
  const result = (state, reason, extra = {}) => freeze({version: "1.0.0", platform: "google_ads", state, reason,
    scope, lookup, source_record: selected.record, shopify_product_id: null, shopify_variant_id: null,
    provider_link_verified: false, authorizes_activation: false, mapping_write_performed: false,
    source_facts_changed: false, persistable: false, mapping: null, ...extra});
  if (selected.state !== "exact_source_record") return result(selected.state, "native_source_not_unique_or_observed");
  if (signal?.aborted) fail("GOOGLE_PRODUCT_IDENTITY_ABORTED");
  let rule;
  try { rule = structuredClone(await loadSourceRule(freeze({scope: structuredClone(scope),
    product_context: structuredClone(selected.record.product_context), shop_id: shop.shopId}))); }
  catch { fail("GOOGLE_PRODUCT_IDENTITY_RULE_READ_FAILED"); }
  if (signal?.aborted) fail("GOOGLE_PRODUCT_IDENTITY_ABORTED");
  rule = checkedCatalogSourceRule(rule, {scope, productContext: selected.record.product_context, shopId: shop.shopId},
    code => fail(`GOOGLE_PRODUCT_IDENTITY_${code}`));
  if (!rule) return result("unresolved", "verified_source_rule_required");
  const proposed = extractShopifyCandidate(selected.record.native_product_id, rule);
  if (!proposed) return result("unresolved", "native_id_does_not_match_verified_rule");
  const verified = await verifyShopifyProductCandidate({admin, shop, installation, ...proposed, signal});
  if (verified.state !== "candidate_verified_in_shop") return result(verified.state, verified.reason,
    {candidate: proposed, shopify_verification: verified});
  // This draft proves source-rule + same-shop identity only; Ads link and lifecycle are separate.
  const mapping = {platform: "google_ads", ...scope, native_product_id: selected.record.native_product_id,
    product_context: selected.record.product_context, shopify_product_id: verified.candidate.product_id,
    shopify_variant_id: verified.candidate.variant_id, mapping_state: "candidate_verified_source_and_shop",
    mapping_evidence: {source_rule: rule, source_record_key: selected.record.key, source_id_field: "offerId",
      source_id_value: selected.record.native_product_id, shopify: verified.evidence, shop_scope: verified.scope}};
  return result("candidate_verified_source_and_shop", "Ads_link_and_current_lifecycle_composition_still_required",
    {candidate: proposed, shopify_product_id: mapping.shopify_product_id,
      shopify_variant_id: mapping.shopify_variant_id, mapping});
}
