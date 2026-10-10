import assert from "node:assert/strict";
import test from "node:test";

import {
  AdapterContractError,
  COMMON_ADAPTER_CONTRACT_VERSION,
  RAW_METRICS,
  createQueryFingerprint,
  runCommonAdapterOperation,
  sanitizeProviderEvidence,
  validateCanonicalFunnelFact,
  validateCommonAdapterRequest,
} from "../app/lib/providers/common-adapter.server.js";

const IDS = Object.freeze({
  workspace: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
  connection: "33333333-3333-4333-8333-333333333333",
  attempt: "44444444-4444-4444-8444-444444444444",
});

function makeRequest(overrides = {}) {
  const query = {
    provider: overrides.provider ?? "meta",
    account: overrides.platform_account_id ?? "act_123",
    start: "2026-10-08",
    end: "2026-10-09",
    metrics: RAW_METRICS,
  };
  return {
    authority: {
      workspace_id: IDS.workspace,
      installation_id: IDS.installation,
      installation_generation: 1,
      status: "active",
      store_scope: "verified_installed_shop",
      shop_domain: "example.myshopify.com",
    },
    provider_connection_id: IDS.connection,
    provider: "meta",
    platform_account_id: "act_123",
    canonical_reporting_account_id: "act_123",
    operation: "fetch_facts",
    adapter_contract_version: COMMON_ADAPTER_CONTRACT_VERSION,
    provider_api_version: "fixture-v1",
    installed_shop_timezone: "Europe/Istanbul",
    date_window: { start: "2026-10-08", end: "2026-10-09" },
    requested_metrics: [...RAW_METRICS],
    levels: ["campaign", "adset", "ad"],
    breakdowns: [],
    query_fingerprint: createQueryFingerprint(query),
    attempt_id: IDS.attempt,
    job_or_run_id: null,
    ...overrides,
  };
}

function makeMetricTriplet(values = {}) {
  const raw_metrics = {};
  const metric_support = {};
  const observation_state = {};
  for (const metric of RAW_METRICS) {
    const value = values[metric];
    if (value === undefined) {
      raw_metrics[metric] = null;
      metric_support[metric] = "supported";
      observation_state[metric] = "absent";
    } else if (value === null) {
      raw_metrics[metric] = null;
      metric_support[metric] = "unsupported";
      observation_state[metric] = "not_requested";
    } else if (value === 0) {
      raw_metrics[metric] = 0;
      metric_support[metric] = "supported";
      observation_state[metric] = "zero";
    } else {
      raw_metrics[metric] = value;
      metric_support[metric] = "supported";
      observation_state[metric] = "present";
    }
  }
  return { raw_metrics, metric_support, observation_state };
}

function makeRow(entityId = "ad-1", values = { impression: 100, ad_click: 0 }) {
  return {
    identity: {
      workspace_id: IDS.workspace,
      installation_id: IDS.installation,
      installation_generation: 1,
      provider_connection_id: IDS.connection,
      platform: "meta",
      platform_account_id: "act_123",
      canonical_reporting_account_id: "act_123",
      business_date: "2026-10-08",
    },
    entity: {
      campaign_type: "standard",
      root_entity_type: "campaign",
      root_entity_id: "campaign-1",
      root_entity_name: "Campaign",
      parent_entity_type: "adset",
      parent_entity_id: "adset-1",
      parent_entity_name: "Ad set",
      entity_type: "ad",
      entity_id: entityId,
      entity_name: entityId,
    },
    ...makeMetricTriplet(values),
    currency: {
      source_currency: "USD",
      target_currency: "TRY",
      fx_rate: 42,
      fx_rate_date: "2026-10-08",
      fx_provider: "fixture",
      fx_engine_version: "v1",
    },
    time: {
      source_timezone: "Europe/Istanbul",
      business_date: "2026-10-08",
      time_engine_version: "v1",
    },
    provenance: {
      source_system: "meta_ads",
      adapter_version: "fixture-v1",
      source_confidence: "real",
      synthetic: true,
      ga4_property_id: null,
      raw_reference: { fixture: entityId },
    },
  };
}

const noRetryClassifier = () => ({
  class: "internal_adapter_failure",
  retryable: false,
  message: "fixture failure",
});

test("request requires active verified installed Shopify store authority", () => {
  const request = makeRequest();
  assert.equal(validateCommonAdapterRequest(request), request);

  assert.throws(
    () =>
      validateCommonAdapterRequest({
        ...request,
        authority: { ...request.authority, store_scope: "ambiguous" },
      }),
    (error) =>
      error instanceof AdapterContractError &&
      error.code === "AMBIGUOUS_STORE_SCOPE",
  );
});

