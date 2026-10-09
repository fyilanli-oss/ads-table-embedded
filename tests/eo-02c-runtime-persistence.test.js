import test from "node:test";
import assert from "node:assert/strict";
import {
  ADSTABLE_RUNTIME_DATABASE_ENV,
  createRuntimePostgresClient,
  readRuntimeDatabaseConfig,
} from "../app/lib/database/runtime-postgres.server.js";
import {
  createShopifyRuntimeRepositories,
} from "../app/lib/database/shopify-runtime-repositories.server.js";
import {
  createVerifiedShopifyEntitlementRuntime,
} from "../app/lib/shopify/entitlement-runtime.server.js";

const connectionString =
  "postgres://adstable_runtime.podpwkrpmjiksskxhwsu:" +
  "test-only-password-long-enough@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" +
  "?sslmode=require";

test("runtime database config is exact, server-only and transaction-pooled", () => {
  assert.equal(ADSTABLE_RUNTIME_DATABASE_ENV, "ADSTABLE_RUNTIME_DATABASE_URL");
  const config = readRuntimeDatabaseConfig({
    ADSTABLE_RUNTIME_DATABASE_URL: connectionString,
  });
  assert.equal(config.connectionString, connectionString.replace("?sslmode=require", ""));
  assert.equal(config.projectRef, "podpwkrpmjiksskxhwsu");
  assert.equal(config.role, "adstable_runtime");
  assert.equal(config.connectionMode, "transaction_pooler");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.match(config.ssl.ca, /^-----BEGIN CERTIFICATE-----/);
  assert.match(config.ssl.ca, /-----END CERTIFICATE-----\n$/);

  for (const invalid of [
    connectionString.replace("adstable_runtime", "postgres"),
    connectionString.replace("podpwkrpmjiksskxhwsu", "otherprojectref00000"),
    connectionString.replace("aws-0-eu-central-1", "aws-0-us-east-1"),
    connectionString.replace(":6543", ":5432"),
    connectionString.replace("?sslmode=require", ""),
  ]) {
    assert.throws(
      () => readRuntimeDatabaseConfig({ADSTABLE_RUNTIME_DATABASE_URL: invalid}),
      /ADSTABLE_RUNTIME_DATABASE_URL_INVALID/,
    );
  }
});

test("database client creates one bounded serverless pool without logging credentials", async () => {
  let observedConfig;
  let observedQuery;
  const client = createRuntimePostgresClient({
    environment: {ADSTABLE_RUNTIME_DATABASE_URL: connectionString},
    poolFactory: (config) => {
      observedConfig = config;
      return {
        query: async (request) => {
          observedQuery = request;
          return {rows: [{ok: true}]};
        },
        end: async () => {},
      };
    },
  });

  assert.equal(observedConfig.max, 1);
  assert.equal(observedConfig.connectionTimeoutMillis, 5_000);
  assert.equal(observedConfig.application_name, "adstable-runtime");
  assert.equal(observedConfig.connectionString.includes("sslmode="), false);
  assert.equal(observedConfig.ssl.rejectUnauthorized, true);
  assert.equal("password" in observedConfig, false);
  assert.deepEqual(await client.query("select $1::integer as value", [1]), {rows: [{ok: true}]});
  assert.deepEqual(observedQuery, {text: "select $1::integer as value", values: [1]});
  await client.close();
});

