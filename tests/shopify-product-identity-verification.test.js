import test from "node:test";
import assert from "node:assert/strict";
import {verifyShopifyProductCandidate as verify} from "../app/lib/shopify/product-identity-verification.server.js";
import {resolveGoogleProductIdentity as resolve} from "../app/lib/providers/google-product-identity-resolution.server.js";
import {readMerchantProductIdentitySnapshot} from "../app/lib/providers/google-product-identity-reader.server.js";
import {GOOGLE_MERCHANT_OAUTH_SCOPE} from "../app/lib/oauth/oauth-permission-profile.server.js";

const gid = (type, id) => `gid://shopify/${type}/${id}`;
const native = (type, id) => ({id: gid(type, id), legacyResourceId: id});
const shop = {authority: "shopify_admin_verified", shopId: gid("Shop", "1"), myshopifyDomain: "example.myshopify.com"};
const installation = {authority: "shopify_installation_verified", status: "active",
  workspaceId: "11111111-1111-4111-8111-111111111111", installGeneration: 2};
const authority = {workspace_id: installation.workspaceId, installation_id: "12", installation_generation: 2,
  provider_connection_id: "22222222-2222-4222-8222-222222222222", platform: "google_ads",
  platform_account_id: "1234567890", merchant_id: "123", granted_scopes: [GOOGLE_MERCHANT_OAUTH_SCOPE]};
function fixture(data = {product: native("Product", "10"), productVariant: {...native("ProductVariant", "20"), product: native("Product", "10")}}) {
  const calls = [];
  return {calls, options: {shop: structuredClone(shop), installation: structuredClone(installation),
    productId: "10", variantId: "20", admin: {graphql: async (...args) => {
      calls.push(args); return {ok: true, json: async () => ({data: {shop: {id: shop.shopId, myshopifyDomain: shop.myshopifyDomain}, ...data}})};
    }}}};
}
async function source(offerId = "shopify_US_10_20", products) {
  return readMerchantProductIdentitySnapshot({authority, accessToken: "synthetic-token", fetchFn: async () => ({ok: true,
    json: async () => ({products: products ?? [{name: `accounts/123/products/en~US~${offerId}`, offerId,
      contentLanguage: "en", feedLabel: "US", dataSource: "accounts/123/dataSources/7"}]})})});
}
function rule(snapshot, overrides = {}) {
  return {state: "verified_source_rule", source_reference: "synthetic-reviewed-source-rule",
    scope: structuredClone(snapshot.scope), product_context: structuredClone(snapshot.records[0].product_context),
    shop_id: shop.shopId, format: "shopify_market_product_variant", market: "US", ...overrides};
}
function resolver(snapshot, f, loadSourceRule = async () => rule(snapshot)) {
  return {snapshot, lookup: {merchantId: "123", feedLabel: "US", itemId: snapshot.records[0]?.native_product_id ?? "missing"},
    context: f.options, loadSourceRule};
}

