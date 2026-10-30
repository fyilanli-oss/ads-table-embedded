import assert from "node:assert/strict";
import test from "node:test";
import {inspectMetaAccessToken, exchangeAndValidateMetaAuthorizationCode} from "../app/lib/providers/meta-graph.server.js";
import {createMetaOAuthRuntime} from "../app/lib/oauth/meta-oauth-runtime.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {oauthInstallationAuthority, OAUTH_CALLBACK_URIS} from "../app/lib/oauth/oauth-transaction.server.js";

const now = () => new Date("2026-10-27T12:00:00.000Z");
const seconds = Math.floor(now().valueOf() / 1000);
const scopes = oauthPermissionScopes("meta", "identity_v1");
const config = {appId: "123", appSecret: "app-secret", graphVersion: "v26.0", redirectUri: OAUTH_CALLBACK_URIS.meta};
const valid = {is_valid: true, app_id: "123", scopes, expires_at: seconds + 3600, data_access_expires_at: seconds + 7200};
const json = (body, status = 200) => new Response(JSON.stringify(body), {status});
const id = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const owner = oauthInstallationAuthority({workspaceId: id(1), installGeneration: 2, status: "active"});
const stored = {access_token: "stored-token", scopes, expires_at: "2026-10-28T12:00:00.000Z",
  permission_profile: "identity_v1", scope_verified_at: "2026-10-26T12:00:00.000Z"};

test("native inspection uses separate app authorization, returns only current safe grant fields", async () => {
  const result = await inspectMetaAccessToken({config, accessToken: "stored-token", permissionProfile: "identity_v1", now,
    fetchFn: async (address, options) => {
      const request = new URL(address);
      assert.equal(request.pathname, "/v26.0/debug_token");
      assert.equal(request.searchParams.get("input_token"), "stored-token");
      assert.equal(options.headers.authorization, "Bearer 123|app-secret");
      return json({data: {...valid, user_id: "private-user", granular_scopes: [{scope: "catalog_management", target_ids: ["private-target"]}]}});
    }});
  assert.deepEqual(Object.keys(result).sort(), ["expiresAt", "scopes", "verifiedAt"]);
  assert.equal(result.expiresAt, "2026-10-27T13:00:00.000Z");
  assert.equal(result.verifiedAt, now().toISOString());
  assert.equal(JSON.stringify(result).includes("private-"), false);
});
test("native data-access deadline bounds validity even when token deadline is later", async () => {
  const result = await inspectMetaAccessToken({config, accessToken: "stored-token", permissionProfile: "identity_v1", now,
    fetchFn: async () => json({data: {...valid, data_access_expires_at: seconds + 120}})});
  assert.equal(result.expiresAt, "2026-10-27T12:02:00.000Z");
});
for (const change of [{is_valid: false}, {app_id: "other"}, {scopes: undefined}, {scopes: ["ads_read"]},
  {scopes: [...scopes, "ads_read"]}, {expires_at: seconds - 1}, {data_access_expires_at: seconds - 1},
  {expires_at: null}, {expires_at: "1893456000"}, {expires_at: -1}, {expires_at: 1.5},
  {expires_at: 0, data_access_expires_at: 0}]) {
  test(`native invalid or incomplete inspection cannot use old grant: ${JSON.stringify(change)}`, async () => {
    let calls = 0;
    await assert.rejects(inspectMetaAccessToken({config, accessToken: "stored-token", permissionProfile: "identity_v1", now,
      fetchFn: async () => {calls++; return json({data: {...valid, ...change}});}}));
    assert.equal(calls, 1);
  });
}
test("network and provider error messages cannot expose credentials or cause another attempt", async () => {
  for (const mode of ["network", "http"]) {
    let count = 0;
    await assert.rejects(inspectMetaAccessToken({config, accessToken: "stored-token", permissionProfile: "identity_v1", now,
      fetchFn: async () => {count++; if (mode === "network") throw new Error("stored-token app-secret");
        return json({error: {code: 190, message: "stored-token app-secret"}}, 401);}}), error => {
      assert.equal(String(error).includes("stored-token"), false);
      assert.equal(JSON.stringify(error).includes("app-secret"), false); return true;
    });
    assert.equal(count, 1);
  }
});
test("identity callback stores its bound purpose and inspection time without changing reporting token shape", async () => {
  for (const profile of ["identity_v1", "reporting_v1"]) {
    let count = 0;
    const result = await exchangeAndValidateMetaAuthorizationCode({config, authorizationCode: "code", permissionProfile: profile, now,
      fetchFn: async () => json(++count <= 2 ? {access_token: "token"} : {data: valid})});
    assert.equal(count, 3);
    assert.equal(result.tokenSet.permission_profile, profile === "identity_v1" ? "identity_v1" : undefined);
    assert.equal(result.tokenSet.scope_verified_at, profile === "identity_v1" ? now().toISOString() : undefined);
  }
});

