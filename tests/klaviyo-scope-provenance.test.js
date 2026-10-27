import assert from "node:assert/strict";
import test from "node:test";
import {exchangeKlaviyoAuthorizationCode, refreshKlaviyoAccessToken, KLAVIYO_OAUTH_SCOPES} from "../app/lib/providers/klaviyo-api.server.js";
import {createKlaviyoCredentialAuthority} from "../app/lib/oauth/klaviyo-oauth-runtime.server.js";
import {assessIdentityPermissionScopes} from "../app/lib/oauth/identity-permission-preflight.server.js";
import {OAUTH_CALLBACK_URIS} from "../app/lib/oauth/oauth-transaction.server.js";

const config = {clientId: "client", clientSecret: "secret", redirectUri: OAUTH_CALLBACK_URIS.klaviyo};
const now = () => new Date("2026-10-27T12:00:00.000Z");
const previous = "2026-10-27T10:00:00.000Z";
const base = {access_token: "new-access", refresh_token: "new-refresh", token_type: "Bearer", expires_in: 3600};
const json = (body, status = 200) => new Response(JSON.stringify(body), {status});
const native = {...base, scope: KLAVIYO_OAUTH_SCOPES.join(" ")};
const exchange = body => exchangeKlaviyoAuthorizationCode({config, authorizationCode: "code", pkceVerifier: "v".repeat(43), now, fetchFn: async () => json(body)});
const refresh = (body, extra = {}) => refreshKlaviyoAccessToken({config, refreshToken: "old-refresh", scopes: KLAVIYO_OAUTH_SCOPES,
  scopeObservedAt: previous, now, fetchFn: async () => json(body), ...extra});

test("authorization exchange records actual native scope and observation time, without extra requested scopes", async () => {
  const result = await exchange({...base, scope: "accounts:read events:read"});
  assert.deepEqual(result.scopes, ["accounts:read", "events:read"]);
  assert.equal(result.tokenSet.scope_source, "native_token_response");
  assert.equal(result.tokenSet.scope_observed_at, now().toISOString());
  assert.equal(result.scopes.includes("campaigns:read"), false);
  const context = {provider: "klaviyo", workspaceId: "11111111-1111-4111-8111-111111111111", installGeneration: 1,
    shopId: "gid://shopify/Shop/1", shopDomain: "example.myshopify.com", connectionId: "22222222-2222-4222-8222-222222222222", accountId: "ABCD"};
  const assessment = assessIdentityPermissionScopes({context, now, evidence: {source: "klaviyo_oauth_native_scope_response",
    complete: true, context, observedAt: result.tokenSet.scope_observed_at, scopes: result.scopes}});
  assert.equal(assessment.scopeStatus, "observed_missing");
  assert.deepEqual(assessment.missingScopes, ["campaigns:read", "flows:read", "metrics:read"]);
});
test("native refresh response replaces the old list and gets its own scope observation", async () => {
  const result = await refresh({...base, scope: "accounts:read"});
  assert.deepEqual(result.scopes, ["accounts:read"]);
  assert.equal(result.tokenSet.scope_source, "native_token_response");
  assert.equal(result.tokenSet.scope_observed_at, now().toISOString());
});
test("omitted refresh scope retains earlier grant and its original time without presenting it as a new native observation", async () => {
  const result = await refresh(base);
  assert.deepEqual(result.scopes, [...KLAVIYO_OAUTH_SCOPES].sort());
  assert.equal(result.tokenSet.scope_source, "retained_previous_grant");
  assert.equal(result.tokenSet.scope_observed_at, previous);
  assert.equal(result.verifiedAt, now().toISOString());
  assert.notEqual(result.tokenSet.scope_observed_at, result.verifiedAt);
});
test("legacy refresh without old observation time stays undated", async () => {
  const result = await refresh(base, {scopeObservedAt: null});
  assert.equal(result.tokenSet.scope_source, "retained_previous_grant");
  assert.equal(result.tokenSet.scope_observed_at, null);
});
test("new native observation does not depend on the cached grant or its old date", async () => {
  const result = await refresh(native, {scopes: [], scopeObservedAt: "invalid"});
  assert.equal(result.tokenSet.scope_source, "native_token_response");
  assert.equal(result.tokenSet.scope_observed_at, now().toISOString());
});
for (const scope of [undefined, null, "", [], ["accounts:read"], " accounts:read", "accounts:read ", "accounts:read  events:read",
  "accounts:read\tevents:read", "accounts:read accounts:read", "accounts:read\nevents:read", "accounts:read " + "x".repeat(201)]) {
  test(`initial malformed or missing native scopes never become the requested list: ${JSON.stringify(scope)}`, async () => {
    await assert.rejects(exchange({...base, scope}));
  });
}
test("authorization exchange cannot retain a requested scope list when native scope is omitted", async () => {
  await assert.rejects(exchange(base), {code: "KLAVIYO_SCOPE_RESPONSE_REQUIRED"});
});
for (const scope of [null, "", [], "accounts:read accounts:read"]) {
  test(`explicit malformed refresh scope cannot fall back to old grant: ${JSON.stringify(scope)}`, async () => {
    await assert.rejects(refresh({...base, scope}));
  });
}
for (const scopeObservedAt of ["2026-10-28T12:00:00.000Z", "invalid", "2026-10-27T10:00:00Z", 123]) {
  test(`retained observation cannot have malformed or future time: ${JSON.stringify(scopeObservedAt)}`, async () => {
    await assert.rejects(refresh(base, {scopeObservedAt}), {code: "KLAVIYO_SCOPE_OBSERVATION_INVALID"});
  });
}

test("credential renewal carries the original scope time into the encrypted replacement", async () => {
  const stored = {...base, scope: native.scope, scopes: KLAVIYO_OAUTH_SCOPES,
    scope_source: "native_token_response", scope_observed_at: previous, expires_at: "2026-10-27T11:59:00.000Z"};
  let saved;
  const authority = createKlaviyoCredentialAuthority({config, now,
    tokenVault: {async loadProviderTokenSet() {return stored;},
      async storeProviderTokenSet(input) {saved = input; return {credentialId: "replacement"};},
      async deleteProviderTokenSet() {throw new Error("UNEXPECTED_DELETE");}},
    lifecycle: {async load() {return {status: "connected", version: 7};}, async renewCredential(input) {
      assert.equal(input.expectedVersion, 7); assert.deepEqual(input.providerEvidence.scopes, [...KLAVIYO_OAUTH_SCOPES].sort());
    }},
    fetchFn: async () => json(base),
  });
  const result = await authority.prepareCredential({installationAuthority: {workspaceId: "workspace", installGeneration: 2},
    credentialId: "credential", connected: {connectionId: "connection", credentialId: "credential"}});
  assert.equal(saved.tokenSet.scope_source, "retained_previous_grant");
  assert.equal(saved.tokenSet.scope_observed_at, previous);
  assert.equal(result.tokenSet.scope_observed_at, previous);
});
test("first provider failure remains one token request with no scope fallback result", async () => {
  let count = 0;
  await assert.rejects(refreshKlaviyoAccessToken({config, refreshToken: "old-refresh", scopes: KLAVIYO_OAUTH_SCOPES, now,
    fetchFn: async () => {count++; return json({error: "invalid_grant"}, 400);}}), {code: "KLAVIYO_REAUTHORIZATION_REQUIRED"});
  assert.equal(count, 1);
});
