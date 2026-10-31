// Server-owned release configuration, not merchant grant or app-review evidence.
// Adding these keys to source does not change the deployed environment.
export function readPermissionSetupRelease(environment = process.env) {
  const google = environment.ADSTABLE_GOOGLE_IDENTITY_OAUTH_ENABLED === "true";
  const meta = environment.ADSTABLE_META_IDENTITY_OAUTH_ENABLED === "true";
  const shopifyRequests = environment.ADSTABLE_SHOPIFY_PERMISSION_REQUESTS_ENABLED === "true";
  const optionalScopesReleased = environment.ADSTABLE_SHOPIFY_OPTIONAL_SCOPES_RELEASED === "true";
  const shopify = shopifyRequests && optionalScopesReleased;
  const shopifyReason = !shopifyRequests
    ? "Shopify permission requests are not enabled for this deployment."
    : "The Shopify optional-scope release has not been confirmed for this deployment.";
  return Object.freeze({
    shopifyRequestsEnabled: shopifyRequests,
    optionalScopesReleased,
    availability: Object.freeze({google_ads: google, meta, shopify_products: shopify, shopify_orders: shopify, klaviyo: true}),
    unavailableReasons: Object.freeze({
      google_ads: google ? undefined : "Google Ads and Merchant Center authorization is not enabled for this deployment.",
      meta: meta ? undefined : "Meta ads and catalog authorization is not enabled for this deployment.",
      shopify_products: shopify ? undefined : shopifyReason,
      shopify_orders: shopify ? undefined : shopifyReason,
    }),
  });
}
