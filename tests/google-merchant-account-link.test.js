import test from "node:test";
import assert from "node:assert/strict";
import {readGoogleMerchantAccountLink as readLink, readLinkedMerchantProductIdentitySnapshot as read,
  GOOGLE_MERCHANT_LINK_QUERY} from "../app/lib/providers/google-merchant-account-link.server.js";
import {GOOGLE_REPORTING_SCOPE, GOOGLE_MERCHANT_OAUTH_SCOPE} from "../app/lib/oauth/oauth-permission-profile.server.js";

const time = new Date("2026-10-27T10:00:00.000Z");
function authority() {
  return {workspace_id: "11111111-1111-4111-8111-111111111111", installation_id: "12",
    installation_generation: 2, provider_connection_id: "22222222-2222-4222-8222-222222222222",
    platform: "google_ads", platform_account_id: "1234567890", merchant_id: "123",
    granted_scopes: [GOOGLE_REPORTING_SCOPE, GOOGLE_MERCHANT_OAUTH_SCOPE]};
}
function current() {
  return {authority: authority(), connectionVersion: 3, credentialId: "33333333-3333-4333-8333-333333333333",
    status: "connected", loginCustomerId: "9999999999", tokenSet: {permission_profile: "identity_v1",
      access_token: "synthetic-token", scope: authority().granted_scopes.join(" "),
      scope_verified_at: "2026-10-27T09:50:00.000Z", expires_at: "2026-10-27T10:50:00.000Z", expires_in: 3600}};
}
function link({merchant = "123", id = "7", ...rest} = {}) {
  return {productLink: {resourceName: `customers/1234567890/productLinks/${id}`,
    productLinkId: id, type: "MERCHANT_CENTER", merchantCenter: {merchantCenterId: merchant}, ...rest}};
}
const rawProduct = {name: "accounts/123/products/en~US~sku", offerId: "sku", feedLabel: "US",
  contentLanguage: "en", dataSource: "accounts/123/dataSources/8"};
function fixture({contexts, pages} = {}) {
  const calls = []; let loads = 0;
  const bodies = pages ?? [{results: [link()]}, {products: [rawProduct]}, {results: [link()]}];
  return {calls, get loads() {return loads;}, options: {
    loadCurrent: async () => structuredClone(contexts ? contexts[Math.min(loads++, contexts.length - 1)] : (loads++, current())),
    developerToken: "synthetic-developer", now: () => new Date(time),
    fetchFn: async (...args) => {calls.push(args); return {ok: true, status: 200, json: async () => structuredClone(bodies[calls.length - 1])};},
  }};
}
function primitive(pages, overrides = {}) {
  const calls = [];
  return {calls, options: {customerId: "1234567890", merchantId: "123",
    adsClient: {search: async args => {calls.push(args); return pages[calls.length - 1];}}, ...overrides}};
}

