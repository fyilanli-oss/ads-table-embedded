// Exact owner-approved copy; no scopes, tokens or provider authority in the browser.
export const PERMISSION_EXPLANATIONS = Object.freeze(Object.fromEntries(
  Object.entries({
  "shopify_products": {
    "heading": "Connect Shopify products",
    "paragraphs": [
      "Allow AdsTable to read your products and variants to match product reporting to your Shopify catalog.",
      "Product access is required to finish product setup. Order access is optional and will be requested separately when you choose an order-based feature."
    ]
  },
  "shopify_orders": {
    "heading": "Connect Shopify orders",
    "paragraphs": [
      "Allow AdsTable to read recent orders and purchased products to compare Shopify sales with marketing attribution.",
      "Order access is optional. Cancelling does not change your existing product connection.",
      "Order access helps investigate attribution overlap; it does not, by itself, confirm duplicate attribution for individual orders."
    ]
  },
  "google_ads": {
    "heading": "Connect Google Ads and Merchant Center",
    "paragraphs": [
      "Allow AdsTable to read your advertising data and catalog to match product reporting.",
      "Both Google Ads and Merchant Center access are needed to finish this connection. You need an accessible Merchant Center account, including for Search-only setups.",
      "Google permissions may also allow changes. AdsTable uses this connection to read data and does not edit your campaigns or catalog."
    ]
  },
  "meta": {
    "heading": "Connect Meta ads and catalog",
    "paragraphs": [
      "Allow AdsTable to read advertising and catalog data for reporting and product matching.",
      "Both ad account and catalog access are needed to finish setup. You may also see business and Page permissions.",
      "Some business and catalog permissions also allow changes. AdsTable uses this connection for reporting and product matching; it does not edit those assets."
    ]
  },
  "klaviyo": {
    "heading": "Connect Klaviyo",
    "paragraphs": [
      "Allow AdsTable to read account details and campaign, flow, metric and event data for reporting.",
      "After connecting, add your estimated monthly Klaviyo cost to finish setup. Enter 0 if you have no monthly cost.",
      "The cost is entered separately in AdsTable. If you leave it incomplete, use Resume setup to finish it later."
    ]
  }
}).map(([id, copy]) => [id, Object.freeze({
    ...copy, paragraphs: Object.freeze(copy.paragraphs),
  })]),
));

export const PERMISSION_CANCEL_COPY = "Cancel closes this explanation without starting a permission request.";
