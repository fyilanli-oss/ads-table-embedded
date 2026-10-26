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

function saleRow(productId) {
  return {account_id: "123456", campaign_id: "campaign-1", adset_id: "adset-1", ad_id: "ad-1",
    date_start: "2026-10-15", date_stop: "2026-10-15", product_id: productId,
    converted_product_quantity: [{action_type: "purchase", value: "2"}],
    converted_product_value: [{action_type: "purchase", value: "200"}],
    converted_promoted_product_quantity: [{action_type: "purchase", value: "1"}],
    converted_promoted_product_value: [{action_type: "purchase", value: "100"}]};
}

function evidenceBatch(rows, input) {
  return {scope: {workspace_id: input.installationAuthority.workspaceId,
    install_generation: input.installationAuthority.installGeneration,
    connection_id: input.connectionId, reporting_account_id: input.reportingAccountId},
  rows: rows.map(row => ({state: "verified", relation_scope: "single_product_sale_relation",
    row_identity: {account_id: row.account_id, ad_id: row.ad_id, product_id: row.product_id, business_date: row.date_start},
    advertised_product_id: "A", sold_product_id: row.product_id, sales_quantity: "1", catalog_id: "123",
    identity_namespace: "retailer_id", source_reference: "synthetic:verified-source"}))};
}

test("Meta complete snapshot classifies verified relationships after all pages and retains one source projection", async () => {
  let requests = 0, loaderCalls = 0;
  const runtime = createMetaReportingAuthorityRuntime({database: database(), appSecret: "test-secret",
    tokenVault: {async loadProviderTokenSet() {return {access_token: "vault-only-token"};}},
    fetchFn: async request => {
      requests++;
      const parsed = new URL(request);
      if (!parsed.searchParams.has("breakdowns")) return json({data: [{...saleRow("A"), product_id: undefined}]});
      for (const field of ["converted_product_quantity", "converted_product_value",
        "converted_promoted_product_quantity", "converted_promoted_product_value"]) {
        assert.ok(parsed.searchParams.get("fields").split(",").includes(field));
      }
      return parsed.searchParams.has("after") ? json({data: [saleRow("B")]})
        : json({data: [saleRow("A")], paging: {next: "next", cursors: {after: "page-2"}}});
    }, loadProductSalesEvidence: async input => {
      loaderCalls++;
      assert.equal(requests, 3);
      assert.equal(input.productRows.length, 2);
      const batch = evidenceBatch(input.productRows, input);
      input.productRows[0].converted_product_quantity[0].value = "999";
      return batch;
    }});
  const result = await runtime.readDailyEvidenceSnapshot({installationAuthority,
    dateWindow: {start: "2026-10-15", end: "2026-10-15"}});
  assert.equal(loaderCalls, 1);
  assert.deepEqual(result.product_sales.rows.map(row => row.sales_role), ["Advertised", "Cross-sell"]);
  assert.deepEqual(result.product_sales.rows.map(row => row.source_row_index), [0, 1]);
  assert.deepEqual(result.product.rows, [saleRow("A"), saleRow("B")]);
  assert.equal(result.product_sales.additional_sales_facts_created, false);
  assert.equal(result.product_sales.dataset_publishable, false);
});

test("Meta default snapshot keeps all four fields but cannot label a sale from promoted values alone", async () => {
  const runtime = createMetaReportingAuthorityRuntime({database: database(), appSecret: "test-secret",
    tokenVault: {async loadProviderTokenSet() {return {access_token: "vault-only-token"};}},
    fetchFn: async request => json({data: new URL(request).searchParams.has("breakdowns") ? [saleRow("A")] : []})});
  const result = await runtime.readDailyEvidenceSnapshot({installationAuthority,
    dateWindow: {start: "2026-10-15", end: "2026-10-15"}});
  assert.equal(result.product_sales.rows[0].sales_role, "Unclassified");
  assert.equal(result.product_sales.rows[0].raw_row, result.product.rows[0]);
  assert.equal(result.product_sales.rows[0].raw_metrics.converted_promoted_product_quantity[0].value, "1");
});

