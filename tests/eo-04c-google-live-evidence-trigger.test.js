import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  buildGoogleLiveEvidenceSafeLog,
  buildGoogleLiveEvidenceSafeFailureLog,
  classifyGoogleLiveEvidenceError,
  completedThirtyDayWindow,
  createGoogleLiveEvidenceRuntime,
  GOOGLE_LIVE_EVIDENCE_QUERY_FAMILIES,
  validateGoogleLiveEvidenceInput,
} from "../app/lib/providers/google-live-evidence.server.js";
import {GoogleAdsRestError} from "../app/lib/providers/google-ads-rest.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const contract = JSON.parse(read("contracts/eo-04c-google-live-evidence-trigger-v1.json"));
const runtimeContract = JSON.parse(read("contracts/eo-04c-google-reporting-runtime-v1.json"));
const master = JSON.parse(read("contracts/a6-eo-implementation-master-v1.json"));
const brief = read("docs/EO_04C_GOOGLE_LIVE_EVIDENCE_TRIGGER_BRIEF.md");
const route = read("app/routes/settings.google-live-evidence.ts");
const settings = read("app/routes/_admin.settings.tsx");
const liveEvidence = JSON.parse(read(
  "docs/evidence/EO_04C_GOOGLE_PROVIDER_LIVE_EVIDENCE_2026-10-16.json",
));

const installationAuthority = Object.freeze({
  authority: "shopify_installation_verified",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  installGeneration: 3,
  status: "active",
});

const authority = Object.freeze({
  connection_id: "22222222-2222-4222-8222-222222222222",
  reporting_account_id: "1234567890",
  reporting_account_currency: "USD",
  reporting_account_timezone: "Atlantic/Reykjavik",
});

function page(rows, nextCursor = null) {
  return {
    provider: "google_ads",
    authority,
    page: {
      rows,
      next_cursor: nextCursor,
      provider_request_id: "provider-trace-secret",
      observation_state: rows.length === 0
        ? "not_observed_in_this_execution"
        : "present",
    },
  };
}

function advertisedSale() {
  return {
    customer: {id: "1234567890"},
    campaign: {id: "campaign-secret", advertisingChannelType: "PERFORMANCE_MAX"},
    segments: {
      date: "2026-10-01",
      productMerchantId: "merchant-secret",
      productFeedLabel: "feed-secret",
      productItemId: "advertised-secret",
      productSoldItemId: "advertised-secret",
      productSoldTitle: "Secret Product",
    },
    metrics: {
      unitsSold: 1,
      revenueMicros: 1000000,
      leadUnitsSold: 1,
      leadRevenueMicros: 1000000,
      crossSellUnitsSold: 0,
      crossSellRevenueMicros: 0,
    },
  };
}

function crossSellSale() {
  return {
    customer: {id: "1234567890"},
    campaign: {id: "campaign-secret", advertisingChannelType: "PERFORMANCE_MAX"},
    segments: {
      date: "2026-10-02",
      productMerchantId: "merchant-secret",
      productFeedLabel: "feed-secret",
      productItemId: "advertised-secret",
      productSoldItemId: "sold-secret",
      productSoldTitle: "Another Secret Product",
    },
    metrics: {
      unitsSold: 1,
      revenueMicros: 2000000,
      leadUnitsSold: 0,
      leadRevenueMicros: 0,
      crossSellUnitsSold: 1,
      crossSellRevenueMicros: 2000000,
    },
  };
}

test("trigger input is Google-only and accepts no operator-controlled date or account", () => {
  assert.deepEqual(validateGoogleLiveEvidenceInput({provider: "google_ads"}), {
    provider: "google_ads",
  });
  for (const input of [
    {provider: "meta"},
    {provider: "google_ads", account_id: "999"},
    {provider: "google_ads", start: "2026-01-01"},
    null,
  ]) assert.throws(() => validateGoogleLiveEvidenceInput(input));
});

