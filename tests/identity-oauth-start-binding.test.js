import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {createOAuthTransactionBoundary, oauthInstallationAuthority, OAUTH_CALLBACK_URIS} from "../app/lib/oauth/oauth-transaction.server.js";
import {createIdentityOAuthAuthorization} from "../app/lib/oauth/identity-oauth-authorization.server.js";
import {bindOAuthPermissionProfile, identityOAuthBindingFromState, oauthPermissionProfileFromState, oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createGoogleOAuthRuntime} from "../app/lib/oauth/google-oauth-runtime.server.js";
import {createMetaOAuthRuntime} from "../app/lib/oauth/meta-oauth-runtime.server.js";

const id = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const owner = oauthInstallationAuthority({workspaceId: id(1), installGeneration: 2, status: "active"});
const now = () => new Date("2026-10-27T12:00:00.000Z");
const initial = {connectionId: null, version: null};
const row = {connectionId: id(2), version: 7, status: "pending_account_selection"};
const json = (body, status = 200) => new Response(JSON.stringify(body), {status});

test("server gate is closed by default and rejects non-boolean configuration", async () => {
  let reads = 0;
  const lifecycle = {async loadCurrent() {reads++; return null;}};
  const gate = createIdentityOAuthAuthorization({lifecycle});
  await assert.rejects(gate.beforeStart({installationAuthority: owner, provider: "meta", enabled: true}), /IDENTITY_OAUTH_START_DISABLED/);
  assert.equal(reads, 0);
  for (const enabled of ["true", 1, null]) assert.throws(() => createIdentityOAuthAuthorization({lifecycle, enabled}));
});
for (const current of [null, row, {...row, status: "reauthorization_required"}]) {
  test(`server gate reads actual owner/provider lifecycle and admits supported setup: ${current?.status ?? "initial"}`, async () => {
    const gate = createIdentityOAuthAuthorization({enabled: true, lifecycle: {async loadCurrent(input) {
      assert.deepEqual(input, {installationAuthority: owner, provider: "google_ads"}); return current;
    }}});
    assert.deepEqual(await gate.beforeStart({installationAuthority: owner, provider: "google_ads"}),
      current === null ? initial : {connectionId: id(2), version: 7});
  });
}
for (const status of ["connected", "disconnect_pending", "disconnected", "unknown"]) {
  test(`no implicit connected upgrade or disconnect revival: ${status}`, async () => {
    const gate = createIdentityOAuthAuthorization({enabled: true, lifecycle: {async loadCurrent() {return {...row, status};}}});
    await assert.rejects(gate.beforeStart({installationAuthority: owner, provider: "meta"}), /IDENTITY_OAUTH_/);
  });
}
test("callback binding checks initial/connection identity and version, not just provider scopes", async () => {
  let current = row;
  const gate = createIdentityOAuthAuthorization({enabled: true, lifecycle: {async loadCurrent() {return current;}}});
  const binding = await gate.beforeStart({installationAuthority: owner, provider: "meta"});
  await gate.beforeCallback({installationAuthority: owner, provider: "meta", binding});
  for (const changed of [null, {...row, version: 8}, {...row, connectionId: id(3)}]) {
    current = changed;
    await assert.rejects(gate.beforeCallback({installationAuthority: owner, provider: "meta", binding}), /IDENTITY_OAUTH_CONNECTION_CHANGED/);
  }
  current = row;
  await assert.rejects(gate.beforeCallback({installationAuthority: owner, provider: "meta", binding: initial}), /IDENTITY_OAUTH_CONNECTION_CHANGED/);
});
for (const version of [1, 7, Number.MAX_SAFE_INTEGER]) {
  test(`canonical connection binding survives state encoding at version ${version}`, () => {
    const expected = {connectionId: id(2), version};
    const state = bindOAuthPermissionProfile("meta", "a".repeat(43), "identity_v1", expected);
    assert.ok(state.length <= 128); assert.equal(oauthPermissionProfileFromState("meta", state), "identity_v1");
    assert.deepEqual(identityOAuthBindingFromState("meta", state), expected);
  });
}
for (const suffix of ["", ".initial.extra", `.${id(2)}.0`, `.${id(2)}.01`, `.${id(2)}.9007199254740992`,
  `.${id(2)}.-1`, ".bad.7", ".INITIAL"]) {
  test(`invalid or unbound identity state is not callback authority: ${suffix || "legacy marker"}`, () => {
    assert.throws(() => identityOAuthBindingFromState("google_ads", "a".repeat(43) + ".identity-v1" + suffix));
  });
}