function harness({mode = "pending", token = stored, native = valid, status = 200, failAds = false, advanceClock = false,
  ledger = scopes} = {}) {
  const calls = [], sqlCalls = [], vaultCalls = [];
  let advanced = false;
  const row = {connection_id: id(2), credential_id: id(3), connection_version: 7,
    lifecycle_status: "pending_account_selection", granted_scopes: ledger,
    accounts: [{id: "act_1", kind: "advertiser", reportingEligible: true}], reporting_account_id: "act_1"};
  const database = {async query(sql, values) {
    sqlCalls.push({sql, values});
    if (sql.includes("load_provider_account_authority")) return {rows: mode === "connected" ? [row] : []};
    if (sql.includes("load_pending_reporting_account_selection")) return {rows: mode === "pending_reporting" ? [row] : []};
    if (sql.includes("load_pending_provider_account_selection")) return {rows: [row]};
    if (sql.includes("complete_pending_provider_account_selection") || sql.includes("complete_pending_reporting_account_selection")) return {rows: [{...row, connection_version: 8}]};
    if (sql.includes("select_reporting_account")) return {rows: [{...row, changed: true}]};
    throw new Error("UNEXPECTED_SQL");
  }};
  const tokenVault = {async assertReady() {}, async store() {}, async take() {}, async remove() {},
    async loadProviderTokenSet(input) {vaultCalls.push(input); return token;},
    async storeProviderTokenSet() {throw new Error("UNEXPECTED_STORE");},
    async deleteProviderTokenSet() {throw new Error("UNEXPECTED_DELETE");}};
  const runtime = createMetaOAuthRuntime({database, tokenVault,
    environment: {META_APP_ID: "123", META_APP_SECRET: "app-secret", META_GRAPH_VERSION: "v26.0", META_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.meta},
    now: () => advanced ? new Date("2026-10-27T12:11:00.000Z") : now(),
    fetchFn: async (address, options) => {
      calls.push({address, options});
      if (address.includes("/debug_token")) return json({data: native}, status);
      if (failAds) return json({error: {code: 190}}, 401);
      if (advanceClock) advanced = true;
      return json({data: [{id: "act_1", name: "Shop"}]});
    }});
  return {runtime, calls, sqlCalls, vaultCalls};
}
const operations = {
  pending_inspect: h => h.runtime.inspect({installationAuthority: owner}),
  pending_select: h => h.runtime.select({installationAuthority: owner, selectedAccountIds: ["act_1"], combinedSetupBinding: {connectionId: id(2), version: 7, credentialId: id(3)}}),
  pending_reporting_inspect: h => h.runtime.inspect({installationAuthority: owner}),
  pending_reporting_finish: h => h.runtime.finishReporting({installationAuthority: owner, reportingAccountId: "act_1", combinedSetupBinding: {connectionId: id(2), version: 7, credentialId: id(3)}}),
  connected_inspect: h => h.runtime.inspect({installationAuthority: owner}),
  connected_change: h => h.runtime.changeReporting({installationAuthority: owner, reportingAccountId: "act_1"}),
};
for (const [name, run] of Object.entries(operations)) {
  const mode = name.startsWith("connected") ? "connected" : name.startsWith("pending_reporting") ? "pending_reporting" : "pending";
  test(`${name}: fresh native grant precedes account use; vault is scoped to owner and generation`, async () => {
    const h = harness({mode}); await run(h);
    assert.ok(h.calls[0].address.includes("/debug_token"));
    if (name !== "connected_inspect" && name !== "pending_reporting_inspect") assert.ok(h.calls[1].address.includes("/me/adaccounts"));
    assert.deepEqual(h.vaultCalls, [{credentialId: id(3), installationAuthority: owner, provider: "meta"}]);
  });
  test(`${name}: removed permission stops before account reads or selection writes`, async () => {
    const h = harness({mode, native: {...valid, scopes: ["ads_read"]}});
    await assert.rejects(run(h), /OAUTH_IDENTITY_SCOPE_NOT_GRANTED/);
    assert.equal(h.calls.length, 1);
    assert.equal(h.sqlCalls.some(c => /complete_pending|select_reporting_account\(/.test(c.sql)), false);
  });
}
test("unknown encrypted credential purpose stops before provider reads", async () => {
  const h = harness({token: {...stored, permission_profile: "identity_v2"}});
  await assert.rejects(h.runtime.select({installationAuthority: owner, selectedAccountIds: ["act_1"], combinedSetupBinding: {connectionId: id(2), version: 7, credentialId: id(3)}}),
    {code: "META_IDENTITY_CREDENTIAL_METADATA_REQUIRED"});
  assert.equal(h.calls.length, 0);
});
test("fresh native scope may succeed despite stale cached scope; cached scope is not scope evidence", async () => {
  const h = harness({token: {...stored, scopes: ["ads_read"]}});
  await h.runtime.select({installationAuthority: owner, selectedAccountIds: ["act_1"], combinedSetupBinding: {connectionId: id(2), version: 7, credentialId: id(3)}});
  assert.equal(h.calls.length, 2);
});
test("first native provider rejection does not exchange, retry or discover accounts", async () => {
  const h = harness({status: 403});
  await assert.rejects(h.runtime.select({installationAuthority: owner, selectedAccountIds: ["act_1"], combinedSetupBinding: {connectionId: id(2), version: 7, credentialId: id(3)}}));
  assert.equal(h.calls.length, 1);
});
test("first Ads error after successful inspection does not renew or retry", async () => {
  const h = harness({failAds: true});
  await assert.rejects(h.runtime.select({installationAuthority: owner, selectedAccountIds: ["act_1"], combinedSetupBinding: {connectionId: id(2), version: 7, credentialId: id(3)}}), /Meta authorization/);
  assert.equal(h.calls.length, 2);
});
test("permission inspection cannot stay fresh through a long account discovery", async () => {
  const h = harness({advanceClock: true});
  await assert.rejects(h.runtime.select({installationAuthority: owner, selectedAccountIds: ["act_1"], combinedSetupBinding: {connectionId: id(2), version: 7, credentialId: id(3)}}), /evidence expired/);
  assert.equal(h.sqlCalls.some(c => c.sql.includes("complete_pending_provider_account_selection")), false);
});
test("ordinary reporting keeps existing account discovery and connected inspection behavior", async () => {
  const token = {...stored, permission_profile: undefined, scopes: ["ads_read"]};
  const pending = harness({token, ledger: ["ads_read"]});
  await pending.runtime.select({installationAuthority: owner, selectedAccountIds: ["act_1"]});
  assert.equal(pending.calls.length, 1); assert.ok(pending.calls[0].address.includes("/me/adaccounts"));
  const connected = harness({mode: "connected", token, ledger: ["ads_read"]});
  assert.equal((await connected.runtime.inspect({installationAuthority: owner})).state, "connected");
  assert.equal(connected.calls.length, 0);
});
test("historical extra permissions cannot upgrade an unmarked reporting token into identity authority", async () => {
  const h = harness({mode: "connected", token: {...stored, permission_profile: undefined}});
  const result = await h.runtime.inspect({installationAuthority: owner});
  assert.equal(h.calls.length, 0); assert.equal(result.state, "connected");
  assert.equal("identityReady" in result, false);
});