test("native active-link query collects every page including empty pages before matching target", async () => {
  const f = primitive([{results: [link({merchant: "456", id: "6"})], next_page_token: "a"},
    {results: [], next_page_token: "b"}, {results: [link()], next_page_token: null}]);
  const result = await readLink(f.options);
  assert.equal(result.state, "confirmed"); assert.equal(result.pages, 3);
  assert.deepEqual(f.calls[0], {customerId: "1234567890", query: GOOGLE_MERCHANT_LINK_QUERY, pageToken: null});
  assert.equal(f.calls[2].pageToken, "b"); assert.equal(result.authorizes_activation, false);
  assert.ok(Object.isFrozen(result.link.source_record.productLink));
});
test("a missing target is not_observed, multiple target links are ambiguous, neither picks first", async () => {
  assert.equal((await readLink(primitive([{results: [], next_page_token: null}]).options)).state, "not_observed");
  const result = await readLink(primitive([{results: [link(), link({id: "8"})], next_page_token: null}]).options);
  assert.equal(result.state, "ambiguous"); assert.equal(result.link, null);
});
for (const [label, pages, code] of [
  ["wrong customer", [{results: [link({resourceName: "customers/9876543210/productLinks/7"})]}], "CUSTOMER_MISMATCH"],
  ["wrong type", [{results: [link({type: "DATA_PARTNER"})]}], "RESPONSE_INVALID"],
  ["numeric merchant ID", [{results: [link({merchant: 123})]}], "ID_INVALID"],
  ["overflow ID", [{results: [link({id: "9223372036854775808"})]}], "ID_INVALID"],
  ["duplicate", [{results: [link(), link()]}], "DUPLICATE"],
  ["repeated cursor", [{results: [], next_page_token: "a"}, {results: [], next_page_token: "a"}], "CURSOR_REPEATED"],
  ["malformed cursor", [{results: [], next_page_token: {}}], "CURSOR_INVALID"],
  ["missing cursor contract", [{results: []}], "CURSOR_INVALID"],
  ["malformed page", [{results: null}], "RESPONSE_INVALID"],
]) test(`rejects ${label} without incomplete evidence`, async () => {
  await assert.rejects(readLink(primitive(pages).options), new RegExp(code));
});
test("primitive bounds stop before extra page and preserve exact int64 IDs", async () => {
  const f = primitive([{results: [], next_page_token: "a"}], {maxPages: 1});
  await assert.rejects(readLink(f.options), /PAGE_LIMIT/); assert.equal(f.calls.length, 1);
  await assert.rejects(readLink(primitive([{results: [link(), link({id: "8"})]}], {maxLinks: 1}).options), /ROW_LIMIT/);
  assert.equal((await readLink(primitive([{results: [link({id: "9223372036854775807"})], next_page_token: null}]).options)).link.product_link_id, "9223372036854775807");
});
test("composes real Ads transport and Merchant reader with before/after link and owner checks", async () => {
  const f = fixture(), result = await read(f.options);
  assert.equal(f.loads, 4); assert.equal(f.calls.length, 3);
  assert.equal(result.provider_link_verified, true); assert.equal(result.shopify_mapping_state, "not_resolved");
  assert.equal(result.authorizes_activation, false); assert.equal(result.snapshot.authorizes_activation, false);
  assert.equal(result.snapshot.records[0].native_product_id, "sku");
  const [endpoint, init] = f.calls[0];
  assert.equal(endpoint, "https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search");
  assert.deepEqual(JSON.parse(init.body), {query: GOOGLE_MERCHANT_LINK_QUERY});
  assert.equal(init.headers["login-customer-id"], "9999999999");
  assert.equal(init.headers.authorization, "Bearer synthetic-token");
  assert.equal(init.headers["developer-token"], "synthetic-developer");
  assert.equal(init.redirect, "error"); assert.equal(f.calls[1][1].redirect, "error");
  assert.equal(f.calls[1][1].headers.Authorization, "Bearer synthetic-token");
  assert.equal(JSON.stringify(result).includes("synthetic-token"), false);
  assert.equal(JSON.stringify(result).includes("synthetic-developer"), false);
  assert.ok(Object.isFrozen(result.link_evidence.before.link.source_record));
});
for (const [label, mutate] of [
  ["workspace", c => {c.authority.workspace_id = "44444444-4444-4444-8444-444444444444";}],
  ["installation generation", c => {c.authority.installation_generation++;}],
  ["connection", c => {c.authority.provider_connection_id = "44444444-4444-4444-8444-444444444444";}],
  ["version", c => {c.connectionVersion++;}], ["credential", c => {c.credentialId = "44444444-4444-4444-8444-444444444444";}],
  ["access token", c => {c.tokenSet.access_token = "other-token";}],
  ["Merchant", c => {c.authority.merchant_id = "456";}],
  ["Ads customer", c => {c.authority.platform_account_id = "9876543210";}],
  ["manager", c => {c.loginCustomerId = null;}],
]) test(`changing ${label} discards products`, async () => {
  const changed = current(); mutate(changed);
  const f = fixture({contexts: [current(), current(), changed]});
  await assert.rejects(read(f.options), /AUTHORITY_CHANGED/); assert.equal(f.calls.length, 2);
});
test("authority change immediately after initial link prevents product call", async () => {
  const changed = current(); changed.connectionVersion++;
  const f = fixture({contexts: [current(), changed]});
  await assert.rejects(read(f.options), /AUTHORITY_CHANGED/); assert.equal(f.calls.length, 1);
});
test("final authority change after link recheck still discards result", async () => {
  const changed = current(); changed.connectionVersion++;
  const f = fixture({contexts: [current(), current(), current(), changed]});
  await assert.rejects(read(f.options), /AUTHORITY_CHANGED/); assert.equal(f.calls.length, 3);
});
test("missing initial link prevents Merchant request; disappearing or replaced link discards collection", async () => {
  const missing = fixture({pages: [{}]});
  await assert.rejects(read(missing.options), /NOT_CONFIRMED/); assert.equal(missing.calls.length, 1);
  for (const last of [{}, {results: [link({id: "8"})]}]) {
    const f = fixture({pages: [{results: [link()]}, {products: [rawProduct]}, last]});
    await assert.rejects(read(f.options), /LINK_CHANGED/); assert.equal(f.calls.length, 3);
  }
});
for (const [label, mutate] of [
  ["disconnected", c => {c.status = "disconnected";}],
  ["reporting credential", c => {c.tokenSet.permission_profile = "reporting_v1";}],
  ["expired credential", c => {c.tokenSet.scope_verified_at = "2026-10-27T08:00:00.000Z"; c.tokenSet.expires_at = "2026-10-27T09:00:00.000Z";}],
  ["scope substitution", c => {c.authority.granted_scopes.push("extra");}],
]) test(`rejects ${label} before provider read without refresh`, async () => {
  const value = current(); mutate(value); const f = fixture({contexts: [value]});
  await assert.rejects(read(f.options)); assert.equal(f.calls.length, 0);
});
test("first provider error stops, with no refresh, fallback or secret in error", async () => {
  const f = fixture(); let count = 0;
  f.options.fetchFn = async () => {count++; throw Error("synthetic-token");};
  await assert.rejects(read(f.options), e => e.code === "GOOGLE_MERCHANT_LINK_READ_FAILED" && !e.message.includes("synthetic-token"));
  assert.equal(count, 1);
});
test("HTTP denial at either Ads check or Merchant read stops without the next request", async () => {
  for (const failureAt of [1, 2, 3]) {
    const f = fixture(), fetcher = f.options.fetchFn;
    f.options.fetchFn = async (...args) => {
      const response = await fetcher(...args);
      if (f.calls.length !== failureAt) return response;
      return {ok: false, status: 403, json: async () => ({error: {status: "PERMISSION_DENIED"}})};
    };
    await assert.rejects(read(f.options)); assert.equal(f.calls.length, failureAt);
  }
});
test("authority lookup failure is safe and does not use cached context", async () => {
  const f = fixture(); f.options.loadCurrent = async () => {throw Error("synthetic-token");};
  await assert.rejects(read(f.options), e => e.code === "GOOGLE_MERCHANT_LINK_AUTHORITY_UNAVAILABLE");
  assert.equal(f.calls.length, 0);
});
test("abort during native Ads call is forwarded and prevents Merchant read", async () => {
  const f = fixture(), controller = new AbortController(); f.options.signal = controller.signal;
  f.options.fetchFn = async (_, init) => {
    assert.equal(init.signal, controller.signal); controller.abort(); throw Error("stopped");
  };
  await assert.rejects(read(f.options), /ABORTED/); assert.equal(f.loads, 1);
});
test("invalid limits and already-aborted work make no provider call", async () => {
  const f = fixture(); await assert.rejects(read({...f.options, maxRows: 0})); assert.equal(f.loads, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(read({...f.options, signal: controller.signal}), /ABORTED/); assert.equal(f.calls.length, 0);
});
test("slow observation and credential expiry during collection discard result", async () => {
  const f = fixture(); let milliseconds = time.valueOf();
  f.options.now = () => new Date(milliseconds);
  const fetcher = f.options.fetchFn;
  f.options.fetchFn = async (...args) => {const r = await fetcher(...args); if (f.calls.length === 2) milliseconds += 120001; return r;};
  await assert.rejects(read(f.options), /OBSERVATION_STALE/); assert.equal(f.calls.length, 2);
  const g = fixture(); let instant = time.valueOf(); g.options.now = () => new Date(instant);
  const get = g.options.fetchFn;
  g.options.fetchFn = async (...args) => {const r = await get(...args); instant += 3600000; return r;};
  await assert.rejects(read(g.options), /REFRESH_REQUIRED/); assert.equal(g.calls.length, 1);
});
