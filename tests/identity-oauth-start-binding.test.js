import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {createOAuthTransactionBoundary, oauthInstallationAuthority, OAUTH_CALLBACK_URIS} from "../app/lib/oauth/oauth-transaction.server.js";
import {createIdentityOAuthAuthorization} from "../app/lib/oauth/identity-oauth-authorization.server.js";
import {bindOAuthPermissionProfile, identityOAuthBindingFromState, oauthPermissionProfileFromState, oauthPermissionScopes, OAuthPermissionProfileError} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createGoogleOAuthRuntime} from "../app/lib/oauth/google-oauth-runtime.server.js";
import {createMetaOAuthRuntime} from "../app/lib/oauth/meta-oauth-runtime.server.js";

const id = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const owner = oauthInstallationAuthority({workspaceId: id(1), installGeneration: 2, status: "active"});
const now = () => new Date("2026-10-27T12:00:00.000Z");
const initial = {connectionId: null, version: null};
const row = {connectionId: id(2), version: 7, status: "pending_account_selection"};
const disconnected = {...row, status: "disconnected", credentialId: null, disconnectedAt: "2026-10-27T11:00:00.000Z"};
const json = (body, status = 200) => new Response(JSON.stringify(body), {status});

test("server gate is closed by default and rejects non-boolean configuration", async () => {
  let reads = 0;
  const lifecycle = {async loadCurrent() {reads++; return null;}};
  const gate = createIdentityOAuthAuthorization({lifecycle});
  await assert.rejects(gate.beforeStart({installationAuthority: owner, provider: "meta", enabled: true}), /IDENTITY_OAUTH_START_DISABLED/);
  assert.equal(reads, 0);
  for (const enabled of ["true", 1, null]) assert.throws(() => createIdentityOAuthAuthorization({lifecycle, enabled}));
});
for (const current of [null, row, {...row, status: "connected"}, {...row, status: "reauthorization_required"}, disconnected]) {
  test(`server gate reads actual owner/provider lifecycle and admits supported setup: ${current?.status ?? "initial"}`, async () => {
    const gate = createIdentityOAuthAuthorization({enabled: true, lifecycle: {async loadCurrent(input) {
      assert.deepEqual(input, {installationAuthority: owner, provider: "google_ads"}); return current;
    }}});
    assert.deepEqual(await gate.beforeStart({installationAuthority: owner, provider: "google_ads"}),
      current === null ? initial : {connectionId: id(2), version: 7});
  });
}
for (const status of ["disconnect_pending", "unknown"]) {
  test(`no implicit connected upgrade or disconnect revival: ${status}`, async () => {
    const gate = createIdentityOAuthAuthorization({enabled: true, lifecycle: {async loadCurrent() {return {...row, status};}}});
    await assert.rejects(gate.beforeStart({installationAuthority: owner, provider: "meta"}), /IDENTITY_OAUTH_/);
  });
}
for (const change of [{credentialId:id(3)}, {credentialId:undefined}, {disconnectedAt:null}, {disconnectedAt:"invalid"}]) {
  test(`disconnected cleanup must be complete before explicit OAuth: ${JSON.stringify(change)}`,async()=>{
    const gate=createIdentityOAuthAuthorization({enabled:true,lifecycle:{loadCurrent:async()=>({...disconnected,...change})}});
    await assert.rejects(gate.beforeStart({installationAuthority:owner,provider:"google_ads"}),/DISCONNECT_INCOMPLETE/);
  });
}
test("disconnected callback retains exact identity/version and never revives changed or pending authority",async()=>{
  let current=disconnected;
  const gate=createIdentityOAuthAuthorization({enabled:true,lifecycle:{loadCurrent:async()=>current}});
  const binding=await gate.beforeStart({installationAuthority:owner,provider:"google_ads"});
  await gate.beforeCallback({installationAuthority:owner,provider:"google_ads",binding});
  for(const changed of [{...disconnected,version:8},{...disconnected,connectionId:id(3)},{...disconnected,status:"disconnect_pending"},null]){
    current=changed;
    await assert.rejects(gate.beforeCallback({installationAuthority:owner,provider:"google_ads",binding}),/IDENTITY_OAUTH_/);
  }
});
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

