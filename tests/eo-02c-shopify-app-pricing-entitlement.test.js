import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  ACTIVE_SUBSCRIPTION_QUERY,
  SHOPIFY_PARTNER_API_VERSION,
  reconcileShopifyAppPricingEntitlement,
} from "../app/lib/shopify/app-pricing-entitlement.server.js";
import {
  SHOPIFY_PARTNER_RUNTIME_ENV,
  createShopifyPartnerApi,
  readShopifyPartnerRuntimeConfig,
} from "../app/lib/shopify/partner-api.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const contract = JSON.parse(read("contracts/eo-02c-shopify-app-pricing-entitlement-v1.json"));
const migration = contract.database.migration_chain.map(read).join("\n").toLowerCase();

const installation = {
  authority: "shopify_installation_verified",
  shopId: "gid://shopify/Shop/123456789",
  shopDomain: "example-store.myshopify.com",
  installGeneration: 1,
};
const appId = "gid://shopify/App/987654321";
const observedAt = new Date("2026-10-06T18:00:00.000Z");

function repositoryFor(expectedStatus) {
  let command;
  return {
    get command() {
      return command;
    },
    repository: {
      applySnapshot: async (value) => {
        command = value;
        return {
          shopId: value.shopId,
          shopDomain: value.shopDomain,
          installGeneration: value.installGeneration,
          entitlementStatus: expectedStatus,
          reportingStoreLimit: 1,
          candidateDetectionBilled: false,
          reportingStoreSwitchBilled: false,
          sourceObservedAt: value.observedAt,
        };
      },
    },
  };
}

test("official Partner API version and query fields are pinned", () => {
  assert.equal(SHOPIFY_PARTNER_API_VERSION, "2026-07");
  assert.match(ACTIVE_SUBSCRIPTION_QUERY, /activeSubscription\(appId: \$appId, shopId: \$shopId\)/);
  assert.match(ACTIVE_SUBSCRIPTION_QUERY, /trialEndsAt/);
  assert.match(ACTIVE_SUBSCRIPTION_QUERY, /currentBillingCycle/);
  assert.equal(contract.decision.billing_authority, "shopify_app_pricing");
  assert.equal(contract.decision.appSubscriptionCreate, false);
});

test("future Shopify trial becomes a generation-bound trial entitlement", async () => {
  const state = repositoryFor("trial");
  const result = await reconcileShopifyAppPricingEntitlement({
    installation,
    appId,
    observedAt,
    partnerApi: {
      activeSubscription: async ({apiVersion, variables}) => {
        assert.equal(apiVersion, "2026-07");
        assert.deepEqual(variables, {appId, shopId: installation.shopId});
        return {
          data: {
            activeSubscription: {
              shop: {id: installation.shopId, myshopifyDomain: installation.shopDomain},
              billingPeriod: "EVERY_30_DAYS",
              cancelAtEndOfCycle: false,
              trialEndsAt: "2026-10-20T18:00:00.000Z",
              currentBillingCycle: null,
              // Shopify development-store free testing can return an effective
              // zero-dollar price with active=false while activeSubscription is live.
              items: [{handle: "ads_table_monthly", price: {active: false}}],
              pendingUpdate: null,
            },
          },
        };
      },
    },
    repository: state.repository,
  });

  assert.equal(result.entitlementStatus, "trial");
  assert.equal(state.command.active, true);
  assert.equal(state.command.installGeneration, 1);
  assert.equal(state.command.trialEndsAt, "2026-10-20T18:00:00.000Z");
  assert.deepEqual(state.command.itemHandles, ["ads_table_monthly"]);
  assert.equal(state.command.sourceHash.length, 64);
});

test("current billing cycle becomes active entitlement", async () => {
  const state = repositoryFor("active");
  await reconcileShopifyAppPricingEntitlement({
    installation,
    appId,
    observedAt,
    partnerApi: {
      activeSubscription: async () => ({
        data: {
          activeSubscription: {
            shop: {id: installation.shopId, myshopifyDomain: installation.shopDomain},
            billingPeriod: "EVERY_30_DAYS",
            cancelAtEndOfCycle: true,
            trialEndsAt: null,
            currentBillingCycle: {
              startTime: "2026-10-01T00:00:00.000Z",
              endTime: "2026-10-31T00:00:00.000Z",
            },
            items: [{handle: "ads_table_monthly", price: {active: true}}],
            pendingUpdate: {
              billingPeriod: "ANNUAL",
              items: [{handle: "ads_table_annual"}],
            },
          },
        },
      }),
    },
    repository: state.repository,
  });

  assert.equal(state.command.entitlementStatus, "active");
  assert.equal(state.command.cancelAtEndOfCycle, true);
  assert.deepEqual(state.command.pendingItemHandles, ["ads_table_annual"]);
});

test("null activeSubscription becomes subscription_required, never a free local trial", async () => {
  const state = repositoryFor("subscription_required");
  await reconcileShopifyAppPricingEntitlement({
    installation,
    appId,
    observedAt,
    partnerApi: {activeSubscription: async () => ({data: {activeSubscription: null}})},
    repository: state.repository,
  });

  assert.equal(state.command.active, false);
  assert.equal(state.command.entitlementStatus, "subscription_required");
  assert.equal(state.command.trialEndsAt, null);
  assert.deepEqual(state.command.itemHandles, []);
});