function boundaryHarness(provider, binding = {connectionId: id(2), version: 7}) {
  let saved, consumed = false, vaultReads = 0;
  const boundary = createOAuthTransactionBoundary({now, identityStartGuard: async () => binding,
    randomBytesFn: size => Buffer.alloc(size, 4),
    repository: {
      async create(input) {saved = input; return {transactionId: id(3), callbackUri: OAUTH_CALLBACK_URIS[provider], pkceRequired: provider === "google_ads", status: "created", expiresAt: "2026-10-27T12:10:00.000Z"};},
      async markRedirected() {return {status: "redirected"};},
      async claim(input) {
        if (consumed || !input.stateDigest.equals(saved.stateDigest) || input.provider !== provider) return {status: "missing"};
        consumed = true; return {status: "claimed", transactionId: id(3), provider, workspaceId: owner.workspaceId,
          installGeneration: 2, callbackUri: OAUTH_CALLBACK_URIS[provider], pkceRequired: provider === "google_ads"};
      }, async complete() {}, async invalidate() {},
    }, verifierVault: {async assertReady() {}, async store() {}, async remove() {}, async take() {vaultReads++; return "verifier";}},
  });
  return {boundary, saved: () => saved, vaultReads: () => vaultReads};
}
for (const provider of ["meta", "google_ads"]) {
  test(`${provider}: full state binds server-read connection version; form/callback binding cannot override it`, async () => {
    const h = boundaryHarness(provider);
    const start = await h.boundary.begin({installationAuthority: owner, provider, permissionProfile: "identity_v1", identityBinding: initial});
    assert.deepEqual(h.saved().stateDigest, createHash("sha256").update(start.state, "ascii").digest());
    assert.equal("identityBinding" in h.saved(), false);
    for (const altered of [start.state.replace(/\.7$/, ".8"), start.state.replace(id(2), id(4)),
      start.state.slice(0, 43) + ".identity-v1.initial"]) {
      await assert.rejects(h.boundary.claimCallback({provider, state: altered, code: "code"}), /OAUTH_TRANSACTION_MISSING/);
    }
    assert.equal(h.vaultReads(), 0);
    const claimed = await h.boundary.claimCallback({provider, state: start.state, code: "code", identityBinding: initial});
    assert.deepEqual(claimed.identityBinding, {connectionId: id(2), version: 7});
    assert.equal(claimed.installGeneration, 2); assert.equal(claimed.workspaceId, owner.workspaceId);
    await assert.rejects(h.boundary.claimCallback({provider, state: start.state, code: "code"}), /OAUTH_TRANSACTION_MISSING/);
  });
}

function runtimeHarness(provider, {enabled = false, changedDuringRead = false, current = null} = {}) {
  const calls = [], writes = [], vault = [], lifecycleReads = [];
  let currentRow = current;
  const database = {async query(sql, values) {
    if (sql.includes("load_provider_connection_lifecycle_by_owner")) {lifecycleReads.push(values); return {rows: currentRow ? [{
      connection_id: currentRow.connectionId, connection_version: currentRow.version, lifecycle_status: currentRow.status, credential_id: id(4)}] : []};}
    if (sql.includes("complete_oauth_transaction")) {writes.push(values[1]); return {rows: [{transaction_id: id(3), transaction_status: values[1]}]};}
    if (sql.includes("stage_provider_account_selection")) {writes.push("stage"); return {rows: [{connection_id: id(2), connection_version: 1, lifecycle_status: "pending_account_selection", granted_scopes: values[4]}]};}
    if (sql.includes("resolve_active_installation_callback_return")) return {rows: [{shop_domain: "example.myshopify.com"}]};
    throw new Error("UNEXPECTED_SQL");
  }};
  const tokenVault = {async assertReady() {}, async store() {}, async take() {}, async remove() {},
    async storeProviderTokenSet() {vault.push("store"); return {credentialId: id(4)};},
    async deleteProviderTokenSet() {vault.push("delete");}};
  const environment = provider === "google_ads" ? {GOOGLE_ADS_OAUTH_CLIENT_ID: "client", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "secret", GOOGLE_ADS_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.google_ads}
    : {META_APP_ID: "123", META_APP_SECRET: "secret", META_GRAPH_VERSION: "v26.0", META_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.meta};
  const runtime = (provider === "google_ads" ? createGoogleOAuthRuntime : createMetaOAuthRuntime)({database, tokenVault, environment, now,
    identityAuthorizationEnabled: enabled, randomUUIDFn: () => id(2), fetchFn: async address => {
      calls.push(address);
      if (changedDuringRead) currentRow = {...row, version: 8};
      if (provider === "google_ads") {
        if (calls.length === 1) return json({access_token: "token", refresh_token: "refresh", token_type: "Bearer", expires_in: 3600, scope: oauthPermissionScopes(provider, "identity_v1").join(" ")});
        if (calls.length === 2) return json({resourceNames: ["customers/123"]});
        return json({results: [{customerClient: {id: "123", level: 0, manager: false}}]});
      }
      if (calls.length < 3) return json({access_token: "token"});
      if (calls.length === 3) return json({data: {app_id: "123", is_valid: true, scopes: oauthPermissionScopes(provider, "identity_v1"), expires_at: 1893456000}});
      return json({data: [{id: "act_123", name: "Shop"}]});
    }});
  return {runtime, calls, writes, vault, lifecycleReads};
}
const claimed = {status: "claimed", transactionId: id(3), workspaceId: owner.workspaceId, installGeneration: 2,
  permissionProfile: "identity_v1", identityBinding: initial, authorizationCode: "code", pkceVerifier: "verifier"};