test("reporting window is the last 30 completed account business dates", () => {
  assert.deepEqual(completedThirtyDayWindow({
    now: new Date("2026-10-16T12:00:00Z"),
    timeZone: "Atlantic/Reykjavik",
  }), {start: "2026-09-16", end: "2026-10-15"});
  assert.deepEqual(completedThirtyDayWindow({
    now: new Date("2026-10-16T00:30:00Z"),
    timeZone: "America/Los_Angeles",
  }), {start: "2026-09-15", end: "2026-10-14"});
});

test("execution reads exact family order, completes pagination, and exposes only safe summaries", async () => {
  const calls = [];
  const runtime = createGoogleLiveEvidenceRuntime({
    clock: () => new Date("2026-10-16T12:00:00Z"),
    googleRuntime: {
      async prepareEvidenceExecution() {},
      async readEvidencePage(input) {
        calls.push(input);
        if (input.queryFamily === "account_campaign_context") {
          return page([{customer: {id: "1234567890", testAccount: false}}]);
        }
        if (input.queryFamily === "cart_data_product_sales_daily") {
          return input.pageToken === null
            ? page([advertisedSale()], "opaque-next-page-secret")
            : page([crossSellSale()]);
        }
        if (input.queryFamily === "shopping_product_daily") {
          return page([{segments: {productItemId: "advertised-secret"}, metrics: {costMicros: "10"}}]);
        }
        if (input.queryFamily === "pmax_listing_tree_current") {
          return page([{
            assetGroup: {id: "asset-secret"},
            assetGroupListingGroupFilter: {
              assetGroup: "customers/123/assetGroups/456",
              path: {dimensions: []},
              type: "UNIT_INCLUDED",
              listingSource: "SHOPPING",
            },
          }]);
        }
        return page([{assetGroup: {id: "asset-secret"}, metrics: {impressions: "3"}}]);
      },
    },
  });

  const result = await runtime.execute({
    installationAuthority,
    input: {provider: "google_ads"},
  });

  assert.deepEqual(calls.map((call) => call.queryFamily), [
    "account_campaign_context",
    "cart_data_product_sales_daily",
    "cart_data_product_sales_daily",
    "shopping_product_daily",
    "pmax_listing_tree_current",
    "pmax_asset_group_channel_daily",
  ]);
  assert.deepEqual(calls.slice(1).map((call) => call.dateWindow), Array(5).fill({
    start: "2026-09-16",
    end: "2026-10-15",
  }));
  assert.equal(result.cart_data_sales.page_count, 2);
  assert.equal(result.cart_data_sales.row_count, 2);
  assert.equal(result.cart_data_sales.sales_role_counts.Advertised, 1);
  assert.equal(result.cart_data_sales.sales_role_counts["Cross-sell"], 1);
  assert.equal(result.current_listing_tree.historical_channel_resolution,
    "not_performed_from_current_tree");
  assert.equal(result.controls.provider_retry_performed, false);
  assert.deepEqual(result.controls.query_families_completed,
    GOOGLE_LIVE_EVIDENCE_QUERY_FAMILIES);

  const safeLog = buildGoogleLiveEvidenceSafeLog(result);
  const serialized = JSON.stringify({result, safeLog});
  for (const forbidden of [
    "provider-trace-secret",
    "opaque-next-page-secret",
    "campaign-secret",
    "merchant-secret",
    "feed-secret",
    "advertised-secret",
    "sold-secret",
    "Secret Product",
    "1234567890",
    authority.connection_id,
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden));
});