test("Meta role evidence rejects scope drift, mismatched cardinality and loader failure without retry", async () => {
  for (const scenario of ["workspace", "generation", "connection", "account", "length", "failure", "outside_window"]) {
    let loaderCalls = 0;
    const runtime = createMetaReportingAuthorityRuntime({database: database(), appSecret: "test-secret",
      tokenVault: {async loadProviderTokenSet() {return {access_token: "vault-only-token"};}},
      fetchFn: async request => json({data: new URL(request).searchParams.has("breakdowns")
        ? [{...saleRow("A"), ...(scenario === "outside_window" ? {date_start: "2026-10-14", date_stop: "2026-10-14"} : {})}] : []}),
      loadProductSalesEvidence: async input => {
        loaderCalls++;
        if (scenario === "failure") throw new Error("private-token");
        const batch = evidenceBatch(input.productRows, input);
        if (scenario === "workspace") batch.scope.workspace_id = "wrong";
        if (scenario === "generation") batch.scope.install_generation = 1;
        if (scenario === "connection") batch.scope.connection_id = "wrong";
        if (scenario === "account") batch.scope.reporting_account_id = "act_999";
        if (scenario === "length") batch.rows = [];
        return batch;
      }});
    await assert.rejects(runtime.readDailyEvidenceSnapshot({installationAuthority,
      dateWindow: {start: "2026-10-15", end: "2026-10-15"}}), error => error.code.startsWith("META_") && !error.message.includes("private-token"));
    assert.equal(loaderCalls, 1);
  }
});

test("snapshot applies promoted probe only to product pages and stops on the first rejection", async () => {
  for (const fail of [false, true]) {
    const requests = [];
    const runtime = createMetaReportingAuthorityRuntime({
      database: database(), appSecret: "test-secret",
      tokenVault: {async loadProviderTokenSet() {return {access_token: "vault-only-token"};}},
      fetchFn: async (url) => {
        const parsed = new URL(url);
        requests.push(parsed);
        if (!parsed.searchParams.has("breakdowns")) return json({data: []});
        if (fail) return json({error: {code: 100}}, 400);
        return parsed.searchParams.has("after") ? json({data: []}) : json({
          data: [{product_id: "provider-1"}],
          paging: {cursors: {after: "page-2"}, next: "next"},
        });
      },
    });
    const operation = runtime.readDailyEvidenceSnapshot({installationAuthority,
      dateWindow: {start: "2026-10-15", end: "2026-10-15"}, includePromotedProductMetrics: true});
    if (fail) await assert.rejects(operation, error => error.code === "META_REPORTING_REQUEST_FAILED");
    else assert.equal((await operation).product.evidence.page_count, 2);
    assert.equal(requests.length, fail ? 2 : 3);
    assert.equal(requests[0].searchParams.get("fields").includes("converted_promoted_product"), false);
    for (const url of requests.slice(1)) {
      assert.equal(url.searchParams.get("breakdowns"), "product_id");
      assert.ok(url.searchParams.get("fields").includes("converted_promoted_product_quantity"));
      assert.ok(url.searchParams.get("fields").includes("converted_promoted_product_value"));
    }
  }
});

