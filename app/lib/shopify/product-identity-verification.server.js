import {normalizeShopDomain} from "./installation-authority.server.js";

export class ShopifyProductVerificationError extends Error {
  constructor(code) { super(code); this.name = "ShopifyProductVerificationError"; this.code = code; }
}
function fail(code) { throw new ShopifyProductVerificationError(code); }
function candidateId(value, type) {
  if (typeof value !== "string") fail("SHOPIFY_PRODUCT_CANDIDATE_INVALID");
  const prefix = `gid://shopify/${type}/`;
  const legacy = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (!/^[1-9][0-9]*$/.test(legacy)) fail("SHOPIFY_PRODUCT_CANDIDATE_INVALID");
  return {gid: prefix + legacy, legacy};
}
function checkedIdentity(value, type, expected) {
  const actual = candidateId(value?.id, type);
  if (actual.gid !== expected.gid || value.legacyResourceId !== expected.legacy) {
    fail("SHOPIFY_PRODUCT_RESPONSE_ID_MISMATCH");
  }
  return actual;
}

// Verifies a supplied candidate in the installed shop, NOT its provider linkage.
// Merchant/catalog candidate extraction and the Dataset writer remain separate.
export async function verifyShopifyProductCandidate({admin, shop, installation, productId, variantId = null}) {
  if (shop?.authority !== "shopify_admin_verified"
    || !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(shop?.shopId ?? "")
    || typeof shop.myshopifyDomain !== "string") fail("SHOPIFY_PRODUCT_SHOP_AUTHORITY_REQUIRED");
  const domain = normalizeShopDomain(shop.myshopifyDomain);
  if (installation?.status !== "active"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installation.workspaceId ?? "")
    || !Number.isSafeInteger(installation.installGeneration) || installation.installGeneration < 1) {
    fail("SHOPIFY_PRODUCT_INSTALLATION_REQUIRED");
  }
  if (!admin || typeof admin.graphql !== "function") fail("SHOPIFY_PRODUCT_ADMIN_REQUIRED");
  const product = candidateId(productId, "Product");
  const variant = variantId === null ? null : candidateId(variantId, "ProductVariant");
  const query = `#graphql
    query AdsTableVerifyProductCandidate($productId: ID!${variant ? ", $variantId: ID!" : ""}) {
      shop { id myshopifyDomain }
      product(id: $productId) { id legacyResourceId }
      ${variant ? `productVariant(id: $variantId) {
        id legacyResourceId product { id legacyResourceId }
      }` : ""}
    }`;
  let response;
  try {
    response = await admin.graphql(query, {variables: {productId: product.gid,
      ...(variant ? {variantId: variant.gid} : {})}});
  } catch { fail("SHOPIFY_PRODUCT_REQUEST_FAILED"); }
  if (!response?.ok) fail("SHOPIFY_PRODUCT_HTTP_FAILED");
  let body;
  try { body = await response.json(); } catch { fail("SHOPIFY_PRODUCT_JSON_INVALID"); }
  if (!body?.data || body.errors) fail("SHOPIFY_PRODUCT_GRAPHQL_FAILED");
  if (body.data.shop?.id !== shop.shopId || body.data.shop?.myshopifyDomain !== domain) {
    fail("SHOPIFY_PRODUCT_SHOP_MISMATCH");
  }
  const scope = Object.freeze({workspace_id: installation.workspaceId,
    installation_generation: installation.installGeneration, shop_id: shop.shopId, shop_domain: domain});
  const result = (state, reason) => Object.freeze({version: "1.0.0", scope, state, reason,
    candidate: Object.freeze({product_id: product.gid, variant_id: variant?.gid ?? null}),
    evidence: Object.freeze({product: body.data.product === null ? null : Object.freeze({...body.data.product}),
      variant: !variant || body.data.productVariant === null ? null : Object.freeze({
        id: body.data.productVariant.id, legacyResourceId: body.data.productVariant.legacyResourceId,
        product: Object.freeze({...body.data.productVariant.product}),
      })}),
    provider_link_verified: false, mapping_write_performed: false});
  // An absent key is malformed data; an explicit null is an observed no-match.
  if (!Object.hasOwn(body.data, "product")) fail("SHOPIFY_PRODUCT_SCHEMA_INVALID");
  if (body.data.product !== null) checkedIdentity(body.data.product, "Product", product);
  if (variant !== null) {
    if (!Object.hasOwn(body.data, "productVariant")) fail("SHOPIFY_PRODUCT_SCHEMA_INVALID");
    if (body.data.productVariant !== null) {
      checkedIdentity(body.data.productVariant, "ProductVariant", variant);
      const parent = body.data.productVariant.product;
      const parentId = candidateId(parent?.id, "Product");
      if (parent.legacyResourceId !== parentId.legacy) fail("SHOPIFY_PRODUCT_RESPONSE_ID_MISMATCH");
      if (parentId.gid !== product.gid) return result("conflicting", "variant_parent_mismatch");
    }
  }
  if (body.data.product === null || (variant !== null && body.data.productVariant === null)) {
    return result("unresolved", "candidate_not_observed");
  }
  return result("candidate_verified_in_shop", "provider_link_still_requires_source_evidence");
}
