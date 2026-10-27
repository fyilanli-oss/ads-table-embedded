import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {readMetaCatalogIdentitySnapshot as read, matchMetaCatalogProductIdentity as match,
  META_CATALOG_IDENTITY_FIELDS} from "../app/lib/providers/meta-catalog-identity-reader.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {META_GRAPH_VERSION} from "../app/lib/providers/meta-graph.server.js";

const authority = {workspace_id: "11111111-1111-4111-8111-111111111111", installation_id: "9223372036854775807",
  installation_generation: 2, provider_connection_id: "22222222-2222-4222-8222-222222222222",
  platform: "meta", platform_account_id: "act_123", catalog_id: "456", granted_scopes: [...oauthPermissionScopes("meta", "identity_v1")]};
function product(overrides = {}) {
  return {id: "789", retailer_id: "shopify_US_10_20", retailer_product_group_id: "group-10",
    product_catalog: {id: "456"}, product_feed: {id: "99"}, ...overrides};
}
function fixture(pages, overrides = {}) {
  const calls = [];
  return {calls, options: {authority: structuredClone(authority), accessToken: "synthetic-token", appSecret: "synthetic-secret",
    fetchFn: async (...args) => {calls.push(args); return {ok: true, status: 200, json: async () => pages[calls.length - 1]};}, ...overrides}};
}
const lookup = {catalogId: "456", namespace: "retailer_id", productId: "shopify_US_10_20"};

