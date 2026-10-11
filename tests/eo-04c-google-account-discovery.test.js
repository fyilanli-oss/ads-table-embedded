import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverGoogleAdsAccounts,
  GOOGLE_ACCOUNT_DISCOVERY_QUERIES,
} from "../app/lib/providers/google-account-discovery.server.js";

function response(payload) {
  return {
    ok: true,
    status: 200,
    headers: {get: () => "request-id"},
    async json() { return payload; },
  };
}

function providerFailure(errorCode, requestId = "provider-request-id") {
  return {
    ok: false,
    status: 403,
    headers: {get: () => requestId},
    async json() {
      return {
        error: {
          status: "PERMISSION_DENIED",
          details: [{errors: [{errorCode}]}],
        },
      };
    },
  };
}

function customerClient({
  id,
  name,
  manager = false,
  status = "ENABLED",
  currency = "USD",
  timezone = "UTC",
  level = "0",
}) {
  return {
    customerClient: {
      clientCustomer: `customers/${id}`,
      id,
      descriptiveName: name,
      manager,
      status,
      currencyCode: currency,
      timeZone: timezone,
      level,
    },
  };
}

test("Google discovery preserves the proven accessible-root customer_client contract", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({url, headers: init.headers, body});
    if (url.endsWith("/customers:listAccessibleCustomers")) {
      return response({resourceNames: ["customers/111", "customers/222"]});
    }
    if (url.includes("/customers/111/")) {
      return response({results: [
        customerClient({id: "111", name: "Direct advertiser"}),
      ]});
    }
    if (url.includes("/customers/222/")) {
      return response({results: [
        customerClient({id: "222", name: "Root manager", manager: true}),
        customerClient({
          id: "333",
          name: "Retail advertiser",
          currency: "TRY",
          timezone: "Europe/Istanbul",
          level: "1",
        }),
      ]});
    }
    throw new Error("unexpected request " + url);
  };

  const evidence = await discoverGoogleAdsAccounts({
    accessToken: "access-token",
    developerToken: "developer-token",
    fetchFn,
    now: () => new Date("2026-10-11T18:00:00.000Z"),
  });

  assert.equal(evidence.verifiedAt, "2026-10-11T18:00:00.000Z");
  assert.deepEqual(evidence.scopes, ["https://www.googleapis.com/auth/adwords"]);
  const byId = new Map(evidence.accounts.map((account) => [account.id, account]));
  assert.equal(byId.get("111").reportingEligible, true);
  assert.equal(byId.get("111").loginAccountId, "111");
  assert.equal(byId.get("222").kind, "manager");
  assert.equal(byId.get("222").reportingEligible, false);
  assert.equal(byId.get("333").loginAccountId, "222");
  assert.equal(byId.get("333").reportingEligible, true);
  assert.equal(
    calls.filter((call) => call.url.includes("/googleAds:search")).length,
    2,
  );
  assert.ok(
    calls
      .filter((call) => call.url.includes("/googleAds:search"))
      .every((call) =>
        call.body.query === GOOGLE_ACCOUNT_DISCOVERY_QUERIES.customerClient
        && call.headers["login-customer-id"] === undefined
      ),
  );
});

test("Google discovery fails closed on empty accessible-account evidence", async () => {
  await assert.rejects(
    discoverGoogleAdsAccounts({
      accessToken: "access-token",
      developerToken: "developer-token",
      fetchFn: async () => response({resourceNames: []}),
    }),
    /GOOGLE_ACCESSIBLE_CUSTOMERS_EMPTY/,
  );
});

test("Google discovery skips an unavailable root when another root verifies", async () => {
  const fetchFn = async (url) => {
    if (url.endsWith("/customers:listAccessibleCustomers")) {
      return response({resourceNames: ["customers/111", "customers/222"]});
    }
    if (url.includes("/customers/111/")) {
      return providerFailure({customerError: "CUSTOMER_NOT_ENABLED"});
    }
    if (url.includes("/customers/222/")) {
      return response({results: [
        customerClient({id: "222", name: "Working advertiser"}),
      ]});
    }
    throw new Error("unexpected request " + url);
  };

  const evidence = await discoverGoogleAdsAccounts({
    accessToken: "access-token",
    developerToken: "developer-token",
    fetchFn,
  });
  assert.deepEqual(evidence.accounts.map((account) => account.id), ["222"]);
});

test("Google discovery preserves the provider failure when every root fails", async () => {
  await assert.rejects(
    discoverGoogleAdsAccounts({
      accessToken: "access-token",
      developerToken: "developer-token",
      fetchFn: async (url) => url.endsWith("/customers:listAccessibleCustomers")
        ? response({resourceNames: ["customers/111"]})
        : providerFailure({customerError: "CUSTOMER_NOT_ENABLED"}),
    }),
    (error) =>
      error.code === "GOOGLE_ADS_REST_REQUEST_FAILED"
      && error.details.provider_error_code === "CUSTOMER_NOT_ENABLED",
  );
});

test("Google discovery keeps provider status informational for advertisers", async () => {
  const evidence = await discoverGoogleAdsAccounts({
    accessToken: "access-token",
    developerToken: "developer-token",
    fetchFn: async (url) => url.endsWith("/customers:listAccessibleCustomers")
      ? response({resourceNames: ["customers/111"]})
      : response({results: [
          customerClient({
            id: "111",
            name: "Legacy advertiser",
            status: "CLOSED",
            currency: "TRY",
            timezone: "Europe/Istanbul",
          }),
        ]}),
  });

  assert.equal(evidence.accounts.length, 1);
  assert.equal(evidence.accounts[0].kind, "advertiser");
  assert.equal(evidence.accounts[0].status, "CLOSED");
  assert.equal(evidence.accounts[0].reportingEligible, true);
  assert.equal(evidence.accounts[0].loginAccountId, "111");
});
