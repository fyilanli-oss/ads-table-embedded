import test from "node:test";
import assert from "node:assert/strict";
import {readMerchantProductIdentitySnapshot as read, matchMerchantProductIdentity as match} from "../app/lib/providers/google-product-identity-reader.server.js";
import {GOOGLE_MERCHANT_OAUTH_SCOPE} from "../app/lib/oauth/oauth-permission-profile.server.js";

const authority = {workspace_id: "11111111-1111-4111-8111-111111111111", installation_id: "9223372036854775807",
  installation_generation: 2, provider_connection_id: "22222222-2222-4222-8222-222222222222",
  platform: "google_ads", platform_account_id: "1234567890", merchant_id: "123",
  granted_scopes: [GOOGLE_MERCHANT_OAUTH_SCOPE]};
function product({offerId = "shopify_US_10_20", contentLanguage = "en", feedLabel = "US", legacyLocal = false, ...rest} = {}) {
  return {name: `accounts/123/products/${legacyLocal ? "local~" : ""}${contentLanguage}~${feedLabel}~${offerId}`,
    offerId, contentLanguage, feedLabel, legacyLocal, dataSource: "accounts/123/dataSources/7", ...rest};
}
function response(body) { return {ok: true, status: 200, json: async () => body}; }
function setup(bodies, overrides = {}) {
  const calls = [];
  return {calls, options: {authority: structuredClone(authority), accessToken: "synthetic-token",
    fetchFn: async (...args) => {calls.push(args); return response(bodies[calls.length - 1]);}, ...overrides}};
}
const lookup = {merchantId: "123", feedLabel: "US", itemId: "shopify_US_10_20"};

