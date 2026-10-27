import test from "node:test";
import assert from "node:assert/strict";
import {collectMetaNativeIdentityEvidence} from "../app/lib/providers/meta-identity-collection.server.js";
import {readMetaCatalogIdentitySnapshot, matchMetaCatalogProductIdentity} from "../app/lib/providers/meta-catalog-identity-reader.server.js";
import {readMetaAdCatalogReference} from "../app/lib/providers/meta-adset-catalog-reference.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createQuotaManagedFetch, quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";

const workspace = "11111111-1111-4111-8111-111111111111", connection = "22222222-2222-4222-8222-222222222222",
  credential = "33333333-3333-4333-8333-333333333333";
function response(body, status = 200) {return {ok: status === 200, status, headers: {get: () => null}, json: async () => body};}
function fixture() {
  const calls = [], queries = [], hooks = {}, scopes = [...oauthPermissionScopes("meta", "identity_v1")];
  const state = {version: 2, account: "act_123", generation: 3, status: "connected", scopes,
    now: new Date("2026-10-27T15:00:00.000Z")};
  const verified = {installationAuthority: {authority: "shopify_installation_verified", workspaceId: workspace, installGeneration: 3, status: "active"},
    identity: {session: {authority: "shopify_id_token_verified", shopDomain: "test.myshopify.com"},
      shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"}},
    context: {admin: {graphql() {throw Error("native collection must not query Shopify");}}}};
  const token = {access_token: "secret-access", permission_profile: "identity_v1", scopes: [...scopes],
    expires_at: "2026-10-27T16:00:00.000Z", scope_verified_at: state.now.toISOString()};
  const native = {
    debug_token: {data: {app_id: "123", is_valid: true, scopes: [...scopes], expires_at: state.now.valueOf() / 1000 + 3600,
      data_access_expires_at: state.now.valueOf() / 1000 + 7200}},
    "66": {id: "66", account_id: "123", adset_id: "77", campaign_id: "55", creative: {id: "99"}},
    "77": {id: "77", account_id: "123", campaign_id: "55", promoted_object: {product_set_id: "88"}},
    "88": {id: "88", product_catalog: {id: "456"}},
    "99": {id: "99", account_id: "123", product_set_id: "88"},
    products: {data: [{id: "900", retailer_id: "shopify_US_10_20", product_catalog: {id: "456"}, product_feed: {id: "100"}}]}
  };
  const database = {async query(sql, params) {
    queries.push({sql, params}); await hooks.query?.(sql);
    if (sql.includes("resolve_active_installation")) return {rows: [{workspace_id: workspace, install_generation: state.generation, installation_status: "active"}]};
    if (sql.includes("load_provider_connection_lifecycle_by_owner")) return {rows: [{connection_id: connection, credential_id: credential,
      lifecycle_status: state.status, connection_version: state.version}]};
    if (sql.includes("load_provider_account_authority")) return {rows: [{connection_id: connection, credential_id: credential,
      reporting_account_id: state.account, granted_scopes: [...state.scopes], accounts: [{id: state.account, kind: "advertiser",
        reporting_eligible: true, login_account_id: null}]}]};
    throw Error("unexpected SQL");
  }};
  const fetchFn = async (endpoint, init) => {
    const parsed = new URL(endpoint); calls.push({parsed, init});
    const custom = await hooks.fetch?.(parsed, init, calls.length); if (custom) return custom;
    assert.equal(parsed.hostname, "graph.facebook.com");
    const key = parsed.pathname.split("/").at(-1); assert.ok(native[key], `unexpected ${key}`);
    return response(structuredClone(native[key]));
  };
  const options = {verified, database, tokenVault: {loadProviderTokenSet: async () => token},
    config: {appId: "123", appSecret: "secret-app", graphVersion: "v26.0"},
    adId: "66", adSetId: "77", campaignId: "55", catalogId: "456", fetchFn, now: () => state.now};
  return {options, state, native, token, hooks, calls, queries, run: () => collectMetaNativeIdentityEvidence(options)};
}

test("concrete SQL/vault loader composes actual token, Ad/creative/catalog observations with no invented canonical scope", async () => {
  const f = fixture(), r = await f.run();
  assert.equal(f.calls.length, 10); assert.equal(r.provider_link_verified, true);
  assert.equal(r.native_source.records[0].retailer_id, "shopify_US_10_20");
  assert.equal(r.native_source.scope, undefined); assert.equal(r.link_evidence.before.scope, undefined);
  assert.equal(r.installation_id, null); assert.equal(r.canonical_scope_ready, false);
  assert.equal(r.proves_product_delivery_or_Insights_namespace, false); assert.equal(r.persistable, false);
  assert.equal(r.authorizes_activation, false); assert.equal(r.mapping_write_performed, false);
  assert.equal(r.native_source.records[0].shopify_product_id, undefined); assert.ok(Object.isFrozen(r.native_source.records));
  assert.ok(!/secret-access|secret-app|credentialId/.test(JSON.stringify(r)));
  assert.ok(f.queries.every(q => q.sql.startsWith("select *")));
  assert.ok(f.calls.every(c => c.init.redirect === "error"));
  assert.equal(f.calls[0].parsed.pathname, "/v26.0/debug_token");
  assert.equal(f.calls[0].init.headers.authorization, "Bearer 123|secret-app");
  assert.ok(f.calls.slice(1).every(c => c.parsed.searchParams.has("appsecret_proof")));
  assert.throws(() => matchMetaCatalogProductIdentity(r.native_source, {catalogId: "456", namespace: "retailer_id", productId: "shopify_US_10_20"}), /CONTEXT_INVALID/);
});
test("canonical entry points still require installation PK before network", async () => {
  const f = fixture(); let calls = 0;
  for (const reader of [readMetaCatalogIdentitySnapshot, readMetaAdCatalogReference]) {
    await assert.rejects(reader({authority: {workspace_id: workspace, installation_generation: 3, provider_connection_id: connection,
      platform: "meta", platform_account_id: "act_123", catalog_id: "456", granted_scopes: f.state.scopes},
    accessToken: "token", fetchFn: async () => {calls++;}}));
  }
  assert.equal(calls, 0);
});
for (const [name, change] of [["app", d => {d.app_id = "124";}], ["validity", d => {d.is_valid = false;}],
  ["native grants", d => {d.scopes.pop();}], ["native expiry", d => {d.expires_at = 1;}],
  ["malformed expiry", d => {d.expires_at = "invalid";}]]) test(`invalid ${name} stops before Ad request; stored grants cannot pad actual grants`, async () => {
  const f = fixture(); change(f.native.debug_token.data); await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
});
for (const [name, change] of [["Ad account", n => {n["66"].account_id = "124";}],
  ["Ad parent", n => {n["66"].adset_id = "78";}], ["campaign", n => {n["77"].campaign_id = "56";}],
  ["creative account", n => {n["99"].account_id = "124";}], ["catalog", n => {n["88"].product_catalog.id = "457";}],
  ["product catalog", n => {n.products.data[0].product_catalog.id = "457";}],
  ["missing relationship", n => {delete n["77"].promoted_object; delete n["99"].product_set_id;}]]) test(`native ${name} mismatch never produces completed evidence`, async () => {
  const f = fixture(); change(f.native); await assert.rejects(f.run()); assert.ok(f.calls.length < 10);
});
for (const [name, change] of [["version", f => {f.state.version++;}], ["selected account", f => {f.state.account = "act_124";}],
  ["generation", f => {f.state.generation++;}], ["disconnect", f => {f.state.status = "disconnect_pending";}],
  ["token secret", f => {f.token.access_token = "changed";}], ["stored grant", f => {f.state.scopes.pop();}]]) test(`${name} change during native JSON prevents another request`, async () => {
  const f = fixture(); f.hooks.fetch = () => {change(f);}; await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
});
test("before/after creative reference change discards all collected products", async () => {
  const f = fixture(); f.hooks.fetch = (p, init, n) => {
    if (n > 6 && p.pathname.endsWith("/99")) return response({id: "99", account_id: "123", product_set_id: null});
  };
  await assert.rejects(f.run(), /REFERENCE_CHANGED/); assert.equal(f.calls.length, 10);
});
test("catalog pagination crosses empty intermediate page and preserves exact catalog", async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname.endsWith("/products") && !p.searchParams.has("after")
    && response({data: [], paging: {cursors: {after: "next"}, next: "https://graph.facebook.com/v26.0/456/products?after=next"}});
  const r = await f.run(); assert.equal(r.native_source.pages, 2); assert.equal(f.calls.length, 11);
  assert.equal(f.calls[6].parsed.searchParams.get("after"), "next");
});
for (const status of [401, 403, 429, 500]) test(`native HTTP ${status} stops first time without retry`, async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname.endsWith("/products") && response({error: {message: "secret-native"}}, status);
  await assert.rejects(f.run(), e => e.message === "META_IDENTITY_COLLECTION_FAILED"); assert.equal(f.calls.length, 6);
});
test("expiry reached after product JSON prevents final native observation", async () => {
  const f = fixture(); f.native.debug_token.data.expires_at = f.state.now.valueOf() / 1000 + 60;
  f.hooks.fetch = p => {if (p.pathname.endsWith("/products")) f.state.now = new Date("2026-10-27T15:01:00Z");};
  await assert.rejects(f.run(), /META_IDENTITY_COLLECTION_FAILED/); assert.equal(f.calls.length, 6);
});
test("abort and observation deadline stop before another native call", async () => {
  for (const mode of ["abort", "deadline"]) {
    const f = fixture(), controller = new AbortController(); f.options.signal = controller.signal;
    f.hooks.fetch = () => {if (mode === "abort") controller.abort(); else f.state.now = new Date(f.state.now.valueOf() + 120001);};
    await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
  }
});
test("authentic quota waiting control survives lower reader sanitizers unchanged", async () => {
  let control;
  const managed = createQuotaManagedFetch({provider: "meta", guard: {execute: async () => ({status: "waiting"})},
    resolveOperation: async () => "a".repeat(64), lane: "background", fetchFn: async () => {throw Error("must not send");}});
  try {await managed("https://graph.facebook.com/v26.0/debug_token");} catch (e) {control = e;}
  assert.equal(quotaBoundaryControl(control).status, "waiting");
  const f = fixture(); f.hooks.fetch = p => {if (p.pathname.endsWith("/products")) throw control;};
  await assert.rejects(f.run(), e => e === control); assert.equal(f.calls.length, 6);
});
test("invalid config, targets and stored reporting-only credential fail before native request", async () => {
  for (const change of [f => {f.options.config.graphVersion = "v19.0";}, f => {f.options.adId = "66/evil";},
    f => {f.token.permission_profile = "reporting_v1";}]) {
    const f = fixture(); change(f); await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
  }
});