test("first provider error stops every remaining family without retry", async () => {
  const calls = [];
  const failure = new Error("opaque-google-provider-failure");
  const runtime = createGoogleLiveEvidenceRuntime({
    clock: () => new Date("2026-10-16T12:00:00Z"),
    googleRuntime: {
      async prepareEvidenceExecution() {},
      async readEvidencePage(input) {
        calls.push(input.queryFamily);
        if (input.queryFamily === "account_campaign_context") {
          return page([{customer: {testAccount: false}}]);
        }
        throw failure;
      },
    },
  });
  await assert.rejects(runtime.execute({
    installationAuthority,
    input: {provider: "google_ads"},
  }), (error) => error === failure);
  assert.deepEqual(calls, [
    "account_campaign_context",
    "cart_data_product_sales_daily",
  ]);
});

test("a test-account observation stops before performance evidence", async () => {
  const calls = [];
  const runtime = createGoogleLiveEvidenceRuntime({
    clock: () => new Date("2026-10-16T12:00:00Z"),
    googleRuntime: {
      async prepareEvidenceExecution() {},
      async readEvidencePage(input) {
        calls.push(input.queryFamily);
        return page([{customer: {testAccount: true}}]);
      },
    },
  });
  await assert.rejects(runtime.execute({
    installationAuthority,
    input: {provider: "google_ads"},
  }), (error) => error.code === "GOOGLE_LIVE_EVIDENCE_TEST_ACCOUNT_NOT_ELIGIBLE");
  assert.deepEqual(calls, ["account_campaign_context"]);
});

test("a safe provider error code is preserved without enabling retry", () => {
  const failure = classifyGoogleLiveEvidenceError(new GoogleAdsRestError(
    "GOOGLE_ADS_REST_REQUEST_FAILED",
    "Google Ads REST request failed",
    {
      status: 400,
      provider_error_code: "QUERY_ERROR",
      request_id: "provider-trace-secret",
    },
  ));
  assert.equal(failure.code, "GOOGLE_PROVIDER_QUERY_ERROR");
  assert.equal(failure.class, "request_contract_invalid");
  assert.equal(failure.provider_request_id, "provider-trace-secret");
  assert.equal(Object.hasOwn(failure, "retryable"), false);
});

test("a failed family emits bounded diagnostic evidence without identifiers", async () => {
  const providerFailure = new GoogleAdsRestError(
    "GOOGLE_ADS_REST_REQUEST_FAILED",
    "Google Ads REST request failed for customer 5252399301",
    {
      status: 400,
      provider_error_code: "QUERY_ERROR",
      request_id: "provider-trace-secret",
    },
  );
  const runtime = createGoogleLiveEvidenceRuntime({
    clock: () => new Date("2026-10-16T12:00:00Z"),
    googleRuntime: {
      async prepareEvidenceExecution() {},
      async readEvidencePage(input) {
        if (input.queryFamily === "account_campaign_context") {
          return page([{customer: {testAccount: false}}]);
        }
        throw providerFailure;
      },
    },
  });

  let caught;
  try {
    await runtime.execute({
      installationAuthority,
      input: {provider: "google_ads"},
    });
  } catch (error) {
    caught = error;
  }

  assert.equal(caught, providerFailure);
  const failure = classifyGoogleLiveEvidenceError(caught);
  const safeLog = buildGoogleLiveEvidenceSafeFailureLog(caught, failure);
  assert.deepEqual(safeLog, {
    event: "google_live_evidence_failed",
    status: "failed",
    code: "GOOGLE_PROVIDER_QUERY_ERROR",
    class: "request_contract_invalid",
    stage: "query_family_read",
    query_family: "cart_data_product_sales_daily",
    source_code: "GOOGLE_ADS_REST_REQUEST_FAILED",
    provider_http_status: 400,
    provider_error_code: "QUERY_ERROR",
    provider_response_observed: true,
    provider_retry_performed: false,
    next_query_family_started: false,
  });
  const serialized = JSON.stringify(safeLog);
  assert.doesNotMatch(serialized, /provider-trace-secret|5252399301/);
  assert.equal(Object.hasOwn(safeLog, "provider_request_id"), false);
});

