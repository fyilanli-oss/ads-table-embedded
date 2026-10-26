import assert from "node:assert/strict";
import test from "node:test";
import {resolveKlaviyoProductIdentities} from "../app/lib/providers/klaviyo-product-identity.server.js";
import {normalizeKlaviyoOrderedProductEvent} from "../app/lib/providers/klaviyo-reporting.server.js";

const metric = {type: "metric", id: "ordered", attributes: {name: "Ordered Product", integration: {name: "Shopify"}}};
const installation = {workspaceId: "12345678-1234-4234-8234-123456789abc", installGeneration: 2, status: "active"};
const sourceAuthority = {platform: "klaviyo", workspace_id: installation.workspaceId,
  installation_generation: 2, connection_id: "22345678-1234-4234-8234-123456789abc", account_id: "account-1"};
const shop = {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/1", myshopifyDomain: "fixture.myshopify.com"};
const identity = (type, id) => ({id: `gid://shopify/${type}/${id}`, legacyResourceId: id});
const data = () => ({shop: {id: shop.shopId, myshopifyDomain: shop.myshopifyDomain},
  product: identity("Product", "9007199254740993"),
  productVariant: {...identity("ProductVariant", "9007199254740995"), product: identity("Product", "9007199254740993")}});
const response = value => ({ok: true, json: async () => ({data: value})});
const row = (id = "event-1", productId = "9007199254740993", variant = "9007199254740995") => ({
  ...normalizeKlaviyoOrderedProductEvent({type: "event", id, attributes: {datetime: "2026-10-26T01:00:00Z",
    event_properties: {ProductID: productId, ...(variant === null ? {} : {VariantID: variant}), Quantity: 1, $value: 125}}}),
  attribution_resolution: {sales_role: "Assisted", channel_id: "message-1"},
  provider_metric_id: "ordered",
});
const resolve = args => resolveKlaviyoProductIdentities({rows: [row()], metric, sourceAuthority,
  context: {shop, installation, admin: {graphql: async () => response(data())}}, ...args});

test("Klaviyo source event reaches Shopify verification and produces an evidence-backed mapping without changing sales", async () => {
  const original = row();
  const result = await resolve({rows: [original]});
  assert.equal(result.rows[0].standardized_product_id, "gid://shopify/Product/9007199254740993");
  assert.equal(result.rows[0].product_identity_resolution.state, "verified");
  assert.equal(result.mappings[0].mapping_evidence.source_event_id, original.provider_event_id);
  assert.equal(result.mappings[0].mapping_evidence.metric_id, "ordered");
  assert.equal(result.mappings[0].mapping_evidence.shopify.variant.product.id, result.rows[0].standardized_product_id);
  assert.equal(result.rows[0].provider_product_properties, original.provider_product_properties);
  assert.equal(result.rows[0].attribution_resolution, original.attribution_resolution);
  assert.equal(original.standardized_product_id, null);
  assert.equal(result.mapping_write_performed, false);
});

test("Klaviyo verifies a repeated product once, retains distinct sales, and deduplicates repeated events", async () => {
  let calls = 0;
  const first = row();
  const result = await resolve({rows: [first, first, row("event-2")], context: {shop, installation,
    admin: {graphql: async () => {calls++; return response(data());}}}});
  assert.equal(calls, 1);
  assert.equal(result.rows.length, 2);
  assert.equal(result.mappings.length, 1);
  assert.equal(result.rows[1].product_identity_resolution.mapping_index, 0);
  assert.equal(result.rows[1].provider_event_id, "event-2");
});

test("Klaviyo rejects custom metrics, wrong installation, duplicate contradictions before Shopify requests", async () => {
  let calls = 0;
  const context = {shop, installation, admin: {graphql: async () => {calls++; return response(data());}}};
  for (const args of [{metric: {...metric, attributes: {...metric.attributes, integration: {name: "Custom"}}}},
    {metric: {...metric, attributes: {...metric.attributes, name: "Placed Order"}}},
    {sourceAuthority: {...sourceAuthority, installation_generation: 1}},
    {sourceAuthority: {...sourceAuthority, workspace_id: "other"}},
    {rows: [{...row(), provider_metric_id: "placed"}]},
    {rows: [row(), {...row(), occurred_at: "different"}]}]) {
    await assert.rejects(resolve({context, ...args}));
  }
  assert.equal(calls, 0);
});

test("Klaviyo missing and unsafe IDs preserve native rows without guessed mappings", async () => {
  let calls = 0;
  const result = await resolve({rows: [row("1", null), row("2", 9007199254740992), row("3", "123", "bad")],
    context: {shop, installation, admin: {graphql: async () => {calls++; return response(data());}}}});
  assert.equal(calls, 0);
  assert.equal(result.rows.length, 3);
  assert.equal(result.mappings.length, 0);
  assert.ok(result.rows.every(event => event.product_identity_resolution.state === "unresolved"));
  assert.equal(result.rows[1].provider_product_properties.ProductID.value, 9007199254740992);
});

test("Klaviyo safe numeric source ID becomes text only after exact safe-integer check", async () => {
  const result = await resolve({rows: [row("1", 123, null)], context: {shop, installation,
    admin: {graphql: async (_query, {variables}) => {
      assert.equal(variables.productId, "gid://shopify/Product/123");
      return response({...data(), product: identity("Product", "123")});
    }}}});
  assert.equal(result.mappings[0].native_product_id, "123");
  assert.equal(result.mappings[0].mapping_evidence.product_property.value, 123);
  assert.equal(result.mappings[0].shopify_variant_id, null);
});

test("Klaviyo absent candidate and conflicting variant retain sales and produce no mapping", async () => {
  for (const [payload, expected] of [[{...data(), product: null, productVariant: null}, "unresolved"],
    [{...data(), productVariant: {...data().productVariant, product: identity("Product", "42")}}, "conflicting"]]) {
    const result = await resolve({context: {shop, installation, admin: {graphql: async () => response(payload)}}});
    assert.equal(result.mappings.length, 0);
    assert.equal(result.rows[0].product_identity_resolution.state, expected);
    assert.equal(result.rows[0].provider_product_properties.$value.value, 125);
  }
});

test("Klaviyo late Shopify failure rejects the whole resolution without a partial mapping batch or retry", async () => {
  let calls = 0;
  await assert.rejects(resolve({rows: [row(), row("2", "42", null)], context: {shop, installation,
    admin: {graphql: async () => {calls++; if (calls === 1) return response(data()); throw new Error("private-token");}}}}),
    error => error.code === "SHOPIFY_PRODUCT_REQUEST_FAILED" && !error.message.includes("private-token"));
  assert.equal(calls, 2);
});
