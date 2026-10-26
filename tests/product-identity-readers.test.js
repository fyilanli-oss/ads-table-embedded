import assert from "node:assert/strict";
import test from "node:test";
import {readMerchantProductIdentitySnapshot, readMetaCatalogIdentitySnapshot,
  matchMerchantProductIdentity, matchMetaCatalogProductIdentity,
  MERCHANT_PRODUCT_READ_SCOPE} from "../app/lib/providers/product-identity-readers.server.js";
import {verifyShopifyProductCandidate} from "../app/lib/shopify/product-identity-verification.server.js";

const scope = {workspace_id: "12345678-1234-4234-8234-123456789abc", installation_id: "9007199254740993",
  installation_generation: 2, provider_connection_id: "22345678-1234-4234-8234-123456789abc", platform_account_id: "123"};
const merchant = {...scope, platform: "google_ads", merchant_id: "456", granted_scopes: [MERCHANT_PRODUCT_READ_SCOPE]};
const meta = {...scope, platform: "meta", catalog_id: "789"};
const token = "private-test-token";
const response = body => ({ok: true, status: 200, json: async () => body});
const product = (id = "native_1", language = "en") => ({name: `accounts/456/products/${language}~US~${id}`,
  offerId: id, feedLabel: "US", contentLanguage: language, dataSource: "accounts/456/dataSources/7",
  productAttributes: {itemGroupId: "not-a-shopify-id"}, customAttributes: []});
const catalogProduct = (id = "1") => ({id, retailer_id: `native_${id}`, product_catalog: {id: "789"},
  retailer_product_group_id: "not-a-shopify-id"});
const readMerchant = args => readMerchantProductIdentitySnapshot({authority: merchant, accessToken: token, ...args});
const readMeta = args => readMetaCatalogIdentitySnapshot({authority: meta, accessToken: token, appSecret: "private-test-secret", ...args});