test("runtime initialization failure proves no provider response without leaking config", () => {
  const failure = new GoogleAdsRestError(
    "GOOGLE_ADS_DEVELOPER_TOKEN_REQUIRED",
    "GOOGLE_ADS_DEVELOPER_TOKEN_REQUIRED",
  );
  const safeLog = buildGoogleLiveEvidenceSafeFailureLog(
    failure,
    classifyGoogleLiveEvidenceError(failure),
    "runtime_initialization",
  );
  assert.equal(safeLog.stage, "runtime_initialization");
  assert.equal(safeLog.source_code, "GOOGLE_ADS_DEVELOPER_TOKEN_REQUIRED");
  assert.equal(safeLog.provider_response_observed, false);
  assert.equal(safeLog.provider_http_status, null);
  assert.equal(safeLog.provider_error_code, null);
});

test("credential refresh failure stops before every query family", async () => {
  const failure = new GoogleAdsRestError(
    "GOOGLE_ADS_OAUTH_TOKEN_EXCHANGE_FAILED",
    "Google OAuth token endpoint rejected the request",
    {status: 400, provider_status: "invalid_grant"},
  );
  let queryCalls = 0;
  const runtime = createGoogleLiveEvidenceRuntime({
    googleRuntime: {
      async prepareEvidenceExecution() {
        throw failure;
      },
      async readEvidencePage() {
        queryCalls += 1;
      },
    },
  });

  let caught;
  try {
    await runtime.execute({installationAuthority, input: {provider: "google_ads"}});
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, failure);
  assert.equal(queryCalls, 0);
  const safeLog = buildGoogleLiveEvidenceSafeFailureLog(
    caught,
    classifyGoogleLiveEvidenceError(caught),
  );
  assert.equal(safeLog.code, "GOOGLE_ADS_REAUTHORIZATION_REQUIRED");
  assert.equal(safeLog.class, "reauthorization_required");
  assert.equal(safeLog.stage, "credential_refresh");
  assert.equal(safeLog.query_family, null);
  assert.equal(safeLog.provider_http_status, 400);
  assert.equal(safeLog.provider_retry_performed, false);
  assert.equal(safeLog.next_query_family_started, false);
});

test("route is read-only, authenticated, safe-logged, and contains no retry path", () => {
  assert.match(route, /resolveReadOnlyShopifyRouteAuthority/);
  assert.match(route, /authenticate[.]admin/);
  assert.match(route, /createGoogleReportingAuthorityRuntime/);
  assert.match(route, /GOOGLE_LIVE_EVIDENCE_SAFE_LOG_PREFIX/);
  assert.equal(route.match(/console[.]info/g)?.length, 2);
  assert.match(route, /buildGoogleLiveEvidenceSafeFailureLog/);
  assert.doesNotMatch(route, /database[.](?:query|transaction)|insert|update|delete/i);
  assert.doesNotMatch(route, /setTimeout|refreshGoogleAdsAccessToken/);
  assert.match(route, /provider_retry_performed: false/);
  assert.doesNotMatch(route, /provider_request_id: failure/);
  assert.doesNotMatch(route, /<s-|useSubmit|Form/);
});

