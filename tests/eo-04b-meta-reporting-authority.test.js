import test from "node:test";
import assert from "node:assert/strict";
import {
  createMetaReportingAuthorityRuntime,
} from "../app/lib/providers/meta-reporting-authority.server.js";

const installationAuthority = Object.freeze({
  authority: "shopify_installation_verified",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  installGeneration: 2,
  status: "active",
});

const json = (payload, status = 200) => new Response(
  JSON.stringify(payload),
  {status, headers: {"content-type": "application/json"}},
);

function databaseRow(overrides = {}) {
  return {
    connection_id: "22222222-2222-4222-8222-222222222222",
    credential_id: "33333333-3333-4333-8333-333333333333",
    granted_scopes: ["ads_read"],
    connected_at: "2026-10-13T00:00:00.000Z",
    last_verified_at: "2026-10-13T00:00:00.000Z",
    accounts: [{
      id: "act_123456",
      name: "Advertiser",
      kind: "advertiser",
      reporting_eligible: true,
    }],
    reporting_account_id: "act_123456",
    ...overrides,
  };
}

function database(row = databaseRow()) {
  return {
    async query(sql, values) {
      assert.match(sql, /integrations[.]load_provider_account_authority/);
      assert.deepEqual(values, [installationAuthority.workspaceId, 2, "meta"]);
      return {rows: row ? [row] : []};
    },
  };
}

test("Meta reporting is bound to canonical Reporting Account and encrypted token authority", async () => {
  const requests = [];
  const vaultLoads = [];
  const runtime = createMetaReportingAuthorityRuntime({
    database: database(),
    tokenVault: {
      async loadProviderTokenSet(input) {
        vaultLoads.push(input);
        return {access_token: "vault-only-token"};
      },
    },
    fetchFn: async (url, options) => {
      requests.push({url: new URL(url), options});
      return requests.length === 1
        ? json({data: [{ad_id: "ad-1", spend: "4.00"}]})
        : json({data: [{ad_id: "ad-1", product_id: "provider-product-1"}]});
    },
  });

  const result = await runtime.readDailyEvidencePages({
    installationAuthority,
    dateWindow: {start: "2026-10-15", end: "2026-10-15"},
  });

  assert.equal(requests.length, 2);
  assert.ok(requests.every(({url}) => url.pathname === "/v26.0/act_123456/insights"));
  assert.equal(requests[0].url.searchParams.has("breakdowns"), false);
  assert.equal(requests[1].url.searchParams.get("breakdowns"), "product_id");
  assert.ok(requests.every(({options}) => (
    options.headers.authorization === "Bearer vault-only-token"
  )));
  assert.deepEqual(vaultLoads, [{
    credentialId: "33333333-3333-4333-8333-333333333333",
    installationAuthority,
    provider: "meta",
  }]);
  assert.deepEqual(result.authority, {
    connection_id: "22222222-2222-4222-8222-222222222222",
    reporting_account_id: "act_123456",
  });
  assert.equal(result.channel.fact_family, "ad_channel_daily_insights");
  assert.equal(result.product.fact_family, "ad_product_breakdown_daily_insights");
  assert.doesNotMatch(JSON.stringify(result), /vault-only-token|credential_id/);
});

test("Meta reporting fails before token or provider access without canonical authority", async () => {
  for (const [row, code] of [
    [null, "CONNECTED_META_CONNECTION_REQUIRED"],
    [databaseRow({reporting_account_id: null}), "META_REPORTING_ACCOUNT_REQUIRED"],
    [databaseRow({reporting_account_id: "act_999"}), "META_REPORTING_ACCOUNT_AUTHORITY_INVALID"],
  ]) {
    let vaultCalled = false;
    const runtime = createMetaReportingAuthorityRuntime({
      database: database(row),
      tokenVault: {
        async loadProviderTokenSet() {
          vaultCalled = true;
          return {access_token: "must-not-load"};
        },
      },
      fetchFn: async () => {
        throw new Error("must not call provider");
      },
    });
    await assert.rejects(
      runtime.readDailyEvidencePages({
        installationAuthority,
        dateWindow: {start: "2026-10-15", end: "2026-10-15"},
      }),
      (error) => error.message === code,
    );
    assert.equal(vaultCalled, false);
  }
});

test("Meta reporting publishes neither page when the product request fails", async () => {
  let calls = 0;
  const runtime = createMetaReportingAuthorityRuntime({
    database: database(),
    tokenVault: {
      async loadProviderTokenSet() {
        return {access_token: "vault-only-token"};
      },
    },
    fetchFn: async () => {
      calls += 1;
      return calls === 1
        ? json({data: [{ad_id: "ad-1"}]})
        : json({error: {code: 100}}, 400);
    },
  });
  await assert.rejects(
    runtime.readDailyEvidencePages({
      installationAuthority,
      dateWindow: {start: "2026-10-15", end: "2026-10-15"},
    }),
    (error) => error.code === "META_REPORTING_REQUEST_FAILED",
  );
  assert.equal(calls, 2);
});
