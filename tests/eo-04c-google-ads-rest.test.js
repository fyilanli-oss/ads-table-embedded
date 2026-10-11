import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoogleAdsAuthorizationUrl,
  createGoogleAdsRestClient,
  exchangeGoogleAdsAuthorizationCode,
  GoogleAdsRestError,
  readGoogleAdsOAuthConfig,
  refreshGoogleAdsAccessToken,
} from "../app/lib/providers/google-ads-rest.server.js";

const config = Object.freeze({
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://embedded.adstable.app/auth/google-ads/callback",
  developerToken: "developer-token-value",
});

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async json() {
      return payload;
    },
  };
}

test("Google OAuth config fails closed and requires the exact accepted callback", () => {
  assert.deepEqual(
    readGoogleAdsOAuthConfig({
      GOOGLE_ADS_OAUTH_CLIENT_ID: config.clientId,
      GOOGLE_ADS_OAUTH_CLIENT_SECRET: config.clientSecret,
      GOOGLE_ADS_OAUTH_REDIRECT_URI: config.redirectUri,
      GOOGLE_ADS_DEVELOPER_TOKEN: config.developerToken,
    }),
    config,
  );
  assert.throws(
    () => readGoogleAdsOAuthConfig({}),
    /GOOGLE_ADS_OAUTH_CLIENT_ID_REQUIRED/,
  );
  assert.throws(
    () => readGoogleAdsOAuthConfig({
      GOOGLE_ADS_OAUTH_CLIENT_ID: config.clientId,
      GOOGLE_ADS_OAUTH_CLIENT_SECRET: config.clientSecret,
      GOOGLE_ADS_OAUTH_REDIRECT_URI: config.redirectUri,
    }),
    /GOOGLE_ADS_DEVELOPER_TOKEN_REQUIRED/,
  );
  assert.throws(
    () => readGoogleAdsOAuthConfig({
      GOOGLE_ADS_OAUTH_CLIENT_ID: config.clientId,
      GOOGLE_ADS_OAUTH_CLIENT_SECRET: config.clientSecret,
      GOOGLE_ADS_OAUTH_REDIRECT_URI: "https://wrong.example/callback",
      GOOGLE_ADS_DEVELOPER_TOKEN: config.developerToken,
    }),
    /redirect URI does not match/,
  );
});

test("authorization URL carries offline, adwords, state and PKCE without client secret", () => {
  const value = buildGoogleAdsAuthorizationUrl({
    config,
    state: "state-value-that-is-long-enough-for-the-contract-123",
    pkceChallenge: "challenge-value-that-is-long-enough-1234567890",
  });
  const url = new URL(value);
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/adwords");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.has("client_secret"), false);
});

test("authorization code exchange requires and preserves offline refresh token", async () => {
  let captured;
  const token = await exchangeGoogleAdsAuthorizationCode({
    config,
    authorizationCode: "authorization-code",
    pkceVerifier: "pkce-verifier-value-that-is-long-enough-1234567890",
    fetchFn: async (url, init) => {
      captured = { url, init };
      return response(200, {
        access_token: "access-token",
        refresh_token: "refresh-token",
        token_type: "Bearer",
        expires_in: 3599,
        scope: "https://www.googleapis.com/auth/adwords",
      });
    },
  });
  assert.equal(token.refresh_token, "refresh-token");
  assert.equal(captured.url, "https://oauth2.googleapis.com/token");
  const form = new URLSearchParams(captured.init.body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code_verifier"), "pkce-verifier-value-that-is-long-enough-1234567890");
  assert.equal(form.get("redirect_uri"), config.redirectUri);

  await assert.rejects(
    () => exchangeGoogleAdsAuthorizationCode({
      config,
      authorizationCode: "authorization-code",
      pkceVerifier: "pkce-verifier-value-that-is-long-enough-1234567890",
      fetchFn: async () => response(200, {
        access_token: "access-token",
        token_type: "Bearer",
        expires_in: 3599,
      }),
    }),
    /offline refresh token/,
  );
});

test("refresh keeps the existing refresh token when Google rotates only access token", async () => {
  const token = await refreshGoogleAdsAccessToken({
    config,
    refreshToken: "retained-refresh-token",
    fetchFn: async () => response(200, {
      access_token: "new-access-token",
      token_type: "Bearer",
      expires_in: 3600,
    }),
  });
  assert.equal(token.access_token, "new-access-token");
  assert.equal(token.refresh_token, "retained-refresh-token");
});

test("REST client lists accessible customers without manager header", async () => {
  let captured;
  const client = createGoogleAdsRestClient({
    accessToken: "access-token",
    developerToken: config.developerToken,
    loginCustomerId: "999-888-7777",
    fetchFn: async (url, init) => {
      captured = { url, init };
      return response(
        200,
        { resourceNames: ["customers/1234567890", "customers/2223334444"] },
        { "request-id": "request-1" },
      );
    },
  });
  const result = await client.listAccessibleCustomers();
  assert.deepEqual(
    result.customers.map((item) => item.customer_id),
    ["1234567890", "2223334444"],
  );
  assert.equal(result.request_id, "request-1");
  assert.equal(captured.init.headers["login-customer-id"], undefined);
  assert.equal(captured.init.headers.authorization, "Bearer access-token");
  assert.equal(captured.init.headers["developer-token"], config.developerToken);
});

test("REST search sends verified access path, preserves opaque pagination and request id", async () => {
  let captured;
  const client = createGoogleAdsRestClient({
    accessToken: "access-token",
    developerToken: config.developerToken,
    loginCustomerId: "999-888-7777",
    fetchFn: async (url, init) => {
      captured = { url, init };
      return response(
        200,
        {
          results: [{ customer: { id: "1234567890" } }],
          nextPageToken: "opaque-next",
          totalResultsCount: "1",
        },
        { "request-id": "request-2" },
      );
    },
  });
  const result = await client.search({
    customerId: "123-456-7890",
    query: "SELECT customer.id FROM customer",
    pageToken: "opaque-current",
  });
  assert.match(captured.url, /customers\/1234567890\/googleAds:search$/);
  assert.equal(captured.init.headers["login-customer-id"], "9998887777");
  assert.equal(captured.init.headers["developer-token"], config.developerToken);
  assert.equal(JSON.parse(captured.init.body).pageToken, "opaque-current");
  assert.equal(result.next_page_token, "opaque-next");
  assert.equal(result.total_results_count, 1);
  assert.equal(result.request_id, "request-2");
});

test("provider errors never include access or refresh token material", async () => {
  const client = createGoogleAdsRestClient({
    accessToken: "super-secret-access-token",
    developerToken: config.developerToken,
    fetchFn: async () => response(
      401,
      { error: { status: "UNAUTHENTICATED", message: "provider raw message" } },
      { "request-id": "request-3" },
    ),
  });
  await assert.rejects(
    () => client.listAccessibleCustomers(),
    (error) => {
      assert.ok(error instanceof GoogleAdsRestError);
      assert.equal(error.code, "GOOGLE_ADS_REST_REQUEST_FAILED");
      assert.equal(error.details.provider_status, "UNAUTHENTICATED");
      assert.equal(error.details.request_id, "request-3");
      assert.doesNotMatch(JSON.stringify(error), /super-secret-access-token|provider raw message/);
      return true;
    },
  );
});
