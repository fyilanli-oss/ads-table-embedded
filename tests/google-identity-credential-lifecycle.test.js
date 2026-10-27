import assert from "node:assert/strict";
import test from "node:test";
import {stampGoogleIdentityCredential, inspectGoogleIdentityCredential} from "../app/lib/oauth/google-identity-credential.server.js";
import {refreshGoogleAdsAccessToken} from "../app/lib/providers/google-ads-rest.server.js";
import {createGoogleOAuthRuntime} from "../app/lib/oauth/google-oauth-runtime.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {oauthInstallationAuthority, OAUTH_CALLBACK_URIS} from "../app/lib/oauth/oauth-transaction.server.js";

const id = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const owner = oauthInstallationAuthority({workspaceId: id(1), installGeneration: 2, status: "active"});
const connectionId = id(2), credentialId = id(3), replacementId = id(4);
const now = () => new Date("2026-10-27T12:00:00.000Z");
const scopes = oauthPermissionScopes("google_ads", "identity_v1");
const native = {access_token: "new-token", token_type: "Bearer", expires_in: 3600, scope: scopes.join(" ")};
const config = {clientId: "client", clientSecret: "secret"};
const json = (body, status = 200) => new Response(JSON.stringify(body), {status});
function stored(at = "2026-10-27T11:00:00.000Z") {
  return stampGoogleIdentityCredential({...native, access_token: "old-token", refresh_token: "retained-refresh"}, () => new Date(at));
}

test("identity timing is issuance-bound; old expiry is never rebased onto the read time", () => {
  assert.equal(inspectGoogleIdentityCredential(stored(), now).needsRefresh, true);
  assert.equal(inspectGoogleIdentityCredential(stored("2026-10-27T11:30:00.000Z"), now).needsRefresh, false);
  for (const change of [{permission_profile: undefined}, {scope_verified_at: now().toISOString()},
    {expires_at: "2026-10-27T12:00:00Z"}, {expires_in: 0}, {scope: scopes[0]},
    {scope_verified_at: "2026-10-28T12:00:00.000Z"}]) {
    assert.throws(() => inspectGoogleIdentityCredential({...stored(), ...change}, now));
  }
});
test("refresh retains offline token and stamps only the native full grant", async () => {
  const result = await refreshGoogleAdsAccessToken({config, refreshToken: "retained-refresh",
    permissionProfile: "identity_v1", now, fetchFn: async (_address, options) => {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("grant_type"), "refresh_token");
      assert.equal(form.get("refresh_token"), "retained-refresh");
      return json(native);
    }});
  assert.equal(result.refresh_token, "retained-refresh");
  assert.equal(result.scope_verified_at, now().toISOString());
  assert.equal(result.expires_at, "2026-10-27T13:00:00.000Z");
});
for (const scope of [undefined, scopes[0], scopes[1], "", []]) {
  test(`refresh missing native grant stops once: ${JSON.stringify(scope)}`, async () => {
    let calls = 0;
    await assert.rejects(refreshGoogleAdsAccessToken({config, refreshToken: "retained-refresh",
      permissionProfile: "identity_v1", now, fetchFn: async () => {calls++; return json({...native, scope});}}));
    assert.equal(calls, 1);
  });
}

function harness({pending = false, token = stored(), tokenPayload = native, tokenStatus = 200,
  adsStatus = 200, renewalFailure = false, changed = false, malformedRenewal = false,
  ledgerScopes = scopes, firstAdsFailure = false} = {}) {
  const calls = [], sqlCalls = [], vaultCalls = [];
  const row = {connection_id: connectionId, connection_version: 7, lifecycle_status: "connected",
    credential_id: credentialId, granted_scopes: ledgerScopes, accounts: [{id: "123"}], reporting_account_id: "123"};
  const database = {async query(sql, values) {
    sqlCalls.push({sql, values});
    if (sql.includes("load_provider_account_authority")) return {rows: pending ? [] : [row]};
    if (sql.includes("load_pending_reporting_account_selection")) return {rows: []};
    if (sql.includes("load_pending_provider_account_selection")) return {rows: [{...row, lifecycle_status: "pending_account_selection"}]};
    if (sql.includes("load_provider_connection_lifecycle(")) return {rows: [{...row, credential_id: changed ? id(5) : credentialId}]};
    if (sql.includes("renew_provider_connection_credential")) {
      if (renewalFailure) throw new Error("WRITE_OUTCOME_UNKNOWN");
      return {rows: [{...row, connection_version: 8, credential_id: malformedRenewal ? credentialId : replacementId}]};
    }
    if (sql.includes("select_reporting_account")) return {rows: [{connection_id: connectionId, reporting_account_id: "123", changed: false}]};
    throw new Error("UNEXPECTED_SQL");
  }};
  const tokenVault = {
    async assertReady() {}, async store() {}, async take() {}, async remove() {},
    async loadProviderTokenSet(input) {vaultCalls.push(["load", input]); return token;},
    async storeProviderTokenSet(input) {vaultCalls.push(["store", input]); return {credentialId: replacementId};},
    async deleteProviderTokenSet(input) {vaultCalls.push(["delete", input]);},
  };
  const runtime = createGoogleOAuthRuntime({database, tokenVault, now,
    environment: {GOOGLE_ADS_OAUTH_CLIENT_ID: "client", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "secret",
      GOOGLE_ADS_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.google_ads},
    fetchFn: async (address, options) => {
      calls.push({address, options});
      if (address.includes("oauth2.googleapis.com/token")) return json(tokenPayload, tokenStatus);
      if (firstAdsFailure && calls.length === 1) return json({error: {status: "UNAUTHENTICATED"}}, 401);
      if (adsStatus !== 200) return json({error: {status: "UNAUTHENTICATED"}}, adsStatus);
      if (address.includes("listAccessibleCustomers")) return json({resourceNames: ["customers/123", "customers/456"]});
      return json({results: [{customerClient: {id: "123", level: "0", manager: false, status: "ENABLED"}}]});
    }});
  return {runtime, calls, sqlCalls, vaultCalls,
    run: () => pending ? runtime.inspect({installationAuthority: owner})
      : runtime.changeReporting({installationAuthority: owner, reportingAccountId: "123"})};
}

