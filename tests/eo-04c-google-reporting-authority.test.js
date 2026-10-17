import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoogleReportingAuthorityRuntime,
} from "../app/lib/providers/google-reporting-authority.server.js";

const installationAuthority = Object.freeze({
  authority: "shopify_installation_verified",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  installGeneration: 2,
  status: "active",
});

const environment = Object.freeze({
  GOOGLE_ADS_OAUTH_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_ADS_OAUTH_REDIRECT_URI: "https://embedded.adstable.app/auth/google-ads/callback",
  GOOGLE_ADS_DEVELOPER_TOKEN: "developer-token",
});

function databaseRow(overrides = {}) {
  return {
    connection_id: "22222222-2222-4222-8222-222222222222",
    credential_id: "33333333-3333-4333-8333-333333333333",
    granted_scopes: ["https://www.googleapis.com/auth/adwords"],
    connected_at: "2026-10-13T00:00:00.000Z",
    last_verified_at: "2026-10-13T00:00:00.000Z",
    accounts: [{
      id: "200",
      name: "Advertiser",
      kind: "advertiser",
      reporting_eligible: true,
      currency: "ISK",
      timezone: "Atlantic/Reykjavik",
      login_account_id: "100",
    }],
    reporting_account_id: "200",
    ...overrides,
  };
}

function database(row = databaseRow()) {
  return {
    async query(sql, values) {
      assert.match(sql, /integrations[.]load_provider_account_authority/);
      assert.deepEqual(values, [installationAuthority.workspaceId, 2, "google_ads"]);
      return {rows: row ? [row] : []};
    },
  };
}

const json = (payload, status = 200, headers = {}) => new Response(
  JSON.stringify(payload),
  {status, headers: {"content-type": "application/json", ...headers}},
);

test("Google reporting refreshes once and reuses one token for canonical advertiser pages", async () => {
  const requests = [];
  const vaultLoads = [];
  const runtime = createGoogleReportingAuthorityRuntime({
    database: database(),
    tokenVault: {
      async loadProviderTokenSet(input) {
        vaultLoads.push(input);
        return {access_token: "vault-only-token", refresh_token: "vault-refresh-token"};
      },
    },
    environment,
    fetchFn: async (url, options) => {
      const request = {url: new URL(url), options, body: options.body};
      requests.push(request);
      if (request.url.hostname === "oauth2.googleapis.com") {
        return json({
          access_token: "fresh-access-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/adwords",
        });
      }
      return json({results: [], totalResultsCount: "0"}, 200, {"request-id": "req-1"});
    },
  });

  const result = await runtime.readEvidencePage({
    installationAuthority,
    queryFamily: "cart_data_product_sales_daily",
    dateWindow: {start: "2026-10-01", end: "2026-10-01"},
  });
  await runtime.readEvidencePage({
    installationAuthority,
    queryFamily: "cart_data_product_sales_daily",
    dateWindow: {start: "2026-10-01", end: "2026-10-01"},
    pageToken: "next-page",
  });

  assert.equal(requests.length, 3);
  assert.equal(requests[0].url.pathname, "/token");
  assert.match(requests[0].body, /grant_type=refresh_token/);
  assert.match(requests[0].body, /refresh_token=vault-refresh-token/);
  assert.equal(requests[1].url.pathname, "/v25/customers/200/googleAds:search");
  assert.equal(requests[1].options.headers.authorization, "Bearer fresh-access-token");
  assert.equal(requests[1].options.headers["developer-token"], "developer-token");
  assert.equal(requests[1].options.headers["login-customer-id"], "100");
  assert.match(JSON.parse(requests[1].body).query, /FROM cart_data_sales_view/);
  assert.equal(requests[2].url.pathname, "/v25/customers/200/googleAds:search");
  assert.equal(requests[2].options.headers.authorization, "Bearer fresh-access-token");
  assert.equal(JSON.parse(requests[2].body).pageToken, "next-page");
  assert.deepEqual(vaultLoads, [{
    credentialId: "33333333-3333-4333-8333-333333333333",
    installationAuthority,
    provider: "google_ads",
  }]);
  assert.deepEqual(result.authority, {
    connection_id: "22222222-2222-4222-8222-222222222222",
    reporting_account_id: "200",
    reporting_account_currency: "ISK",
    reporting_account_timezone: "Atlantic/Reykjavik",
  });
  assert.equal(result.page.observation_state, "not_observed_in_this_execution");
  assert.doesNotMatch(JSON.stringify(result), /vault-only-token|vault-refresh-token|developer-token/);
});