test("repositories call only the function boundary and map exact results", async () => {
  const calls = [];
  const repositories = createShopifyRuntimeRepositories({
    query: async (text, values) => {
      calls.push({text, values});
      if (text.includes("shopify.bootstrap_installation")) {
        return {
          rows: [{
            workspace_id: "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9a",
            install_generation: "1",
            installation_status: "active",
            disposition: "created",
          }],
        };
      }
      return {
        rows: [{
          workspace_id: "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9a",
          shop_id: "gid://shopify/Shop/123456789",
          shop_domain: "example-store.myshopify.com",
          install_generation: "1",
          entitlement_status: "active",
          source_observed_at: new Date("2026-10-08T10:00:00.000Z"),
        }],
      };
    },
  });

  const installation = await repositories.installation.bootstrap({
    shopId: "gid://shopify/Shop/123456789",
    shopDomain: "example-store.myshopify.com",
    verifiedAt: "2026-10-08T10:00:00.000Z",
  });
  assert.equal(installation.installGeneration, 1);
  assert.equal(installation.status, "active");

  const entitlement = await repositories.entitlement.applySnapshot({
    shopId: "gid://shopify/Shop/123456789",
    shopDomain: "example-store.myshopify.com",
    installGeneration: 1,
    active: true,
    entitlementStatus: "active",
    billingPeriod: "EVERY_30_DAYS",
    cancelAtEndOfCycle: false,
    trialEndsAt: null,
    currentCycleStart: "2026-10-08T08:45:05.000Z",
    currentCycleEnd: "2026-11-07T08:45:05.000Z",
    itemHandles: ["shopify-test"],
    pendingItemHandles: [],
    observedAt: "2026-10-08T10:00:00.000Z",
    sourceHash: "a".repeat(64),
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /shopify\.bootstrap_installation/);
  assert.match(calls[1].text, /billing\.apply_shopify_app_pricing_snapshot/);
  assert.doesNotMatch(calls.map((call) => call.text).join("\n"), /\b(?:insert|update|delete)\b/i);
  assert.equal(entitlement.entitlementStatus, "active");
  assert.equal(entitlement.sourceObservedAt, "2026-10-08T10:00:00.000Z");
});

test("internal caller requires verified Shopify identities before Partner API or persistence", async () => {
  const observedAt = new Date("2026-10-08T10:00:00.000Z");
  const calls = [];
  const database = {
    query: async (text, values) => {
      calls.push({text, values});
      if (text.includes("shopify.bootstrap_installation")) {
        return {
          rows: [{
            workspace_id: "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9a",
            install_generation: "1",
            installation_status: "active",
            disposition: "existing",
          }],
        };
      }
      return {
        rows: [{
          workspace_id: "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9a",
          shop_id: "gid://shopify/Shop/123456789",
          shop_domain: "example-store.myshopify.com",
          install_generation: "1",
          entitlement_status: "active",
          source_observed_at: observedAt,
        }],
      };
    },
  };
  let providerCalls = 0;
  const runtime = createVerifiedShopifyEntitlementRuntime({
    database,
    partnerApi: {
      appId: "gid://shopify/App/432251994113",
      activeSubscription: async () => {
        providerCalls += 1;
        return {
          data: {
            activeSubscription: {
              shop: {
                id: "gid://shopify/Shop/123456789",
                myshopifyDomain: "example-store.myshopify.com",
              },
              billingPeriod: "EVERY_30_DAYS",
              cancelAtEndOfCycle: false,
              trialEndsAt: null,
              currentBillingCycle: {
                startTime: "2026-10-08T08:45:05.000Z",
                endTime: "2026-11-07T08:45:05.000Z",
              },
              items: [{handle: "shopify-test", price: {active: true}}],
              pendingUpdate: null,
            },
          },
        };
      },
    },
  });

  await assert.rejects(
    runtime.reconcile({
      session: {authority: "unverified", shopDomain: "example-store.myshopify.com"},
      shop: {
        authority: "shopify_admin_verified",
        shopId: "gid://shopify/Shop/123456789",
        myshopifyDomain: "example-store.myshopify.com",
      },
      observedAt,
    }),
    /VERIFIED_SHOPIFY_ID_TOKEN_REQUIRED/,
  );
  assert.equal(providerCalls, 0);
  assert.equal(calls.length, 0);

  const result = await runtime.reconcile({
    session: {
      authority: "shopify_id_token_verified",
      shopDomain: "example-store.myshopify.com",
    },
    shop: {
      authority: "shopify_admin_verified",
      shopId: "gid://shopify/Shop/123456789",
      myshopifyDomain: "example-store.myshopify.com",
    },
    observedAt,
  });

  assert.equal(providerCalls, 1);
  assert.equal(calls.length, 2);
  assert.equal(result.entitlementStatus, "active");
});