test("checks product, variant and parent in one request with tries 1 and only identity fields", async () => {
  const f = fixture(), result = await verify(f.options);
  assert.equal(result.state, "candidate_verified_in_shop"); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0][1].variables, {productId: gid("Product", "10"), variantId: gid("ProductVariant", "20")});
  assert.equal(f.calls[0][1].tries, 1); assert.match(f.calls[0][0], /shop \{ id myshopifyDomain \}/);
  assert.equal(result.candidate.product_id, gid("Product", "10"));
  assert.equal(result.provider_link_verified, false); assert.equal(result.mapping_write_performed, false);
  assert.equal(result.authorizes_activation, false); assert.ok(Object.isFrozen(result.evidence.variant.product));
});
test("product-only query does not request all variants; variant-only derives its parent", async () => {
  const p = fixture({product: native("Product", "10")});
  const product = await verify({...p.options, variantId: null});
  assert.equal(product.candidate.variant_id, null); assert.doesNotMatch(p.calls[0][0], /productVariant/);
  const v = fixture({productVariant: {...native("ProductVariant", "20"), product: native("Product", "10")}});
  const variant = await verify({...v.options, productId: null});
  assert.equal(variant.candidate.product_id, gid("Product", "10"));
  assert.deepEqual(v.calls[0][1].variables, {variantId: gid("ProductVariant", "20")});
});
test("canonical GIDs accepted and full unsigned int64 precision preserved", async () => {
  const id = "18446744073709551615", f = fixture({product: native("Product", id)});
  const result = await verify({...f.options, productId: gid("Product", id), variantId: null});
  assert.equal(result.candidate.product_id, gid("Product", id));
});
test("explicit null is unresolved for product or variant, including variant-only no-match", async () => {
  for (const [data, overrides] of [
    [{product: null}, {variantId: null}],
    [{product: native("Product", "10"), productVariant: null}, {}],
    [{productVariant: null}, {productId: null}],
  ]) {
    const f = fixture(data), result = await verify({...f.options, ...overrides});
    assert.equal(result.state, "unresolved"); assert.equal(result.reason, "candidate_not_observed");
  }
});
test("variant belonging to a different product conflicts without rewriting the requested product", async () => {
  const f = fixture({product: native("Product", "10"), productVariant: {...native("ProductVariant", "20"), product: native("Product", "99")}});
  const result = await verify(f.options);
  assert.equal(result.state, "conflicting"); assert.equal(result.reason, "variant_parent_mismatch");
  assert.equal(result.candidate.product_id, gid("Product", "10"));
});
for (const [label, data] of [
  ["missing product", {productVariant: null}], ["missing variant", {product: native("Product", "10")}],
  ["undefined product", {product: undefined, productVariant: null}],
  ["wrong product GID", {product: native("Product", "99"), productVariant: null}],
  ["numeric legacy ID", {product: {id: gid("Product", "10"), legacyResourceId: 10}, productVariant: null}],
  ["wrong variant GID", {product: native("Product", "10"), productVariant: {...native("ProductVariant", "99"), product: native("Product", "10")}}],
  ["missing parent", {product: native("Product", "10"), productVariant: native("ProductVariant", "20")}],
  ["wrong parent legacy ID", {product: native("Product", "10"), productVariant: {...native("ProductVariant", "20"), product: {id: gid("Product", "10"), legacyResourceId: "99"}}}],
  ["wrong shop", {shop: {id: gid("Shop", "2"), myshopifyDomain: shop.myshopifyDomain}}],
  ["wrong domain", {shop: {id: shop.shopId, myshopifyDomain: "other.myshopify.com"}}],
]) test(`rejects ${label} response`, async () => {await assert.rejects(verify(fixture(data).options));});
for (const id of [10, "0", "01", "18446744073709551616", " 10", gid("ProductVariant", "10"), "10?x=1"]) {
  test(`rejects malformed candidate ${id} before calling Shopify`, async () => {
    const f = fixture(); await assert.rejects(verify({...f.options, productId: id})); assert.equal(f.calls.length, 0);
  });
}
test("absent candidate and untrusted/inactive installation fail before provider read", async () => {
  const f = fixture();
  for (const overrides of [{productId: null, variantId: null}, {installation: {...installation, status: "inactive"}},
    {shop: {...shop, authority: "unverified"}}, {installation: {...installation, authority: "unverified"}}]) {
    await assert.rejects(verify({...f.options, ...overrides}));
  }
  assert.equal(f.calls.length, 0);
});
for (const kind of ["transport", "http", "json", "graphql", "partial"]) {
  test(`first ${kind} failure stops safely with no retry`, async () => {
    const f = fixture(); let calls = 0;
    f.options.admin.graphql = async () => {
      calls++; if (kind === "transport") throw Error("secret-native-message");
      return {ok: kind !== "http", json: async () => {
        if (kind === "json") throw Error("secret-native-message");
        return {data: kind === "partial" ? {shop, product: native("Product", "10")} : null,
          errors: [{message: "secret-native-message"}]};
      }};
    };
    await assert.rejects(verify(f.options), e => !e.message.includes("secret-native-message")); assert.equal(calls, 1);
  });
}
test("abort signal is forwarded; already aborted or canceled response yields no result", async () => {
  const controller = new AbortController(), f = fixture(); controller.abort();
  await assert.rejects(verify({...f.options, signal: controller.signal}), /ABORTED/); assert.equal(f.calls.length, 0);
  const during = new AbortController();
  f.options.admin.graphql = async (_, options) => {assert.equal(options.signal, during.signal); during.abort(); throw Error("cancel");};
  await assert.rejects(verify({...f.options, signal: during.signal}), /ABORTED/);
});

