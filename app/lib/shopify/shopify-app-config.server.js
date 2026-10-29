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
