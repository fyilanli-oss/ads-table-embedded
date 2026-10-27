import test from "node:test";
import assert from "node:assert/strict";
import {resolveMetaProductIdentity as resolve} from "../app/lib/providers/meta-product-identity-resolution.server.js";
import {readMetaCatalogIdentitySnapshot} from "../app/lib/providers/meta-catalog-identity-reader.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";

const gid = (type, value) => `gid://shopify/${type}/${value}`;
const native = (type, value) => ({id: gid(type, value), legacyResourceId: value});
const scope = {workspace_id: "11111111-1111-4111-8111-111111111111", installation_id: "12", installation_generation: 2,
  provider_connection_id: "22222222-2222-4222-8222-222222222222", platform: "meta", platform_account_id: "act_123"};
const shop = {authority: "shopify_admin_verified", shopId: gid("Shop", "1"), myshopifyDomain: "sample.myshopify.com"};
const installation = {authority: "shopify_installation_verified", status: "active", workspaceId: scope.workspace_id, installGeneration: 2};
const reportShape = {source_family: "ad_product_breakdown_daily_insights", graph_version: "v26.0"};
function item(overrides = {}) {return {id: "1000", retailer_id: "shopify_US_10_20", retailer_product_group_id: "group-10",
  product_catalog: {id: "456"}, product_feed: {id: "99"}, ...overrides};}
async function fixture({items = [item()], namespace = "catalog_product_id", data} = {}) {
  const snapshot = await readMetaCatalogIdentitySnapshot({authority: {...scope, catalog_id: "456", granted_scopes: [...oauthPermissionScopes("meta", "identity_v1")]},
    accessToken: "synthetic-token", appSecret: "synthetic-secret", fetchFn: async () => new Response(JSON.stringify({data: items}))});
  const calls = {report: 0, source: 0, shopify: []};
  const reportRule = {state: "verified_report_identity_rule", source_reference: "synthetic-namespace-proof", scope: structuredClone(scope),
    report_context: {...reportShape}, catalog_id: "456", identity_namespace: namespace};
  const sourceRule = {state: "verified_source_rule", source_reference: "synthetic-source-format-proof", scope: structuredClone(scope),
    product_context: structuredClone(snapshot.records[0]?.product_context ?? {catalog_id: "456"}), shop_id: shop.shopId,
    format: "shopify_market_product_variant", market: "US"};
  const options = {snapshot, lookup: {catalogId: "456", namespace, productId: namespace === "catalog_product_id" ? items[0]?.id ?? "1000" : items[0]?.retailer_id ?? "missing"},
    reportContext: {...reportShape, source_reference: "synthetic-report-source"},
    context: {shop: structuredClone(shop), installation: structuredClone(installation), admin: {graphql: async (...args) => {
      calls.shopify.push(args); return new Response(JSON.stringify({data: {shop: {id: shop.shopId, myshopifyDomain: shop.myshopifyDomain},
        ...(data ?? {product: native("Product", "10"), productVariant: {...native("ProductVariant", "20"), product: native("Product", "10")}})}}));
    }}},
    loadReportIdentityRule: async request => {calls.report++; assert.ok(Object.isFrozen(request.report_context)); return structuredClone(reportRule);},
    loadSourceRule: async request => {calls.source++; assert.ok(Object.isFrozen(request.product_context)); return structuredClone(sourceRule);}};
  return {options, calls, reportRule, sourceRule};
}