test("lists the fixed v1 account with exact bearer header and follows an empty intermediate page", async () => {
  const {options, calls} = setup([{products: [product()], nextPageToken: "cursor+/="},
    {nextPageToken: "next"}, {products: [product({offerId: "other"})]}]);
  const result = await read(options);
  assert.equal(result.pages, 3); assert.equal(result.records.length, 2);
  assert.equal(calls[0][0], "https://merchantapi.googleapis.com/products/v1/accounts/123/products?pageSize=1000");
  assert.equal(new URL(calls[1][0]).searchParams.get("pageToken"), "cursor+/=");
  assert.equal(calls[0][1].headers.Authorization, "Bearer synthetic-token");
  assert.equal(calls[0][1].method, "GET"); assert.equal(calls[0][1].redirect, "error");
  assert.equal(result.scope.installation_id, "9223372036854775807");
  assert.equal(JSON.stringify(result).includes("synthetic-token"), false);
  assert.equal(result.authorizes_activation, false);
});
test("keeps a detached immutable raw source without parsing Shopify-looking IDs", async () => {
  const raw = product({customAttributes: [{name: "shopify_product_id", value: "10"}]});
  const {options} = setup([{products: [raw]}]);
  const snapshot = await read(options), result = match(snapshot, lookup);
  raw.customAttributes[0].value = "changed";
  assert.equal(result.record.source_record.customAttributes[0].value, "10");
  assert.ok(Object.isFrozen(result.record.source_record.customAttributes[0]));
  assert.equal(result.state, "exact_source_record"); assert.equal(result.provider_link_verified, false);
  assert.equal(result.shopify_mapping_state, "not_resolved");
  assert.equal(Object.hasOwn(result.record, "shopify_product_id"), false);
  assert.throws(() => snapshot.records.push({}), TypeError);
});
test("multiple language and local contexts stay ambiguous until explicitly selected", async () => {
  const {options} = setup([{products: [product(), product({contentLanguage: "fr"}), product({legacyLocal: true})]}]);
  const snapshot = await read(options);
  assert.equal(match(snapshot, lookup).state, "ambiguous");
  assert.equal(match(snapshot, {...lookup, contentLanguage: "en"}).state, "ambiguous");
  assert.equal(match(snapshot, {...lookup, contentLanguage: "en", legacyLocal: false}).state, "exact_source_record");
  assert.equal(match(snapshot, {...lookup, dataSource: "accounts/123/dataSources/8"}).state, "unresolved");
  assert.equal(match(snapshot, {...lookup, itemId: "missing"}).state, "unresolved");
  assert.throws(() => match(snapshot, {...lookup, merchantId: "456"}), /CONTEXT_INVALID/);
});
test("empty protobuf list is complete; absent legacyLocal means false; exact opaque offer ID preserved", async () => {
  assert.equal((await read(setup([{}]).options)).records.length, 0);
  const raw = product({offerId: "opaque/a~b%20"}); delete raw.legacyLocal;
  const snapshot = await read(setup([{products: [raw]}]).options);
  assert.equal(snapshot.records[0].native_product_id, "opaque/a~b%20");
  assert.equal(snapshot.records[0].product_context.legacy_local, false);
});
for (const [label, change] of [
  ["wrong provider", {platform: "meta"}], ["invalid workspace", {workspace_id: "bad"}],
  ["invalid connection", {provider_connection_id: "bad"}], ["overflow installation", {installation_id: "9223372036854775808"}],
  ["numeric installation", {installation_id: 1}], ["invalid generation", {installation_generation: 0}],
  ["absent grant", {granted_scopes: []}], ["malformed merchant", {merchant_id: "123/456"}],
]) test(`rejects ${label} before network`, async () => {
  const {options, calls} = setup([{}], {authority: {...authority, ...change}});
  await assert.rejects(read(options)); assert.equal(calls.length, 0);
});
for (const body of [null, [], {error: {}}, {products: null}, {products: {}}, {products: [null]},
  {products: [product({name: "accounts/456/products/en~US~x"})]},
  {products: [product({dataSource: "accounts/456/dataSources/7"})]},
  {products: [product({dataSource: "accounts/123/dataSources/7/extra"})]},
  {products: [product({legacyLocal: "false"})]}, {nextPageToken: null}]) {
  test(`rejects malformed or cross-account page ${JSON.stringify(body)}`, async () => {
    const {options, calls} = setup([body]);
    await assert.rejects(read(options)); assert.equal(calls.length, 1);
  });
}
test("duplicate records, repeated cursor and limits fail without returning partial data", async () => {
  await assert.rejects(read(setup([{products: [product()], nextPageToken: "a"}, {products: [product()]}]).options), /DUPLICATE_PRODUCT/);
  await assert.rejects(read(setup([{nextPageToken: "a"}, {nextPageToken: "a"}]).options), /CURSOR_REPEATED/);
  const limited = setup([{nextPageToken: "a"}], {maxPages: 1});
  await assert.rejects(read(limited.options), /PAGE_LIMIT/); assert.equal(limited.calls.length, 1);
  await assert.rejects(read(setup([{products: [product(), product({offerId: "other"})]}], {maxRows: 1}).options), /ROW_LIMIT/);
  const badLimit = setup([{}], {maxRows: 100001});
  await assert.rejects(read(badLimit.options), /LIMIT_INVALID/); assert.equal(badLimit.calls.length, 0);
});
for (const kind of ["http", "transport", "json"]) test(`first ${kind} error stops without secret or retry`, async () => {
  let calls = 0;
  await assert.rejects(read({...setup([]).options, fetchFn: async () => {
    calls += 1;
    if (kind === "transport") throw Error("synthetic-token");
    if (kind === "http") return {ok: false, status: 403, json: () => assert.fail("must not read body")};
    return {ok: true, json: async () => {throw Error("synthetic-token");}};
  }}), error => !error.message.includes("synthetic-token") && error.code.startsWith("MERCHANT_IDENTITY_"));
  assert.equal(calls, 1);
});
test("abort before or during read discards output and does not fetch another page", async () => {
  const controller = new AbortController(); controller.abort();
  const before = setup([{}], {signal: controller.signal});
  await assert.rejects(read(before.options), /ABORTED/); assert.equal(before.calls.length, 0);
  const during = new AbortController(); let calls = 0;
  await assert.rejects(read({...setup([]).options, signal: during.signal, fetchFn: async (_, init) => {
    calls += 1; assert.equal(init.signal, during.signal); during.abort(); return response({nextPageToken: "a"});
  }}), /ABORTED/); assert.equal(calls, 1);
});
