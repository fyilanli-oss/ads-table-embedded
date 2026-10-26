import assert from "node:assert/strict";
import test from "node:test";
import {readMerchantProductIdentitySnapshot, readMetaCatalogIdentitySnapshot, MERCHANT_PRODUCT_READ_SCOPE} from "../app/lib/providers/product-identity-readers.server.js";
import {resolveCatalogProductIdentity} from "../app/lib/providers/catalog-product-identity.server.js";

const base = {workspace_id: "12345678-1234-4234-8234-123456789abc", installation_id: "12",
  installation_generation: 2, provider_connection_id: "22345678-1234-4234-8234-123456789abc", platform_account_id: "123"};
const productId = "9007199254740993", variantId = "9007199254740995";
const nativeId = `shopify_US_${productId}_${variantId}`;
const resource = (type, id) => ({id: `gid://shopify/${type}/${id}`, legacyResourceId: id});
const response = payload => ({ok: true, json: async () => payload});
async function fixture(platform = "google_ads", id = nativeId) {
  const snapshot = platform === "google_ads" ? await readMerchantProductIdentitySnapshot({
    authority: {...base, platform, merchant_id: "456", granted_scopes: [MERCHANT_PRODUCT_READ_SCOPE]}, accessToken: "private",
    fetchFn: async () => response({products: [{name: "accounts/456/products/en~US~item", offerId: id,
      feedLabel: "US", contentLanguage: "en", dataSource: "accounts/456/dataSources/7"}]})})
    : await readMetaCatalogIdentitySnapshot({authority: {...base, platform, catalog_id: "789"},
      accessToken: "private", appSecret: "private-secret", fetchFn: async () => response({
        data: [{id: "999", retailer_id: id, product_catalog: {id: "789"}}]})});
  const calls = [];
  const context = {shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/123", myshopifyDomain: "example.myshopify.com"},
    installation: {workspaceId: base.workspace_id, installGeneration: 2, status: "active"},
    admin: {graphql: async (query, {variables}) => {
      calls.push({query, variables});
      return response({data: {shop: {id: "gid://shopify/Shop/123", myshopifyDomain: "example.myshopify.com"},
        ...(variables.productId ? {product: resource("Product", productId)} : {}),
        ...(variables.variantId ? {productVariant: {...resource("ProductVariant", variantId), product: resource("Product", productId)}} : {})}});
    }}};
  const lookup = platform === "google_ads" ? {merchantId: "456", feedLabel: "US", itemId: id}
    : {catalogId: "789", productId: "999", namespace: "catalog_product_id"};
  const sourceRule = {state: "verified_source_rule", source_reference: "synthetic-reviewed-source-rule-not-live-evidence",
    scope: snapshot.scope, product_context: snapshot.records[0].product_context,
    shop_id: context.shop.shopId, format: "shopify_market_product_variant", market: "US"};
  return {snapshot, lookup, context, sourceRule, calls};
}

test("structured Google and Meta IDs resolve only with a scoped source rule and Shopify parent proof", async () => {
  for (const platform of ["google_ads", "meta"]) {
    const f = await fixture(platform);
    const original = structuredClone(f.snapshot);
    const result = await resolveCatalogProductIdentity(f);
    assert.equal(result.state, "verified");
    assert.equal(result.shopify_product_id, `gid://shopify/Product/${productId}`);
    assert.equal(result.shopify_variant_id, `gid://shopify/ProductVariant/${variantId}`);
    assert.equal(f.calls.length, 1);
    assert.equal(result.mapping.mapping_evidence.source_id_field, platform === "google_ads" ? "offerId" : "retailer_id");
    assert.equal(result.mapping.native_product_id, platform === "google_ads" ? nativeId : "999");
    if (platform === "meta") assert.equal(result.mapping.product_context.identity_namespace, "catalog_product_id");
    assert.deepEqual(f.snapshot, original);
    assert.equal(result.mapping_write_performed, false);
    assert.equal(result.source_facts_changed, false);
  }
});

test("a matching prefix without source evidence never triggers Shopify or a mapping", async () => {
  const f = await fixture();
  for (const sourceRule of [null, {...f.sourceRule, state: "pending"}]) {
    const result = await resolveCatalogProductIdentity({...f, sourceRule});
    assert.equal(result.state, "unresolved");
    assert.equal(result.mapping, null);
    assert.equal(result.provider_link_verified, false);
  }
  assert.equal(f.calls.length, 0);
});

test("source rules cannot cross account, connection, shop, generation, language or data source", async () => {
  for (const patch of [{scope: {...base, platform: "google_ads", platform_account_id: "999"}},
    {scope: {...base, platform: "google_ads", provider_connection_id: "other"}},
    {scope: {...base, platform: "google_ads", installation_generation: 3}},
    {shop_id: "gid://shopify/Shop/999"}, {product_context: {merchant_id: "456"}},
    {product_context: {merchant_id: "456", feed_label: "US", content_language: "de", data_source: "accounts/456/dataSources/7"}},
    {source_reference: ""}, {token: "must-not-be-recorded"}]) {
    const f = await fixture();
    await assert.rejects(resolveCatalogProductIdentity({...f, sourceRule: {...f.sourceRule, ...patch}}), /CATALOG_IDENTITY_/);
    assert.equal(f.calls.length, 0);
  }
});