function runtimeHarness(provider, {enabled = false, changedDuringRead = false, current = null, commitFails = false, returnFails = false,
  grantedScopes, finalizeFails = false, finalizeMismatch = null, commitScopeError = false, commitStatus = "pending_account_selection", providerStatus = 200,
  googleRoots = null, googleResponses = null} = {}) {
  const calls = [], writes = [], vault = [], lifecycleReads = [];
  const committedAccounts = [];
  let currentRow = current;
  const database = {async query(sql, values) {
    if (sql.includes("load_provider_connection_lifecycle_by_owner")) {lifecycleReads.push(values); return {rows: currentRow ? [{
      connection_id: currentRow.connectionId, connection_version: currentRow.version, lifecycle_status: currentRow.status,
      credential_id: Object.hasOwn(currentRow,"credentialId") ? currentRow.credentialId : id(4), disconnected_at: currentRow.disconnectedAt ?? null}] : []};}
    if (sql.includes("create_oauth_transaction(")) {writes.push("created");return {rows:[{transaction_id:id(3),callback_uri:OAUTH_CALLBACK_URIS[provider],
      pkce_required:provider==="google_ads",expires_at:"2026-10-27T12:05:00.000Z",transaction_status:"created"}]};}
    if (sql.includes("mark_oauth_transaction_redirected")) {writes.push("redirected");return {rows:[{transaction_id:id(3),transaction_status:"redirected"}]};}
    if (sql.includes("complete_oauth_transaction")) {writes.push(values[1]); if(finalizeFails)throw Error("FINALIZE_ACK_LOST");
      return {rows: [{transaction_id: finalizeMismatch==="transaction"?id(4):id(3),
        transaction_status:finalizeMismatch==="status"?"exchanged":values[1]}]};}
    if (sql.includes("stage_provider_account_selection")) {writes.push("stage"); return {rows: [{connection_id: id(2), connection_version: 1, lifecycle_status: "pending_account_selection", granted_scopes: values[4]}]};}
    if (sql.includes("resolve_active_installation_callback_return")) {
      if (returnFails) throw Error("CALLBACK_RETURN_UNAVAILABLE");
      return {rows: [{shop_domain: "example.myshopify.com"}]};
    }
    throw new Error("UNEXPECTED_SQL");
  }};
  const tokenVault = {async assertReady() {}, async store() {}, async take() {}, async remove() {},
    async storeProviderTokenSet() {vault.push("store"); return {credentialId: id(4)};},
    async commitIdentityOAuthCredential(value) {writes.push("atomic");
      committedAccounts.push(value.accounts);
      assert.deepEqual(value.binding,current===null?initial:{connectionId:current.connectionId,version:current.version}); assert.ok(value.accounts.length);
      if(commitScopeError) throw new OAuthPermissionProfileError("OAUTH_IDENTITY_SCOPE_NOT_GRANTED");
      if (commitFails) throw Error("IDENTITY_OAUTH_WRITE_UNCONFIRMED");
      return {connectionId:id(2),credentialId:id(4),version:1,status:commitStatus};},
    async deleteProviderTokenSet() {vault.push("delete");}};
  const environment = provider === "google_ads" ? {GOOGLE_ADS_OAUTH_CLIENT_ID: "client", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "secret", GOOGLE_ADS_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.google_ads}
    : {META_APP_ID: "123", META_APP_SECRET: "secret", META_GRAPH_VERSION: "v26.0", META_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.meta};
  const runtime = (provider === "google_ads" ? createGoogleOAuthRuntime : createMetaOAuthRuntime)({database, tokenVault, environment, now,
    identityAuthorizationEnabled: enabled, randomUUIDFn: () => id(2), fetchFn: async address => {
      calls.push(address);
      if(providerStatus!==200)return json({error:{code:190}},providerStatus);
      if (changedDuringRead) currentRow = {...row, version: 8};
      const nativeScopes=grantedScopes===undefined?oauthPermissionScopes(provider,"identity_v1"):grantedScopes;
      if (provider === "google_ads") {
        if (calls.length === 1) return json({access_token: "token", refresh_token: "refresh", token_type: "Bearer", expires_in: 3600,
          scope:Array.isArray(nativeScopes)?nativeScopes.join(" "):nativeScopes});
        if (calls.length === 2) return json({resourceNames: googleRoots ?? ["customers/123"]});
        if (googleResponses) {
          const response = googleResponses[/customers\/(\d+)\//.exec(address)[1]];
          return json(response.body, response.status ?? 200);
        }
        return json({results: [{customerClient: {id: "123", level: 0, manager: false}}]});
      }
      if (calls.length < 3) return json({access_token: "token"});
      if (calls.length === 3) return json({data: {app_id: "123", is_valid: true, scopes:nativeScopes, expires_at: 1893456000}});
      return json({data: [{id: "act_123", name: "Shop"}]});
    }});
  return {runtime, calls, writes, vault, lifecycleReads, committedAccounts, current:()=>currentRow};
}
const claimed = {status: "claimed", transactionId: id(3), workspaceId: owner.workspaceId, installGeneration: 2,
  permissionProfile: "identity_v1", identityBinding: initial, authorizationCode: "code", pkceVerifier: "verifier"};

test("Google callback excludes unavailable root and stages only valid accounts without connecting", async () => {
  const h = runtimeHarness("google_ads", {enabled: true, googleRoots: ["customers/111", "customers/222"],
    googleResponses: {
      111: {status: 403, body: {error: {status: "PERMISSION_DENIED", details: [{errors: [{errorCode: {authorizationError: "CUSTOMER_NOT_ENABLED"}}]}]}}},
      222: {body: {results: [{customerClient: {id: "222", manager: false, level: 0}}]}},
    }});
  const result = await h.runtime.completeCallback({claimed});
  assert.equal(result.outcome, "pending_account_selection");
  assert.equal(result.setupComplete, false);
  assert.equal(result.setupResumeAction, "select_account");
  assert.deepEqual(h.committedAccounts.flat().map(account => account.id), ["222"]);
  assert.deepEqual(h.writes, ["atomic"]);
  assert.equal(h.calls.length, 4);
});
test("Google callback with all unavailable roots never stages a credential", async () => {
  const h = runtimeHarness("google_ads", {enabled: true, googleRoots: ["customers/111"], googleResponses: {
    111: {status: 403, body: {error: {status: "PERMISSION_DENIED", details: [{errors: [{errorCode: {authorizationError: "CUSTOMER_NOT_ENABLED"}}]}]}}},
  }});
  await assert.rejects(h.runtime.completeCallback({claimed}), /Google Ads REST request failed/);
  assert.deepEqual(h.committedAccounts, []);
  assert.deepEqual(h.vault, []);
  assert.equal(h.writes.includes("atomic"), false);
  assert.equal(h.calls.length, 3);
});

for (const provider of ["google_ads", "meta"]) {
  test(`${provider}: explicit disconnected reconnect binds the old version and ends at fresh account selection`,async()=>{
    const h=runtimeHarness(provider,{enabled:true,current:disconnected});
    const start=await h.runtime.beginCombinedSetup({installationAuthority:owner});
    const state=new URL(start.authorizationUrl).searchParams.get("state");
    assert.deepEqual(identityOAuthBindingFromState(provider,state),{connectionId:disconnected.connectionId,version:disconnected.version});
    assert.equal(h.calls.length,0);
    const result=await h.runtime.completeCallback({claimed:{...claimed,identityBinding:{connectionId:disconnected.connectionId,version:disconnected.version}}});
    assert.equal(result.outcome,"pending_account_selection");assert.equal(result.setupResumeAction,"select_account");
    assert.equal(result.setupComplete,false);assert.deepEqual(h.writes,["created","redirected","atomic"]);
  });
  test(`${provider}: combined setup always binds the full profile to the server-read connection`, async () => {
    const current={...row,status:"connected"};
    const h=runtimeHarness(provider,{enabled:true,current});
    const r=await h.runtime.beginCombinedSetup({installationAuthority:owner,
      provider:"klaviyo",permissionProfile:"reporting_v1",identityBinding:initial});
    const target=new URL(r.authorizationUrl);
    assert.equal(r.permissionProfile,"identity_v1");
    assert.deepEqual(target.searchParams.get("scope").split(provider==="meta"?",":" "),oauthPermissionScopes(provider,"identity_v1"));
    const state=target.searchParams.get("state");
    assert.equal(oauthPermissionProfileFromState(provider,state),"identity_v1");
    assert.deepEqual(identityOAuthBindingFromState(provider,state),{connectionId:current.connectionId,version:current.version});
    assert.deepEqual(h.writes,["created","redirected"]);
    assert.equal(h.calls.length,0);
    assert.doesNotMatch(r.authorizationUrl,/client_secret|access_token|refresh_token/);
  });
  test(`${provider}: combined setup cannot enable itself through caller arguments`, async () => {
    const h=runtimeHarness(provider);
    await assert.rejects(h.runtime.beginCombinedSetup({installationAuthority:owner,identityAuthorizationEnabled:true}),/START_DISABLED/);
    assert.deepEqual(h.writes,[]);assert.equal(h.calls.length,0);assert.equal(h.lifecycleReads.length,0);
  });
  for(const current of [null,{...row,status:"connected"},disconnected]) for(const grantIndex of provider==="google_ads"?[0,1]:[0]) {
    test(`${provider}: partial native grant ${grantIndex} stays resumable without replacing ${current?"existing":"initial"} authority`, async () => {
      const h=runtimeHarness(provider,{enabled:true,current,grantedScopes:[oauthPermissionScopes(provider,"identity_v1")[grantIndex]]});
      const before=JSON.stringify(current);
      const r=await h.runtime.completeCallback({claimed:{...claimed,identityBinding:current?{connectionId:current.connectionId,version:current.version}:initial}});
      assert.equal(r.outcome,"pending_permissions");assert.equal(r.setupState,"resume_setup");
      assert.equal(r.setupReason,"permissions_incomplete");assert.equal(r.setupComplete,false);
      assert.equal(r.setupResumeAction,"request_permissions");
      assert.deepEqual(h.writes,["failed"]);assert.deepEqual(h.vault,[]);
      assert.equal(h.calls.length,provider==="meta"?3:1);
      assert.equal(JSON.stringify(h.current()),before);
      assert.doesNotMatch(JSON.stringify(r),/access_token|refresh_token|authorizationCode|pkceVerifier/);
    });
  }
  test(`${provider}: malformed grants are an error, not a partial-permission completion`, async () => {
    const h=runtimeHarness(provider,{enabled:true,grantedScopes:42});
    await assert.rejects(h.runtime.completeCallback({claimed}),/INVALID/);
    assert.deepEqual(h.writes,["failed"]);assert.deepEqual(h.vault,[]);
    assert.equal(h.calls.length,provider==="meta"?3:1);
  });
  test(`${provider}: failed transaction acknowledgement cannot be reported as resumable`, async () => {
    const h=runtimeHarness(provider,{enabled:true,grantedScopes:[oauthPermissionScopes(provider,"identity_v1")[0]],finalizeFails:true});
    await assert.rejects(h.runtime.completeCallback({claimed}),/IDENTITY_OAUTH_FINALIZATION_UNCONFIRMED/);
    assert.deepEqual(h.writes,["failed"]);assert.deepEqual(h.vault,[]);
  });
  for(const finalizeMismatch of ["transaction","status"]) {
    test(`${provider}: wrong ${finalizeMismatch} acknowledgement cannot confirm a partial-permission stop`, async () => {
      const h=runtimeHarness(provider,{enabled:true,grantedScopes:[oauthPermissionScopes(provider,"identity_v1")[0]],finalizeMismatch});
      await assert.rejects(h.runtime.completeCallback({claimed}),/IDENTITY_OAUTH_FINALIZATION_UNCONFIRMED/);
      assert.deepEqual(h.writes,["failed"]);assert.deepEqual(h.vault,[]);
    });
  }
  test(`${provider}: scope-shaped error after atomic write starts must not become a permission resume`, async () => {
    const h=runtimeHarness(provider,{enabled:true,commitScopeError:true});
    await assert.rejects(h.runtime.completeCallback({claimed}),/OAUTH_IDENTITY_SCOPE_NOT_GRANTED/);
    assert.deepEqual(h.writes,["atomic"]);assert.deepEqual(h.vault,[]);
  });
  test(`${provider}: partial grant with unavailable callback return cannot pretend setup can resume`, async () => {
    const h=runtimeHarness(provider,{enabled:true,grantedScopes:[oauthPermissionScopes(provider,"identity_v1")[0]],returnFails:true});
    await assert.rejects(h.runtime.completeCallback({claimed}),/CALLBACK_RETURN_UNAVAILABLE/);
    assert.deepEqual(h.writes,["failed"]);assert.deepEqual(h.vault,[]);
  });
  test(`${provider}: provider HTTP error is not relabeled as a permission decline and is not retried`, async () => {
    const h=runtimeHarness(provider,{enabled:true,providerStatus:503});
    await assert.rejects(h.runtime.completeCallback({claimed}));
    assert.equal(h.calls.length,1);assert.deepEqual(h.writes,["failed"]);assert.deepEqual(h.vault,[]);
  });
  test(`${provider}: denied combined authorization remains incomplete without token or connection mutation`, async () => {
    const h=runtimeHarness(provider,{enabled:true,current:{...row,status:"connected"}});
    const r=await h.runtime.completeCallback({claimed:{...claimed,status:"denied"}});
    assert.equal(r.outcome,"denied");assert.equal(r.setupState,"resume_setup");
    assert.equal(r.setupReason,"authorization_not_completed");assert.equal(r.setupComplete,false);
    assert.equal(r.setupResumeAction,"request_permissions");
    assert.deepEqual(h.writes,[]);assert.deepEqual(h.vault,[]);assert.equal(h.calls.length,0);
    const legacy=await h.runtime.completeCallback({claimed:{...claimed,status:"denied",permissionProfile:undefined}});
    assert.equal("setupState" in legacy,false);
  });
  for(const connected of [false,true]) {
    test(`${provider}: full grants alone cannot complete ${connected?"upgraded":"initial"} combined setup`, async () => {
      const current=connected?{...row,status:"connected"}:null;
      const h=runtimeHarness(provider,{enabled:true,current,commitStatus:connected?"connected":"pending_account_selection"});
      const r=await h.runtime.completeCallback({claimed:{...claimed,identityBinding:current?{connectionId:current.connectionId,version:current.version}:initial}});
      assert.equal(r.setupComplete,false);assert.equal(r.setupState,"resume_setup");
      assert.equal(r.outcome,connected?"reporting_account_selected":"pending_account_selection");
      assert.equal(r.connectionState,connected?"connected":"pending_account_selection");
      assert.equal(r.setupReason,connected?"reporting_account_selected":"account_selection_required");
      assert.equal(r.setupResumeAction,connected?"reporting_selected":"select_account");
      assert.deepEqual(h.writes,["atomic"]);assert.deepEqual(h.vault,[]);
    });
  }
}
for (const provider of ["meta", "google_ads"]) {
  for (const options of [{commitFails:true},{returnFails:true}]) {
    test(`${provider}: uncertain write or later return failure never deletes or finalizes failed ${JSON.stringify(options)}`,async()=>{
      const h=runtimeHarness(provider,{enabled:true,...options});
      await assert.rejects(h.runtime.completeCallback({claimed}), /WRITE_UNCONFIRMED|CALLBACK_RETURN_UNAVAILABLE/);
      assert.deepEqual(h.writes,["atomic"]);assert.deepEqual(h.vault,[]);
    });
  }
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
    assert.deepEqual(h.vault, []);
    assert.deepEqual(h.writes, ["failed"]);
    assert.equal(h.lifecycleReads.length, 2);
    assert.equal(h.calls.length, provider === "meta" ? 4 : 3);
  });
  test(`${provider}: unchanged initial binding completes existing scope-checked callback in isolated tests`, async () => {
    const h = runtimeHarness(provider, {enabled: true});
    assert.equal((await h.runtime.completeCallback({claimed})).outcome, "pending_account_selection");
    assert.deepEqual(h.writes, ["atomic"]); assert.deepEqual(h.vault, []); assert.equal(h.lifecycleReads.length, 2);
  });
  test(`${provider}: unbound identity callback is rejected without provider calls`, async () => {
    const h = runtimeHarness(provider, {enabled: true});
    await assert.rejects(h.runtime.completeCallback({claimed: {...claimed, identityBinding: undefined}}), /OAUTH_IDENTITY_BINDING_INVALID/);
    assert.equal(h.calls.length, 0);
  });
}