test("Google v25 reporting works without the sunset developer-token header", async () => {
  const requests = [];
  const {GOOGLE_ADS_DEVELOPER_TOKEN: _retired, ...environmentWithoutDeveloperToken} = environment;
  const runtime = createGoogleReportingAuthorityRuntime({
    database: database(),
    tokenVault: {
      async loadProviderTokenSet() {
        return {access_token: "vault-only-token", refresh_token: "vault-refresh-token"};
      },
    },
    environment: environmentWithoutDeveloperToken,
    fetchFn: async (url, options) => {
      const request = {url: new URL(url), options};
      requests.push(request);
      if (request.url.hostname === "oauth2.googleapis.com") {
        return json({
          access_token: "fresh-access-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/adwords",
        });
      }
      return json({results: [], totalResultsCount: "0"}, 200, {"request-id": "req-no-token"});
    },
  });

  await runtime.readEvidencePage({
    installationAuthority,
    queryFamily: "account_identity",
    dateWindow: {start: "2026-10-01", end: "2026-10-01"},
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].url.hostname, "googleads.googleapis.com");
  assert.equal(requests[1].options.headers.authorization, "Bearer fresh-access-token");
  assert.equal(Object.hasOwn(requests[1].options.headers, "developer-token"), false);
  assert.equal(requests[1].options.headers["login-customer-id"], "100");
});

test("Google reporting fails before token or provider access without canonical authority", async () => {
  for (const [row, code] of [
    [null, "CONNECTED_GOOGLE_CONNECTION_REQUIRED"],
    [databaseRow({reporting_account_id: null}), "GOOGLE_REPORTING_ACCOUNT_REQUIRED"],
    [databaseRow({reporting_account_id: "999"}), "GOOGLE_REPORTING_ACCOUNT_AUTHORITY_INVALID"],
    [databaseRow({accounts: [{
      id: "200",
      kind: "manager",
      reporting_eligible: false,
      login_account_id: null,
    }]}), "GOOGLE_REPORTING_ACCOUNT_AUTHORITY_INVALID"],
    [databaseRow({accounts: [{
      id: "200",
      kind: "advertiser",
      reporting_eligible: true,
      currency: "ISK",
      timezone: null,
      login_account_id: "100",
    }]}), "GOOGLE_REPORTING_ACCOUNT_TIMEZONE_REQUIRED"],
  ]) {
    let vaultCalled = false;
    const runtime = createGoogleReportingAuthorityRuntime({
      database: database(row),
      tokenVault: {
        async loadProviderTokenSet() {
          vaultCalled = true;
          return {access_token: "must-not-load"};
        },
      },
      environment,
      fetchFn: async () => assert.fail("provider must not be called"),
    });
    await assert.rejects(
      runtime.readEvidencePage({
        installationAuthority,
        queryFamily: "account_identity",
        dateWindow: {start: "2026-10-01", end: "2026-10-01"},
      }),
      (error) => error.message === code,
    );
    assert.equal(vaultCalled, false);
  }
});

test("first Google provider error stops without automatic retry", async () => {
  const calls = [];
  const runtime = createGoogleReportingAuthorityRuntime({
    database: database(),
    tokenVault: {
      async loadProviderTokenSet() {
        return {access_token: "vault-only-token", refresh_token: "vault-refresh-token"};
      },
    },
    environment,
    fetchFn: async (url) => {
      calls.push(new URL(url).hostname);
      if (new URL(url).hostname === "oauth2.googleapis.com") {
        return json({
          access_token: "fresh-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      return json({
        error: {
          status: "RESOURCE_EXHAUSTED",
          details: [{errors: [{errorCode: {quotaError: "RESOURCE_EXHAUSTED"}}]}],
        },
      }, 429, {"request-id": "req-429"});
    },
  });
  await assert.rejects(
    runtime.readEvidencePage({
      installationAuthority,
      queryFamily: "shopping_product_daily",
      dateWindow: {start: "2026-10-01", end: "2026-10-01"},
    }),
    (error) => error.code === "GOOGLE_ADS_REST_REQUEST_FAILED",
  );
  assert.deepEqual(calls, ["oauth2.googleapis.com", "googleads.googleapis.com"]);
});

test("refresh failure stops before the first Google Ads query and is not retried", async () => {
  const calls = [];
  const runtime = createGoogleReportingAuthorityRuntime({
    database: database(),
    tokenVault: {
      async loadProviderTokenSet() {
        return {access_token: "stale-access-token", refresh_token: "vault-refresh-token"};
      },
    },
    environment,
    fetchFn: async (url) => {
      calls.push(new URL(url).hostname);
      return json({error: "invalid_grant"}, 400);
    },
  });

  await assert.rejects(
    runtime.prepareEvidenceExecution({installationAuthority}),
    (error) => error.code === "GOOGLE_ADS_OAUTH_TOKEN_EXCHANGE_FAILED",
  );
  await assert.rejects(
    runtime.prepareEvidenceExecution({installationAuthority}),
    (error) => error.code === "GOOGLE_ADS_OAUTH_TOKEN_EXCHANGE_FAILED",
  );
  assert.deepEqual(calls, ["oauth2.googleapis.com"]);
});
