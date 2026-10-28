import test from "node:test";
import assert from "node:assert/strict";
import {createIdentityRuntimeAuthorityLoader} from "../app/lib/providers/identity-runtime-authority.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";

const workspace = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const credentialId = "33333333-3333-4333-8333-333333333333";
const date = new Date("2026-10-27T14:00:00.000Z");
function fixture(provider = "google_ads") {
  const state = {provider, version: 2, status: "connected", credentialId, connectionId,
    generation: 3, workspace, account: provider === "meta" ? "act_123" : provider === "klaviyo" ? "AbCd" : "123",
    scopes: provider === "klaviyo" ? ["campaigns:read", "events:read", "flows:read", "metrics:read"] : [...oauthPermissionScopes(provider, "identity_v1")]};
  const calls = [], vaultCalls = [], verified = {
    installationAuthority: {authority: "shopify_installation_verified", status: "active", workspaceId: workspace, installGeneration: 3},
    identity: {session: {authority: "shopify_id_token_verified", shopDomain: "test.myshopify.com"},
      shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"}},
    context: {admin: {graphql() {throw Error("no native call authorized in this loader");}}},
  };
  let token = {access_token: "secret-access", refresh_token: "secret-refresh", scope: state.scopes.join(" "), scopes: [...state.scopes],
    permission_profile: "identity_v1", scope_verified_at: date.toISOString(), expires_in: 3600,
    expires_at: "2026-10-27T15:00:00.000Z", scope_source: "retained_previous_grant", scope_observed_at: null};
  const db = {async query(sql, params) {
    calls.push({sql, params});
    await hooks.query?.(sql, params);
    if (sql.includes("load_provider_identity_authority")) return {rows: state.accountCredentialId && state.accountCredentialId!==state.credentialId ? [] : [{
      installation_id: String(state.installationId ?? "42"),workspace_id:state.workspace,install_generation:state.generation,installation_status:"active",
      shop_id:"gid://shopify/Shop/12",shop_domain:"test.myshopify.com",connection_id:state.connectionId,credential_id:state.credentialId,connection_version:state.version,lifecycle_status:state.status,
      granted_scopes:[...state.scopes],reporting_account_id:provider==="klaviyo"?null:state.account,reporting_selection_epoch:provider==="klaviyo"?null:String(state.selectionEpoch ?? "71"),
      accounts:hooks.accounts?.() ?? [{id:state.account,kind:provider==="klaviyo"?"account":"advertiser",status:"active",reporting_eligible:true,
        login_account_id:provider==="google_ads"?"456":null}]}]};
    throw Error("unexpected SQL");
  }};
  const hooks = {};
  const tokenVault = {async loadProviderTokenSet(input) {vaultCalls.push(input); await hooks.vault?.(); return token;}};
  const options = {verified, database: db, tokenVault, provider, now: () => date};
  return {state, calls, vaultCalls, verified, hooks, options, token, setToken(v) {token = v;}, create: () => createIdentityRuntimeAuthorityLoader(options)};
}
for (const provider of ["google_ads", "meta", "klaviyo"]) test(`${provider}: concrete scoped SQL and vault reads without canonical-ready claim`, async () => {
  const f = fixture(provider), result = await f.create().loadCurrent();
  assert.equal(result.connectionId, connectionId); assert.equal(result.connectionVersion, 2);
  assert.equal(result.account.id, f.state.account); assert.equal(result.account.name, undefined);
  assert.equal(result.installation_id, "42"); assert.equal(result.reporting_selection_epoch,provider==="klaviyo"?null:"71"); assert.equal(result.canonical_scope_ready, false);
  assert.equal(result.native_permission_revalidated, false); assert.equal(result.persistable, false);
  assert.equal(result.authorizes_activation, false); assert.equal(f.calls.length, 2); assert.equal(f.vaultCalls.length, 1);
  assert.deepEqual(f.vaultCalls[0], {credentialId, installationAuthority: f.verified.installationAuthority, provider});
  assert.ok(f.calls.every(c => /^select \*/.test(c.sql))); assert.ok(Object.isFrozen(result.tokenSet));
  assert.ok(f.calls.every(c => JSON.stringify(c.params) === JSON.stringify([workspace, 3, provider,"gid://shopify/Shop/12","test.myshopify.com"])));
});
test("never fabricates internal installation key from caller or generation", async () => {
  const f = fixture(); f.verified.installationAuthority.installation_id = "999";
  const r = await f.create().loadCurrent(); assert.equal(r.installation_id, "42"); assert.equal(r.installation.installation_id, undefined);
});
test("caller input detached before async reads", async () => {
  const f = fixture(), loader = f.create(); f.verified.identity.shop.shopId = "gid://shopify/Shop/99";
  const r = await loader.loadCurrent(); assert.equal(r.shop.shopId, "gid://shopify/Shop/12");
});
for (const change of [f => {f.verified.identity.session.shopDomain = "other.myshopify.com";},
  f => {f.verified.installationAuthority.authority = "browser";}, f => {delete f.verified.context.admin;}]) {
  test("reject unverified/mismatched server caller before reads", () => {
    const f = fixture(); change(f); assert.throws(f.create); assert.equal(f.calls.length, 0);
  });
}
for (const change of [s => {s.generation++;}, s => {s.workspace = connectionId;}, s => {s.status = "disconnect_pending";},
  s => {s.version = 0;}, s => {s.credentialId = null;}, s => {s.accountCredentialId = workspace;}, s => {s.scopes = ["ads_read"]; }]) {
  test("invalid current installation, connection, or scopes blocks vault", async () => {
    const f = fixture(); change(f.state); await assert.rejects(f.create().loadCurrent()); assert.equal(f.vaultCalls.length, 0);
  });
}
test("credential rotation during vault read discards result and poisons execution", async () => {
  const f = fixture(), loader = f.create(); f.hooks.vault = () => {f.state.version++;};
  await assert.rejects(loader.loadCurrent(), /AUTHORITY_CHANGED/);
  const count = f.calls.length; await assert.rejects(loader.loadCurrent(), /EXECUTION_STOPPED/); assert.equal(f.calls.length, count);
});
test("account selection change between successful loads rejected", async () => {
  const f = fixture(), loader = f.create(); await loader.loadCurrent(); f.state.account = "789";
  await assert.rejects(loader.loadCurrent(), /AUTHORITY_CHANGED/);
});

for(const field of ["selectionEpoch","installationId"])test(`SQL ${field} change during vault read cannot revive the same account`,async()=>{
  const f=fixture(),loader=f.create();f.hooks.vault=()=>{f.state[field]="9007199254740993";};
  await assert.rejects(loader.loadCurrent(),/AUTHORITY_CHANGED/);assert.equal(f.vaultCalls.length,1);
  await assert.rejects(loader.loadCurrent(),/EXECUTION_STOPPED/);
});
test("SQL bigint installation and selection keys stay lossless strings",async()=>{
  const f=fixture();f.state.installationId="9007199254740993";f.state.selectionEpoch="9007199254740995";
  const r=await f.create().loadCurrent();assert.equal(r.installation_id,"9007199254740993");assert.equal(r.reporting_selection_epoch,"9007199254740995");
  assert.equal(r.persistable,false);assert.equal(r.canonical_scope_ready,false);
});
test("same-account selection epoch changes between completed reads invalidate the loader",async()=>{
  const f=fixture(),loader=f.create();await loader.loadCurrent();f.state.selectionEpoch="72";
  await assert.rejects(loader.loadCurrent(),/AUTHORITY_CHANGED/);assert.equal(f.state.account,"123");
});
for(const field of ["installationId","selectionEpoch"])for(const value of ["0","01","9223372036854775808","1.5","1e3"])
  test(`invalid SQL ${field} ${value} stops before vault`,async()=>{
    const f=fixture();f.state[field]=value;await assert.rejects(f.create().loadCurrent(),/AUTHORITY_READ_FAILED/);assert.equal(f.vaultCalls.length,0);
  });
test("unchanged context can reload without metadata/token caching", async () => {
  const f = fixture(), loader = f.create(); await loader.loadCurrent(); await loader.loadCurrent();
  assert.equal(f.calls.length, 4); assert.equal(f.vaultCalls.length, 2);
});
test("same credential ID with changed token is rejected on next load", async () => {
  const f = fixture(), loader = f.create(); await loader.loadCurrent(); f.token.access_token = "changed";
  await assert.rejects(loader.loadCurrent(), /AUTHORITY_CHANGED/);
});
test("missing vault token stops without a provider request or secret leak", async () => {
  const f = fixture(); f.hooks.vault = () => {throw Error("secret-credential-payload");};
  await assert.rejects(f.create().loadCurrent(), e => !e.message.includes("secret") && /AUTHORITY_READ_FAILED/.test(e.message));
  assert.equal(f.vaultCalls.length, 1); assert.equal(f.calls.length, 1);
});
for (const provider of ["google_ads", "klaviyo"]) test(`${provider}: expired token never refreshes`, async () => {
  const f = fixture(provider); f.token.expires_at = date.toISOString(); await assert.rejects(f.create().loadCurrent());
  assert.equal(f.calls.length, 1); assert.equal(f.vaultCalls.length, 1);
});
test("reporting-only Meta token cannot enter identity execution", async () => {
  const f = fixture("meta"); delete f.token.permission_profile;
  await assert.rejects(f.create().loadCurrent(), /IDENTITY_PROFILE_REQUIRED/);
});
test("native token scopes cannot be padded from stored connection scopes", async () => {
  const f = fixture("klaviyo"); f.token.scopes = ["events:read"];
  await assert.rejects(f.create().loadCurrent(), /TOKEN_SCOPE_MISMATCH/);
});
test("Klaviyo retained scope provenance remains old/null", async () => {
  const f = fixture("klaviyo"), r = await f.create().loadCurrent();
  assert.equal(r.tokenSet.scope_source, "retained_previous_grant"); assert.equal(r.tokenSet.scope_observed_at, null);
});
test("multiple Klaviyo accounts never selects first", async () => {
  const f = fixture("klaviyo"); f.hooks.accounts = () => [{id: "one"}, {id: "two"}];
  await assert.rejects(f.create().loadCurrent(), /ACCOUNT_INVALID/); assert.equal(f.vaultCalls.length, 0);
});
test("abort during vault read prevents acceptance", async () => {
  const f = fixture(), control = new AbortController(); f.options.signal = control.signal;
  f.hooks.vault = () => control.abort(); await assert.rejects(f.create().loadCurrent(), /ABORTED/);
});
test("SQL read failure stops at first read with sanitized error", async () => {
  const f = fixture(); f.hooks.query = () => {throw Error("secret-sql");};
  await assert.rejects(f.create().loadCurrent(), /AUTHORITY_READ_FAILED/); assert.equal(f.calls.length, 1);
});
test("concurrent loader reads do not race baseline", async () => {
  const f = fixture(); let release; f.hooks.vault = () => new Promise(resolve => {release = resolve;});
  const loader = f.create(), first = loader.loadCurrent();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(loader.loadCurrent(), /CONCURRENT_LOAD/); release(); await first;
});
test("invalid native token cannot trigger a second DB collection", async () => {
  const f = fixture(); f.token.access_token = "contains\u0001control";
  await assert.rejects(f.create().loadCurrent(), /TOKEN_INVALID/); assert.equal(f.calls.length, 1);
});
test("frozen result does not freeze or mutate vault's original object", async () => {
  const f = fixture(), r = await f.create().loadCurrent();
  f.token.access_token = "still mutable vault copy"; assert.equal(r.tokenSet.access_token, "secret-access");
});
test("Google manager route is read from the selected persisted account", async () => {
  const f = fixture(), r = await f.create().loadCurrent(); assert.equal(r.account.login_account_id, "456");
});
test("non-identity Google token rejected without refreshing", async () => {
  const f = fixture(); delete f.token.permission_profile;
  await assert.rejects(f.create().loadCurrent(), /AUTHORITY_READ_FAILED/); assert.equal(f.calls.length, 1);
});

test("abort on return from each SQL read stops before the next SQL or vault dependency", async () => {
  for (const at of [1, 2]) {
    const f = fixture(), caller = new AbortController(); f.options.signal = caller.signal;
    f.hooks.query = () => {if (f.calls.length === at) caller.abort();};
    await assert.rejects(f.create().loadCurrent(), /IDENTITY_RUNTIME_ABORTED/);
    assert.equal(f.calls.length, at); assert.equal(f.vaultCalls.length, at === 1 ? 0 : 1);
  }
});