test("Meta reporting is bound to canonical Reporting Account and encrypted token authority", async () => {
  const requests = [];
  const vaultLoads = [];
  const runtime = createMetaReportingAuthorityRuntime({
    database: database(),
    appSecret: "test-secret",
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
      appSecret: "test-secret",
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
    appSecret: "test-secret",
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

test("Meta App Role acceptance snapshot follows every bounded opaque page", async () => {
  const cursors = [];
  const responses = [
    json({data: [{ad_id: "ad-1"}], paging: {cursors: {after: "channel-2"}, next: "next"}}),
    json({data: [{ad_id: "ad-2"}]}),
    json({data: [{ad_id: "ad-1", product_id: "product-1"}], paging: {cursors: {after: "product-2"}, next: "next"}}),
    json({data: [{ad_id: "ad-2", product_id: "product-2"}]}),
  ];
  const runtime = createMetaReportingAuthorityRuntime({
    database: database(),
    appSecret: "test-secret",
    tokenVault: {
      async loadProviderTokenSet() {
        return {access_token: "vault-only-token"};
      },
    },
    fetchFn: async (url) => {
      cursors.push(new URL(url).searchParams.get("after"));
      return responses.shift();
    },
  });

  const result = await runtime.readDailyEvidenceSnapshot({
    installationAuthority,
    dateWindow: {start: "2026-10-15", end: "2026-10-15"},
  });

  assert.deepEqual(cursors, [null, "channel-2", null, "product-2"]);
  assert.deepEqual(result.channel.rows.map((row) => row.ad_id), ["ad-1", "ad-2"]);
  assert.deepEqual(result.channel.pd_metric_rows.map(row => row.source_row_index), [0, 1]);
  assert.equal(result.channel.pd_metric_rows.length, result.channel.rows.length);
  assert.deepEqual(result.product.rows.map((row) => row.product_id), ["product-1", "product-2"]);
  assert.equal(result.channel.evidence.page_count, 2);
  assert.equal(result.product.evidence.page_count, 2);
});

test("default product rejection never retries with the old field list", async () => {
  const requests = [];
  const runtime = createMetaReportingAuthorityRuntime({
    database: database(), appSecret: "test-secret",
    tokenVault: {async loadProviderTokenSet() {return {access_token: "fixture-token"};}},
    fetchFn: async url => {
      requests.push(new URL(url));
      return requests.length === 1 ? json({data: [{ad_id: "ad-1"}]}) : json({error: {code: 100}}, 400);
    },
  });
  await assert.rejects(runtime.readDailyEvidenceSnapshot({installationAuthority,
    dateWindow: {start: "2026-10-15", end: "2026-10-15"}}), error => error.code === "META_REPORTING_REQUEST_FAILED");
  assert.equal(requests.length, 2);
  assert.ok(requests[1].searchParams.get("fields").includes("converted_promoted_product_quantity"));
  assert.ok(requests[1].searchParams.get("fields").includes("converted_promoted_product_value"));
});

test("04 snapshot links only after both families finish, using global indexes and authenticated scope", async () => {
  const native = {account_id: "123456", campaign_id: "campaign-1", adset_id: "set-1",
    date_start: "2026-10-15", date_stop: "2026-10-15"};
  const ad1 = {...native, ad_id: "ad-1", spend: "300"};
  const ad2 = {...native, ad_id: "ad-2", spend: "400"};
  const product1 = {...native, ad_id: "ad-2", product_id: "product-1", spend: "18"};
  const product2 = {...native, ad_id: "ad-1", product_id: "product-2", spend: "9"};
  const responses = [
    json({data: [ad1], paging: {cursors: {after: "ad-next"}, next: "next"}}),
    json({data: [ad2]}),
    json({data: [product1], paging: {cursors: {after: "product-next"}, next: "next"}}),
    json({data: [product2]}),
  ];
  let calls = 0;
  const runtime = createMetaReportingAuthorityRuntime({database: database(), appSecret: "test-secret",
    tokenVault: {async loadProviderTokenSet() {return {access_token: "fixture-token"};}},
    fetchFn: async () => {calls++; return responses.shift();},
  });
  const snapshot = await runtime.readDailyEvidenceSnapshot({installationAuthority,
    dateWindow: {start: "2026-10-15", end: "2026-10-15"},
    scope: {workspace_id: "forged", reporting_account_id: "act_999"},
  });
  assert.equal(calls, 4);
  assert.deepEqual(snapshot.source_links.scope, {workspace_id: installationAuthority.workspaceId,
    install_generation: 2, connection_id: databaseRow().connection_id, reporting_account_id: "act_123456"});
  assert.deepEqual(snapshot.source_links.product_links.map(link => [link.product_row_index, link.pd_row_index]), [[0, 1], [1, 0]]);
  assert.ok(snapshot.source_links.product_links.every(link => link.state === "exact_native_ad_reference"));
  assert.deepEqual(snapshot.product.rows, [product1, product2]);
  assert.deepEqual(snapshot.channel.rows, [ad1, ad2]);
  assert.equal(snapshot.source_links.publishable, false);
  assert.doesNotMatch(JSON.stringify(snapshot.source_links), /fixture-token|forged|spend/);
});

test("invalid PD mapping stops before product fetch and returns no partial snapshot", async () => {
  let calls = 0;
  const runtime = createMetaReportingAuthorityRuntime({
    database: database(), appSecret: "test-secret",
    tokenVault: {async loadProviderTokenSet() {return {access_token: "fixture-token"};}},
    fetchFn: async () => {calls++; return json({data: [{ad_id: "ad-1", spend: "broken"}]});},
  });
  await assert.rejects(runtime.readDailyEvidenceSnapshot({installationAuthority,
    dateWindow: {start: "2026-10-15", end: "2026-10-15"}}), error => error.code === "META_REPORTING_SCHEMA_CHANGED");
  assert.equal(calls, 1);
});

test("first Meta authorization rejection persists reauthorization_required without retry", async () => {
  const queries = [];
  let providerCalls = 0;
  const runtime = createMetaReportingAuthorityRuntime({
    database: {
      async query(sql, values) {
        queries.push({sql, values});
        if (/load_provider_account_authority/.test(sql)) return {rows: [databaseRow()]};
        if (/load_provider_connection_lifecycle/.test(sql)) {
          return {rows: [{
            connection_id: databaseRow().connection_id,
            lifecycle_status: "connected",
            connection_version: 4,
            credential_id: databaseRow().credential_id,
            lifecycle_changed_at: "2026-10-17T00:00:00.000Z",
            disconnected_at: null,
            disconnect_reason: null,
          }]};
        }
        if (/transition_provider_connection_lifecycle/.test(sql)) {
          return {rows: [{
            connection_id: databaseRow().connection_id,
            lifecycle_status: "reauthorization_required",
            connection_version: 5,
            credential_id: databaseRow().credential_id,
            lifecycle_changed_at: "2026-10-17T00:00:01.000Z",
            disconnected_at: null,
            disconnect_reason: null,
          }]};
        }
        throw new Error("unexpected query");
      },
    },
    appSecret: "test-secret",
    tokenVault: {
      async loadProviderTokenSet() {
        return {access_token: "expired-token"};
      },
    },
    fetchFn: async () => {
      providerCalls += 1;
      return json({error: {code: 190}}, 401);
    },
  });

  await assert.rejects(
    runtime.readDailyEvidenceSnapshot({
      installationAuthority,
      dateWindow: {start: "2026-10-15", end: "2026-10-15"},
    }),
    (error) => error.code === "META_REAUTHORIZATION_REQUIRED",
  );
  assert.equal(providerCalls, 1);
  assert.equal(queries.filter(({sql}) => /transition_provider_connection_lifecycle/.test(sql)).length, 1);
});

test("Meta permission and BUC failures preserve connection lifecycle and stop partial publication", async () => {
  for (const method of ["readDailyEvidencePages", "readDailyEvidenceSnapshot"]) {
    for (const code of [10, 200, 80000, 80004, null]) {
      for (const failOn of [1, 2]) {
        let calls = 0;
        let queries = 0;
        const runtime = createMetaReportingAuthorityRuntime({
          database: {async query(sql) {
            queries++;
            // Any lifecycle read/transition would fail this test immediately.
            assert.match(sql, /integrations[.]load_provider_account_authority/);
            return {rows: [databaseRow()]};
          }},
          appSecret: "test-secret",
          tokenVault: {async loadProviderTokenSet() {return {access_token: "valid-token"};}},
          fetchFn: async () => {
            calls++;
            return calls === failOn
              ? json({error: code === null ? {} : {code}}, 403)
              : json({data: [{ad_id: "ad-1"}]});
          },
        });
        await assert.rejects(runtime[method]({
          installationAuthority, dateWindow: {start: "2026-10-15", end: "2026-10-15"},
        }), error => error.code === (code === 80000 || code === 80004
          ? "META_REPORTING_REQUEST_FAILED" : "META_PERMISSION_DENIED"));
        assert.equal(calls, failOn);
        assert.equal(queries, 1);
      }
    }
  }
});

test("Meta App Role acceptance snapshot fails closed on an opaque cursor loop", async () => {
  let providerCalls = 0;
  const runtime = createMetaReportingAuthorityRuntime({
    database: database(),
    appSecret: "test-secret",
    tokenVault: {
      async loadProviderTokenSet() {
        return {access_token: "vault-only-token"};
      },
    },
    fetchFn: async () => {
      providerCalls += 1;
      return json({
        data: [{ad_id: `ad-${providerCalls}`}],
        paging: {cursors: {after: "same-cursor"}, next: "next"},
      });
    },
  });

  await assert.rejects(
    runtime.readDailyEvidenceSnapshot({
      installationAuthority,
      dateWindow: {start: "2026-10-15", end: "2026-10-15"},
    }),
    (error) => error.code === "META_REPORTING_CURSOR_LOOP",
  );
  assert.equal(providerCalls, 2);
});
