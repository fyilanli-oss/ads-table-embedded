import assert from "node:assert/strict";
import test from "node:test";
import {createCombinedSetupAssetDiscovery} from "../app/lib/oauth/combined-setup-asset-discovery.server.js";
import {createPermissionSettings} from "../app/lib/shopify/permission-settings.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {permissionResponseMatches} from "../app/lib/ui/permission-settings-response.js";

const workspace = "11111111-1111-4111-8111-111111111111", connection = "22222222-2222-4222-8222-222222222222",
  credential = "33333333-3333-4333-8333-333333333333";
const response = (value, status = 200) => new Response(JSON.stringify(value), {status});
function fixture(provider, options = {}) {
  const state = {time: Date.now(), version: 7, account: provider === "meta" ? "act_123" : "123"};
  const calls = [], queries = [];
  const scopes = oauthPermissionScopes(provider, "identity_v1");
  const verified = {installationAuthority: {authority: "shopify_installation_verified", status: "active", workspaceId: workspace, installGeneration: 3},
    identity: {session: {authority: "shopify_id_token_verified", shopDomain: "test.myshopify.com"},
      shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"}},
    context: {admin: {graphql: () => assert.fail()}}};
  const token = {access_token: "synthetic-secret", refresh_token: "synthetic-refresh", permission_profile: "identity_v1",
    scope: scopes.join(" "), scopes, expires_in: 3600, scope_verified_at: new Date(state.time).toISOString(), expires_at: new Date(state.time + 3600000).toISOString()};
  const database = {query: async (sql, params) => {
    assert.match(sql, /^select \*.*load_provider_identity_authority/);
    queries.push(sql);
    assert.deepEqual(params, [workspace, 3, provider, "gid://shopify/Shop/12", "test.myshopify.com"]);
    return {rows: [{installation_id: "42", workspace_id: workspace, install_generation: 3, installation_status: "active",
      shop_id: "gid://shopify/Shop/12", shop_domain: "test.myshopify.com", connection_id: connection,
      connection_version: state.version, lifecycle_status: "connected", credential_id: credential, granted_scopes: scopes,
      reporting_account_id: state.account, reporting_selection_epoch: "71", accounts: [{id: state.account, kind: "advertiser",
        reporting_eligible: true, status: "active", login_account_id: null}]}]};
  }};
  const tokenVault = {loadProviderTokenSet: async () => token};
  let inspections = 0;
  const fetchFn = async (address, init) => {
    const target = new URL(address); calls.push(target);
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.ok(init.signal instanceof AbortSignal);
    const custom = await options.respond?.(target, state, calls);
    if (custom) return custom;
    if (target.hostname === "merchantapi.googleapis.com") return response({accounts: [{name: "accounts/99", accountId: "99", accountName: "Store", businessInfo: "discard"}]});
    if (target.pathname.endsWith("/debug_token")) {
      inspections++;
      return response({data: {is_valid: true, app_id: "123", scopes: options.removedGrant && inspections > 1 ? ["ads_read"] : scopes,
        expires_at: Math.floor(state.time / 1000) + 3600, user_id: "discard-private-user"}});
    }
    if (target.pathname.endsWith("/me/businesses")) return response({data: [{id: "88", name: "Business", extra: "discard"}]});
    if (target.pathname.endsWith("/owned_product_catalogs") || target.pathname.endsWith("/client_product_catalogs")) {
      return response({data: [{id: "77", name: "Catalog"}]});
    }
    assert.fail("Unexpected native endpoint");
  };
  const discoverer = createCombinedSetupAssetDiscovery({provider, enabled: options.enabled ?? true, database, tokenVault,
    config: {appId: "123", appSecret: "synthetic-app-secret", graphVersion: "v26.0"}, fetchFn,
    now: () => new Date(state.time), maxPages: options.maxPages ?? 100, maxRows: options.maxRows ?? 10000});
  const expectedConnection = {connectionId: connection, version: 7, reportingAccountId: state.account};
  const input = {verified, installationAuthority: verified.installationAuthority, expectedConnection};
  return {state, calls, queries, input, discoverer, run: more => discoverer.discover({...input, ...more})};
}

for (const provider of ["google_ads", "meta"]) {
  test(`${provider}: candidate discovery is owner/binding scoped and never asset access or activation proof`, async () => {
    const f = fixture(provider), value = await f.run();
    assert.equal(value.provider, provider); assert.equal(value.complete, true);
    assert.equal(value.connectionId, connection); assert.equal(value.connectionVersion, 7);
    assert.equal(value.assetAccessVerified, false); assert.equal(value.persisted, false); assert.equal(value.authorizesActivation, false);
    assert.equal(value.candidateKind, provider === "meta" ? "businesses" : "merchant_accounts");
    assert.ok(Object.isFrozen(value.candidates));
    assert.doesNotMatch(JSON.stringify(value), /synthetic-secret|synthetic-app-secret|discard|access_token/);
    assert.ok(f.queries.length > f.calls.length);
  });
  test(`${provider}: closed gate and stale binding cannot dispatch native requests`, async () => {
    const closed = fixture(provider, {enabled: false});
    await assert.rejects(closed.run(), /DISABLED/);
    assert.equal(closed.queries.length, 0); assert.equal(closed.calls.length, 0);
    const stale = fixture(provider);
    await assert.rejects(stale.run({expectedConnection: {...stale.input.expectedConnection, version: 6}}), /CONNECTION_CHANGED/);
    assert.equal(stale.calls.length, 0);
  });
  test(`${provider}: first HTTP failure stops without retries, partial lists or alternate edges`, async () => {
    const f = fixture(provider, {respond: () => response({error: {message: "synthetic-secret"}}, 429)});
    await assert.rejects(f.run(), error => !JSON.stringify(error).includes("synthetic-secret"));
    assert.equal(f.calls.length, 1);
  });
  test(`${provider}: a connection change during a native read stops the execution`, async () => {
    const f = fixture(provider, {respond: (target, state) => { state.version++; return response({}); }});
    await assert.rejects(f.run());
    assert.equal(f.calls.length, 1);
  });
  test(`${provider}: the displayed binding is captured before the first await`, async () => {
    const f = fixture(provider), expectedConnection = {...f.input.expectedConnection};
    const pending = f.run({expectedConnection}); expectedConnection.version = 8;
    assert.equal((await pending).connectionVersion, 7);
  });
}

test("Google pages use a fixed host and opaque token; a complete empty proto list is distinct from an error", async () => {
  const f = fixture("google_ads", {respond: target => response(target.searchParams.has("pageToken")
    ? {accounts: [{name: "accounts/100", accountId: "100", accountName: "Second"}]}
    : {accounts: [{name: "accounts/99", accountId: "99", accountName: "First"}], nextPageToken: "opaque"})});
  assert.deepEqual((await f.run()).candidates.map(value => value.id), ["99", "100"]);
  assert.equal(f.calls[1].searchParams.get("pageToken"), "opaque");
  assert.ok(f.calls.every(value => value.hostname === "merchantapi.googleapis.com" && value.searchParams.get("pageSize") === "100"));
  const empty = fixture("google_ads", {respond: () => response({})});
  const result = await empty.run(); assert.deepEqual(result.candidates, []); assert.equal(result.complete, true);
});

for (const mode of ["cursor", "duplicate", "null_cursor", "rows", "pages"]) {
  test(`Google ${mode} does not expose a truncated or invalid candidate list`, async () => {
    const f = fixture("google_ads", {maxRows: mode === "rows" ? 1 : 100, maxPages: mode === "pages" ? 1 : 100,
      respond: target => response({accounts: [{name: `accounts/${mode === "cursor" && target.searchParams.has("pageToken") ? "100" : "99"}`,
        accountId: mode === "cursor" && target.searchParams.has("pageToken") ? "100" : "99", accountName: "First"},
        ...(mode === "rows" ? [{name: "accounts/100", accountId: "100", accountName: "Second"}] : [])],
        ...(mode === "null_cursor" ? {nextPageToken: null} : {nextPageToken: "same"})})});
    await assert.rejects(f.run());
    assert.ok(f.calls.length <= 2);
  });
}

test("Meta catalogs require a visible business and merge owned/client duplicates only when consistent", async () => {
  const f = fixture("meta"), result = await f.run({businessId: "88"});
  assert.equal(result.candidateKind, "catalogs"); assert.equal(result.businessId, "88");
  assert.deepEqual(result.candidates, [{id: "77", name: "Catalog"}]);
  assert.equal(f.calls.filter(value => value.pathname.endsWith("/debug_token")).length, 2);
  const unknown = fixture("meta"); await assert.rejects(unknown.run({businessId: "999"}), /BUSINESS_NOT_VISIBLE/);
  assert.equal(unknown.calls.some(value => value.pathname.includes("product_catalogs")), false);
});

test("Meta pagination never follows provider-supplied next addresses", async () => {
  const f = fixture("meta", {respond: target => {
    if (!target.pathname.endsWith("/me/businesses")) return;
    return response(target.searchParams.has("after") ? {data: [{id: "89", name: "Second"}]}
      : {data: [{id: "88", name: "First"}], paging: {next: "https://evil.example/secret", cursors: {after: "opaque"}}});
  }});
  assert.equal((await f.run()).candidates.length, 2);
  assert.ok(f.calls.every(value => value.hostname === "graph.facebook.com"));
});

test("Meta an owned-edge failure cannot fall through to client catalogs; revoked grant discards all candidates", async () => {
  const failed = fixture("meta", {respond: target => target.pathname.endsWith("/owned_product_catalogs") ? response({}, 403) : undefined});
  await assert.rejects(failed.run({businessId: "88"}));
  assert.equal(failed.calls.some(value => value.pathname.endsWith("/client_product_catalogs")), false);
  const revoked = fixture("meta", {removedGrant: true}); await assert.rejects(revoked.run());
});

test("Meta rejects malformed page cursors and conflicting owned/client catalog names", async () => {
  const bad = fixture("meta", {respond: target => target.pathname.endsWith("/me/businesses")
    ? response({data: [], paging: {next: "opaque-next-without-cursor"}}) : undefined});
  await assert.rejects(bad.run(), /CURSOR_INVALID/);
  const conflict = fixture("meta", {respond: target => target.pathname.endsWith("/client_product_catalogs")
    ? response({data: [{id: "77", name: "Different catalog"}]}) : undefined});
  await assert.rejects(conflict.run({businessId: "88"}), /CATALOG_CONFLICT/);
});

test("closed discovery settings never construct a runtime; a forged discovery receipt is rejected", async () => {
  const f = fixture("meta");
  const closed = createPermissionSettings({providerRuntime: () => assert.fail("Closed gate must do no I/O")});
  assert.equal((await closed.discoverAssets({feature: "meta", verified: f.input.verified})).kind, "unavailable");
  const settings = createPermissionSettings({availability: {meta: true}, providerRuntime: () => ({combinedSetup: {
    discoverAssets: async args => ({...await f.discoverer.discover(args), assetAccessVerified: true}),
  }})});
  await assert.rejects(settings.discoverAssets({feature: "meta", verified: f.input.verified, expected: f.input.expectedConnection}), /DISCOVERY_UNCONFIRMED/);
});

test("server projection exposes fresh candidates only, with same bound context and no access claim", async () => {
  const f = fixture("google_ads");
  const settings = createPermissionSettings({availability: {google_ads: true}, providerRuntime: () => ({combinedSetup: {discoverAssets: args => f.discoverer.discover(args)}})});
  const reply = await settings.discoverAssets({feature: "google_ads", verified: f.input.verified, expected: f.input.expectedConnection});
  assert.deepEqual(reply.selection.assetOptions.candidates, [{id: "99", name: "Store"}]);
  assert.equal(reply.selection.assetOptions.accessVerified, false);
  assert.equal(permissionResponseMatches({...reply, requestId: "request"}, {requestId: "request", feature: "google_ads"}), true);
  assert.doesNotMatch(JSON.stringify(reply), /synthetic-secret|workspaceId|installGeneration/);
});
