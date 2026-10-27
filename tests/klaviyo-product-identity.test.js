import test from "node:test";
import assert from "node:assert/strict";
import {resolveKlaviyoProductIdentities as resolve} from "../app/lib/providers/klaviyo-product-identity.server.js";
import {normalizeKlaviyoOrderedProductEvent as normalize} from "../app/lib/providers/klaviyo-reporting.server.js";

const gid = (type, value) => `gid://shopify/${type}/${value}`;
const native = (type, value) => ({id: gid(type, value), legacyResourceId: value});
const scope = {workspace_id: "11111111-1111-4111-8111-111111111111", installation_id: "12", installation_generation: 2,
  provider_connection_id: "22222222-2222-4222-8222-222222222222", platform: "klaviyo", platform_account_id: "Account1"};
const shop = {authority: "shopify_admin_verified", shopId: gid("Shop", "1"), myshopifyDomain: "sample.myshopify.com"};
const installation = {authority: "shopify_installation_verified", status: "active", workspaceId: scope.workspace_id, installGeneration: 2};
const metric = {type: "metric", id: "Ordered1", attributes: {name: "Ordered Product", integration: {name: "Shopify"}}};
function event(id = "event1", properties = {ProductID: "10", "Variant ID": "20"}) {
  return {type: "event", id, attributes: {uuid: `uuid-${id}`, datetime: "2026-10-27T10:00:00+00:00",
    event_properties: {Quantity: 1, "$value": 12.34, ...properties}}, relationships: {metric: {data: {type: "metric", id: "Ordered1"}}}};
}
function fixture(events = [event()], response) {
  const calls = [];
  return {calls, options: {events, metric: structuredClone(metric), sourceAuthority: structuredClone(scope),
    context: {shop: structuredClone(shop), installation: structuredClone(installation), admin: {graphql: async (...args) => {
      calls.push(args); const variables = args[1].variables;
      const p = variables.productId.split("/").at(-1), v = variables.variantId?.split("/").at(-1);
      return new Response(JSON.stringify({data: {shop: {id: shop.shopId, myshopifyDomain: shop.myshopifyDomain},
        ...(response ?? {product: native("Product", p), ...(v ? {productVariant: {...native("ProductVariant", v), product: native("Product", p)}} : {})})}}));
    }}}}};
}
test("normalization preserves both exact variant property names and native metric ID", () => {
  const result = normalize(event("event1", {ProductID: "10", "Variant ID": "20", VariantID: 20}));
  assert.equal(result.provider_metric_id, "Ordered1");
  assert.deepEqual(result.provider_product_properties["Variant ID"], {state: "present", value: "20"});
  assert.deepEqual(result.provider_product_properties.VariantID, {state: "present", value: 20});
  const missing = event(); delete missing.relationships;
  assert.equal(normalize(missing).provider_metric_id, null);
});
test("native Shopify Ordered Product IDs get same-shop product and variant-parent verification", async () => {
  const f = fixture(), result = await resolve(f.options);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].tries, 1);
  assert.equal(result.rows[0].standardized_product_id, gid("Product", "10"));
  assert.equal(result.rows[0].product_identity_resolution.shopify_variant_id, gid("ProductVariant", "20"));
  assert.equal(result.rows[0].provider_product_properties["$value"].value, 12.34);
  assert.equal(result.rows[0].provider_product_properties.Quantity.value, 1);
  assert.equal(result.persistable, false); assert.equal(result.provider_link_verified, false);
  assert.equal(result.authorizes_activation, false); assert.equal(result.mapping_write_performed, false);
  assert.equal(result.sales_roles_changed, false); assert.equal(result.source_amounts_or_quantities_changed, false);
  assert.equal(result.mappings[0].mapping_state, "candidate_verified_source_and_shop");
  assert.ok(Object.isFrozen(result.rows[0].provider_product_properties["Variant ID"]));
});
test("replayed event ID is deduplicated, repeated product checks are cached, every source event ID retained", async () => {
  const first = event(), f = fixture([first, structuredClone(first), event("event2")]);
  const result = await resolve(f.options);
  assert.equal(result.rows.length, 2); assert.equal(f.calls.length, 1); assert.equal(result.mappings.length, 1);
  assert.deepEqual(result.mappings[0].mapping_evidence.source_event_ids, ["event1", "event2"]);
  assert.equal(result.rows[0].product_identity_resolution.mapping_index, result.rows[1].product_identity_resolution.mapping_index);
  assert.match(result.mapping_references, /not_a_database_id/);
});
test("distinct variants remain distinct mappings under the same Product ID", async () => {
  const f = fixture([event(), event("event2", {ProductID: "10", "Variant ID": "21"})]), result = await resolve(f.options);
  assert.equal(f.calls.length, 2); assert.equal(result.mappings.length, 2);
  assert.equal(result.mappings[0].shopify_product_id, result.mappings[1].shopify_product_id);
  assert.notEqual(result.mappings[0].shopify_variant_id, result.mappings[1].shopify_variant_id);
});
test("product-only event preserves absent variant without inventing one", async () => {
  const f = fixture([event("event1", {ProductID: "10"})]), result = await resolve(f.options);
  assert.equal(result.mappings[0].shopify_variant_id, null);
  assert.equal(result.rows[0].product_identity_resolution.variant_observation, "absent");
  assert.doesNotMatch(f.calls[0][0], /productVariant/);
});
test("legacy-only VariantID remains unresolved until its source meaning is proved", async () => {
  const f = fixture([event("event1", {ProductID: "10", VariantID: "20"})]), result = await resolve(f.options);
  assert.equal(f.calls.length, 0); assert.equal(result.rows[0].product_identity_resolution.reason, "legacy_variant_field_requires_source_evidence");
  assert.equal(result.rows[0].provider_product_properties.VariantID.value, "20");
});
test("consistent aliases compare exact safe IDs; conflicting aliases are not coalesced", async () => {
  const same = fixture([event("event1", {ProductID: 10, "Variant ID": "20", VariantID: 20})]);
  assert.equal((await resolve(same.options)).mappings.length, 1);
  const f = fixture([event("event1", {ProductID: "10", "Variant ID": "20", VariantID: "21"})]);
  const result = await resolve(f.options);
  assert.equal(result.rows[0].product_identity_resolution.state, "conflicting"); assert.equal(f.calls.length, 0);
});
for (const [label, properties, reason] of [
  ["absent product", {}, "source_product_id_absent"], ["null product", {ProductID: null}, "source_product_id_null"],
  ["zero product", {ProductID: 0}, "source_product_id_invalid"],
  ["unsafe numeric product", {ProductID: 9007199254740992}, "source_product_id_invalid"],
  ["overflow string product", {ProductID: "18446744073709551616"}, "source_product_id_invalid"],
  ["null variant", {ProductID: "10", "Variant ID": null}, "source_variant_id_null"],
  ["zero variant", {ProductID: "10", "Variant ID": "0"}, "source_variant_id_invalid"],
  ["unsafe numeric variant", {ProductID: "10", "Variant ID": 9007199254740992}, "source_variant_id_invalid"],
  ["malformed alias", {ProductID: "10", "Variant ID": "20", VariantID: null}, "source_variant_alias_invalid"],
  ["SKU fallback forbidden", {SKU: "10"}, "source_product_id_absent"],
]) test(`${label} stays unresolved before Shopify query`, async () => {
  const f = fixture([event("event1", properties)]), result = await resolve(f.options);
  assert.equal(result.rows[0].product_identity_resolution.reason, reason); assert.equal(result.rows[0].standardized_product_id, null);
  assert.equal(f.calls.length, 0);
});
test("full unsigned-int64 decimal strings retain exact identity", async () => {
  const id = "18446744073709551615", f = fixture([event("event1", {ProductID: id})]);
  assert.equal((await resolve(f.options)).mappings[0].shopify_product_id, gid("Product", id));
});
for (const [label, change] of [
  ["Placed Order", m => {m.attributes.name = "Placed Order";}],
  ["custom integration", m => {m.attributes.integration.name = "API";}],
  ["missing integration", m => {delete m.attributes.integration;}],
]) test(`${label} cannot masquerade as native Shopify Ordered Product`, async () => {
  const f = fixture(); change(f.options.metric); await assert.rejects(resolve(f.options), /METRIC_INVALID/); assert.equal(f.calls.length, 0);
});
test("missing/mismatched native metric relationship is not filled from request filter", async () => {
  for (const relation of [undefined, {metric: {data: {type: "metric", id: "Other"}}}, {metric: {data: {type: "profile", id: "Ordered1"}}}]) {
    const row = event(); row.relationships = relation;
    const f = fixture([row]); await assert.rejects(resolve(f.options)); assert.equal(f.calls.length, 0);
  }
});
test("all event provenance and duplicate conflicts are validated before any Shopify query", async () => {
  const wrong = event("event2"); wrong.relationships.metric.data.id = "Other";
  const f = fixture([event(), wrong]); await assert.rejects(resolve(f.options), /METRIC_MISMATCH/); assert.equal(f.calls.length, 0);
  const g = fixture([event(), event("event1", {ProductID: "99"})]);
  await assert.rejects(resolve(g.options), /EVENT_CONFLICT/); assert.equal(g.calls.length, 0);
});
test("wrong workspace/connection/generation or excessive rows fails before provider access", async () => {
  const f = fixture();
  for (const change of [{workspace_id: "other"}, {provider_connection_id: "bad"}, {installation_generation: 99}, {platform: "meta"}]) {
    await assert.rejects(resolve({...f.options, sourceAuthority: {...scope, ...change}}));
  }
  await assert.rejects(resolve({...f.options, maxEvents: 0})); assert.equal(f.calls.length, 0);
});
test("Shopify null and wrong parent remain separate outcomes without mapping drafts", async () => {
  for (const [data, state] of [[{product: null, productVariant: null}, "unresolved"],
    [{product: native("Product", "10"), productVariant: {...native("ProductVariant", "20"), product: native("Product", "99")}}, "conflicting"]]) {
    const result = await resolve(fixture([event()], data).options);
    assert.equal(result.rows[0].product_identity_resolution.state, state); assert.equal(result.mappings.length, 0);
  }
});
test("first Shopify failure yields no partial output, no retry and no secret message", async () => {
  const f = fixture([event(), event("event2", {ProductID: "99"})]); let count = 0;
  f.options.context.admin.graphql = async () => {count++; throw Error("secret-message");};
  await assert.rejects(resolve(f.options), error => !error.message.includes("secret-message")); assert.equal(count, 1);
});
test("empty collection is complete and returns no fabricated mapping", async () => {
  const f = fixture([]), result = await resolve(f.options);
  assert.equal(result.rows.length, 0); assert.equal(result.mappings.length, 0); assert.equal(f.calls.length, 0);
  assert.equal(result.persistable, false);
});
test("cancel before or during verification never returns an accepted collection", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(resolve({...f.options, signal: controller.signal}), /ABORTED/); assert.equal(f.calls.length, 0);
  const during = new AbortController();
  f.options.context.admin.graphql = async (_, options) => {assert.equal(options.signal, during.signal); during.abort(); throw Error("stopped");};
  await assert.rejects(resolve({...f.options, signal: during.signal}), /ABORTED/);
});
test("source arrays and owner/admin context are detached before first await", async () => {
  const f = fixture([event(), event("event2")]), original = f.options.context.admin.graphql;
  f.options.context.admin.graphql = async (...args) => {
    f.options.events[1].attributes.event_properties.ProductID = "99";
    f.options.context.shop.shopId = gid("Shop", "999"); f.options.context.installation.installGeneration = 99;
    return original(...args);
  };
  const result = await resolve(f.options);
  assert.equal(result.rows[1].standardized_product_id, gid("Product", "10")); assert.equal(f.calls.length, 1);
});
