import assert from "node:assert/strict";
import test from "node:test";
import {createKlaviyoReportingAuthorityRuntime} from "../app/lib/providers/klaviyo-reporting-authority.server.js";

const installationAuthority = Object.freeze({
  authority: "shopify_installation_verified",
  workspaceId: "00000000-0000-4000-8000-000000000101",
  installGeneration: 3,
  status: "active",
});

const connection = Object.freeze({
  connectionId: "00000000-0000-4000-8000-000000000102",
  credentialId: "00000000-0000-4000-8000-000000000103",
  grantedScopes: Object.freeze([
    "accounts:read",
    "campaigns:read",
    "events:read",
    "flows:read",
    "metrics:read",
  ]),
  accounts: Object.freeze([Object.freeze({
    id: "klaviyo-account-1",
    kind: "account",
    status: "active",
    currency: "USD",
    timezone: "Europe/Istanbul",
  })]),
  reportingAccountId: null,
});

function response(status, payload, requestId = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {get: (name) => name.toLowerCase() === "x-request-id" ? requestId : null},
    json: async () => payload,
  };
}

function metric(id, name) {
  return {type: "metric", id, attributes: {name, integration: {name: "Shopify"}}};
}

function reportRow(kind, id) {
  return {
    groupings: {
      [`${kind}_id`]: `${kind}-1`,
      ...(kind === "flow" ? {flow_name: "Sepeti Terk Etme"} : {}),
      [`${kind}_message_id`]: `${kind}-message-${id}`,
      [`${kind}_message_name`]: `${kind === "flow" ? "İlk Hatırlatma" : "Sonbahar Takıları"} ${id}`,
      send_channel: "email",
      variation: `variation-${id}`,
      variation_name: `Küpe Görseli ${id}`,
    },
    statistics: {recipients: 20, conversions: 1, conversion_value: 450},
  };
}

function event(id, attributionId = null) {
  return {
    type: "event",
    id,
    attributes: {
      uuid: `uuid-${id}`,
      datetime: "2026-10-17T12:00:00+03:00",
      event_properties: {ProductID: "necklace", ProductName: "Kolye", Quantity: 1, "$value": 450},
    },
    relationships: {
      attributions: {
        data: attributionId == null ? [] : [{type: "attribution", id: attributionId}],
      },
    },
  };
}

function runtime({fetchFn, connected = connection, lifecycle = null, now = () => new Date()} = {}) {
  return createKlaviyoReportingAuthorityRuntime({
    fetchFn,
    accountAuthority: {load: async () => connected},
    credentialAuthority: {
      prepareCredential: async (input) => {
        assert.equal(input.credentialId, connected.credentialId);
        assert.equal(input.connected, connected);
        return {tokenSet: {access_token: "access-token"}};
      },
    },
    lifecycle: lifecycle ?? {
      load: async () => ({status: "connected", version: 2}),
      markReauthorizationRequired: async () => undefined,
    },
    config: {},
    now,
  });
}