test("Partner API errors and shop mismatch fail closed before persistence", async () => {
  let writes = 0;
  const repository = {applySnapshot: async () => { writes += 1; }};

  await assert.rejects(
    reconcileShopifyAppPricingEntitlement({
      installation,
      appId,
      observedAt,
      partnerApi: {activeSubscription: async () => ({errors: [{message: "throttled"}]})},
      repository,
    }),
    /SHOPIFY_PARTNER_API_UNAVAILABLE/,
  );

  await assert.rejects(
    reconcileShopifyAppPricingEntitlement({
      installation,
      appId,
      observedAt,
      partnerApi: {
        activeSubscription: async () => ({
          data: {
            activeSubscription: {
              shop: {id: "gid://shopify/Shop/999", myshopifyDomain: installation.shopDomain},
              billingPeriod: "EVERY_30_DAYS",
              trialEndsAt: null,
              currentBillingCycle: {
                startTime: "2026-10-01T00:00:00.000Z",
                endTime: "2026-10-31T00:00:00.000Z",
              },
              items: [{handle: "ads_table_monthly", price: {active: true}}],
            },
          },
        }),
      },
      repository,
    }),
    /PARTNER_SUBSCRIPTION_SHOP_MISMATCH/,
  );

  assert.equal(writes, 0);
});

test("database boundary is forced-RLS and runtime function-only", () => {
  for (const table of [
    "billing.workspace_subscriptions",
    "billing.workspace_entitlements",
    "billing.trial_ledger",
  ]) {
    assert.match(migration, new RegExp("alter table " + table.replace(".", "\\.") + " enable row level security"));
    assert.match(migration, new RegExp("alter table " + table.replace(".", "\\.") + " force row level security"));
  }
  assert.match(migration, /grant execute on function billing\.apply_shopify_app_pricing_snapshot/);
  assert.match(migration, /grant execute on function billing\.resolve_workspace_entitlement/);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all)[^;]*to\s+adstable_runtime/);
  assert.doesNotMatch(migration, /grant[^;]*to\s+(?:anon|authenticated|service_role)/);
  assert.match(migration, /reporting_store_limit smallint not null default 1/);
  assert.match(migration, /candidate_detection_billed boolean not null default false/);
  assert.match(migration, /reporting_store_switch_billed boolean not null default false/);
  assert.match(migration, /eo02c_stale_entitlement_did_not_fail_closed/);
});

test("new-subscription code cannot use the legacy Billing API", () => {
  const implementation = read("app/lib/shopify/app-pricing-entitlement.server.js");
  assert.doesNotMatch(implementation, /appSubscriptionCreate|billing\.request/);
  assert.equal(contract.reconciliation.billing_webhook, false);
  assert.equal(contract.reporting_store_entitlement.included_active_reporting_stores, 1);
  assert.equal(contract.reporting_store_entitlement.candidate_detection_billed, false);
  assert.equal(contract.reporting_store_entitlement.active_reporting_store_switch_billed, false);
});


test("Partner API runtime environment is exact, server-only and fail-closed", async () => {
  assert.deepEqual(SHOPIFY_PARTNER_RUNTIME_ENV, {
    organizationId: "SHOPIFY_PARTNER_ORG_ID",
    accessToken: "SHOPIFY_PARTNER_API_ACCESS_TOKEN",
    appId: "SHOPIFY_APP_GID",
  });
  assert.throws(() => readShopifyPartnerRuntimeConfig({}), /SHOPIFY_PARTNER_ORG_ID_INVALID/);

  const environment = {
    SHOPIFY_PARTNER_ORG_ID: "5235756",
    SHOPIFY_PARTNER_API_ACCESS_TOKEN: "test-only-token",
    SHOPIFY_APP_GID: "gid://shopify/App/432251994113",
  };
  let observedRequest;
  const partnerApi = createShopifyPartnerApi({
    environment,
    fetchImpl: async (url, init) => {
      observedRequest = {url, init};
      return {
        ok: true,
        json: async () => ({data: {activeSubscription: null}}),
      };
    },
  });

  const variables = {appId: partnerApi.appId, shopId: installation.shopId};
  const payload = await partnerApi.activeSubscription({
    apiVersion: SHOPIFY_PARTNER_API_VERSION,
    query: ACTIVE_SUBSCRIPTION_QUERY,
    variables,
  });

  assert.equal(
    observedRequest.url,
    "https://partners.shopify.com/5235756/api/2026-07/graphql.json",
  );
  assert.equal(observedRequest.init.method, "POST");
  assert.equal(
    observedRequest.init.headers["X-Shopify-Access-Token"],
    environment.SHOPIFY_PARTNER_API_ACCESS_TOKEN,
  );
  assert.deepEqual(JSON.parse(observedRequest.init.body), {
    query: ACTIVE_SUBSCRIPTION_QUERY,
    variables,
  });
  assert.deepEqual(payload, {data: {activeSubscription: null}});
});

test("Partner API transport errors never become a missing subscription", async () => {
  const partnerApi = createShopifyPartnerApi({
    environment: {
      SHOPIFY_PARTNER_ORG_ID: "5235756",
      SHOPIFY_PARTNER_API_ACCESS_TOKEN: "test-only-token",
      SHOPIFY_APP_GID: "gid://shopify/App/432251994113",
    },
    fetchImpl: async () => ({
      ok: false,
      json: async () => ({errors: [{message: "throttled"}]}),
    }),
  });

  await assert.rejects(
    partnerApi.activeSubscription({
      apiVersion: SHOPIFY_PARTNER_API_VERSION,
      query: ACTIVE_SUBSCRIPTION_QUERY,
      variables: {appId: partnerApi.appId, shopId: installation.shopId},
    }),
    /SHOPIFY_PARTNER_API_HTTP_ERROR/,
  );
});