test("Settings exposes one native Google evidence action with complete terminal states", () => {
  assert.match(settings, /"Run Google evidence"/);
  assert.match(settings, /fetch\("\/settings\/google-live-evidence"/);
  assert.match(settings, /body: JSON[.]stringify\(\{provider: "google_ads"\}\)/);
  assert.match(settings, /if \(googleEvidenceAttempted[.]current\) return/);
  assert.match(settings, /googleEvidenceAttempted[.]current = true/);
  assert.match(settings, /loading=\{googleEvidenceStatus === "loading"\}/);
  assert.match(settings, /Google evidence stopped[.] No retry was performed/);
  assert.match(settings, /This is not zero or unsupported/);
  assert.doesNotMatch(settings, /google-evidence-modal|Google evidence date/);
});

test("contracts record completed live gates while preserving retry and merge gates", () => {
  assert.deepEqual(contract.execution.query_families_in_order,
    GOOGLE_LIVE_EVIDENCE_QUERY_FAMILIES);
  assert.equal(contract.execution.automatic_retry, false);
  assert.equal(contract.execution.preflight_access_token_refresh_once, true);
  assert.equal(contract.execution.refresh_failure_stops_before_gaql, true);
  assert.equal(contract.execution.one_refreshed_access_token_per_execution, true);
  assert.equal(contract.result.current_listing_tree_resolves_historical_channel, false);
  assert.equal(contract.mutations.database, false);
  assert.equal(contract.product_owner_authorization.repository_implementation, true);
  assert.equal(contract.product_owner_authorization.deployment, true);
  assert.equal(contract.product_owner_authorization.first_live_provider_call, true);
  assert.equal(contract.product_owner_authorization.safe_failure_logging_fix, true);
  assert.equal(contract.product_owner_authorization.preflight_access_token_refresh, true);
  assert.equal(contract.product_owner_authorization.visual_acceptance, true);
  assert.equal(contract.product_owner_authorization.merge, false);
  assert.equal(contract.failure_evidence.server_log_required, true);
  assert.equal(contract.failure_evidence.provider_request_id_logged, false);
  assert.equal(contract.acceptance.mobile_320px_real_shopify_admin_required, true);
  assert.match(brief, /modal, date\s+input, new section or `s-clickable`/i);
  assert.match(brief, /additional live request requires a separate explicit product-owner approval/i);

  assert.equal(runtimeContract.product_owner_acceptance.runtime_final_acceptance, true);
  assert.equal(runtimeContract.product_owner_acceptance.merge_authorized, true);
  assert.equal(runtimeContract.product_owner_acceptance.merge_commit,
    "752cc1988323c238297d00516e7b7009432032c2");
  const googlePackage = master.packages
    .flatMap((parent) => parent.children ?? [])
    .find((child) => child.id === "A6-EO-04-C");
  assert.equal(googlePackage.reporting_runtime_final_product_owner_acceptance, true);
  assert.equal(googlePackage.live_evidence_trigger_implementation_authorized, true);
  assert.equal(googlePackage.live_evidence_trigger_deployment_authorized, true);
  assert.equal(googlePackage.first_live_reporting_call_authorized, true);
  assert.equal(googlePackage.additional_live_reporting_call_authorized, false);
  assert.equal(googlePackage.account_context_correction_required, true);
});

test("retained Google live evidence is empty without inventing zero or support", () => {
  assert.equal(liveEvidence.repository_commit,
    "960ad41a7db9446e4be147f18d33d946c8324ae5");
  assert.equal(liveEvidence.execution.status, "complete");
  assert.equal(liveEvidence.execution.query_families_completed, 5);
  assert.equal(liveEvidence.observations.campaign_context_row_count, 0);
  assert.equal(liveEvidence.observations.cart_data_sales_row_count, 0);
  assert.equal(liveEvidence.observations.shopping_product_row_count, 0);
  assert.equal(liveEvidence.observations.current_pmax_listing_tree_row_count, 0);
  assert.equal(liveEvidence.observations.pmax_asset_group_performance_row_count, 0);
  assert.equal(liveEvidence.truth_boundaries.empty_is_real_zero, false);
  assert.equal(liveEvidence.truth_boundaries.product_id_support_proven, false);
  assert.equal(liveEvidence.truth_boundaries.sales_role_support_proven, false);
  assert.equal(liveEvidence.next_gate.account_identity_query, "FROM customer");
  assert.equal(liveEvidence.next_gate.code_change_authorized, false);
  assert.doesNotMatch(JSON.stringify(liveEvidence),
    /5252399301|ya29[.]|vault-refresh|developer-token/i);
});
