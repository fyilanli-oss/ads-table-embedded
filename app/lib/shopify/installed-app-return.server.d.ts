export const SHOPIFY_APP_HANDLE: string;
export function installedShopifySettingsUrl(
  shopDomain: string,
  input?: {
    googleStatus?: "pending" | "cancelled" | "error" | null;
    googleError?: string | null;
  },
): string;
