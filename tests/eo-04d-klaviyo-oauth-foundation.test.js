import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  buildKlaviyoAuthorizationUrl,
  discoverKlaviyoAccount,
  exchangeKlaviyoAuthorizationCode,
  KLAVIYO_ACCOUNTS_ENDPOINT,
  KLAVIYO_API_REVISION,
  KLAVIYO_OAUTH_SCOPES,
  KLAVIYO_REVOCATION_ENDPOINT,
  KLAVIYO_TOKEN_ENDPOINT,
  klaviyoTokenRequiresRefresh,
  readKlaviyoOAuthConfig,
  refreshKlaviyoAccessToken,
  revokeKlaviyoAuthorization,
} from "../app/lib/providers/klaviyo-api.server.js";
import {installedShopifySettingsUrl} from "../app/lib/shopify/installed-app-return.server.js";
import {
  createKlaviyoCredentialAuthority,
  selectKlaviyoAccount,
} from "../app/lib/oauth/klaviyo-oauth-runtime.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const config = Object.freeze({
  clientId: "klaviyo-client",
  clientSecret: "klaviyo-secret",
  redirectUri: "https://embedded.adstable.app/auth/klaviyo/callback",
});

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {get: (name) => headers[name.toLowerCase()] ?? null},
    json: async () => payload,
  };
}

test("Klaviyo configuration and authorization use the exact callback and S256 PKCE", () => {
  assert.deepEqual(readKlaviyoOAuthConfig({
    KLAVIYO_CLIENT_ID: config.clientId,
    KLAVIYO_CLIENT_SECRET: config.clientSecret,
    KLAVIYO_OAUTH_REDIRECT_URI: config.redirectUri,
  }), config);
  const url = new URL(buildKlaviyoAuthorizationUrl({
    config,
    state: "s".repeat(43),
    pkceChallenge: "c".repeat(43),
  }));
  assert.equal(url.origin + url.pathname, "https://www.klaviyo.com/oauth/authorize");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), KLAVIYO_OAUTH_SCOPES.join(" "));
  assert.throws(
    () => readKlaviyoOAuthConfig({...config, KLAVIYO_CLIENT_ID: config.clientId}),
    /KLAVIYO_CLIENT_SECRET_REQUIRED/,
  );
});

test("authorization-code exchange uses Basic auth, form encoding and provider expiry", async () => {
  const calls = [];
  const exchanged = await exchangeKlaviyoAuthorizationCode({
    config,
    authorizationCode: "authorization-code",
    pkceVerifier: "v".repeat(43),
    now: () => new Date("2026-10-13T10:00:00.000Z"),
    fetchFn: async (url, options) => {
      calls.push({url, options});
      return response(200, {
        access_token: "access-token",
        refresh_token: "refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        scope: KLAVIYO_OAUTH_SCOPES.join(" "),
      });
    },
  });
  assert.equal(calls[0].url, KLAVIYO_TOKEN_ENDPOINT);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(
    calls[0].options.headers.authorization,
    `Basic ${Buffer.from("klaviyo-client:klaviyo-secret").toString("base64")}`,
  );
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("redirect_uri"), config.redirectUri);
  assert.equal(body.get("code"), "authorization-code");
  assert.equal(body.get("code_verifier"), "v".repeat(43));
  assert.equal(exchanged.expiresAt, "2026-10-13T11:00:00.000Z");
  assert.equal(exchanged.verifiedAt, "2026-10-13T10:00:00.000Z");
  assert.equal(exchanged.tokenSet.expires_at, "2026-10-13T11:00:00.000Z");
  assert.equal(exchanged.tokenSet.refresh_token, "refresh-token");
  assert.ok(exchanged.scopes.includes("accounts:read"));
});

test("authorization code and refresh invalid_grant have distinct terminal meanings", async () => {
  const rejected = async () => response(400, {error: "invalid_grant"});
  await assert.rejects(
    exchangeKlaviyoAuthorizationCode({
      config,
      authorizationCode: "expired-code",
      pkceVerifier: "v".repeat(43),
      fetchFn: rejected,
    }),
    (error) => error?.code === "KLAVIYO_OAUTH_SESSION_EXPIRED",
  );
  await assert.rejects(
    refreshKlaviyoAccessToken({
      config,
      refreshToken: "invalid-refresh",
      scopes: KLAVIYO_OAUTH_SCOPES,
      fetchFn: rejected,
    }),
    (error) => error?.code === "KLAVIYO_REAUTHORIZATION_REQUIRED",
  );
});

