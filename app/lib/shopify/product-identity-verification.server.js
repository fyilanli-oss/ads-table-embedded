import {normalizeShopDomain} from "./installation-authority.server.js";

export class ShopifyProductVerificationError extends Error {
  constructor(code) { super(code); this.name = "ShopifyProductVerificationError"; this.code = code; }
}
function fail(code) { throw new ShopifyProductVerificationError(code); }
const verificationEvidence = new WeakMap();
const observations = new WeakSet();
// Only a genuine completed verifier result can expose this allowlisted observation.
// It proves the observed same-shop response, never a provider mapping or source rule.
export function shopifyProductVerificationEvidence(result) {
  const evidence = verificationEvidence.get(result);
  if (!evidence) fail("SHOPIFY_PRODUCT_OBSERVATION_REQUIRED");
  return evidence;
}
export function bindShopifyProductVerification(evidence, owner) {
  if (!observations.has(evidence) || evidence.scope.workspace_id !== owner.workspaceId
    || String(evidence.scope.installation_generation) !== owner.generation
    || evidence.scope.shop_id !== owner.shopId || evidence.scope.shop_domain !== owner.shopDomain)
    fail("SHOPIFY_PRODUCT_OBSERVATION_OWNER_MISMATCH");
  return evidence;
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function candidateId(value, type) {
  if (typeof value !== "string") fail("SHOPIFY_PRODUCT_CANDIDATE_INVALID");
  const prefix = `gid://shopify/${type}/`, legacy = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (!/^[1-9][0-9]{0,19}$/.test(legacy) || BigInt(legacy) > 18446744073709551615n) fail("SHOPIFY_PRODUCT_CANDIDATE_INVALID");
  return {gid: prefix + legacy, legacy};
}
function identity(value, type, expected = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("SHOPIFY_PRODUCT_SCHEMA_INVALID");
  const actual = candidateId(value.id, type);
  if (value.id !== actual.gid || value.legacyResourceId !== actual.legacy
    || (expected !== null && actual.gid !== expected.gid)) fail("SHOPIFY_PRODUCT_RESPONSE_ID_MISMATCH");
  return actual;
}

// Fixed existing read shapes shared with the inactive HTTP quota classifier.
export const SHOPIFY_PRODUCT_CANDIDATE_QUERIES = Object.freeze(Object.fromEntries([
  ["identity_product",true,false],["identity_variant",false,true],["identity_product_variant",true,true],
].map(([family,productRequested,variant])=>[family,`#graphql
    query AdsTableVerifyProductCandidate(${productRequested ? "$productId: ID!" : "$variantId: ID!"}${productRequested && variant ? ", $variantId: ID!" : ""}) {
      shop { id myshopifyDomain }
      ${productRequested ? "product(id: $productId) { id legacyResourceId }" : ""}
      ${variant ? "productVariant(id: $variantId) { id legacyResourceId product { id legacyResourceId } }" : ""}
    }`])));

// Same-shop existence and parent verification only. This does not prove a provider mapping.
export async function verifyShopifyProductCandidate({admin, shop, installation,
  productId = null, variantId = null, signal} = {}) {
  shop = structuredClone(shop); installation = structuredClone(installation);
  if (shop?.authority !== "shopify_admin_verified"
    || !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(shop?.shopId ?? "")) fail("SHOPIFY_PRODUCT_SHOP_AUTHORITY_REQUIRED");
  const domain = normalizeShopDomain(shop.myshopifyDomain);
  if (installation?.authority !== "shopify_installation_verified" || installation.status !== "active"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installation.workspaceId ?? "")
    || !Number.isSafeInteger(installation.installGeneration) || installation.installGeneration < 1) fail("SHOPIFY_PRODUCT_INSTALLATION_REQUIRED");
  if (typeof admin?.graphql !== "function") fail("SHOPIFY_PRODUCT_ADMIN_REQUIRED");
  if (productId === null && variantId === null) fail("SHOPIFY_PRODUCT_CANDIDATE_REQUIRED");
  let product = productId === null ? null : candidateId(productId, "Product");
  const variant = variantId === null ? null : candidateId(variantId, "ProductVariant");
  const productRequested = product !== null;
  const query = SHOPIFY_PRODUCT_CANDIDATE_QUERIES[productRequested ? variant ? "identity_product_variant" : "identity_product" : "identity_variant"];
  const variables = {...(product ? {productId: product.gid} : {}), ...(variant ? {variantId: variant.gid} : {})};
  const requested = {...variables};
  if (signal?.aborted) fail("SHOPIFY_PRODUCT_ABORTED");
  let response, body;
  try {
    response = await admin.graphql(query, {variables, tries: 1, signal});
    if (!response?.ok || typeof response.json !== "function") fail("SHOPIFY_PRODUCT_HTTP_FAILED");
    body = await response.json();
  } catch { fail(signal?.aborted ? "SHOPIFY_PRODUCT_ABORTED" : "SHOPIFY_PRODUCT_READ_FAILED"); }
  if (signal?.aborted) fail("SHOPIFY_PRODUCT_ABORTED");
  if (!body || typeof body !== "object" || Array.isArray(body)
    || (Object.hasOwn(body, "errors") && (!Array.isArray(body.errors) || body.errors.length > 0))
    || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) fail("SHOPIFY_PRODUCT_GRAPHQL_FAILED");
  const data = body.data;
  if (data.shop?.id !== shop.shopId || data.shop?.myshopifyDomain !== domain) fail("SHOPIFY_PRODUCT_SHOP_MISMATCH");
  if ((productRequested && !Object.hasOwn(data, "product"))
    || (variant && !Object.hasOwn(data, "productVariant"))) fail("SHOPIFY_PRODUCT_SCHEMA_INVALID");
  if (productRequested && data.product !== null) identity(data.product, "Product", product);
  let parent = null;
  if (variant && data.productVariant !== null) {
    identity(data.productVariant, "ProductVariant", variant);
    parent = identity(data.productVariant.product, "Product");
    if (product === null) product = parent;
  }
  const result = (state, reason) => {
    const value = freeze({version: "1.0.0", state, reason,
    scope: {workspace_id: installation.workspaceId, installation_generation: installation.installGeneration,
      shop_id: shop.shopId, shop_domain: domain},
    candidate: {product_id: product?.gid ?? null, variant_id: variant?.gid ?? null},
    evidence: {product: productRequested && data.product !== null ? {id: data.product.id, legacyResourceId: data.product.legacyResourceId} : null,
      variant: variant && data.productVariant !== null ? {id: data.productVariant.id,
        legacyResourceId: data.productVariant.legacyResourceId,
        product: {id: parent.gid, legacyResourceId: parent.legacy}} : null},
    provider_link_verified: false, authorizes_activation: false, mapping_write_performed: false});
    const observation = freeze({schemaVersion: "shopify-product-verification-v1",
      scope: {...value.scope}, request: requested,
      response: {shop: {id: data.shop.id, myshopifyDomain: data.shop.myshopifyDomain},
        product: productRequested ? data.product === null ? {state: "null"} : {state: "observed", ...value.evidence.product} : {state: "not_requested"},
        variant: variant ? data.productVariant === null ? {state: "null"} : {state: "observed", ...value.evidence.variant} : {state: "not_requested"}},
      outcome: {state, reason}, providerMappingVerified: false});
    observations.add(observation);
    verificationEvidence.set(value, observation);
    return value;
  };
  if (parent && parent.gid !== product.gid) return result("conflicting", "variant_parent_mismatch");
  if ((productRequested && data.product === null) || (variant && data.productVariant === null)) {
    return result("unresolved", "candidate_not_observed");
  }
  return result("candidate_verified_in_shop", "provider_source_rule_and_link_still_required");
}
