import {GOOGLE_MERCHANT_OAUTH_SCOPE} from "../oauth/oauth-permission-profile.server.js";

export class MerchantIdentityReadError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = "MerchantIdentityReadError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, status) { throw new MerchantIdentityReadError(code, status); }
function text(value, code = "MERCHANT_IDENTITY_FIELD_INVALID") {
  if (typeof value !== "string" || !value || value !== value.trim()
    || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) fail(code);
  return value;
}
function numeric(value) {
  if (!/^[1-9][0-9]*$/.test(text(value))) fail("MERCHANT_IDENTITY_ID_INVALID");
  return value;
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function merchantIdentityScopeContext(authority) {
  if (authority?.platform !== "google_ads") fail("MERCHANT_IDENTITY_PROVIDER_INVALID");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const key of ["workspace_id", "provider_connection_id"]) {
    if (!uuid.test(text(authority[key]))) fail("MERCHANT_IDENTITY_SCOPE_INVALID");
  }
  const installationId = numeric(authority.installation_id);
  if (BigInt(installationId) > 9223372036854775807n
    || !Number.isSafeInteger(authority.installation_generation) || authority.installation_generation < 1) {
    fail("MERCHANT_IDENTITY_SCOPE_INVALID");
  }
  return {workspace_id: authority.workspace_id, installation_id: installationId,
    installation_generation: authority.installation_generation,
    provider_connection_id: authority.provider_connection_id, platform: "google_ads",
    platform_account_id: text(authority.platform_account_id)};
}

export function merchantIdentityReadScope(authority) {
  const scope = merchantIdentityScopeContext(authority);
  if (!Array.isArray(authority.granted_scopes)
    || !authority.granted_scopes.includes(GOOGLE_MERCHANT_OAUTH_SCOPE)) fail("MERCHANT_IDENTITY_SCOPE_MISSING");
  return scope;
}

// Native source observation only: no canonical installation scope or Shopify ID is emitted.
// The composing server binds the credential and Ads/Merchant relationship separately.
export async function readMerchantProductSourceSnapshot({merchantId, accessToken,
  fetchFn = fetch, maxPages = 100, maxRows = 10000, signal} = {}) {
  numeric(merchantId);
  text(accessToken, "MERCHANT_IDENTITY_TOKEN_REQUIRED");
  if (typeof fetchFn !== "function" || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000
    || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000) fail("MERCHANT_IDENTITY_LIMIT_INVALID");
  const records = [], cursors = new Set(), keys = new Set();
  let pageToken = "", pages = 0;
  for (;;) {
    if (signal?.aborted) fail("MERCHANT_IDENTITY_ABORTED");
    if (pages >= maxPages) fail("MERCHANT_IDENTITY_PAGE_LIMIT");
    const endpoint = new URL(`https://merchantapi.googleapis.com/products/v1/accounts/${merchantId}/products`);
    endpoint.searchParams.set("pageSize", "1000");
    if (pageToken) endpoint.searchParams.set("pageToken", pageToken);
    let response;
    try {
      response = await fetchFn(endpoint.toString(), {method: "GET", redirect: "error",
        headers: {Authorization: `Bearer ${accessToken}`}, signal});
    } catch { fail(signal?.aborted ? "MERCHANT_IDENTITY_ABORTED" : "MERCHANT_IDENTITY_TRANSPORT_FAILED"); }
    if (!response?.ok) fail("MERCHANT_IDENTITY_HTTP_FAILED", Number.isInteger(response?.status) ? response.status : null);
    let body;
    try { body = await response.json(); } catch { fail("MERCHANT_IDENTITY_JSON_INVALID"); }
    if (signal?.aborted) fail("MERCHANT_IDENTITY_ABORTED");
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "error")) {
      fail("MERCHANT_IDENTITY_RESPONSE_INVALID");
    }
    const products = Object.hasOwn(body, "products") ? body.products : [];
    if (!Array.isArray(products)) fail("MERCHANT_IDENTITY_RESPONSE_INVALID");
    pages += 1;
    for (const product of products) {
      if (!product || typeof product !== "object" || Array.isArray(product)) fail("MERCHANT_IDENTITY_PRODUCT_INVALID");
      const offerId = text(product.offerId), feedLabel = text(product.feedLabel), language = text(product.contentLanguage);
      if (Object.hasOwn(product, "legacyLocal") && typeof product.legacyLocal !== "boolean") fail("MERCHANT_IDENTITY_PRODUCT_INVALID");
      const local = product.legacyLocal === true;
      if (text(product.name) !== `accounts/${merchantId}/products/${local ? "local~" : ""}${language}~${feedLabel}~${offerId}`
        || !new RegExp(`^accounts/${merchantId}/dataSources/[1-9][0-9]*$`).test(text(product.dataSource))) {
        fail("MERCHANT_IDENTITY_SOURCE_MISMATCH");
      }
      const key = JSON.stringify([merchantId, language, feedLabel, offerId, local]);
      if (keys.has(key)) fail("MERCHANT_IDENTITY_DUPLICATE_PRODUCT");
      keys.add(key);
      if (records.length >= maxRows) fail("MERCHANT_IDENTITY_ROW_LIMIT");
      records.push({key, native_product_id: offerId,
        product_context: {merchant_id: merchantId, feed_label: feedLabel, content_language: language,
          data_source: product.dataSource, legacy_local: local}, source_record: structuredClone(product)});
    }
    if (!Object.hasOwn(body, "nextPageToken") || body.nextPageToken === "") break;
    pageToken = text(body.nextPageToken, "MERCHANT_IDENTITY_CURSOR_INVALID");
    if (cursors.has(pageToken)) fail("MERCHANT_IDENTITY_CURSOR_REPEATED");
    cursors.add(pageToken);
  }
  return freeze({version: "1.0.0", context: {merchant_id: merchantId}, complete: true,
    pages, records, shopify_mapping_state: "not_resolved", authorizes_activation: false,
    canonical_scope_ready: false, provider_link_verified: false, persistable: false});
}