test("Merchant reads complete scoped pages, preserves raw IDs and does not infer Shopify IDs", async () => {
  const calls = [];
  const snapshot = await readMerchant({fetchFn: async (url, options) => {
    calls.push({url: new URL(url), options});
    return response(calls.length === 1 ? {products: [product()], nextPageToken: "cursor/2"} : {products: [product("native_2")]});
  }});
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.searchParams.get("pageToken"), "cursor/2");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${token}`);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(snapshot.scope.installation_id, "9007199254740993");
  assert.equal(snapshot.records[0].source_record.productAttributes.itemGroupId, "not-a-shopify-id");
  assert.equal(snapshot.shopify_mapping_state, "not_resolved");
  assert.ok(Object.isFrozen(snapshot.records[0].source_record.productAttributes));
  assert.ok(!JSON.stringify(snapshot).includes(token));
  const match = matchMerchantProductIdentity(snapshot, {merchantId: "456", feedLabel: "US", itemId: "native_1"});
  assert.equal(match.state, "exact_source_record");
  assert.equal(match.provider_link_verified, false);
});

test("Merchant lookup cannot collapse language variants or cross feed/account boundaries", async () => {
  const snapshot = await readMerchant({fetchFn: async () => response({products: [product(), product("native_1", "de")]})});
  assert.equal(matchMerchantProductIdentity(snapshot, {merchantId: "456", feedLabel: "US", itemId: "native_1"}).state, "ambiguous");
  assert.equal(matchMerchantProductIdentity(snapshot, {merchantId: "456", feedLabel: "GB", itemId: "native_1"}).state, "unresolved");
  assert.throws(() => matchMerchantProductIdentity(snapshot, {merchantId: "999", feedLabel: "US", itemId: "native_1"}), /ACCOUNT_MISMATCH/);
  assert.throws(() => matchMerchantProductIdentity({...snapshot, complete: false}, {}), /COMPLETE_SNAPSHOT_REQUIRED/);
});

test("Merchant missing scope or malformed authority causes zero HTTP calls", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return response({}); };
  for (const authority of [{...merchant, granted_scopes: ["https://www.googleapis.com/auth/adwords"]},
    {...merchant, installation_id: 9007199254740992}, {...merchant, platform: "meta"},
    {...merchant, installation_id: "9223372036854775808"}, {...merchant, workspace_id: "bad"}]) {
    await assert.rejects(readMerchant({authority, fetchFn}));
  }
  assert.equal(calls, 0);
});

test("Merchant rejects wrong account, malformed source and duplicate encoded identity", async () => {
  for (const products of [[{...product(), name: "accounts/999/products/en~US~native_1"}],
    [{...product(), dataSource: "accounts/999/dataSources/7"}],
    [product(), {...product(), name: "accounts/456/products/ZW5-VVN-bmF0aXZlXzE"}],
    [{...product(), offerId: 42}]]) {
    await assert.rejects(readMerchant({fetchFn: async () => response({products})}));
  }
});

test("Merchant late-page HTTP failure throws once without partial snapshot or leaked errors", async () => {
  let calls = 0;
  await assert.rejects(readMerchant({fetchFn: async () => {
    calls++;
    if (calls === 1) return response({products: [product()], nextPageToken: "second"});
    return {ok: false, status: 403, json: async () => { throw new Error(token); }};
  }}), error => error.code === "IDENTITY_HTTP_FAILED" && error.status === 403 && !JSON.stringify(error).includes(token));
  assert.equal(calls, 2);
});

test("Readers reject partial paging, repeated cursors, row limits and disguised errors", async () => {
  await assert.rejects(readMerchant({maxPages: 1, fetchFn: async () => response({nextPageToken: "again"})}), /PAGE_LIMIT/);
  let calls = 0;
  await assert.rejects(readMerchant({fetchFn: async () => {calls++; return response({nextPageToken: "again"});}}), /CURSOR_REPEATED/);
  assert.equal(calls, 2);
  await assert.rejects(readMerchant({maxRows: 1, fetchFn: async () => response({products: [product(), product("2")]})}), /ROW_LIMIT/);
  await assert.rejects(readMerchant({fetchFn: async () => response({error: {message: token}})}), /RESPONSE_INVALID/);
  await assert.rejects(readMerchant({fetchFn: async () => {throw new Error(token);}}), error => error.message === "IDENTITY_TRANSPORT_FAILED");
  await assert.rejects(readMerchant({fetchFn: async () => ({ok: true, json: async () => {throw new Error(token);}})}), /JSON_INVALID/);
  const empty = await readMerchant({fetchFn: async () => response({})});
  assert.equal(empty.complete, true);
  assert.deepEqual(empty.records, []);
  await assert.rejects(readMerchant({fetchFn: async () => response({products: null})}), /SCHEMA_INVALID/);
});

test("Meta reconstructs bounded paging on fixed Graph origin and retains both ID namespaces", async () => {
  const calls = [];
  const snapshot = await readMeta({fetchFn: async (url, options) => {
    calls.push({url: new URL(url), options});
    return response(calls.length === 1 ? {data: [catalogProduct()], paging: {next: "https://hostile.invalid/steal", cursors: {after: "after/2"}}}
      : {data: [catalogProduct("2")], paging: {cursors: {after: "last"}}});
  }});
  assert.equal(calls[1].url.origin, "https://graph.facebook.com");
  assert.equal(calls[1].url.pathname, "/v26.0/789/products");
  assert.equal(calls[1].url.searchParams.get("after"), "after/2");
  assert.ok(calls[0].url.searchParams.get("appsecret_proof"));
  assert.equal(calls[0].url.searchParams.get("access_token"), null);
  assert.equal(calls[0].options.headers.authorization, `Bearer ${token}`);
  assert.equal(snapshot.records[0].catalog_product_id, "1");
  assert.equal(snapshot.records[0].retailer_id, "native_1");
  assert.ok(!JSON.stringify(snapshot).includes(token));
  assert.ok(!JSON.stringify(snapshot).includes("appsecret_proof"));
  assert.equal(matchMetaCatalogProductIdentity(snapshot, {catalogId: "789", productId: "native_1", namespace: "retailer_id"}).state, "exact_source_record");
  assert.equal(matchMetaCatalogProductIdentity(snapshot, {catalogId: "789", productId: "native_1", namespace: "catalog_product_id"}).state, "unresolved");
  assert.throws(() => matchMetaCatalogProductIdentity(snapshot, {catalogId: "789", productId: "1"}), /NAMESPACE_REQUIRED/);
  assert.throws(() => matchMetaCatalogProductIdentity(snapshot, {catalogId: "999", productId: "1", namespace: "catalog_product_id"}), /CATALOG_MISMATCH/);
});

test("Meta rejects catalog drift, duplicate IDs, missing paging evidence and HTTP-200 Graph errors", async () => {
  for (const payload of [{data: [{...catalogProduct(), product_catalog: {id: "999"}}]},
    {data: [catalogProduct(), catalogProduct()]}, {data: [], paging: {next: "https://hostile.invalid"}},
    {data: [], error: {code: 190, message: token}}, {data: null}]) {
    await assert.rejects(readMeta({fetchFn: async () => response(payload)}));
  }
  let calls = 0;
  await assert.rejects(readMeta({fetchFn: async () => {calls++; return {ok: false, status: 429};}}), /HTTP_FAILED/);
  assert.equal(calls, 1);
});

const shop = {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/123", myshopifyDomain: "fixture.myshopify.com"};
const installation = {workspaceId: scope.workspace_id, installGeneration: 2, status: "active"};
const productId = "9007199254740993", variantId = "9007199254740995";
const identity = (type, id) => ({id: `gid://shopify/${type}/${id}`, legacyResourceId: id});
const shopData = () => ({shop: {id: shop.shopId, myshopifyDomain: shop.myshopifyDomain},
  product: identity("Product", productId), productVariant: {...identity("ProductVariant", variantId), product: identity("Product", productId)}});
const verify = args => verifyShopifyProductCandidate({shop, installation, productId, variantId, ...args});

test("Shopify verifies exact text IDs and variant parent without declaring provider mapping", async () => {
  let variables;
  const verified = await verify({admin: {graphql: async (_query, options) => {variables = options.variables; return response({data: shopData()});}}});
  assert.equal(variables.productId, `gid://shopify/Product/${productId}`);
  assert.equal(variables.variantId, `gid://shopify/ProductVariant/${variantId}`);
  assert.equal(verified.state, "candidate_verified_in_shop");
  assert.equal(verified.scope.workspace_id, scope.workspace_id);
  assert.equal(verified.evidence.variant.product.id, `gid://shopify/Product/${productId}`);
  assert.equal(verified.evidence.product.legacyResourceId, productId);
  assert.equal(verified.provider_link_verified, false);
  assert.equal(verified.mapping_write_performed, false);
});

test("Shopify product-only verification never fabricates a variant request", async () => {
  const result = await verify({variantId: null, admin: {graphql: async (query, options) => {
    assert.ok(!query.includes("productVariant"));
    assert.ok(!Object.hasOwn(options.variables, "variantId"));
    const data = shopData(); delete data.productVariant;
    return response({data});
  }}});
  assert.equal(result.state, "candidate_verified_in_shop");
  assert.equal(result.candidate.variant_id, null);
});

test("Shopify wrong shop or partial GraphQL errors cannot validate a candidate", async () => {
  for (const body of [{data: {...shopData(), shop: {id: "gid://shopify/Shop/999", myshopifyDomain: shop.myshopifyDomain}}},
    {data: {...shopData(), shop: {id: shop.shopId, myshopifyDomain: "other.myshopify.com"}}},
    {data: shopData(), errors: [{message: token}]}, {data: {shop: shopData().shop}}]) {
    await assert.rejects(verify({admin: {graphql: async () => response(body)}}));
  }
});

test("Shopify distinguishes absent candidate, conflicting parent and malformed legacy ID", async () => {
  const absent = await verify({admin: {graphql: async () => response({data: {...shopData(), product: null, productVariant: null}})}});
  assert.equal(absent.state, "unresolved");
  const conflict = await verify({admin: {graphql: async () => response({data: {...shopData(),
    productVariant: {...shopData().productVariant, product: identity("Product", "42")}}})}});
  assert.equal(conflict.state, "conflicting");
  await assert.rejects(verify({admin: {graphql: async () => response({data: {...shopData(),
    product: {...shopData().product, legacyResourceId: 9007199254740992}}})}}), /RESPONSE_ID_MISMATCH/);
});

test("Shopify malformed authority or numeric candidate causes zero requests; HTTP failure is not absence", async () => {
  let calls = 0;
  const admin = {graphql: async () => {calls++; return response({data: shopData()});}};
  for (const args of [{productId: 42}, {variantId: "gid://shopify/Product/42"}, {shop: {...shop, authority: "unverified"}},
    {installation: {...installation, status: "inactive"}}, {installation: {...installation, installGeneration: 0}}]) {
    await assert.rejects(verify({admin, ...args}));
  }
  assert.equal(calls, 0);
  await assert.rejects(verify({admin: {graphql: async () => {calls++; return {ok: false, status: 403};}}}), /HTTP_FAILED/);
  assert.equal(calls, 1);
  await assert.rejects(verify({admin: {graphql: async () => {throw new Error(token);}}}), error => error.message === "SHOPIFY_PRODUCT_REQUEST_FAILED");
});
