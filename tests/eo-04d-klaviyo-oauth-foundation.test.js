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
  readKlaviyoOAuthConfig,
  refreshKlaviyoAccessToken,
  revokeKlaviyoAuthorization,
} from "../app/lib/providers/klaviyo-api.server.js";
import {installedShopifySettingsUrl} from "../app/lib/shopify/installed-app-return.server.js";

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
  assert.equal(exchanged.tokenSet.refresh_token, "refresh-token");
  assert.ok(exchanged.scopes.includes("accounts:read"));
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

test("foundation stages pending completion without inventing reporting or data contracts", () => {
  const runtime = read("app/lib/oauth/klaviyo-oauth-runtime.server.js");
  const repository = read("app/lib/database/klaviyo-setup-repository.server.js");
  const callback = read("app/routes/auth.klaviyo.callback.ts");
  assert.match(runtime, /outcome: "pending_completion"/);
  assert.match(repository, /stage_provider_account_selection/);
  assert.match(repository, /'klaviyo'/);
  assert.match(callback, /provider: "klaviyo"/);
  assert.doesNotMatch(runtime + repository + callback, /reportingAccount|channel_hierarchy|Dataset V2/i);
  assert.doesNotMatch(runtime + repository + callback, /complete_pending_provider_account_selection/);
});