// Existing canonical-scope entry point still validates PK and grant BEFORE native requests.
export async function readMerchantProductIdentitySnapshot({authority, accessToken,
  fetchFn = fetch, maxPages = 100, maxRows = 10000, signal} = {}) {
  const scope = merchantIdentityReadScope(authority), merchantId = numeric(authority.merchant_id);
  const source = await readMerchantProductSourceSnapshot({merchantId, accessToken, fetchFn, maxPages, maxRows, signal});
  return freeze({version: "1.0.0", scope, context: source.context, complete: true,
    pages: source.pages, records: source.records, shopify_mapping_state: "not_resolved", authorizes_activation: false});
}

// A unique source record still requires the later trusted source rule and Shopify verification.
export function matchMerchantProductIdentity(snapshot, {merchantId, feedLabel, itemId,
  contentLanguage, dataSource, legacyLocal} = {}) {
  numeric(merchantId); text(feedLabel); text(itemId);
  if (contentLanguage !== undefined) text(contentLanguage);
  if (dataSource !== undefined) text(dataSource);
  if (legacyLocal !== undefined && typeof legacyLocal !== "boolean") fail("MERCHANT_IDENTITY_LOOKUP_INVALID");
  if (snapshot?.complete !== true || snapshot.scope?.platform !== "google_ads"
    || snapshot.context?.merchant_id !== merchantId || !Array.isArray(snapshot.records)) fail("MERCHANT_IDENTITY_LOOKUP_CONTEXT_INVALID");
  const matches = snapshot.records.filter(record => record.native_product_id === itemId
    && record.product_context.merchant_id === merchantId && record.product_context.feed_label === feedLabel
    && (contentLanguage === undefined || record.product_context.content_language === contentLanguage)
    && (dataSource === undefined || record.product_context.data_source === dataSource)
    && (legacyLocal === undefined || record.product_context.legacy_local === legacyLocal));
  return freeze({state: matches.length === 1 ? "exact_source_record" : matches.length ? "ambiguous" : "unresolved",
    record: matches.length === 1 ? matches[0] : null, provider_link_verified: false,
    shopify_mapping_state: "not_resolved", authorizes_activation: false});
}
