import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import {createRuntimePostgresClient} from "../database/runtime-postgres.server.js";
import {createTokenVault} from "../oauth/token-vault.server.js";
import {createEncryptedShopifySessionStorage} from "./encrypted-session-storage.server.js";
import {createShopifyProgressivePermissions} from "./progressive-permissions.server.js";

import {readShopifyAppRuntimeConfig} from "./shopify-app-config.server.js";
export {readShopifyAppRuntimeConfig};
const POLARIS_URL = "https://cdn.shopify.com/shopifycloud/polaris-2.0.js";

export async function createShopifyAppRuntime({
  environment = process.env,
  database,
  sessionStorage,
  permissionRequestsEnabled = false,
  optionalScopesReleased = false,
} = {}) {
  const config = readShopifyAppRuntimeConfig(environment);
  const runtimeDatabase = database ?? createRuntimePostgresClient({environment});
  const runtimeSessionStorage = sessionStorage ?? createEncryptedShopifySessionStorage({
    database: runtimeDatabase,
    environment,
  });
  const tokenVault = createTokenVault({
    database: runtimeDatabase,
    environment,
  });
  const tokenVaultStartup = await tokenVault.assertRuntimeReady();

  const shopify = shopifyApp({
    apiKey: config.apiKey,
    apiSecretKey: config.apiSecretKey,
    apiVersion: ApiVersion.October26,
    scopes: config.scopes,
    appUrl: config.appUrl,
    polarisUrl: POLARIS_URL,
    authPathPrefix: "/auth",
    sessionStorage: runtimeSessionStorage,
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
  });

  return Object.freeze({
    shopify,
    database: runtimeDatabase,
    tokenVault,
    tokenVaultStartup,
    permissionSetup: createShopifyProgressivePermissions({database: runtimeDatabase, apiKey: config.apiKey,
      requiredScopes: config.scopes, requestsEnabled: permissionRequestsEnabled, optionalScopesReleased}),
    publicConfig: Object.freeze({
      apiKey: config.apiKey,
      polarisUrl: POLARIS_URL,
    }),
  });
}