test("unknown IDs, zero variants and unsupported markets remain unresolved without fabricated IDs", async () => {
  for (const id of [`shopify_US_${productId}_0`, `shopify_TR_${productId}_${variantId}`, "SKU123", "shopify_US_01_2", "shopify_US_18446744073709551616_2"]) {
    const f = await fixture("google_ads", id);
    const result = await resolveCatalogProductIdentity(f);
    assert.equal(result.state, "unresolved");
    assert.equal(result.shopify_product_id, null);
    assert.equal(f.calls.length, 0);
  }
});

test("a numeric native ID has no assumed meaning; approved variant rules derive the Shopify parent", async () => {
  const f = await fixture("meta", variantId);
  assert.equal((await resolveCatalogProductIdentity(f)).state, "unresolved");
  assert.equal(f.calls.length, 0);
  const {market, ...sourceRule} = f.sourceRule;
  const result = await resolveCatalogProductIdentity({...f, sourceRule: {...sourceRule, format: "shopify_variant_id"}});
  assert.equal(result.state, "verified");
  assert.equal(result.shopify_product_id, `gid://shopify/Product/${productId}`);
  assert.deepEqual(f.calls[0].variables, {variantId: `gid://shopify/ProductVariant/${variantId}`});
  assert.doesNotMatch(f.calls[0].query, /\bproduct\(id:/);
});

test("approved product-only source IDs do not fabricate or request a variant", async () => {
  const f = await fixture("google_ads", productId);
  const {market, ...sourceRule} = f.sourceRule;
  const result = await resolveCatalogProductIdentity({...f, sourceRule: {...sourceRule, format: "shopify_product_id"}});
  assert.equal(result.state, "verified");
  assert.equal(result.shopify_variant_id, null);
  assert.deepEqual(f.calls[0].variables, {productId: `gid://shopify/Product/${productId}`});
});

test("wrong parent or missing Shopify variant preserves native identity with no mapping", async () => {
  for (const missing of [false, true]) {
    const f = await fixture();
    f.context.admin.graphql = async () => response({data: {shop: {id: "gid://shopify/Shop/123", myshopifyDomain: "example.myshopify.com"},
      product: resource("Product", productId), productVariant: missing ? null : {...resource("ProductVariant", variantId), product: resource("Product", "999")}}});
    const result = await resolveCatalogProductIdentity(f);
    assert.equal(result.state, missing ? "unresolved" : "conflicting");
    assert.equal(result.mapping, null);
    assert.equal(result.source_record.native_product_id, nativeId);
  }
});

test("Shopify failures are errors, never observed absence or a partial verified mapping", async () => {
  const f = await fixture();
  let calls = 0;
  f.context.admin.graphql = async () => {calls++; throw Error("private-error-body");};
  await assert.rejects(resolveCatalogProductIdentity(f), error => error.code === "SHOPIFY_PRODUCT_REQUEST_FAILED"
    && !error.message.includes("private"));
  assert.equal(calls, 1);
});

test("ambiguous Merchant language matches stop before source decoding or Shopify access", async () => {
  const f = await fixture();
  const snapshot = structuredClone(f.snapshot);
  snapshot.records.push({...structuredClone(snapshot.records[0]), product_context: {...snapshot.records[0].product_context, content_language: "de"}});
  assert.equal((await resolveCatalogProductIdentity({...f, snapshot})).state, "ambiguous");
  assert.equal(f.calls.length, 0);
});

test("variant-only absent and malformed parent responses cannot produce a mapping", async () => {
  for (const malformed of [false, true]) {
    const f = await fixture("meta", variantId);
    const {market, ...rule} = f.sourceRule;
    f.sourceRule = {...rule, format: "shopify_variant_id"};
    f.context.admin.graphql = async () => response({data: {
      shop: {id: "gid://shopify/Shop/123", myshopifyDomain: "example.myshopify.com"},
      productVariant: malformed ? {...resource("ProductVariant", variantId), product: {id: "gid://shopify/Product/1", legacyResourceId: "2"}} : null,
    }});
    if (malformed) await assert.rejects(resolveCatalogProductIdentity(f), /RESPONSE_ID_MISMATCH/);
    else {
      const result = await resolveCatalogProductIdentity(f);
      assert.equal(result.state, "unresolved");
      assert.equal(result.shopify_product_id, null);
      assert.equal(result.mapping, null);
    }
  }
});

test("Meta reader retains feed scope and a catalog-wide rule cannot silently cover a specific feed", async () => {
  const f = await fixture("meta");
  const snapshot = await readMetaCatalogIdentitySnapshot({authority: {...base, platform: "meta", catalog_id: "789"},
    accessToken: "private", appSecret: "private-secret", fetchFn: async () => response({data: [{id: "999", retailer_id: nativeId,
      product_catalog: {id: "789"}, product_feed: {id: "321"}}]})});
  assert.equal(snapshot.records[0].product_context.product_feed_id, "321");
  await assert.rejects(resolveCatalogProductIdentity({...f, snapshot}), /RULE_CONTEXT_MISMATCH/);
  assert.equal(f.calls.length, 0);
});