test("Google source rule + same-shop parent check creates an immutable nonpersistable draft", async () => {
  const snapshot = await source(), f = fixture(); let request;
  const result = await resolve(resolver(snapshot, f, async value => {request = value; return rule(snapshot);}));
  assert.equal(result.state, "candidate_verified_source_and_shop");
  assert.equal(result.shopify_product_id, gid("Product", "10")); assert.equal(result.shopify_variant_id, gid("ProductVariant", "20"));
  assert.equal(result.provider_link_verified, false); assert.equal(result.authorizes_activation, false);
  assert.equal(result.persistable, false); assert.equal(result.mapping_write_performed, false);
  assert.equal(result.source_facts_changed, false); assert.ok(Object.isFrozen(request.product_context));
  assert.ok(Object.isFrozen(result.mapping.mapping_evidence.source_rule));
});
test("no reviewed rule means no ID split and no Shopify call, even with familiar-looking offerId", async () => {
  const snapshot = await source(), f = fixture();
  for (const returned of [null, {state: "pending"}]) {
    const result = await resolve(resolver(snapshot, f, async () => returned));
    assert.equal(result.state, "unresolved"); assert.equal(result.reason, "verified_source_rule_required");
  }
  assert.equal(f.calls.length, 0);
});
for (const field of ["workspace_id", "installation_id", "installation_generation", "provider_connection_id", "platform_account_id"]) {
  test(`rejects source rule with mismatched ${field}`, async () => {
    const snapshot = await source(), f = fixture(), r = rule(snapshot); r.scope[field] = "other";
    await assert.rejects(resolve(resolver(snapshot, f, async () => r)), /CONTEXT_MISMATCH/); assert.equal(f.calls.length, 0);
  });
}
for (const field of ["merchant_id", "feed_label", "content_language", "data_source", "legacy_local"]) {
  test(`rejects source rule with mismatched ${field}`, async () => {
    const snapshot = await source(), f = fixture(), r = rule(snapshot); r.product_context[field] = "other";
    await assert.rejects(resolve(resolver(snapshot, f, async () => r)), /CONTEXT_MISMATCH/); assert.equal(f.calls.length, 0);
  });
}
test("unobserved/ambiguous product never calls rule loader or Shopify", async () => {
  const raw = {offerId: "sku", feedLabel: "US", dataSource: "accounts/123/dataSources/7"};
  const products = ["en", "fr"].map(contentLanguage => ({...raw, contentLanguage, name: `accounts/123/products/${contentLanguage}~US~sku`}));
  const snapshot = await source("sku", products), f = fixture();
  const options = resolver(snapshot, f, () => assert.fail("must not load rule"));
  assert.equal((await resolve(options)).state, "ambiguous");
  assert.equal((await resolve({...options, lookup: {...options.lookup, itemId: "missing"}})).state, "unresolved");
  assert.equal(f.calls.length, 0);
});
test("rules cannot silently add fields, omit evidence, change shop or use an unknown format", async () => {
  const snapshot = await source(), f = fixture();
  for (const overrides of [{source_reference: ""}, {shop_id: gid("Shop", "2")}, {extra: true}, {format: "guess"}]) {
    await assert.rejects(resolve(resolver(snapshot, f, async () => rule(snapshot, overrides))));
  }
  assert.equal(f.calls.length, 0);
});
test("market mismatch or zero-variant sentinel is unresolved without Shopify query", async () => {
  for (const offer of ["shopify_GB_10_20", "shopify_US_10_0", "shopify_US_10_18446744073709551616"]) {
    const snapshot = await source(offer), f = fixture();
    const result = await resolve(resolver(snapshot, f)); assert.equal(result.state, "unresolved"); assert.equal(f.calls.length, 0);
  }
});
test("explicit product-only and variant-only source rules remain independently supported", async () => {
  for (const [offer, format, data] of [["10", "shopify_product_id", {product: native("Product", "10")}],
    ["20", "shopify_variant_id", {productVariant: {...native("ProductVariant", "20"), product: native("Product", "10")}}]]) {
    const snapshot = await source(offer), f = fixture(data), r = rule(snapshot, {format}); delete r.market;
    const result = await resolve(resolver(snapshot, f, async () => r));
    assert.equal(result.shopify_product_id, gid("Product", "10"));
    assert.equal(result.shopify_variant_id, format === "shopify_variant_id" ? gid("ProductVariant", "20") : null);
  }
});
test("Shopify no-match or wrong parent is carried through without a draft mapping", async () => {
  const snapshot = await source();
  for (const [data, state] of [[{product: null, productVariant: null}, "unresolved"],
    [{product: native("Product", "10"), productVariant: {...native("ProductVariant", "20"), product: native("Product", "99")}}, "conflicting"]]) {
    const result = await resolve(resolver(snapshot, fixture(data)));
    assert.equal(result.state, state); assert.equal(result.mapping, null); assert.equal(result.shopify_product_id, null);
  }
});
test("loader error stays safe; canceled rule load never queries Shopify", async () => {
  const snapshot = await source(), f = fixture();
  await assert.rejects(resolve(resolver(snapshot, f, () => {throw Error("secret-message");})), /RULE_READ_FAILED/);
  const controller = new AbortController();
  await assert.rejects(resolve({...resolver(snapshot, f, async () => {controller.abort(); return rule(snapshot);}), signal: controller.signal}), /ABORTED/);
  assert.equal(f.calls.length, 0);
});
test("async rule loading cannot change copied lookup, shop, install or selected source", async () => {
  const snapshot = structuredClone(await source()), f = fixture(), options = resolver(snapshot, f);
  const r = rule(snapshot);
  options.loadSourceRule = async () => {
    options.lookup.itemId = "changed"; options.context.shop.shopId = gid("Shop", "99");
    options.context.installation.installGeneration = 99;
    assert.throws(() => {snapshot.records[0].native_product_id = "changed";}, TypeError);
    options.context.admin.graphql = () => assert.fail("captured Admin must be used");
    return r;
  };
  const result = await resolve(options);
  assert.equal(result.shopify_product_id, gid("Product", "10")); assert.equal(result.lookup.itemId, "shopify_US_10_20");
});
test("wrong shop installation generation is rejected before rule lookup or Shopify read", async () => {
  const snapshot = await source(), f = fixture(); f.options.installation.installGeneration++;
  await assert.rejects(resolve(resolver(snapshot, f, () => assert.fail("must not load rule"))), /SHOP_SCOPE_MISMATCH/);
  assert.equal(f.calls.length, 0);
});