test("PD authority discovers exact metrics, retains whole rows and exhausts per-metric pagination", async () => {
  const calls = [];
  const api = runtime({fetchFn: async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/metrics") {
      calls.push("metrics");
      return response(200, {data: [metric("p", "Placed Order"), metric("a", "Added to Cart"), metric("c", "Checkout Started")]});
    }
    const attrs = JSON.parse(options.body).data.attributes;
    const kind = parsed.pathname.includes("campaign") ? "campaign" : "flow";
    calls.push(`${kind}:${attrs.conversion_metric_id}:${parsed.searchParams.get("page_cursor") ?? "first"}`);
    const hasNext = kind === "campaign" && attrs.conversion_metric_id === "a" && !parsed.searchParams.has("page_cursor");
    return response(200, {data: {attributes: {results: [reportRow(kind, "1")]}},
      ...(hasNext ? {links: {next: "https://a.klaviyo.com/api/campaign-values-reports?page_cursor=second"}} : {})});
  }});
  const result = await api.readPdEvidenceSnapshot({installationAuthority, businessDate: "2026-10-17"});
  assert.equal(result.status, "completed");
  assert.equal(result.complete, true);
  assert.equal(result.publishable, false);
  assert.equal(calls.length, 8);
  assert.equal(result.results.reports.length, 6);
  const cart = result.results.reports.find(r => r.source === "campaign" && r.conversion_metric_name === "Added to Cart");
  assert.equal(cart.page_count, 2);
  assert.deepEqual(cart.rows, [reportRow("campaign", "1"), reportRow("campaign", "1")]);
  assert.deepEqual(cart.pd_metric_rows.map(r => r.source_row_index), [0, 1]);
  assert.equal(cart.pd_metric_rows[0].raw_metrics.add_to_cart, 1);
  assert.equal(cart.pd_metric_rows[0].raw_metrics.purchase, null);
  assert.deepEqual(cart.evidence.request_body.data.attributes.statistics, ["conversions", "conversion_value"]);
  assert.doesNotMatch(JSON.stringify(result), /access-token|refresh_token/);
});

test("PD missing metric never sends a guessed conversion ID or silently reports zero", async () => {
  let calls = 0;
  const api = runtime({fetchFn: async url => {
    calls++;
    if (new URL(url).pathname === "/api/metrics") return response(200, {data: [metric("p", "Placed Order")]});
    return response(200, {data: {attributes: {results: []}}});
  }});
  const result = await api.readPdEvidenceSnapshot({installationAuthority, businessDate: "2026-10-17"});
  assert.equal(calls, 3);
  assert.equal(result.status, "configuration_missing");
  assert.equal(result.publishable, false);
  assert.equal(result.results.reports.filter(r => r.observation === "account_configuration_missing").length, 4);
  assert.equal(result.results.reports[0].observation, "not_observed_in_this_execution");
});

test("PD provider error stops remaining metric reports with no staged results or retry", async () => {
  let calls = 0;
  const api = runtime({fetchFn: async () => {
    calls++;
    if (calls === 1) return response(200, {data: [metric("p", "Placed Order"), metric("a", "Added to Cart"), metric("c", "Checkout Started")]});
    if (calls === 3) return response(403, {errors: [{code: "permission_denied"}]});
    return response(200, {data: {attributes: {results: []}}});
  }});
  const result = await api.readPdEvidenceSnapshot({installationAuthority, businessDate: "2026-10-17"});
  assert.equal(calls, 3);
  assert.equal(result.status, "failed");
  assert.equal(result.results, null);
  assert.equal(result.error.code, "KLAVIYO_PERMISSION_DENIED");
});