test("connected expiry refreshes before Ads and binds replacement with owner, generation, old credential and version", async () => {
  const h = harness(); await h.run();
  assert.ok(h.calls[0].address.includes("oauth2.googleapis.com/token"));
  assert.equal(h.calls[1].options.headers.authorization, "Bearer new-token");
  const renew = h.sqlCalls.find(c => c.sql.includes("renew_provider_connection_credential"));
  assert.deepEqual(renew.values.slice(1, 8), [connectionId, owner.workspaceId, 2, "google_ads", 7, credentialId, replacementId]);
  assert.deepEqual([...renew.values[8]].sort(), [...scopes].sort());
  const envelope = h.vaultCalls.find(c => c[0] === "store")[1];
  assert.equal(envelope.installationAuthority, owner); assert.equal(envelope.expiresAt, "2026-10-27T13:00:00.000Z");
  assert.equal(h.vaultCalls.some(c => c[0] === "delete"), false);
  assert.equal(h.sqlCalls.some(c => c.sql.includes("stage_provider_account_selection")), false);
});
test("expired pending consent never refreshes, stages or connects", async () => {
  const h = harness({pending: true});
  await assert.rejects(h.run(), /GOOGLE_IDENTITY_PENDING_REAUTHORIZATION_REQUIRED/);
  assert.equal(h.calls.length, 0); assert.equal(h.vaultCalls.length, 1);
  assert.equal(h.sqlCalls.some(c => c.sql.includes("renew_provider_connection_credential")), false);
});
test("valid pending consent reads accounts without restamping or renewal", async () => {
  const h = harness({pending: true, token: stored("2026-10-27T11:30:00.000Z")});
  assert.equal((await h.run()).state, "pending_account_selection");
  assert.equal(h.calls.length, 3); assert.equal(h.vaultCalls.length, 1);
});
test("ledger expecting identity cannot silently downgrade a token without identity metadata", async () => {
  const token = {...stored()}; delete token.permission_profile;
  const h = harness({token});
  await assert.rejects(h.run(), /GOOGLE_IDENTITY_CREDENTIAL_METADATA_REQUIRED/);
  assert.equal(h.calls.length, 0);
});
for (const options of [{tokenPayload: {...native, scope: scopes[0]}}, {tokenStatus: 400}]) {
  test(`renewal rejection stops before storage and Ads: ${JSON.stringify(options)}`, async () => {
    const h = harness(options); await assert.rejects(h.run());
    assert.equal(h.calls.length, 1); assert.equal(h.vaultCalls.length, 1);
  });
}
test("connection changed before renewal stops without contacting provider", async () => {
  const h = harness({changed: true}); await assert.rejects(h.run(), /GOOGLE_IDENTITY_CONNECTION_CHANGED/);
  assert.equal(h.calls.length, 0);
});
for (const options of [{renewalFailure: true}, {malformedRenewal: true}]) {
  test(`uncertain or invalid replacement never uses or deletes the new envelope: ${JSON.stringify(options)}`, async () => {
    const h = harness(options); await assert.rejects(h.run());
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.vaultCalls.map(c => c[0]), ["load", "store"]);
    assert.equal(h.sqlCalls.some(c => c.sql.includes("select_reporting_account(")), false);
  });
}
test("Ads 401 with a valid identity token stops without refresh retry", async () => {
  const h = harness({token: stored("2026-10-27T11:30:00.000Z"), adsStatus: 401});
  await assert.rejects(h.run()); assert.equal(h.calls.length, 1); assert.equal(h.vaultCalls.length, 1);
});
test("ordinary connected reporting retains its prior refresh path without staging a pending connection", async () => {
  const token = {...native, refresh_token: "retained-refresh", scope: scopes[0]};
  const h = harness({token, ledgerScopes: [scopes[0]], firstAdsFailure: true});
  await h.run();
  assert.ok(h.calls[1].address.includes("oauth2.googleapis.com/token"));
  assert.deepEqual(h.vaultCalls.map(c => c[0]), ["load"]);
  assert.equal(h.sqlCalls.some(c => c.sql.includes("stage_provider_account_selection")), false);
});
test("first root failure stops before trying a different accessible root", async () => {
  const {discoverGoogleAdsAccounts} = await import("../app/lib/providers/google-account-discovery.server.js");
  let count = 0;
  await assert.rejects(discoverGoogleAdsAccounts({accessToken: "token", now, stopOnFirstError: true,
    fetchFn: async () => ++count === 1 ? json({resourceNames: ["customers/123", "customers/456"]}) : json({error: {}}, 403)}));
  assert.equal(count, 2);
});
