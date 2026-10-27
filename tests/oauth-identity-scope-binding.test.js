import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {createOAuthTransactionBoundary, oauthInstallationAuthority, OAUTH_CALLBACK_URIS} from "../app/lib/oauth/oauth-transaction.server.js";
import {oauthPermissionScopes, oauthPermissionProfile, oauthPermissionProfileFromState,
  bindOAuthPermissionProfile, validateIdentityOAuthGrantedScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {buildGoogleAdsAuthorizationUrl, exchangeGoogleAdsAuthorizationCode} from "../app/lib/providers/google-ads-rest.server.js";
import {buildMetaAuthorizationUrl, exchangeAndValidateMetaAuthorizationCode} from "../app/lib/providers/meta-graph.server.js";
import {createGoogleOAuthRuntime} from "../app/lib/oauth/google-oauth-runtime.server.js";
import {createMetaOAuthRuntime} from "../app/lib/oauth/meta-oauth-runtime.server.js";
import {identityPermissionRequirements} from "../app/lib/oauth/identity-permission-preflight.server.js";

const uuid = "11111111-1111-4111-8111-111111111111";
const txn = "22222222-2222-4222-8222-222222222222";
const now = () => new Date("2026-10-27T12:00:00.000Z");
const owner = oauthInstallationAuthority({workspaceId: uuid, installGeneration: 1, status: "active"});
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});
function boundary(provider) {
  let saved = null; let claimed = false;
  const calls = [];
  const values = new Map();
  const repo = {
    async create(input) {saved = input; calls.push("create"); return {transactionId: txn, callbackUri: OAUTH_CALLBACK_URIS[provider],
      pkceRequired: provider !== "meta", status: "created", expiresAt: "2026-10-27T12:10:00.000Z"};},
    async markRedirected() {return {status: "redirected"};},
    async claim(input) {calls.push("claim");
      if (input.provider !== provider || !input.stateDigest.equals(saved.stateDigest) || claimed) return {status: "missing"};
      claimed = true; return {transactionId: txn, workspaceId: uuid, installGeneration: 1, provider,
        callbackUri: OAUTH_CALLBACK_URIS[provider], pkceRequired: provider !== "meta", status: "claimed"};},
    async complete(input) {calls.push(input.outcome); return {status: input.outcome};},
    async invalidate() {calls.push("invalidate");},
  };
  const vault = {async assertReady() {}, async store(id, v) {values.set(id, v);},
    async take(id) {calls.push("take"); const v = values.get(id); values.delete(id); return v;}, async remove(id) {values.delete(id);}};
  let n = 0;
  return {api: createOAuthTransactionBoundary({repository: repo, verifierVault: vault, now, randomBytesFn: size => Buffer.alloc(size, ++n)}),
    calls, saved: () => saved};
}
for (const provider of ["google_ads", "meta"]) {
  test(`${provider}: identity purpose survives full digest claim and keeps original 32-byte state entropy`, async () => {
    const h = boundary(provider);
    const start = await h.api.begin({provider, installationAuthority: owner, permissionProfile: "identity_v1"});
    assert.match(start.state, /^[A-Za-z0-9_-]{43}\.identity-v1$/);
    assert.equal(start.permissionProfile, "identity_v1");
    assert.deepEqual(h.saved().stateDigest, createHash("sha256").update(start.state, "ascii").digest());
    assert.equal("permissionProfile" in h.saved(), false); assert.equal("state" in h.saved(), false);
    const result = await h.api.claimCallback({provider, state: start.state, code: "code"});
    assert.equal(result.permissionProfile, "identity_v1");
    assert.equal(result.workspaceId, uuid); assert.equal(result.installGeneration, 1);
    await assert.rejects(h.api.claimCallback({provider, state: start.state, code: "code"}), /OAUTH_TRANSACTION_MISSING/);
  });
  test(`${provider}: dropping or changing purpose cannot reuse the stored transaction`, async () => {
    const h = boundary(provider);
    const start = await h.api.begin({provider, installationAuthority: owner, permissionProfile: "identity_v1"});
    await assert.rejects(h.api.claimCallback({provider, state: start.state.slice(0, 43), code: "code"}), /OAUTH_TRANSACTION_MISSING/);
    assert.equal(h.calls.includes("take"), false);
    const result = await h.api.claimCallback({provider, state: start.state, code: "code", permissionProfile: "reporting_v1"});
    assert.equal(result.permissionProfile, "identity_v1");
  });
  test(`${provider}: reporting transactions cannot be upgraded by editing the returned state`, async () => {
    const h = boundary(provider);
    const start = await h.api.begin({provider, installationAuthority: owner});
    assert.equal(start.state.length, 43); assert.equal("permissionProfile" in start, false);
    await assert.rejects(h.api.claimCallback({provider, state: start.state + ".identity-v1", code: "code"}), /OAUTH_TRANSACTION_MISSING/);
    const result = await h.api.claimCallback({provider, state: start.state, code: "code", permissionProfile: "identity_v1"});
    assert.equal("permissionProfile" in result, false);
  });
  test(`${provider}: denied identity consent never takes the verifier for an exchange`, async () => {
    const h = boundary(provider);
    const start = await h.api.begin({provider, installationAuthority: owner, permissionProfile: "identity_v1"});
    const result = await h.api.claimCallback({provider, state: start.state, providerError: "access_denied"});
    assert.equal(result.status, "denied"); assert.equal(h.calls.includes("take"), false);
  });
  test(`${provider}: request scope target equals the permission preflight target`, () => {
    assert.deepEqual(oauthPermissionScopes(provider, "identity_v1"), identityPermissionRequirements({provider}).scopes);
  });
}
test("unknown purpose and Klaviyo identity purpose fail before creating a transaction", async () => {
  const h = boundary("klaviyo");
  await assert.rejects(h.api.begin({provider: "klaviyo", installationAuthority: owner, permissionProfile: "identity_v1"}), /OAUTH_PERMISSION_PROFILE_INVALID/);
  assert.deepEqual(h.calls, []);
  for (const p of ["", null, "identity_v2"]) assert.throws(() => oauthPermissionProfile("meta", p));
  for (const s of ["x".repeat(43) + ".identity-v2", "x.identity-v1", "x".repeat(43) + ".identity-v1.more"]) {
    assert.throws(() => oauthPermissionProfileFromState("meta", s));
  }
});
test("OAuth builders derive requested scopes from bound state, keeping reporting defaults", () => {
  for (const profile of ["reporting_v1", "identity_v1"]) {
    const state = bindOAuthPermissionProfile("google_ads", "s".repeat(43), profile);
    const g = new URL(buildGoogleAdsAuthorizationUrl({config: {clientId: "client", redirectUri: OAUTH_CALLBACK_URIS.google_ads}, state, pkceChallenge: "p".repeat(43)}));
    const m = new URL(buildMetaAuthorizationUrl({config: {appId: "123", graphVersion: "v26.0", redirectUri: OAUTH_CALLBACK_URIS.meta}, state}));
    assert.deepEqual(g.searchParams.get("scope").split(" "), oauthPermissionScopes("google_ads", profile));
    assert.deepEqual(m.searchParams.get("scope").split(","), oauthPermissionScopes("meta", profile));
    assert.equal(g.searchParams.get("state"), state); assert.equal(g.searchParams.get("code_challenge_method"), "S256");
    assert.equal(g.searchParams.get("redirect_uri"), OAUTH_CALLBACK_URIS.google_ads);
    assert.equal(m.searchParams.get("redirect_uri"), OAUTH_CALLBACK_URIS.meta);
  }
});
test("non-ASCII state aliases cannot downgrade the purpose while colliding under the old ASCII digest encoding", async () => {
  const h = boundary("google_ads");
  const start = await h.api.begin({provider: "google_ads", installationAuthority: owner, permissionProfile: "identity_v1"});
  const alias = start.state.replace(".", "\u012e");
  assert.deepEqual(Buffer.from(start.state, "ascii"), Buffer.from(alias, "ascii"));
  await assert.rejects(h.api.claimCallback({provider: "google_ads", state: alias, code: "code"}), /OAUTH_STATE_PROFILE_INVALID/);
  assert.equal(h.calls.includes("claim"), false);
  assert.equal((await h.api.claimCallback({provider: "google_ads", state: start.state, code: "code"})).permissionProfile, "identity_v1");
});
const googleConfig = {clientId: "client", clientSecret: "secret", redirectUri: OAUTH_CALLBACK_URIS.google_ads};
const metaConfig = {appId: "123", appSecret: "secret", graphVersion: "v26.0", redirectUri: OAUTH_CALLBACK_URIS.meta};
function token(scope) {return {access_token: "access", refresh_token: "refresh", token_type: "Bearer", expires_in: 3600, ...(scope === undefined ? {} : {scope})};}
async function googleExchange(scope, permissionProfile = "identity_v1") {
  let calls = 0;
  const result = await exchangeGoogleAdsAuthorizationCode({config: googleConfig, authorizationCode: "code", pkceVerifier: "verifier", permissionProfile,
    fetchFn: async () => {calls++; return json(token(scope));}});
  assert.equal(calls, 1); return result;
}
test("Google identity exchange preserves the actual full scope string without an Ads-only fallback", async () => {
  const scope = oauthPermissionScopes("google_ads", "identity_v1").join(" ");
  assert.equal((await googleExchange(scope)).scope, scope);
  assert.equal((await googleExchange(undefined, "reporting_v1")).scope, oauthPermissionScopes("google_ads")[0]);
});
for (const scope of [undefined, null, "", "https://www.googleapis.com/auth/adwords", "https://www.googleapis.com/auth/content", [], "adwords,content"]) {
  test(`Google incomplete native scope response rejects: ${JSON.stringify(scope)}`, async () => {
    await assert.rejects(googleExchange(scope), /OAUTH_IDENTITY_SCOPE_/);
  });
}
test("Meta identity exchange checks native token inspection scopes and never substitutes requested scopes", async () => {
  for (const scopes of [undefined, ["ads_read"], oauthPermissionScopes("meta", "identity_v1")]) {
    let count = 0;
    const responses = [json({access_token: "short"}), json({access_token: "long"}), json({data: {
      is_valid: true, app_id: "123", scopes, expires_at: 1893456000, data_access_expires_at: 1893456000}})];
    const run = exchangeAndValidateMetaAuthorizationCode({config: metaConfig, authorizationCode: "code", permissionProfile: "identity_v1", now,
      fetchFn: async () => {count++; return responses.shift();}});
    if (scopes?.length === 5) assert.deepEqual((await run).scopes, [...scopes].sort());
    else await assert.rejects(run, /OAUTH_IDENTITY_SCOPE_/);
    assert.equal(count, 3);
  }
});
test("malformed or duplicate native permission lists never pass", () => {
  for (const [p, value] of [["meta", ["ads_read", "ads_read"]], ["meta", Array(1)],
    ["meta", ["ads_read", 1]], ["google_ads", Array(2)], ["google_ads", "a a"]]) {
    assert.throws(() => validateIdentityOAuthGrantedScopes(p, value), /OAUTH_IDENTITY_SCOPE_/);
  }
});
test("invalid exchange profiles and provider errors cannot trigger fallback or another attempt", async () => {
  for (const provider of ["google_ads", "meta"]) {
    let calls = 0;
    const method = provider === "google_ads" ? exchangeGoogleAdsAuthorizationCode : exchangeAndValidateMetaAuthorizationCode;
    await assert.rejects(method({config: provider === "google_ads" ? googleConfig : metaConfig,
      authorizationCode: "code", pkceVerifier: "verifier", permissionProfile: "identity_v2", now,
      fetchFn: async () => {calls++; throw new Error("unexpected");}}), /OAUTH_PERMISSION_PROFILE_INVALID/);
    assert.equal(calls, 0);
    await assert.rejects(method({config: provider === "google_ads" ? googleConfig : metaConfig,
      authorizationCode: "code", pkceVerifier: "verifier", permissionProfile: "identity_v1", now,
      fetchFn: async () => {calls++; return json({error: {code: 190}}, 401);}}));
    assert.equal(calls, 1);
  }
});
function runtimeHarness(provider, granted) {
  const calls = []; let stageScopes = null;
  const database = {async query(sql, values) {
    if (sql.includes("stage_provider_account_selection")) {calls.push("stage"); stageScopes = values[4];
      return {rows: [{connection_id: txn, connection_version: 1, lifecycle_status: "pending_account_selection", credential_id: uuid, granted_scopes: values[4]}]};}
    if (sql.includes("complete_oauth_transaction")) {calls.push(values[1]); return {rows: [{transaction_id: txn, transaction_status: values[1]}]};}
    if (sql.includes("resolve_active_installation_callback_return")) return {rows: [{shop_domain: "example.myshopify.com"}]};
    throw new Error("UNEXPECTED_TEST_QUERY");
  }};
  const tokenVault = {async storeProviderTokenSet() {calls.push("store"); return {credentialId: uuid};},
    async deleteProviderTokenSet() {calls.push("delete");}, async assertReady() {}, async store() {}, async take() {}, async remove() {}};
  let requestCount = 0;
  const fetchFn = async () => {
    requestCount++;
    if (provider === "google_ads") {
      if (requestCount === 1) return json(token(granted));
      if (requestCount === 2) return json({resourceNames: ["customers/123"]});
      return json({results: [{customerClient: {id: "123", descriptiveName: "Shop", manager: false, level: 0, status: "ENABLED", currencyCode: "USD", timeZone: "UTC"}}]});
    }
    if (requestCount <= 2) return json({access_token: "token"});
    if (requestCount === 3) return json({data: {is_valid: true, app_id: "123", scopes: granted,
      expires_at: 1893456000, data_access_expires_at: 1893456000}});
    return json({data: [{id: "act_123", name: "Shop", currency: "USD", account_status: 1, timezone_name: "UTC"}]});
  };
  const environment = provider === "google_ads" ? {GOOGLE_ADS_OAUTH_CLIENT_ID: "client", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "secret", GOOGLE_ADS_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.google_ads}
    : {META_APP_ID: "123", META_APP_SECRET: "secret", META_GRAPH_VERSION: "v26.0", META_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.meta};
  const runtime = (provider === "google_ads" ? createGoogleOAuthRuntime : createMetaOAuthRuntime)({database, tokenVault, environment, fetchFn, now, randomUUIDFn: () => txn});
  return {runtime, calls, stageScopes: () => stageScopes, requestCount: () => requestCount};
}
const claimed = {status: "claimed", workspaceId: uuid, installGeneration: 1, transactionId: txn, authorizationCode: "code", pkceVerifier: "verifier", permissionProfile: "identity_v1"};
for (const provider of ["google_ads", "meta"]) {
  test(`${provider}: incomplete consent fails before credential storage or account discovery`, async () => {
    const granted = provider === "google_ads" ? oauthPermissionScopes(provider)[0] : ["ads_read"];
    const h = runtimeHarness(provider, granted);
    await assert.rejects(h.runtime.completeCallback({claimed}), /OAUTH_IDENTITY_SCOPE_/);
    assert.equal(h.calls.includes("store"), false); assert.equal(h.calls.includes("stage"), false);
    assert.equal(h.requestCount(), provider === "google_ads" ? 1 : 3);
    assert.deepEqual(h.calls, ["failed"]);
  });
  test(`${provider}: callback carries real granted scopes into existing pending account selection`, async () => {
    const scopes = oauthPermissionScopes(provider, "identity_v1");
    const h = runtimeHarness(provider, provider === "google_ads" ? scopes.join(" ") : scopes);
    const r = await h.runtime.completeCallback({claimed});
    assert.equal(r.outcome, "pending_account_selection");
    assert.deepEqual([...h.stageScopes()].sort(), [...scopes].sort());
    assert.deepEqual(h.calls, ["store", "stage", "exchanged"]);
  });
}
