import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import {createRuntimePostgresClient} from "../database/runtime-postgres.server.js";
import {createTokenVault} from "../oauth/token-vault.server.js";
import {createEncryptedShopifySessionStorage} from "./encrypted-session-storage.server.js";

const API_KEY_PATTERN = /^[a-f0-9]{32}$/;
const APP_URL = "https://embedded.adstable.app";
const SCOPE_PATTERN = /^(?:[a-z][a-z0-9_]*)(?:,[a-z][a-z0-9_]*)*$/;

function invalidConfiguration(field) {
  return new Error(`SHOPIFY_APP_RUNTIME_${field}_INVALID`);
}

export function readShopifyAppRuntimeConfig(environment = process.env) {
  const apiKey = environment?.SHOPIFY_API_KEY;
  const apiSecretKey = environment?.SHOPIFY_API_SECRET;
  const appUrl = environment?.SHOPIFY_APP_URL;
  const rawScopes = environment?.SCOPES ?? "";

  if (typeof apiKey !== "string" || !API_KEY_PATTERN.test(apiKey)) {
    throw invalidConfiguration("API_KEY");
  }
  if (typeof apiSecretKey !== "string" || apiSecretKey.length < 32) {
    throw invalidConfiguration("API_SECRET");
  }
  if (appUrl !== APP_URL) {
    throw invalidConfiguration("URL");
  }
  if (rawScopes !== "" && !SCOPE_PATTERN.test(rawScopes)) {
    throw invalidConfiguration("SCOPES");
  }

  return Object.freeze({
    apiKey,
    apiSecretKey,
    appUrl,
    scopes: rawScopes === "" ? [] : rawScopes.split(","),
  });
}

export async function createShopifyAppRuntime({
  environment = process.env,
  database,
  sessionStorage,
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
    publicConfig: Object.freeze({
      apiKey: config.apiKey,
      polarisUrl: "https://cdn.shopify.com/shopifycloud/polaris-2.0-rc.js",
    }),
  });
}