test("token expiry is decided before provider access and legacy tokens refresh", () => {
  const now = () => new Date("2026-10-17T10:00:00.000Z");
  assert.equal(klaviyoTokenRequiresRefresh({}, now), true);
  assert.equal(klaviyoTokenRequiresRefresh({
    expires_at: "2026-10-17T10:00:30.000Z",
  }, now), true);
  assert.equal(klaviyoTokenRequiresRefresh({
    expires_at: "2026-10-17T11:00:00.000Z",
  }, now), false);
});

test("token exchange fails closed without refresh token or accounts scope", async () => {
  const exchange = (payload) => exchangeKlaviyoAuthorizationCode({
    config,
    authorizationCode: "authorization-code",
    pkceVerifier: "v".repeat(43),
    fetchFn: async () => response(200, payload),
  });
  await assert.rejects(
    exchange({
      access_token: "access",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "accounts:read",
    }),
    (error) => error?.code === "KLAVIYO_REFRESH_TOKEN_MISSING",
  );
  await assert.rejects(
    exchange({
      access_token: "access",
      refresh_token: "refresh",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "campaigns:read",
    }),
    (error) => error?.code === "KLAVIYO_ACCOUNTS_SCOPE_MISSING",
  );
});

test("refresh uses the rotating refresh-token grant and preserves verified scopes", async () => {
  const calls = [];
  const refreshed = await refreshKlaviyoAccessToken({
    config,
    refreshToken: "old-refresh",
    scopes: KLAVIYO_OAUTH_SCOPES,
    now: () => new Date("2026-10-13T10:00:00.000Z"),
    fetchFn: async (url, options) => {
      calls.push({url, options});
      return response(200, {
        access_token: "new-access",
        refresh_token: "new-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    },
  });
  assert.equal(calls[0].url, KLAVIYO_TOKEN_ENDPOINT);
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("refresh_token"), "old-refresh");
  assert.equal(refreshed.tokenSet.refresh_token, "new-refresh");
  assert.deepEqual(refreshed.scopes, [...KLAVIYO_OAUTH_SCOPES].sort());
});

test("Accounts API yields exactly one provider-authored account with currency and timezone", async () => {
  const calls = [];
  const evidence = await discoverKlaviyoAccount({
    accessToken: "access-token",
    scopes: KLAVIYO_OAUTH_SCOPES,
    now: () => new Date("2026-10-13T10:00:00.000Z"),
    fetchFn: async (url, options) => {
      calls.push({url, options});
      return response(200, {data: [{
        type: "account",
        id: "account-1",
        attributes: {
          contact_information: {organization_name: "AdsTable Demo"},
          preferred_currency: "USD",
          timezone: "Europe/Istanbul",
        },
      }]});
    },
  });
  assert.equal(calls[0].url, KLAVIYO_ACCOUNTS_ENDPOINT);
  assert.equal(calls[0].options.headers.authorization, "Bearer access-token");
  assert.equal(calls[0].options.headers.revision, KLAVIYO_API_REVISION);
  assert.equal(evidence.authority, "provider_account_access_verified");
  assert.equal(evidence.provider, "klaviyo");
  assert.equal(evidence.reportingAccountId, null);
  assert.deepEqual(evidence.accounts, [{
    id: "account-1",
    name: "AdsTable Demo",
    kind: "account",
    reportingEligible: true,
    status: "active",
    currency: "USD",
    timezone: "Europe/Istanbul",
    loginAccountId: null,
  }]);
});

test("Accounts API fails closed on zero, multiple or incomplete accounts", async () => {
  const discover = (data) => discoverKlaviyoAccount({
    accessToken: "access-token",
    scopes: ["accounts:read"],
    fetchFn: async () => response(200, {data}),
  });
  await assert.rejects(
    discover([]),
    (error) => error?.code === "KLAVIYO_ACCOUNT_CARDINALITY_INVALID",
  );
  await assert.rejects(
    discover([{id: "a"}, {id: "b"}]),
    (error) => error?.code === "KLAVIYO_ACCOUNT_CARDINALITY_INVALID",
  );
  await assert.rejects(discover([{
    type: "account",
    id: "a",
    attributes: {preferred_currency: "USD", timezone: "Not/AZone"},
  }]), (error) => error?.code === "KLAVIYO_ACCOUNT_TIMEZONE_INVALID");
  await assert.rejects(discover([{
    type: "profile",
    id: "a",
    attributes: {preferred_currency: "USD", timezone: "Europe/Istanbul"},
  }]), (error) => error?.code === "KLAVIYO_ACCOUNT_SCHEMA_CHANGED");
});

test("Accounts 401 requires reauthorization while 403 stays permission denied", async () => {
  const discover = (status) => discoverKlaviyoAccount({
    accessToken: "access-token",
    scopes: ["accounts:read"],
    fetchFn: async () => response(status, {errors: [{code: "provider_status"}]}),
  });
  await assert.rejects(
    discover(401),
    (error) => error?.code === "KLAVIYO_REAUTHORIZATION_REQUIRED",
  );
  await assert.rejects(
    discover(403),
    (error) => error?.code === "KLAVIYO_PERMISSION_DENIED",
  );
});

function accountResponse() {
  return response(200, {data: [{
    type: "account",
    id: "account-1",
    attributes: {
      contact_information: {organization_name: "AdsTable Demo"},
      preferred_currency: "USD",
      timezone: "Europe/Istanbul",
    },
  }]});
}

function credentialHarness({stored, accountsStatus = 200, refreshStatus = 200} = {}) {
  const calls = [];
  const lifecycle = {
    load: async () => {
      calls.push("lifecycle.load");
      return {status: "connected", version: 4};
    },
    renewCredential: async () => calls.push("lifecycle.renew"),
    markReauthorizationRequired: async () => calls.push("lifecycle.reauthorize"),
  };
  const setup = {
    stage: async (input) => {
      calls.push("setup.stage");
      return {connectionId: input.connectionId, version: 3};
    },
  };
  const tokenVault = {
    loadProviderTokenSet: async () => {
      calls.push("vault.load");
      return stored;
    },
    storeProviderTokenSet: async () => {
      calls.push("vault.store");
      return {credentialId: "credential-new"};
    },
    deleteProviderTokenSet: async () => calls.push("vault.delete"),
  };
  const fetchFn = async (url) => {
    if (url === KLAVIYO_TOKEN_ENDPOINT) {
      calls.push("provider.token");
      return refreshStatus === 200
        ? response(200, {
            access_token: "access-new",
            refresh_token: "refresh-new",
            token_type: "Bearer",
            expires_in: 3600,
          })
        : response(refreshStatus, {error: "invalid_grant"});
    }
    if (url === KLAVIYO_ACCOUNTS_ENDPOINT) {
      calls.push("provider.accounts");
      return accountsStatus === 200
        ? accountResponse()
        : response(accountsStatus, {errors: [{code: "provider_status"}]});
    }
    throw new Error("UNEXPECTED_TEST_URL");
  };
  return {
    calls,
    authority: createKlaviyoCredentialAuthority({
      tokenVault,
      lifecycle,
      setup,
      config,
      fetchFn,
      now: () => new Date("2026-10-17T10:00:00.000Z"),
    }),
  };
}

const installationAuthority = Object.freeze({
  authority: "shopify_installation_verified",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  installGeneration: 1,
  status: "active",
});

test("expired connected credential renews before the single Accounts request", async () => {
  const {authority: credential, calls} = credentialHarness({stored: {
    access_token: "access-old",
    refresh_token: "refresh-old",
    scopes: KLAVIYO_OAUTH_SCOPES,
    expires_at: "2026-10-17T09:59:00.000Z",
  }});
  await credential.discover({
    installationAuthority,
    credentialId: "credential-old",
    scopes: KLAVIYO_OAUTH_SCOPES,
    connected: {
      connectionId: "00000000-0000-4000-8000-000000000011",
      credentialId: "credential-old",
    },
  });
  assert.deepEqual(calls, [
    "vault.load",
    "provider.token",
    "vault.store",
    "lifecycle.load",
    "lifecycle.renew",
    "provider.accounts",
  ]);
});

test("legacy pending credential is persisted and staged before provider access", async () => {
  const {authority: credential, calls} = credentialHarness({stored: {
    access_token: "access-old",
    refresh_token: "refresh-old",
    scopes: KLAVIYO_OAUTH_SCOPES,
  }});
  const evidence = await credential.discover({
    installationAuthority,
    credentialId: "credential-old",
    scopes: KLAVIYO_OAUTH_SCOPES,
    pendingConnectionId: "00000000-0000-4000-8000-000000000012",
  });
  assert.equal(evidence.pending.version, 3);
  assert.deepEqual(calls, [
    "vault.load",
    "provider.token",
    "vault.store",
    "setup.stage",
    "provider.accounts",
  ]);
});

test("first Accounts failure is terminal and is never followed by refresh or retry", async () => {
  const {authority: credential, calls} = credentialHarness({
    stored: {
      access_token: "access-current",
      refresh_token: "refresh-current",
      scopes: KLAVIYO_OAUTH_SCOPES,
      expires_at: "2026-10-17T11:00:00.000Z",
    },
    accountsStatus: 401,
  });
  await assert.rejects(
    credential.discover({
      installationAuthority,
      credentialId: "credential-current",
      scopes: KLAVIYO_OAUTH_SCOPES,
      connected: {
        connectionId: "00000000-0000-4000-8000-000000000013",
        credentialId: "credential-current",
      },
    }),
    (error) => error?.code === "KLAVIYO_REAUTHORIZATION_REQUIRED",
  );
  assert.deepEqual(calls, [
    "vault.load",
    "provider.accounts",
    "lifecycle.load",
    "lifecycle.reauthorize",
  ]);
});

test("Accounts 403 is permission denial without refresh, retry or lifecycle guess", async () => {
  const {authority: credential, calls} = credentialHarness({
    stored: {
      access_token: "access-current",
      refresh_token: "refresh-current",
      scopes: KLAVIYO_OAUTH_SCOPES,
      expires_at: "2026-10-17T11:00:00.000Z",
    },
    accountsStatus: 403,
  });
  await assert.rejects(
    credential.discover({
      installationAuthority,
      credentialId: "credential-current",
      scopes: KLAVIYO_OAUTH_SCOPES,
      connected: {
        connectionId: "00000000-0000-4000-8000-000000000015",
        credentialId: "credential-current",
      },
    }),
    (error) => error?.code === "KLAVIYO_PERMISSION_DENIED",
  );
  assert.deepEqual(calls, ["vault.load", "provider.accounts"]);
});

test("refresh invalid_grant marks connected authority unavailable without Accounts call", async () => {
  const {authority: credential, calls} = credentialHarness({
    stored: {
      access_token: "access-old",
      refresh_token: "refresh-invalid",
      scopes: KLAVIYO_OAUTH_SCOPES,
      expires_at: "2026-10-17T09:59:00.000Z",
    },
    refreshStatus: 400,
  });
  await assert.rejects(
    credential.discover({
      installationAuthority,
      credentialId: "credential-old",
      scopes: KLAVIYO_OAUTH_SCOPES,
      connected: {
        connectionId: "00000000-0000-4000-8000-000000000014",
        credentialId: "credential-old",
      },
    }),
    (error) => error?.code === "KLAVIYO_REAUTHORIZATION_REQUIRED",
  );
  assert.deepEqual(calls, [
    "vault.load",
    "provider.token",
    "lifecycle.load",
    "lifecycle.reauthorize",
  ]);
});

test("revocation targets the refresh token before local disconnect authority can change", async () => {
  const calls = [];
  const result = await revokeKlaviyoAuthorization({
    config,
    refreshToken: "refresh-token",
    fetchFn: async (url, options) => {
      calls.push({url, options});
      return response(204, null);
    },
  });
  assert.equal(result.outcome, "revoked");
  assert.equal(calls[0].url, KLAVIYO_REVOCATION_ENDPOINT);
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get("token"), "refresh-token");
  assert.equal(body.get("token_type_hint"), "refresh_token");
});

test("callback return carries only bounded Klaviyo status and public error codes", () => {
  const url = new URL(installedShopifySettingsUrl("demo-store.myshopify.com", {
    klaviyoStatus: "error",
    klaviyoError: "KLAVIYO_ACCOUNTS_REQUEST_FAILED",
  }));
  assert.equal(url.searchParams.get("klaviyo_status"), "error");
  assert.equal(url.searchParams.get("klaviyo_error"), "KLAVIYO_ACCOUNTS_REQUEST_FAILED");
  assert.throws(
    () => installedShopifySettingsUrl("demo-store.myshopify.com", {klaviyoError: "raw provider body"}),
    /KLAVIYO_RETURN_ERROR_INVALID/,
  );
});

test("Klaviyo completion requires an explicit account still present in fresh provider evidence", () => {
  const accounts = [{id: "account-1", name: "AdsTable Demo"}];
  assert.equal(selectKlaviyoAccount(accounts, "account-1"), accounts[0]);
  for (const accountId of ["", "missing-account"]) {
    assert.throws(
      () => selectKlaviyoAccount(accounts, accountId),
      /KLAVIYO_ACCOUNT_SELECTION_INVALID/,
    );
  }
});

test("foundation stages pending account selection without inventing reporting or data contracts", () => {
  const runtime = read("app/lib/oauth/klaviyo-oauth-runtime.server.js");
  const repository = read("app/lib/database/klaviyo-setup-repository.server.js");
  const callback = read("app/routes/auth.klaviyo.callback.ts");
  assert.match(runtime, /outcome: "pending_account_selection"/);
  assert.match(runtime, /accounts: evidence\.accounts/);
  assert.match(runtime, /selectKlaviyoAccount\(evidence\.accounts, accountId\)/);
  assert.doesNotMatch(runtime, /account: evidence\.accounts\[0\]/);
  assert.match(repository, /stage_provider_account_selection/);
  assert.match(repository, /load_pending_klaviyo_account_selection/);
  assert.match(repository, /'klaviyo'/);
  assert.match(callback, /provider: "klaviyo"/);
  assert.doesNotMatch(runtime + repository + callback, /reportingAccount|channel_hierarchy|Dataset V2/i);
  assert.doesNotMatch(runtime + repository + callback, /complete_pending_provider_account_selection/);
});
