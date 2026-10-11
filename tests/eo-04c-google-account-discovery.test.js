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

function customerNotEnabledResponse() {
  return {
    ok: false,
    status: 403,
    headers: {get: () => "customer-not-enabled-request-id"},
    async json() {
      return {
        error: {
          status: "PERMISSION_DENIED",
          details: [{
            errors: [{
              errorCode: {customerError: "CUSTOMER_NOT_ENABLED"},
            }],
          }],
        },
      };
    },
  };
}

test("Google discovery keeps managers as access paths and advertisers as reporting choices", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({url, headers: init.headers, body});
    if (url.endsWith("/customers:listAccessibleCustomers")) {
      return response({resourceNames: ["customers/111", "customers/222"]});
    }
    if (url.includes("/customers/111/")) {
      return response({results: [{customer: {
        id: "111", descriptiveName: "Direct advertiser", manager: false,
        status: "ENABLED", currencyCode: "USD", timeZone: "UTC",
      }}]});
    }
    if (url.includes("/customers/222/") && body.query === GOOGLE_ACCOUNT_DISCOVERY_QUERIES.customer) {
      return response({results: [{customer: {
        id: "222", descriptiveName: "Root manager", manager: true,
        status: "ENABLED", currencyCode: "USD", timeZone: "UTC",
      }}]});
    }
    if (url.includes("/customers/222/")) {
      return response({results: [
        {customerClient: {
          clientCustomer: "customers/222", id: "222",
          descriptiveName: "Root manager", manager: true, status: "ENABLED",
          currencyCode: "USD", timeZone: "UTC", level: "0",
        }},
        {customerClient: {
          clientCustomer: "customers/333", id: "333",
          descriptiveName: "Child manager", manager: true, status: "ENABLED",
          currencyCode: "USD", timeZone: "UTC", level: "1",
        }},
        {customerClient: {
          clientCustomer: "customers/444", id: "444",
          descriptiveName: "Retail advertiser", manager: false, status: "ENABLED",
          currencyCode: "TRY", timeZone: "Europe/Istanbul", level: "1",
        }},
      ]});
    }
    if (url.includes("/customers/333/")) {
      return response({results: [
        {customerClient: {
          clientCustomer: "customers/333", id: "333",
          descriptiveName: "Child manager", manager: true, status: "ENABLED",
          currencyCode: "USD", timeZone: "UTC", level: "0",
        }},
        {customerClient: {
          clientCustomer: "customers/555", id: "555",
          descriptiveName: "Nested advertiser", manager: false, status: "SUSPENDED",
          currencyCode: "EUR", timeZone: "Europe/Berlin", level: "1",
        }},
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
  assert.equal(byId.get("111").loginAccountId, null);
  assert.equal(byId.get("222").kind, "manager");
  assert.equal(byId.get("222").reportingEligible, false);
  assert.equal(byId.get("444").loginAccountId, "222");
  assert.equal(byId.get("444").reportingEligible, true);
  assert.equal(byId.get("555").reportingEligible, false);
  assert.equal(
    calls.find((call) => call.url.includes("/customers/444/")),
    undefined,
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith("/customers:listAccessibleCustomers"))[0]
      .headers["login-customer-id"],
    undefined,
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

test("Google discovery skips a disabled direct root and preserves enabled advertisers", async () => {
  const fetchFn = async (url) => {
    if (url.endsWith("/customers:listAccessibleCustomers")) {
      return response({resourceNames: ["customers/111", "customers/222"]});
    }
    if (url.includes("/customers/111/")) return customerNotEnabledResponse();
    if (url.includes("/customers/222/")) {
      return response({results: [{customer: {
        id: "222", descriptiveName: "Enabled advertiser", manager: false,
        status: "ENABLED", currencyCode: "USD", timeZone: "UTC",
      }}]});
    }
    throw new Error("unexpected request " + url);
  };

  const evidence = await discoverGoogleAdsAccounts({
    accessToken: "access-token",
    developerToken: "developer-token",
    fetchFn,
  });

  assert.deepEqual(evidence.accounts.map((account) => account.id), ["222"]);
  assert.equal(evidence.accounts[0].reportingEligible, true);
});

test("Google discovery reports when every accessible root is disabled", async () => {
  await assert.rejects(
    discoverGoogleAdsAccounts({
      accessToken: "access-token",
      developerToken: "developer-token",
      fetchFn: async (url) => url.endsWith("/customers:listAccessibleCustomers")
        ? response({resourceNames: ["customers/111"]})
        : customerNotEnabledResponse(),
    }),
    /GOOGLE_ADS_ENABLED_CUSTOMERS_EMPTY/,
  );
});
