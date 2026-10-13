import {normalizeShopDomain} from "./installation-authority.server.js";

export const SHOPIFY_APP_HANDLE = "adstable-1";

const STATUS = new Set(["pending", "cancelled", "error"]);

export function installedShopifySettingsUrl(
  shopDomain,
  {
    googleStatus = null,
    googleError = null,
    metaStatus = null,
    metaError = null,
  } = {},
) {
  const canonical = normalizeShopDomain(shopDomain);
  const storeHandle = canonical.slice(0, -".myshopify.com".length);
  const url = new URL(
    "https://admin.shopify.com/store/"
      + storeHandle
      + "/apps/"
      + SHOPIFY_APP_HANDLE
      + "/settings",
  );
  if (googleStatus !== null) {
    if (!STATUS.has(googleStatus)) {
      throw new Error("GOOGLE_RETURN_STATUS_INVALID");
    }
    url.searchParams.set("google_status", googleStatus);
  }
  if (googleError !== null) {
    if (
      typeof googleError !== "string"
      || !/^[A-Z0-9_]{1,80}$/.test(googleError)
    ) throw new Error("GOOGLE_RETURN_ERROR_INVALID");
    url.searchParams.set("google_error", googleError);
  }
  if (metaStatus !== null) {
    if (!STATUS.has(metaStatus)) {
      throw new Error("META_RETURN_STATUS_INVALID");
    }
    url.searchParams.set("meta_status", metaStatus);
  }
  if (metaError !== null) {
    if (
      typeof metaError !== "string"
      || !/^[A-Z0-9_]{1,80}$/.test(metaError)
    ) throw new Error("META_RETURN_ERROR_INVALID");
    url.searchParams.set("meta_error", metaError);
  }
  return url.toString();
}