test("Klaviyo binds one platform account without an Ad Account selector", () => {
  const request = makeRequest({
    provider: "klaviyo",
    platform_account_id: "klaviyo-account",
    canonical_reporting_account_id: null,
  });
  assert.equal(validateCommonAdapterRequest(request), request);

  assert.throws(
    () =>
      validateCommonAdapterRequest({
        ...request,
        canonical_reporting_account_id: "not-an-ad-account",
      }),
    /must not receive an Ad Account/,
  );
});

test("canonical row preserves explicit zero, absence and unsupported as different states", () => {
  const row = makeRow("ad-states", {
    impression: 100,
    ad_click: 0,
    session: null,
  });
  assert.equal(validateCanonicalFunnelFact(row), row);
  assert.equal(row.raw_metrics.ad_click, 0);
  assert.equal(row.observation_state.ad_click, "zero");
  assert.equal(row.raw_metrics.add_to_cart, null);
  assert.equal(row.observation_state.add_to_cart, "absent");
  assert.equal(row.raw_metrics.session, null);
  assert.equal(row.metric_support.session, "unsupported");
});

test("canonical row rejects invented zero and non-null unsupported values", () => {
  const inventedZero = makeRow();
  inventedZero.raw_metrics.add_to_cart = 0;
  assert.throws(
    () => validateCanonicalFunnelFact(inventedZero),
    /must be null for absent state/,
  );

  const unsupportedValue = makeRow();
  unsupportedValue.raw_metrics.session = 12;
  unsupportedValue.metric_support.session = "unsupported";
  unsupportedValue.observation_state.session = "not_requested";
  assert.throws(
    () => validateCanonicalFunnelFact(unsupportedValue),
    /must be null when support is unsupported/,
  );
});

test("complete multi-page traversal stages all rows and deduplicates identical replay", async () => {
  const pages = {
    first: {
      rows: [makeRow("ad-1")],
      next_cursor: "opaque-2",
      provider_request_id: "req-1",
      raw_evidence: { request_id: "req-1" },
    },
    "opaque-2": {
      rows: [makeRow("ad-1"), makeRow("ad-2", { impression: 50 })],
      next_cursor: null,
      provider_request_id: "req-2",
      raw_evidence: { request_id: "req-2" },
    },
  };

  const result = await runCommonAdapterOperation({
    request: makeRequest(),
    fetchPage: async ({ cursor }) => pages[cursor ?? "first"],
    classifyError: noRetryClassifier,
  });

  assert.equal(result.status, "complete");
  assert.equal(result.publishable, true);
  assert.equal(result.rows.length, 2);
  assert.equal(result.evidence.page_count, 2);
  assert.equal(result.evidence.staged_row_count, 2);
  assert.equal(result.evidence.completeness, "complete");
});

test("cursor loop fails closed and publishes no staged rows", async () => {
  const result = await runCommonAdapterOperation({
    request: makeRequest(),
    fetchPage: async ({ cursor }) => ({
      rows: [makeRow(cursor == null ? "ad-1" : "ad-2")],
      next_cursor: "same-cursor",
      raw_evidence: {},
    }),
    classifyError: noRetryClassifier,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.publishable, false);
  assert.deepEqual(result.rows, []);
  assert.equal(result.error.class, "partial_result");
  assert.match(result.error.message, /cursor loop/i);
  assert.equal(result.evidence.staged_row_count, 2);
});

test("documented rate limit honors Retry-After then succeeds", async () => {
  let calls = 0;
  const delays = [];
  const result = await runCommonAdapterOperation({
    request: makeRequest(),
    fetchPage: async () => {
      calls += 1;
      if (calls === 1) throw new Error("429");
      return { rows: [makeRow()], next_cursor: null, raw_evidence: {} };
    },
    classifyError: () => ({
      class: "rate_limited",
      retryable: true,
      retry_after_ms: 1_750,
      provider_request_id: "req-rate",
      message: "rate limited",
    }),
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    random: () => 0,
  });

  assert.equal(result.publishable, true);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1_750]);
  assert.equal(result.evidence.total_attempts, 2);
});

test("authentication failure is never retried even if classifier asks for retry", async () => {
  let calls = 0;
  const result = await runCommonAdapterOperation({
    request: makeRequest(),
    fetchPage: async () => {
      calls += 1;
      throw new Error("expired token");
    },
    classifyError: () => ({
      class: "reauthorization_required",
      retryable: true,
      message: "reauthorize",
    }),
    sleep: async () => assert.fail("sleep must not be called"),
  });

  assert.equal(calls, 1);
  assert.equal(result.publishable, false);
  assert.equal(result.error.class, "reauthorization_required");
});