for (const provider of ["meta", "google_ads"]) {
  test(`${provider}: runtime default and call arguments cannot enable identity start or callback`, async () => {
    const h = runtimeHarness(provider);
    await assert.rejects(h.runtime.oauthBoundary.begin({installationAuthority: owner, provider, permissionProfile: "identity_v1", identityAuthorizationEnabled: true}), /IDENTITY_OAUTH_START_DISABLED/);
    await assert.rejects(h.runtime.completeCallback({claimed}), /IDENTITY_OAUTH_START_DISABLED/);
    assert.equal(h.calls.length, 0); assert.equal(h.lifecycleReads.length, 0);
    assert.deepEqual(h.vault, []); assert.deepEqual(h.writes, ["failed"]);
  });
  test(`${provider}: real lifecycle validates active installation before creating identity intent`, async () => {
    const h = runtimeHarness(provider, {enabled: true});
    await assert.rejects(h.runtime.oauthBoundary.begin({installationAuthority: {...owner, status: "inactive"}, provider, permissionProfile: "identity_v1"}), /INSTALLATION_REQUIRED/);
    assert.equal(h.lifecycleReads.length, 0); assert.equal(h.calls.length, 0);
  });
  test(`${provider}: connection created or changed after initial consent prevents token exchange`, async () => {
    const h = runtimeHarness(provider, {enabled: true, current: row});
    await assert.rejects(h.runtime.completeCallback({claimed}), /IDENTITY_OAUTH_CONNECTION_CHANGED/);
    assert.equal(h.calls.length, 0); assert.deepEqual(h.vault, []);
    assert.deepEqual(h.lifecycleReads[0], [owner.workspaceId, 2, provider]);
  });
  test(`${provider}: connection change during provider reads stops before selection storage`, async () => {
    const h = runtimeHarness(provider, {enabled: true, changedDuringRead: true});
    await assert.rejects(h.runtime.completeCallback({claimed}), /IDENTITY_OAUTH_CONNECTION_CHANGED/);
    assert.deepEqual(h.vault, ["store", "delete"]);
    assert.deepEqual(h.writes, ["failed"]);
    assert.equal(h.lifecycleReads.length, 2);
    assert.equal(h.calls.length, provider === "meta" ? 4 : 3);
  });
  test(`${provider}: unchanged initial binding completes existing scope-checked callback in isolated tests`, async () => {
    const h = runtimeHarness(provider, {enabled: true});
    assert.equal((await h.runtime.completeCallback({claimed})).outcome, "pending_account_selection");
    assert.deepEqual(h.writes, ["stage", "exchanged"]); assert.equal(h.lifecycleReads.length, 2);
  });
  test(`${provider}: unbound identity callback is rejected without provider calls`, async () => {
    const h = runtimeHarness(provider, {enabled: true});
    await assert.rejects(h.runtime.completeCallback({claimed: {...claimed, identityBinding: undefined}}), /OAUTH_IDENTITY_BINDING_INVALID/);
    assert.equal(h.calls.length, 0);
  });
}
