import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoogleConnectionRuntime,
  GOOGLE_REVOKE_URL,
} from "../app/lib/oauth/google-connection-runtime.server.js";

const owner = Object.freeze({
  authority: "shopify_installation_verified",
  status: "active",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  installGeneration: 3,
});
const connection = Object.freeze({
  connectionId: "22222222-2222-4222-8222-222222222222",
  credentialId: "33333333-3333-4333-8333-333333333333",
  accounts: Object.freeze([
    Object.freeze({id: "100", name: "Shop account", kind: "advertiser"}),
  ]),
  reportingAccountId: "100",
});
const fixedNow = () => new Date("2026-10-11T19:00:00.000Z");

function dependencies(overrides = {}) {
  const calls = [];
  const accountAuthority = {
    async load(value) {
      calls.push(["account.load", value]);
      return connection;
    },
    async selectReportingAccount(value) {
      calls.push(["account.reporting", value]);
      return {changed: true, reportingAccountId: value.providerAccountId};
    },
  };
  const connectionLifecycle = {
    async load(value) {
      calls.push(["lifecycle.load", value]);
      return {
        connectionId: connection.connectionId,
        status: "connected",
        version: 4,
        credentialId: connection.credentialId,
      };
    },
    async requestDisconnect(value) {
      calls.push(["lifecycle.requestDisconnect", value]);
      return {
        connectionId: connection.connectionId,
        status: "disconnect_pending",
        version: value.expectedVersion + 1,
      };
    },
    async finalizeDisconnect(value) {
      calls.push(["lifecycle.finalizeDisconnect", value]);
      return {
        connectionId: connection.connectionId,
        status: "disconnected",
        version: value.expectedVersion + 1,
      };
    },
  };
  const tokenVault = {
    async loadProviderTokenSet(value) {
      calls.push(["token.load", value]);
      return {refresh_token: "refresh-token"};
    },
  };
  return {
    calls,
    accountAuthority,
    connectionLifecycle,
    tokenVault,
    async refreshAccessToken(value) {
      calls.push(["refresh", value]);
      return {access_token: "access-token"};
    },
    async discoverAccounts(value) {
      calls.push(["discover", value]);
      return {
        verifiedAt: "2026-10-11T19:00:00.000Z",
        accounts: [{
          id: "100",
          name: "Shop account",
          kind: "advertiser",
          reportingEligible: true,
        }],
      };
    },
    async fetchFn(url, init) {
      calls.push(["fetch", {url, init}]);
      return {
        ok: true,
        status: 200,
        async text() { return ""; },
      };
    },
    ...overrides,
  };
}

test("connected Settings truth requires a successful server-side token refresh", async () => {
  const deps = dependencies();
  const runtime = createGoogleConnectionRuntime({...deps, now: fixedNow});
  const result = await runtime.inspect({installationAuthority: owner});
  assert.equal(result.status, "connected");
  assert.ok(deps.calls.some(([name]) => name === "refresh"));
});

test("revoked Google grant is finalized locally and never rendered connected", async () => {
  const error = Object.assign(new Error("rejected"), {
    code: "GOOGLE_ADS_OAUTH_TOKEN_EXCHANGE_FAILED",
    details: {status: 400, provider_status: "invalid_grant"},
  });
  const deps = dependencies({
    async refreshAccessToken() { throw error; },
  });
  const runtime = createGoogleConnectionRuntime({...deps, now: fixedNow});
  const result = await runtime.inspect({installationAuthority: owner});
  assert.equal(result.status, "reauthorization_required");
  assert.ok(deps.calls.some(([name]) => name === "lifecycle.requestDisconnect"));
  const finalized = deps.calls.find(
    ([name]) => name === "lifecycle.finalizeDisconnect",
  )[1];
  assert.equal(finalized.providerEvidence.outcome, "already_invalid");
});

test("reporting-account change is limited by fresh Google advertiser evidence", async () => {
  const deps = dependencies();
  const runtime = createGoogleConnectionRuntime({...deps, now: fixedNow});
  const result = await runtime.changeReportingAccount({
    installationAuthority: owner,
    providerAccountId: "100",
  });
  assert.equal(result.changed, true);
  assert.ok(deps.calls.some(([name]) => name === "discover"));
  assert.ok(deps.calls.some(([name]) => name === "account.reporting"));
});

test("disconnect revokes Google then closes local authority and preserves history", async () => {
  const deps = dependencies();
  const runtime = createGoogleConnectionRuntime({...deps, now: fixedNow});
  const result = await runtime.disconnect({installationAuthority: owner});
  assert.deepEqual(result, {
    status: "not_connected",
    providerGrantRevoked: true,
    localCredentialsRemoved: true,
    historicalDataPreserved: true,
  });
  const fetchCall = deps.calls.find(([name]) => name === "fetch")[1];
  assert.equal(fetchCall.url, GOOGLE_REVOKE_URL);
  assert.match(fetchCall.init.body, /token=refresh-token/);
  assert.ok(deps.calls.some(([name]) => name === "lifecycle.finalizeDisconnect"));
});

test("invalid_token revoke response is accepted as already disconnected", async () => {
  const deps = dependencies({
    async fetchFn() {
      return {
        ok: false,
        status: 400,
        async text() { return "{\"error\":\"invalid_token\"}"; },
      };
    },
  });
  const runtime = createGoogleConnectionRuntime({...deps, now: fixedNow});
  const result = await runtime.disconnect({installationAuthority: owner});
  assert.equal(result.providerGrantRevoked, false);
  const finalized = deps.calls.find(
    ([name]) => name === "lifecycle.finalizeDisconnect",
  )[1];
  assert.equal(finalized.providerEvidence.outcome, "already_invalid");
});