test("failure after a successful page remains partial and not publishable", async () => {
  const result = await runCommonAdapterOperation({
    request: makeRequest(),
    fetchPage: async ({ cursor }) => {
      if (cursor == null) {
        return {
          rows: [makeRow("ad-1")],
          next_cursor: "opaque-2",
          raw_evidence: {},
        };
      }
      throw new Error("provider unavailable");
    },
    classifyError: () => ({
      class: "transient_provider_failure",
      retryable: true,
      message: "provider unavailable",
    }),
    sleep: async () => {},
    limits: { maximum_attempts_per_page: 2 },
  });

  assert.equal(result.publishable, false);
  assert.deepEqual(result.rows, []);
  assert.equal(result.error.class, "transient_provider_failure");
  assert.equal(result.evidence.staged_row_count, 1);
  assert.equal(result.evidence.completeness, "partial");
});

test("conflicting duplicate fact fails closed", async () => {
  const conflicting = makeRow("ad-1", { impression: 101 });
  const result = await runCommonAdapterOperation({
    request: makeRequest(),
    fetchPage: async ({ cursor }) =>
      cursor == null
        ? { rows: [makeRow("ad-1")], next_cursor: "next", raw_evidence: {} }
        : { rows: [conflicting], next_cursor: null, raw_evidence: {} },
    classifyError: noRetryClassifier,
  });

  assert.equal(result.publishable, false);
  assert.equal(result.error.class, "partial_result");
  assert.match(result.error.message, /conflicting duplicate/i);
});

test("provider schema failure is not published as an empty success", async () => {
  const malformed = makeRow();
  delete malformed.raw_metrics.purchase_value;
  const result = await runCommonAdapterOperation({
    request: makeRequest(),
    fetchPage: async () => ({
      rows: [malformed],
      next_cursor: null,
      raw_evidence: {},
    }),
    classifyError: noRetryClassifier,
  });

  assert.equal(result.publishable, false);
  assert.equal(result.error.class, "provider_schema_changed");
  assert.deepEqual(result.rows, []);
});

test("evidence sanitizer redacts secrets, authorization and personal email", () => {
  const evidence = sanitizeProviderEvidence({
    request_id: "req-1",
    access_token: "top-secret-token",
    headers: { Authorization: "Bearer top-secret-token" },
    nested: {
      client_secret: "client-secret",
      contact: "merchant@example.com",
    },
  });
  const serialized = JSON.stringify(evidence.sanitized);

  assert.equal(evidence.sha256.length, 64);
  assert.ok(evidence.byte_length > 0);
  assert.doesNotMatch(serialized, /top-secret-token|client-secret|merchant@example\.com/);
  assert.match(serialized, /REDACTED/);
});

test("evidence byte ceiling is enforced", () => {
  assert.throws(
    () => sanitizeProviderEvidence({ payload: "x".repeat(100) }, { maxBytes: 10 }),
    (error) =>
      error instanceof AdapterContractError && error.code === "EVIDENCE_TOO_LARGE",
  );
});


test("provider Retry-After is never shortened to the fallback delay ceiling", async () => {
  let slept = false;
  const result = await runCommonAdapterOperation({
    request: makeRequest(),
    fetchPage: async () => {
      throw new Error("429");
    },
    classifyError: () => ({
      class: "rate_limited",
      retryable: true,
      retry_after_ms: 5_000,
      message: "rate limited",
    }),
    sleep: async () => {
      slept = true;
    },
    now: () => 0,
    limits: {
      maximum_elapsed_ms: 1_000,
      maximum_delay_ms: 10,
    },
  });

  assert.equal(result.publishable, false);
  assert.equal(result.error.class, "rate_limited");
  assert.match(result.error.message, /elapsed-time budget/i);
  assert.equal(slept, false);
});

test("oversized provider evidence fails closed instead of escaping the runner", async () => {
  const result = await runCommonAdapterOperation({
    request: makeRequest(),
    fetchPage: async () => ({
      rows: [makeRow()],
      next_cursor: null,
      provider_request_id: "req-large-evidence",
      raw_evidence: { payload: "x".repeat(100) },
    }),
    classifyError: noRetryClassifier,
    limits: { maximum_evidence_bytes: 10 },
  });

  assert.equal(result.publishable, false);
  assert.deepEqual(result.rows, []);
  assert.equal(result.error.class, "internal_adapter_failure");
  assert.match(result.error.message, /evidence/i);
});
