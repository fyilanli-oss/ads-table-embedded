import assert from "node:assert/strict";
import test from "node:test";
import {createGoogleOAuthRuntime} from "../app/lib/oauth/google-oauth-runtime.server.js";
import {createMetaOAuthRuntime} from "../app/lib/oauth/meta-oauth-runtime.server.js";
import {oauthInstallationAuthority, OAUTH_CALLBACK_URIS} from "../app/lib/oauth/oauth-transaction.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {stampGoogleIdentityCredential} from "../app/lib/oauth/google-identity-credential.server.js";

const id = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const owner = oauthInstallationAuthority({workspaceId: id(1), installGeneration: 2, status: "active"});
const now = () => new Date("2026-10-29T12:00:00.000Z");

// Real runtimes, repositories and native validators; only I/O is synthetic.
function harness(provider, options = {}) {
  let status = options.status ?? "pending_account_selection", version = 7, credential = id(4);
  let selected = options.selected ?? [], reporting = options.reporting ?? null;
  const reads = [], calls = [], writes = [];
  const accounts = ["123", "456"].map(value => ({id: provider === "meta" ? `act_${value}` : value, name: `Shop ${value}`}));
  const scopes = options.partial ? [oauthPermissionScopes(provider, "identity_v1")[0]] : oauthPermissionScopes(provider, "identity_v1");
  let token = provider === "google_ads" ? stampGoogleIdentityCredential({access_token: "secret-access",
    refresh_token: "secret-refresh", scope: oauthPermissionScopes(provider, "identity_v1").join(" "), expires_in: 3600}, now)
    : {access_token: "secret-access", scopes, expires_at: "2026-10-29T13:00:00.000Z", permission_profile: "identity_v1"};
  if (options.partial && provider === "google_ads") token = {...token, scope: scopes.join(" ")};
  if (options.legacy) token = {...token, permission_profile: "reporting_v1"};
  const row = () => ({connection_id: id(2), connection_version: version, lifecycle_status: status,
    credential_id: credential, granted_scopes: scopes, accounts: selected.map(value => accounts.find(a => a.id === value)),
    connected_account_count: selected.length || null, reporting_account_id: reporting});
  const database = {async query(sql, values) {
    reads.push(sql);
    if (sql.includes("load_provider_connection_lifecycle_by_owner")) {
      assert.deepEqual(values, [owner.workspaceId, owner.installGeneration, provider]);
      return {rows: options.absent ? [] : [row()]};
    }
    if (sql.includes("load_provider_account_authority")) return {rows: status === "connected" ? [row()] : []};
    if (sql.includes("load_pending_reporting_account_selection")) return {rows: status === "pending_account_selection" && selected.length > 1 ? [row()] : []};
    if (sql.includes("load_pending_provider_account_selection")) {
      if (options.changedBeforeSelection) version++;
      return {rows: status === "pending_account_selection" && !selected.length ? [row()] : []};
    }
    if (sql.includes("complete_pending_provider_account_selection")) {
      writes.push("accounts");
      assert.equal(values[3], version);
      selected = JSON.parse(values[4]).map(a => a.id); version++;
      status = selected.length === 1 ? "connected" : "pending_account_selection";
      reporting = selected.length === 1 ? selected[0] : null;
    } else if (sql.includes("complete_pending_reporting_account_selection")) {
      writes.push("reporting"); assert.equal(values[3], version);
      reporting = values[4]; status = "connected"; version++;
    } else throw Error("UNEXPECTED_DATABASE_OPERATION");
    if (options.writeError) throw Error("WRITE_ACK_LOST");
    const receipt = row();
    if (options.receiptMismatch) receipt.connection_version++;
    if (options.receiptWrongAccount) receipt.reporting_account_id = "unavailable";
    if (options.receiptWrongCount) receipt.connected_account_count = 3;
    if (options.changedAfterWrite) credential = id(5);
    return {rows: [receipt]};
  }};
  const unexpectedOAuth = async () => {throw Error("UNEXPECTED_OAUTH_EXCHANGE");};
  const tokenVault = {assertReady: unexpectedOAuth, store: unexpectedOAuth, take: unexpectedOAuth, remove: unexpectedOAuth,
    async loadProviderTokenSet(input) {
    assert.equal(input.provider, provider); assert.deepEqual(input.installationAuthority, owner);
    assert.equal(input.credentialId, credential);
    if (options.changedDuringVault) version++;
    return token;
  }};
  const fetchFn = async address => {
    calls.push(address);
    if (options.providerError) return new Response("{}", {status: 503});
    if (options.changedDuringNative) version++;
    const body = provider === "google_ads"
      ? address.includes("listAccessibleCustomers") ? {resourceNames: ["customers/123", "customers/456"]}
        : {results: accounts.map(a => ({customerClient: {id: a.id, descriptiveName: a.name, level: 0, manager: false}}))}
      : address.includes("debug_token") ? {data: {app_id: "123", is_valid: true, scopes, expires_at: 1893456000}}
        : {data: accounts};
    return new Response(JSON.stringify(body), {status: 200});
  };
  const environment = provider === "google_ads" ? {GOOGLE_ADS_OAUTH_CLIENT_ID: "client", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "secret", GOOGLE_ADS_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.google_ads}
    : {META_APP_ID: "123", META_APP_SECRET: "secret", META_GRAPH_VERSION: "v26.0", META_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.meta};
  const runtime = (provider === "google_ads" ? createGoogleOAuthRuntime : createMetaOAuthRuntime)({database,
    tokenVault, environment, now, fetchFn, identityAuthorizationEnabled: options.enabled ?? true});
  return {runtime, setup: runtime.combinedSetup, reads, calls, writes};
}
function incomplete(result, action) {
  assert.equal(result.setupComplete, false); assert.equal(result.setupState, "resume_setup");
  assert.equal(result.setupResumeAction, action);
  assert.doesNotMatch(JSON.stringify(result), /secret-|credentialId|access_token|refresh_token|scope|verifiedAt/);
}
for (const provider of ["google_ads", "meta"]) {
  const first = provider === "meta" ? "act_123" : "123", second = provider === "meta" ? "act_456" : "456";
  test(`${provider}: combined account entry stays closed, caller cannot enable it`, async () => {
    const h = harness(provider, {enabled: false});
    for (const [method, fields] of [["inspect", {}], ["select", {selectedAccountIds: [first]}], ["finishReporting", {reportingAccountId: first}]]) {
      await assert.rejects(h.setup[method]({installationAuthority: owner, ...fields, enabled: true}), /START_DISABLED/);
    }
    assert.deepEqual(h.reads, []); assert.deepEqual(h.calls, []); assert.deepEqual(h.writes, []);
  });
  test(`${provider}: one account selection and reopening keep asset verification pending`, async () => {
    const h = harness(provider);
    incomplete(await h.setup.inspect({installationAuthority: owner}), "select_account");
    const result = await h.setup.select({installationAuthority: owner, selectedAccountIds: [first], setupComplete: true,
      assetVerified: true, provider: "other", permissionProfile: "reporting_v1"});
    incomplete(result, "verify_assets"); assert.equal(result.connectionState, "connected");
    assert.equal(result.reportingAccountId, first); assert.equal(result.connectionVersion, 8);
    incomplete(await h.setup.inspect({installationAuthority: owner}), "verify_assets");
    assert.deepEqual(h.writes, ["accounts"]);
  });
  test(`${provider}: multiple accounts require reporting selection without a new OAuth exchange`, async () => {
    const h = harness(provider);
    incomplete(await h.setup.select({installationAuthority: owner, selectedAccountIds: [first, second]}), "select_reporting_account");
    const pending = await h.setup.inspect({installationAuthority: owner});
    incomplete(pending, "select_reporting_account"); assert.equal(pending.connectionState, "pending_account_selection");
    assert.deepEqual(pending.accounts, [{id: first, name: "Shop 123"}, {id: second, name: "Shop 456"}]);
    incomplete(await h.setup.finishReporting({installationAuthority: owner, reportingAccountId: second}), "verify_assets");
    assert.deepEqual(h.writes, ["accounts", "reporting"]);
    assert.ok(h.calls.every(address => !address.includes("oauth/access_token") && !address.includes("oauth2.googleapis.com")));
  });
  for (const option of ["legacy", "partial", "changedDuringVault", "changedBeforeSelection"]) {
    test(`${provider}: ${option} rejects before native account discovery or selection`, async () => {
      const h = harness(provider, {[option]: true});
      await assert.rejects(h.setup.select({installationAuthority: owner, selectedAccountIds: [first]}));
      assert.deepEqual(h.calls, []); assert.deepEqual(h.writes, []);
    });
  }
  for (const option of ["writeError", "receiptMismatch", "receiptWrongAccount", "receiptWrongCount", "changedAfterWrite"]) {
    test(`${provider}: ${option} is an error after one selection attempt, never completion or retry`, async () => {
      const h = harness(provider, {[option]: true});
      await assert.rejects(h.setup.select({installationAuthority: owner, selectedAccountIds: [first]}));
      assert.deepEqual(h.writes, ["accounts"]);
    });
  }
  test(`${provider}: native failure stops before account write`, async () => {
    const h = harness(provider, {providerError: true});
    await assert.rejects(h.setup.select({installationAuthority: owner, selectedAccountIds: [first]}));
    assert.equal(h.calls.length, 1); assert.deepEqual(h.writes, []);
  });
  test(`${provider}: duplicate or inaccessible accounts cannot be selected`, async () => {
    for (const selectedAccountIds of [[first, first], ["unavailable"]]) {
      const h = harness(provider);
      await assert.rejects(h.setup.select({installationAuthority: owner, selectedAccountIds}));
      assert.deepEqual(h.writes, []);
    }
  });
  test(`${provider}: reporting account must belong to the staged selection`, async () => {
    const h = harness(provider, {selected: [first, second]});
    await assert.rejects(h.setup.finishReporting({installationAuthority: owner, reportingAccountId: "unavailable"}), /REPORTING_ACCOUNT_NOT_SELECTED/);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.writes, []);
  });
  test(`${provider}: lost reporting-selection write acknowledgement is not retried`, async () => {
    const h = harness(provider, {selected: [first, second], writeError: true});
    await assert.rejects(h.setup.finishReporting({installationAuthority: owner, reportingAccountId: first}), /WRITE_ACK_LOST/);
    assert.deepEqual(h.writes, ["reporting"]);
  });
  test(`${provider}: lifecycle changes during inspect cannot produce a setup result`, async () => {
    const h = harness(provider, {changedDuringNative: true});
    await assert.rejects(h.setup.inspect({installationAuthority: owner}), /CONNECTION_CHANGED/);
    assert.deepEqual(h.writes, []);
  });
  test(`${provider}: existing legacy inspect is untouched by the disabled new entry`, async () => {
    const h = harness(provider, {enabled: false, status: "connected", selected: [first], reporting: first});
    assert.equal((await h.runtime.inspect({installationAuthority: owner})).state, "connected");
  });
  for (const options of [{absent: true}, {status: "reauthorization_required"}]) {
    test(`${provider}: ${options.status ?? "absent"} requests authorization, no discovery or write`, async () => {
      const h = harness(provider, options);
      incomplete(await h.setup.inspect({installationAuthority: owner}), "request_permissions");
      assert.deepEqual(h.calls, []); assert.deepEqual(h.writes, []);
    });
  }
  for (const status of ["disconnected", "disconnect_pending", "unknown"]) {
    test(`${provider}: ${status} is not implicitly revived`, async () => {
      const h = harness(provider, {status});
      await assert.rejects(h.setup.inspect({installationAuthority: owner}), /LIFECYCLE_UNAVAILABLE/);
      assert.deepEqual(h.calls, []); assert.deepEqual(h.writes, []);
    });
  }
}