test("Klaviyo authority binds one account, uses its timezone, exhausts opaque cursors and publishes only a complete snapshot", async () => {
  const calls = [];
  const api = runtime({
    fetchFn: async (url, options) => {
      const parsed = new URL(url);
      calls.push({path: parsed.pathname, cursor: parsed.searchParams.get("page[cursor]") ?? parsed.searchParams.get("page_cursor"), options});
      if (parsed.pathname === "/api/metrics" && !parsed.searchParams.has("page[cursor]")) {
        return response(200, {
          data: [metric("placed", "Placed Order")],
          links: {self: url, next: "https://a.klaviyo.com/api/metrics?page%5Bcursor%5D=metrics-2"},
        }, "metrics-1");
      }
      if (parsed.pathname === "/api/metrics") {
        return response(200, {
          data: [metric("ordered-product", "Ordered Product")],
          links: {self: url},
        }, "metrics-2");
      }
      if (parsed.pathname === "/api/campaign-values-reports" && !parsed.searchParams.has("page_cursor")) {
        assert.equal(options.headers.accept, "application/vnd.api+json");
        assert.equal(options.headers["content-type"], "application/vnd.api+json");
        return response(200, {
          data: {type: "campaign-values-report", attributes: {results: [reportRow("campaign", "1")]}},
          links: {self: url, next: "https://a.klaviyo.com/api/campaign-values-reports?page_cursor=campaign-2"},
        }, "campaign-1");
      }
      if (parsed.pathname === "/api/campaign-values-reports") {
        return response(200, {
          data: {type: "campaign-values-report", attributes: {results: [reportRow("campaign", "2")]}},
          links: {self: url},
        }, "campaign-2");
      }
      if (parsed.pathname === "/api/flow-values-reports") {
        return response(200, {
          data: {type: "flow-values-report", attributes: {results: []}},
          links: {self: url},
        }, "flow-1");
      }
      if (parsed.pathname === "/api/events" && !parsed.searchParams.has("page[cursor]")) {
        return response(200, {
          data: [event("event-1", "attribution-1")],
          included: [{
            type: "attribution",
            id: "attribution-1",
            relationships: {
              flow: {data: {type: "flow", id: "flow-1"}},
              "flow-message": {data: {type: "flow-message", id: "flow-message-1"}},
              "flow-message-variation": {data: {type: "flow-message", id: "flow-variation-1"}},
            },
          }],
          links: {self: url, next: "https://a.klaviyo.com/api/events?page%5Bcursor%5D=events-2"},
        }, "events-1");
      }
      if (parsed.pathname === "/api/events") {
        return response(200, {data: [event("event-2")], links: {self: url}}, "events-2");
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  const result = await api.readDailyEvidenceSnapshot({
    installationAuthority,
    businessDate: "2026-10-17",
  });

  assert.equal(result.status, "completed");
  assert.equal(result.publishable, true);
  assert.equal(result.authority.connected_account_id, "klaviyo-account-1");
  assert.equal(result.authority.connected_account_timezone, "Europe/Istanbul");
  assert.equal(result.timeframe.start, "2026-10-17T00:00:00+03:00");
  assert.equal(result.results.metrics.page_count, 2);
  assert.equal(result.results.campaign_values.page_count, 2);
  assert.equal(result.results.campaign_values.rows.length, 2);
  assert.equal(result.results.flow_values.observation, "not_observed_in_this_execution");
  assert.equal(result.results.ordered_product_events.page_count, 2);
  assert.equal(result.results.ordered_product_events.rows.length, 2);
  assert.equal(result.results.resolved_product_sales.rows.length, 2);
  assert.equal(
    result.results.resolved_product_sales.rows[0].attribution_resolution.channel_id,
    "flow-message-1",
  );
  assert.equal(result.results.resolved_product_sales.rows[0].attribution_resolution.channel_name, null);
  assert.equal(
    result.results.resolved_product_sales.rows[0].attribution_resolution.sales_role,
    "Triggered",
  );
  assert.equal(
    result.results.resolved_product_sales.rows[1].attribution_resolution.channel_type,
    "Unclassified Channel",
  );
  assert.equal(result.results.resolved_product_sales.rows[1].attribution_resolution.sales_role, "Unclassified");
  assert.deepEqual(result.completed_families, [
    "metrics",
    "campaign_values",
    "flow_values",
    "ordered_product_events",
    "resolved_product_sales",
  ]);
  assert.equal(
    result.results.ordered_product_events.rows[0].provider_attributions[0].flow_message_variation_id,
    "flow-variation-1",
  );
  assert.deepEqual(calls.map((call) => `${call.path}:${call.cursor ?? "first"}`), [
    "/api/metrics:first",
    "/api/metrics:metrics-2",
    "/api/campaign-values-reports:first",
    "/api/campaign-values-reports:campaign-2",
    "/api/flow-values-reports:first",
    "/api/events:first",
    "/api/events:events-2",
  ]);
});

test("the first provider rejection stops later families and never publishes partial rows", async () => {
  const calls = [];
  const api = runtime({
    fetchFn: async (url) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/api/metrics") {
        return response(200, {
          data: [metric("placed", "Placed Order"), metric("product", "Ordered Product")],
          links: {self: url},
        });
      }
      if (path === "/api/campaign-values-reports") {
        return response(429, {errors: [{code: "throttled"}]}, "request-429");
      }
      throw new Error("a later family must not start");
    },
  });
  const result = await api.readDailyEvidenceSnapshot({installationAuthority, businessDate: "2026-10-17"});
  assert.deepEqual(calls, ["/api/metrics", "/api/campaign-values-reports"]);
  assert.equal(result.status, "failed");
  assert.equal(result.publishable, false);
  assert.equal(result.results, null);
  assert.deepEqual(result.completed_families, ["metrics"]);
  assert.equal(result.error.code, "KLAVIYO_REPORTING_REQUEST_REJECTED");
});

test("a reporting 401 marks reauthorization once and is not retried", async () => {
  const calls = [];
  const lifecycle = {
    load: async () => {
      calls.push("lifecycle.load");
      return {status: "connected", version: 7};
    },
    markReauthorizationRequired: async (input) => {
      calls.push("lifecycle.reauthorize");
      assert.equal(input.reason, "klaviyo_reporting_authorization_rejected");
    },
  };
  const api = runtime({
    lifecycle,
    fetchFn: async () => {
      calls.push("provider.metrics");
      return response(401, {errors: [{code: "not_authorized"}]});
    },
  });
  const result = await api.readDailyEvidenceSnapshot({installationAuthority, businessDate: "2026-10-17"});
  assert.deepEqual(calls, ["provider.metrics", "lifecycle.load", "lifecycle.reauthorize"]);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "KLAVIYO_REAUTHORIZATION_REQUIRED");
});

test("pagination never follows a foreign or malformed continuation link", async () => {
  let requestCount = 0;
  const api = runtime({
    fetchFn: async (url) => {
      requestCount += 1;
      return response(200, {
        data: [metric("placed", "Placed Order")],
        links: {self: url, next: "https://example.com/api/metrics?page%5Bcursor%5D=stolen"},
      });
    },
  });
  const result = await api.readDailyEvidenceSnapshot({installationAuthority, businessDate: "2026-10-17"});
  assert.equal(requestCount, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "KLAVIYO_PAGINATION_LINK_INVALID");
});

test("invalid connected-account cardinality fails before credential or provider access", async () => {
  let providerCalled = false;
  let credentialCalled = false;
  const api = createKlaviyoReportingAuthorityRuntime({
    fetchFn: async () => {
      providerCalled = true;
      throw new Error("unexpected");
    },
    accountAuthority: {load: async () => ({...connection, accounts: []})},
    credentialAuthority: {prepareCredential: async () => {
      credentialCalled = true;
      return {tokenSet: {access_token: "unexpected"}};
    }},
    lifecycle: {},
    config: {},
  });
  await assert.rejects(
    () => api.readDailyEvidenceSnapshot({installationAuthority, businessDate: "2026-10-17"}),
    (error) => error.code === "KLAVIYO_ACCOUNT_CARDINALITY_INVALID",
  );
  assert.equal(credentialCalled, false);
  assert.equal(providerCalled, false);
});

test("an evidence run without a supplied date uses the connected account business date", async () => {
  let campaignBody = null;
  const api = runtime({
    now: () => new Date("2026-10-17T22:30:00.000Z"),
    fetchFn: async (url, options) => {
      const path = new URL(url).pathname;
      if (path === "/api/metrics") {
        return response(200, {
          data: [metric("placed", "Placed Order"), metric("product", "Ordered Product")],
          links: {self: url},
        });
      }
      if (path === "/api/campaign-values-reports") {
        campaignBody = JSON.parse(options.body);
        return response(429, {errors: [{code: "throttled"}]});
      }
      throw new Error("a later family must not start");
    },
  });
  const result = await api.readDailyEvidenceSnapshot({installationAuthority});
  assert.equal(result.business_date, "2026-10-18");
  assert.equal(
    campaignBody.data.attributes.timeframe.start,
    "2026-10-18T00:00:00+03:00",
  );
  assert.equal(result.status, "failed");
});
