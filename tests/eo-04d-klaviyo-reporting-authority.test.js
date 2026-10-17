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

function runtime({fetchFn, connected = connection, lifecycle = null} = {}) {
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
  });
}

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