test("report namespace and retailer format require independent proofs before same-shop verification", async () => {
  const f = await fixture(), result = await resolve(f.options);
  assert.equal(f.calls.report, 1); assert.equal(f.calls.source, 1); assert.equal(f.calls.shopify.length, 1);
  assert.equal(result.state, "candidate_verified_source_and_shop");
  assert.equal(result.shopify_product_id, gid("Product", "10")); assert.equal(result.shopify_variant_id, gid("ProductVariant", "20"));
  assert.equal(result.mapping.native_product_id, "1000"); assert.equal(result.mapping.mapping_evidence.source_id_field, "retailer_id");
  assert.equal(result.mapping.product_context.identity_namespace, "catalog_product_id");
  assert.equal(result.mapping.mapping_evidence.report_identity_rule.source_reference, "synthetic-namespace-proof");
  assert.equal(result.mapping.mapping_evidence.source_rule.source_reference, "synthetic-source-format-proof");
  assert.equal(result.persistable, false); assert.equal(result.provider_link_verified, false);
  assert.equal(result.authorizes_activation, false); assert.equal(result.mapping_write_performed, false);
  assert.equal(result.source_facts_changed, false); assert.ok(Object.isFrozen(result.mapping.mapping_evidence.report_identity_rule.scope));
});
test("retailer namespace can be explicitly proved; no inference from numeric or prefix shape", async () => {
  const f = await fixture({namespace: "retailer_id"}), result = await resolve(f.options);
  assert.equal(result.mapping.native_product_id, "shopify_US_10_20"); assert.equal(result.shopify_product_id, gid("Product", "10"));
});
test("missing or pending report rule prevents source-rule lookup and Shopify read", async () => {
  const f = await fixture();
  for (const rule of [null, {state: "pending"}]) {
    const result = await resolve({...f.options, loadReportIdentityRule: async () => rule});
    assert.equal(result.state, "unresolved"); assert.equal(result.reason, "verified_report_identity_rule_required");
  }
  assert.equal(f.calls.source, 0); assert.equal(f.calls.shopify.length, 0);
});
test("missing source-format proof never parses familiar retailer ID or calls Shopify", async () => {
  const f = await fixture();
  const result = await resolve({...f.options, loadSourceRule: async () => null});
  assert.equal(result.reason, "verified_source_rule_required"); assert.equal(f.calls.shopify.length, 0);
});
for (const [label, change] of [
  ["wrong namespace", r => {r.identity_namespace = "retailer_id";}],
  ["wrong account", r => {r.scope.platform_account_id = "act_999";}],
  ["wrong generation", r => {r.scope.installation_generation++;}],
  ["wrong catalog", r => {r.catalog_id = "999";}],
  ["wrong report family", r => {r.report_context.source_family = "other";}],
  ["wrong Graph version", r => {r.report_context.graph_version = "v25.0";}],
  ["missing evidence", r => {delete r.source_reference;}],
  ["blank evidence", r => {r.source_reference = " ";}],
  ["extra field", r => {r.extra = true;}],
]) test(`rejects ${label} report rule without trying another namespace`, async () => {
  const f = await fixture(); change(f.reportRule);
  await assert.rejects(resolve(f.options)); assert.equal(f.calls.source, 0); assert.equal(f.calls.shopify.length, 0);
});
for (const [label, change] of [
  ["wrong workspace", r => {r.scope.workspace_id = "other";}],
  ["wrong connection", r => {r.scope.provider_connection_id = "other";}],
  ["wrong feed", r => {r.product_context.product_feed_id = "999";}],
  ["wrong catalog", r => {r.product_context.catalog_id = "999";}],
  ["wrong shop", r => {r.shop_id = gid("Shop", "2");}],
  ["unsupported source format", r => {r.format = "guess";}],
  ["missing evidence", r => {delete r.source_reference;}],
]) test(`rejects ${label} source rule before Shopify read`, async () => {
  const f = await fixture(); change(f.sourceRule);
  await assert.rejects(resolve(f.options)); assert.equal(f.calls.shopify.length, 0);
});
test("Meta internal ID is never interpreted as Shopify Product ID even when numeric", async () => {
  const f = await fixture({items: [item({id: "10", retailer_id: "20"})], data: {product: native("Product", "20")}});
  f.sourceRule.format = "shopify_product_id"; delete f.sourceRule.market;
  const result = await resolve(f.options);
  assert.equal(result.shopify_product_id, gid("Product", "20"));
  assert.equal(result.mapping.native_product_id, "10"); assert.equal(result.mapping.mapping_evidence.source_id_value, "20");
});
test("retailer group is not a Shopify Product ID fallback", async () => {
  const f = await fixture({items: [item({retailer_id: "not-a-shopify-id", retailer_product_group_id: "shopify_US_10_20"})]});
  const result = await resolve(f.options);
  assert.equal(result.state, "unresolved"); assert.equal(result.mapping, null); assert.equal(f.calls.shopify.length, 0);
});
test("market mismatch and variant zero remain unresolved instead of guessed mappings", async () => {
  for (const retailer of ["shopify_GB_10_20", "shopify_US_10_0"]) {
    const f = await fixture({items: [item({retailer_id: retailer})]});
    assert.equal((await resolve(f.options)).state, "unresolved"); assert.equal(f.calls.shopify.length, 0);
  }
});
test("variant-only rule derives Shopify parent, preserving variant detail", async () => {
  const f = await fixture({items: [item({retailer_id: "20"})], data: {productVariant: {...native("ProductVariant", "20"), product: native("Product", "10")}}});
  f.sourceRule.format = "shopify_variant_id"; delete f.sourceRule.market;
  const result = await resolve(f.options);
  assert.equal(result.shopify_product_id, gid("Product", "10")); assert.equal(result.shopify_variant_id, gid("ProductVariant", "20"));
});
test("ambiguous and missing native record require no format lookup or Shopify call", async () => {
  const f = await fixture({namespace: "retailer_id", items: [item(), item({id: "1001"})]});
  assert.equal((await resolve(f.options)).state, "ambiguous");
  assert.equal((await resolve({...f.options, lookup: {...f.options.lookup, productId: "missing"}})).state, "unresolved");
  assert.equal(f.calls.source, 0); assert.equal(f.calls.shopify.length, 0);
});
test("Shopify null and parent conflict are carried through without a mapping draft", async () => {
  for (const [data, state] of [[{product: null, productVariant: null}, "unresolved"],
    [{product: native("Product", "10"), productVariant: {...native("ProductVariant", "20"), product: native("Product", "99")}}, "conflicting"]]) {
    const f = await fixture({data}), result = await resolve(f.options);
    assert.equal(result.state, state); assert.equal(result.mapping, null); assert.equal(result.shopify_product_id, null);
  }
});
test("first loader/Shopify errors stop safely without retry or fallback", async () => {
  for (const stage of ["report", "source", "shopify"]) {
    const f = await fixture(); let attempts = 0;
    const failure = async () => {attempts++; throw Error("secret-native-message");};
    if (stage === "report") f.options.loadReportIdentityRule = failure;
    else if (stage === "source") f.options.loadSourceRule = failure;
    else f.options.context.admin.graphql = failure;
    await assert.rejects(resolve(f.options), e => !e.message.includes("secret-native-message")); assert.equal(attempts, 1);
  }
});
test("invalid report or shop context is rejected before either rule loader", async () => {
  const f = await fixture();
  for (const options of [{...f.options, reportContext: {...f.options.reportContext, source_reference: ""}},
    {...f.options, reportContext: {...f.options.reportContext, graph_version: "v25.0"}},
    {...f.options, lookup: {...f.options.lookup, namespace: undefined}},
    {...f.options, context: {...f.options.context, installation: {...installation, installGeneration: 99}}}]) await assert.rejects(resolve(options));
  assert.equal(f.calls.report, 0); assert.equal(f.calls.source, 0); assert.equal(f.calls.shopify.length, 0);
});
test("cancel before or during either rule load makes no Shopify call", async () => {
  for (const stage of ["before", "report", "source"]) {
    const f = await fixture(), controller = new AbortController();
    if (stage === "before") controller.abort();
    if (stage === "report") f.options.loadReportIdentityRule = async () => {controller.abort(); return f.reportRule;};
    if (stage === "source") f.options.loadSourceRule = async () => {controller.abort(); return f.sourceRule;};
    await assert.rejects(resolve({...f.options, signal: controller.signal}), /ABORTED/); assert.equal(f.calls.shopify.length, 0);
  }
});
test("async loaders cannot retarget captured shop, lookup, report reference or Admin client", async () => {
  const f = await fixture();
  f.options.loadReportIdentityRule = async request => {
    assert.ok(Object.isFrozen(request.scope));
    f.options.lookup.productId = "changed"; f.options.context.shop.shopId = gid("Shop", "2");
    f.options.reportContext.source_reference = "changed"; f.options.context.installation.installGeneration = 99;
    f.options.context.admin.graphql = () => assert.fail("captured Admin must be used");
    return f.reportRule;
  };
  const result = await resolve(f.options);
  assert.equal(result.shopify_product_id, gid("Product", "10"));
  assert.equal(result.lookup.productId, "1000"); assert.equal(result.report_context.source_reference, "synthetic-report-source");
});
