// Pure candidate helpers. A recognized shape is never provider-link or source-rule proof.
export function exactIdentityContext(actual, expected) {
  return actual && typeof actual === "object" && !Array.isArray(actual)
    && Object.keys(actual).length === Object.keys(expected).length
    && Object.keys(expected).every(key => actual[key] === expected[key]);
}
export function checkedCatalogSourceRule(rule, {scope, productContext, shopId}, fail) {
  if (rule?.state !== "verified_source_rule") return null;
  const fields = ["state", "source_reference", "scope", "product_context", "shop_id", "format",
    ...(rule.format === "shopify_market_product_variant" ? ["market"] : [])];
  if (Object.keys(rule).length !== fields.length || fields.some(key => !Object.hasOwn(rule, key))
    || typeof rule.source_reference !== "string" || !rule.source_reference.trim()
    || rule.source_reference.length > 2048) fail("RULE_INVALID");
  if (!exactIdentityContext(rule.scope, scope) || !exactIdentityContext(rule.product_context, productContext)
    || rule.shop_id !== shopId) fail("RULE_CONTEXT_MISMATCH");
  if (!["shopify_product_id", "shopify_variant_id", "shopify_market_product_variant"].includes(rule.format)
    || (rule.format === "shopify_market_product_variant" && !/^[A-Z]{2}$/.test(rule.market ?? ""))) fail("RULE_FORMAT_INVALID");
  return rule;
}
function decimal(value) {
  return /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
}
export function extractShopifyCandidate(nativeId, rule) {
  if (typeof nativeId !== "string") return null;
  if (rule.format === "shopify_product_id") return decimal(nativeId) ? {productId: nativeId, variantId: null} : null;
  if (rule.format === "shopify_variant_id") return decimal(nativeId) ? {productId: null, variantId: nativeId} : null;
  if (rule.format !== "shopify_market_product_variant") return null;
  const parts = /^shopify_([A-Z]{2})_([1-9][0-9]{0,19})_([1-9][0-9]{0,19})$/.exec(nativeId);
  return parts && parts[1] === rule.market && decimal(parts[2]) && decimal(parts[3])
    ? {productId: parts[2], variantId: parts[3]} : null;
}
