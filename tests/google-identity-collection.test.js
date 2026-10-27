import test from "node:test";
import assert from "node:assert/strict";
import {collectGoogleMerchantIdentityEvidence} from "../app/lib/providers/google-identity-collection.server.js";
import {readMerchantProductIdentitySnapshot, matchMerchantProductIdentity} from "../app/lib/providers/google-product-identity-reader.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createQuotaManagedFetch, quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";

const workspace = "11111111-1111-4111-8111-111111111111", connection = "22222222-2222-4222-8222-222222222222",
  credential = "33333333-3333-4333-8333-333333333333";
function response(body, status = 200) {return {ok: status === 200, status, headers: {get: () => "request1"}, json: async () => body};}
function product(offerId = "shopify_US_123_456") {
  return {name: `accounts/99/products/en~US~${offerId}`, offerId, contentLanguage: "en", feedLabel: "US", dataSource: "accounts/99/dataSources/7"};
}
function link(id = "7", merchant = "99") {
  return {productLink: {resourceName: `customers/123/productLinks/${id}`, productLinkId: id,
    type: "MERCHANT_CENTER", merchantCenter: {merchantCenterId: merchant}}};
}
function fixture() {
  const calls = [], queries = [], hooks = {}, state = {version: 2, account: "123", manager: "456", status: "connected",
    now: new Date("2026-10-27T15:00:00.000Z"), generation: 3, scopes: [...oauthPermissionScopes("google_ads", "identity_v1")]};
  const verified = {installationAuthority: {authority: "shopify_installation_verified", workspaceId: workspace, installGeneration: 3, status: "active"},
    identity: {session: {authority: "shopify_id_token_verified", shopDomain: "test.myshopify.com"},
      shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"}},
    context: {admin: {graphql() {throw Error("no unproven source format may reach Shopify");}}}};
  const token = {access_token: "secret-access", refresh_token: "secret-refresh", permission_profile: "identity_v1",
    scope: state.scopes.join(" "), scope_verified_at: state.now.toISOString(), expires_in: 3600, expires_at: "2026-10-27T16:00:00.000Z"};
  const database = {async query(sql, params) {
    queries.push({sql, params}); await hooks.query?.(sql);
    if (sql.includes("resolve_active_installation")) return {rows: [{workspace_id: workspace, install_generation: state.generation, installation_status: "active"}]};
    if (sql.includes("load_provider_connection_lifecycle_by_owner")) return {rows: [{connection_id: connection, credential_id: credential,
      lifecycle_status: state.status, connection_version: state.version}]};
    if (sql.includes("load_provider_account_authority")) return {rows: [{connection_id: connection, credential_id: credential,
      reporting_account_id: state.account, granted_scopes: [...state.scopes], accounts: [{id: state.account, kind: "advertiser",
        reporting_eligible: true, login_account_id: state.manager}]}]};
    throw Error("unexpected SQL");
  }};
  const tokenVault = {loadProviderTokenSet: async () => token};
  const fetchFn = async (endpoint, init) => {
    const parsed = new URL(endpoint); calls.push({endpoint, parsed, init});
    const custom = await hooks.fetch?.(parsed, init, calls.length); if (custom) return custom;
    if (parsed.hostname === "googleads.googleapis.com") return response({results: [link()]});
    if (parsed.hostname === "merchantapi.googleapis.com") return response({products: [product()]});
    throw Error("unexpected endpoint");
  };
  const options = {verified, database, tokenVault, merchantId: "99", developerToken: "secret-developer", fetchFn, now: () => state.now};
  return {state, calls, queries, hooks, token, options, run: () => collectGoogleMerchantIdentityEvidence(options)};
}

test("concrete authority loader composes native Ads link, Merchant source and final link with no invented scope", async () => {
  const f = fixture(), r = await f.run();
  assert.equal(f.calls.length, 3); assert.equal(r.native_source.records[0].native_product_id, "shopify_US_123_456");
  assert.equal(r.native_source.scope, undefined); assert.equal(r.installation_id, null); assert.equal(r.canonical_scope_ready, false);
  assert.equal(r.provider_link_verified, true); assert.equal(r.relationship_scope, "observed_direct_Ads_Merchant_relationship_only");
  assert.equal(r.native_source.provider_link_verified, false); assert.equal(r.persistable, false); assert.equal(r.mapping_write_performed, false);
  assert.equal(r.shopify_mapping_state, "not_resolved"); assert.equal(r.source_facts_changed, false);
  assert.equal(r.native_source.records[0].shopify_product_id, undefined); assert.ok(Object.isFrozen(r.native_source.records));
  assert.ok(!/secret-access|secret-refresh|secret-developer|credentialId/.test(JSON.stringify(r)));
  assert.ok(f.queries.every(q => q.sql.startsWith("select *")));
  assert.ok(f.calls.every(c => c.init.redirect === "error"));
  const ads = f.calls.filter(c => c.parsed.hostname === "googleads.googleapis.com");
  assert.equal(ads[0].init.headers["login-customer-id"], "456"); assert.equal(ads[0].init.headers["developer-token"], "secret-developer");
  assert.equal(ads[0].init.body, ads[1].init.body);
  assert.equal(f.calls[1].init.headers.Authorization, "Bearer secret-access");
});
test("full-scope entry point still rejects missing PK before native request", async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(readMerchantProductIdentitySnapshot({authority: {workspace_id: workspace, installation_generation: 3,
    provider_connection_id: connection, platform: "google_ads", platform_account_id: "123", merchant_id: "99", granted_scopes: f.state.scopes},
  accessToken: "token", fetchFn: async () => {calls++;}})); assert.equal(calls, 0);
});
test("source-only snapshot cannot be relabeled as canonical by the old matcher", async () => {
  const r = await fixture().run(); assert.throws(() => matchMerchantProductIdentity(r.native_source,
    {merchantId: "99", feedLabel: "US", itemId: "shopify_US_123_456"}), /CONTEXT_INVALID/);
});
test("native Merchant pagination follows empty intermediate page without changing target", async () => {
  const f = fixture(); f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && !p.searchParams.has("pageToken")
    && response({nextPageToken: "second"});
  const r = await f.run(); assert.equal(r.native_source.pages, 2); assert.equal(f.calls.length, 4);
  assert.equal(f.calls[2].parsed.searchParams.get("pageToken"), "second"); assert.equal(f.calls[2].parsed.pathname, f.calls[1].parsed.pathname);
});
for (const [name, rows] of [["not linked", []], ["other Merchant", [link("7", "100")]], ["ambiguous links", [link(), link("8")]]]) {
  test(`${name}: native relationship must be unique before Merchant read`, async () => {
    const f = fixture(); f.hooks.fetch = () => response({results: rows});
    await assert.rejects(f.run(), /LINK_NOT_CONFIRMED/); assert.equal(f.calls.length, 1);
  });
}
test("native link change after source read discards the source", async () => {
  const f = fixture(); f.hooks.fetch = (p, init, n) => p.hostname === "googleads.googleapis.com" && n > 1 && response({results: [link("8")]});
  await assert.rejects(f.run(), /LINK_CHANGED/); assert.equal(f.calls.length, 3);
});
for (const [name, change] of [["version", s => {s.version++;}], ["selected Ads account", s => {s.account = "789";}],
  ["manager", s => {s.manager = "789";}], ["generation", s => {s.generation++;}], ["disconnect", s => {s.status = "disconnect_pending";}]]) {
  test(`current ${name} change prevents Merchant request`, async () => {
    const f = fixture(); f.hooks.fetch = p => {if (p.hostname === "googleads.googleapis.com") change(f.state);};
    await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
  });
}
test("same credential ID with changed secret rejects collection", async () => {
  const f = fixture(); f.hooks.fetch = p => {if (p.hostname === "merchantapi.googleapis.com") f.token.access_token = "changed";};
  await assert.rejects(f.run()); assert.equal(f.calls.length, 2);
});
for (const change of [f => {f.token.permission_profile = "reporting_v1";}, f => {f.token.expires_at = f.state.now.toISOString();},
  f => {f.state.scopes = [f.state.scopes[0]];}]) test("invalid credential or missing identity grant stops without refresh", async () => {
  const f = fixture(); change(f); await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
});
for (const status of [401, 403, 429, 500]) test(`Merchant ${status} stops before link recheck, no retry`, async () => {
  const f = fixture(); f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && response({error: {message: "secret-native"}}, status);
  await assert.rejects(f.run(), e => e.message === "GOOGLE_IDENTITY_COLLECTION_FAILED"); assert.equal(f.calls.length, 2);
});
test("first transport error is sanitized and never retried", async () => {
  const f = fixture(); f.hooks.fetch = () => {throw Error("secret-credential-payload");};
  await assert.rejects(f.run(), /COLLECTION_FAILED/); assert.equal(f.calls.length, 1);
});
test("source records retain raw product and feed/language/dataSource/local context without parsing", async () => {
  const f = fixture(), raw = product("opaque/native/123"); raw.customAttributes = [{name: "shopify_product_id", value: "unproven"}];
  f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && response({products: [raw]});
  const r = await f.run(); raw.customAttributes[0].value = "changed";
  assert.equal(r.native_source.records[0].source_record.customAttributes[0].value, "unproven");
  assert.equal(r.native_source.records[0].product_context.content_language, "en");
  assert.equal(r.native_source.records[0].product_context.data_source, "accounts/99/dataSources/7");
});
test("cross-Merchant product response cannot become source evidence", async () => {
  const f = fixture(), raw = product(); raw.dataSource = "accounts/100/dataSources/7";
  f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && response({products: [raw]});
  await assert.rejects(f.run()); assert.equal(f.calls.length, 2);
});
test("authentic local quota wait survives shared reader sanitization", async () => {
  const managed = createQuotaManagedFetch({provider: "google_ads", guard: {execute: async () => ({status: "waiting"})},
    resolveOperation: async () => "a".repeat(64), lane: "background", fetchFn: async () => {throw Error("must not send");}});
  let control; try {await managed("https://googleads.googleapis.com/v25/customers/123/googleAds:search", {method: "POST"});} catch (error) {control = error;}
  assert.equal(quotaBoundaryControl(control).status, "waiting");
  const f = fixture(); f.hooks.fetch = p => {if (p.hostname === "merchantapi.googleapis.com") throw control;};
  await assert.rejects(f.run(), e => e === control); assert.equal(f.calls.length, 2);
});
test("abort during Merchant read reaches native request and prevents final link", async () => {
  const f = fixture(), controller = new AbortController(); f.options.signal = controller.signal;
  f.hooks.fetch = (p, init) => {assert.equal(init.signal, controller.signal); if (p.hostname === "merchantapi.googleapis.com") controller.abort();};
  await assert.rejects(f.run(), /ABORTED/); assert.equal(f.calls.length, 2);
});
test("observation window does not become a completed stale snapshot", async () => {
  const f = fixture(); f.hooks.fetch = p => {if (p.hostname === "merchantapi.googleapis.com") f.state.now = new Date(f.state.now.valueOf() + 121000);};
  await assert.rejects(f.run()); assert.equal(f.calls.length, 2);
});
test("invalid target/bounds stop before SQL or provider calls", async () => {
  const f = fixture(); f.options.merchantId = "99/100"; await assert.rejects(f.run(), /INPUT_INVALID/); assert.equal(f.queries.length, 0);
});
test("caller authority callback cannot replace persisted selected account", async () => {
  const f = fixture(); f.options.loadCurrent = () => {throw Error("must not use");}; assert.equal((await f.run()).account_id, "123");
});