test("reads fixed version/catalog with bearer and proof, follows cursors not supplied next addresses", async () => {
  const f = fixture([{data: [product()], paging: {cursors: {after: "after+/="}, next: "https://elsewhere.invalid/?access_token=must-not-follow"}},
    {data: [], paging: {next: "https://elsewhere.invalid/other", cursors: {after: "next"}}},
    {data: [product({id: "790", retailer_id: "other"})], paging: {cursors: {after: "final-but-no-next"}}}]);
  const snapshot = await read(f.options);
  assert.equal(snapshot.pages, 3); assert.equal(snapshot.records.length, 2);
  for (const [target, init] of f.calls) {
    const endpoint = new URL(target);
    assert.equal(endpoint.origin, "https://graph.facebook.com"); assert.equal(endpoint.pathname, `/${META_GRAPH_VERSION}/456/products`);
    assert.equal(endpoint.searchParams.get("fields"), META_CATALOG_IDENTITY_FIELDS.join(","));
    assert.equal(endpoint.searchParams.get("limit"), "100");
    assert.equal(endpoint.searchParams.get("appsecret_proof"), createHmac("sha256", "synthetic-secret").update("synthetic-token").digest("hex"));
    assert.equal(endpoint.searchParams.has("access_token"), false);
    assert.equal(init.headers.authorization, "Bearer synthetic-token"); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
  }
  assert.equal(new URL(f.calls[1][0]).searchParams.get("after"), "after+/=");
  assert.equal(snapshot.scope.installation_id, "9223372036854775807");
  assert.equal(snapshot.provider_link_verified, false); assert.equal(snapshot.authorizes_activation, false);
  assert.equal(snapshot.shopify_mapping_state, "not_resolved");
  for (const secret of ["synthetic-token", "synthetic-secret", "must-not-follow", "appsecret_proof"]) assert.equal(JSON.stringify(snapshot).includes(secret), false);
});
test("catalog ID and retailer ID namespaces never cross-match even when numeric IDs collide", async () => {
  const snapshot = await read(fixture([{data: [product({id: "789", retailer_id: "790"}), product({id: "790", retailer_id: "789"})]}]).options);
  assert.equal(match(snapshot, {...lookup, productId: "789"}).record.catalog_product_id, "790");
  assert.equal(match(snapshot, {...lookup, namespace: "catalog_product_id", productId: "789"}).record.retailer_id, "790");
  assert.throws(() => match(snapshot, {...lookup, namespace: undefined}), /NAMESPACE_REQUIRED/);
  assert.throws(() => match(snapshot, {...lookup, namespace: "catalog_product_id", productId: "shopify_US_10_20"}), /ID_INVALID/);
});
test("duplicate retailer IDs remain ambiguous; explicit feed filter can select one source record", async () => {
  const snapshot = await read(fixture([{data: [product(), product({id: "790", product_feed: {id: "98"}})]}]).options);
  assert.equal(match(snapshot, lookup).state, "ambiguous"); assert.equal(match(snapshot, lookup).record, null);
  assert.equal(match(snapshot, {...lookup, productFeedId: "99"}).record.catalog_product_id, "789");
  assert.equal(match(snapshot, {...lookup, productFeedId: "100"}).state, "unresolved");
  assert.throws(() => match(snapshot, {...lookup, catalogId: "999"}), /CONTEXT_INVALID/);
});
test("raw group/feed absence and null stay distinct; no Shopify ID inferred", async () => {
  const missing = product({id: "790", retailer_id: "other"}); delete missing.product_feed; delete missing.retailer_product_group_id;
  const raw = product({product_feed: null, retailer_product_group_id: null});
  const snapshot = await read(fixture([{data: [raw, missing]}]).options);
  raw.retailer_id = "changed";
  assert.equal(snapshot.records[0].source_record.product_feed, null);
  assert.equal(Object.hasOwn(snapshot.records[1].source_record, "product_feed"), false);
  assert.equal(Object.hasOwn(snapshot.records[0], "shopify_product_id"), false);
  assert.equal(snapshot.records[0].retailer_id, "shopify_US_10_20");
  assert.ok(Object.isFrozen(snapshot.records[0].source_record.product_catalog));
});
test("explicit empty data is complete, zero records is not a missing response", async () => {
  const result = await read(fixture([{data: []}]).options);
  assert.equal(result.complete, true); assert.equal(result.records.length, 0);
  assert.equal(match(result, lookup).state, "unresolved");
});
for (const [label, changed] of [
  ["provider", {platform: "google_ads"}], ["workspace", {workspace_id: "bad"}],
  ["connection", {provider_connection_id: "bad"}], ["installation overflow", {installation_id: "9223372036854775808"}],
  ["numeric installation", {installation_id: 12}], ["generation", {installation_generation: 0}],
  ["catalog", {catalog_id: "456/789"}], ["scopes", {granted_scopes: ["ads_read"]}],
]) test(`invalid ${label} fails before fetch`, async () => {
  const f = fixture([{data: []}], {authority: {...authority, ...changed}});
  await assert.rejects(read(f.options)); assert.equal(f.calls.length, 0);
});
for (const [label, body] of [
  ["null", null], ["array", []], ["missing data", {}], ["null data", {data: null}],
  ["error with data", {data: [], error: {message: "synthetic-token"}}],
  ["null row", {data: [null]}], ["numeric ID", {data: [product({id: 789})]}],
  ["missing retailer ID", {data: [product({retailer_id: undefined})]}],
  ["wrong catalog", {data: [product({product_catalog: {id: "999"}})]}],
  ["missing catalog", {data: [product({product_catalog: undefined})]}],
  ["malformed feed", {data: [product({product_feed: {id: null}})]}],
  ["malformed group ID", {data: [product({retailer_product_group_id: 10})]}],
  ["null paging", {data: [], paging: null}],
  ["next without cursor", {data: [], paging: {next: "next"}}],
  ["empty next", {data: [], paging: {next: "", cursors: {after: "a"}}}],
  ["null next", {data: [], paging: {next: null, cursors: {after: "a"}}}],
]) test(`rejects ${label} response safely without retry`, async () => {
  const f = fixture([body]);
  await assert.rejects(read(f.options), e => !e.message.includes("synthetic-token")); assert.equal(f.calls.length, 1);
});
test("duplicate native catalog ID across pages, cursor loops and bounds reject partial collections", async () => {
  const next = {next: "native-next", cursors: {after: "a"}};
  await assert.rejects(read(fixture([{data: [product()], paging: next}, {data: [product()]}]).options), /DUPLICATE_PRODUCT/);
  await assert.rejects(read(fixture([{data: [], paging: next}, {data: [], paging: next}]).options), /CURSOR_REPEATED/);
  const pages = fixture([{data: [], paging: next}], {maxPages: 1});
  await assert.rejects(read(pages.options), /PAGE_LIMIT/); assert.equal(pages.calls.length, 1);
  await assert.rejects(read(fixture([{data: [product(), product({id: "790"})]}], {maxRows: 1}).options), /ROW_LIMIT/);
  const invalid = fixture([], {maxRows: 100001});
  await assert.rejects(read(invalid.options), /LIMIT_INVALID/); assert.equal(invalid.calls.length, 0);
});
for (const kind of ["transport", "http", "json"]) test(`first ${kind} failure stops with no retry or secrets`, async () => {
  let calls = 0;
  const f = fixture([], {fetchFn: async () => {
    calls++; if (kind === "transport") throw Error("synthetic-token");
    return {ok: kind !== "http", status: 403, json: async () => {throw Error("synthetic-secret");}};
  }});
  await assert.rejects(read(f.options), e => e.code.startsWith("META_CATALOG_IDENTITY_") && !/synthetic/.test(e.message));
  assert.equal(calls, 1);
});
test("cancel before/during read prevents another request or completed result", async () => {
  const controller = new AbortController(), f = fixture([{data: []}], {signal: controller.signal}); controller.abort();
  await assert.rejects(read(f.options), /ABORTED/); assert.equal(f.calls.length, 0);
  const during = new AbortController();
  const g = fixture([], {signal: during.signal, fetchFn: async (_, init) => {
    assert.equal(init.signal, during.signal); during.abort(); return {ok: true, json: async () => ({data: []})};
  }});
  await assert.rejects(read(g.options), /ABORTED/);
});
