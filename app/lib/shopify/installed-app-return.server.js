import {normalizeShopDomain} from "./installation-authority.server.js";

export const SHOPIFY_APP_HANDLE = "adstable-1";

const RETURN_KEYS = new Set([
  "google_setup",
  "google_status",
  "google_error",
]);

function safeValue(value) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 128
    || !/^[A-Za-z0-9_.:-]+$/.test(value)
  ) {
    throw new Error("SHOPIFY_APP_RETURN_PARAMETER_INVALID");
  }
  return value;
}

export function installedShopifySettingsUrl(shopDomain, parameters = {}) {
  const canonical = normalizeShopDomain(shopDomain);
  const storeHandle = canonical.slice(0, -".myshopify.com".length);
  const url = new URL(
    "https://admin.shopify.com/store/"
      + storeHandle
      + "/apps/"
      + SHOPIFY_APP_HANDLE
      + "/settings",
  );
  for (const [key, value] of Object.entries(parameters)) {
    if (!RETURN_KEYS.has(key)) {
      throw new Error("SHOPIFY_APP_RETURN_PARAMETER_FORBIDDEN");
    }
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, safeValue(value));
    }
  }
  return url.toString();
}
