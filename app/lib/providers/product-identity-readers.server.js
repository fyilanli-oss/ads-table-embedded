import {createMetaAppSecretProof, META_GRAPH_VERSION} from "./meta-graph.server.js";

export const MERCHANT_PRODUCT_READ_SCOPE = "https://www.googleapis.com/auth/content";
export const META_PRODUCT_IDENTITY_FIELDS = Object.freeze([
  "id", "retailer_id", "retailer_product_group_id", "product_catalog", "product_feed",
]);

export class ProductIdentityReadError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = "ProductIdentityReadError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, status) { throw new ProductIdentityReadError(code, status); }
function text(value, code) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 8192) fail(code);
  return value;
}
function numericId(value) {
  if (!/^[1-9][0-9]*$/.test(text(value, "IDENTITY_ID_INVALID"))) fail("IDENTITY_ID_INVALID");
  return value;
}
function scopeOf(authority, platform) {
  if (authority?.platform !== platform) fail("IDENTITY_PROVIDER_MISMATCH");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const key of ["workspace_id", "provider_connection_id"]) {
    if (!uuid.test(text(authority[key], "IDENTITY_SCOPE_INVALID"))) fail("IDENTITY_SCOPE_INVALID");
  }
  const installationId = numericId(authority.installation_id);
  if (BigInt(installationId) > 9223372036854775807n
    || !Number.isSafeInteger(authority.installation_generation) || authority.installation_generation < 1) {
    fail("IDENTITY_SCOPE_INVALID");
  }
  return Object.freeze({workspace_id: authority.workspace_id, installation_id: installationId,
    installation_generation: authority.installation_generation, provider_connection_id: authority.provider_connection_id,
    platform, platform_account_id: text(authority.platform_account_id, "IDENTITY_ACCOUNT_REQUIRED")});
}
function limits(maxPages, maxRows) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000
    || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000) fail("IDENTITY_LIMIT_INVALID");
}
function immutable(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
async function readJson(url, headers, fetchFn) {
  let response;
  try { response = await fetchFn(url.toString(), {method: "GET", headers, redirect: "error"}); }
  catch { fail("IDENTITY_TRANSPORT_FAILED"); }
  if (!response?.ok) fail("IDENTITY_HTTP_FAILED", response?.status ?? null);
  let body;
  try { body = await response.json(); } catch { fail("IDENTITY_JSON_INVALID"); }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.error) fail("IDENTITY_RESPONSE_INVALID");
  return body;
}
async function collect({scope, context, page, maxPages, maxRows}) {
  limits(maxPages, maxRows);
  const records = [], keys = new Set(), cursors = new Set();
  let cursor = null;
  for (let index = 0; index < maxPages; index++) {
    const result = await page(cursor);
    for (const record of result.records) {
      if (keys.has(record.key)) fail("IDENTITY_DUPLICATE_SOURCE_RECORD");
      keys.add(record.key);
      records.push(record);
      if (records.length > maxRows) fail("IDENTITY_ROW_LIMIT");
    }
    if (result.next === null) {
      return immutable({version: "1.0.0", scope, context, complete: true, pages: index + 1, records,
        shopify_mapping_state: "not_resolved"});
    }
    cursor = text(result.next, "IDENTITY_CURSOR_INVALID");
    if (cursors.has(cursor)) fail("IDENTITY_CURSOR_REPEATED");
    cursors.add(cursor);
  }
  fail("IDENTITY_PAGE_LIMIT");
}

// Server-only primitives. The caller must load fresh account/asset/token authority;
// accepting this DTO does not authenticate a token or authorize a live trigger.
export async function readMerchantProductIdentitySnapshot({authority, accessToken, fetchFn = fetch,
  maxPages = 100, maxRows = 10000}) {
  const scope = scopeOf(authority, "google_ads");
  const merchantId = numericId(authority.merchant_id);
  if (!Array.isArray(authority.granted_scopes) || !authority.granted_scopes.includes(MERCHANT_PRODUCT_READ_SCOPE)) {
    fail("MERCHANT_PRODUCT_SCOPE_MISSING");
  }
  const token = text(accessToken, "IDENTITY_TOKEN_REQUIRED");
  if (typeof fetchFn !== "function") fail("IDENTITY_FETCH_REQUIRED");
  return collect({scope, context: {merchant_id: merchantId}, maxPages, maxRows, page: async cursor => {
    const url = new URL(`https://merchantapi.googleapis.com/products/v1/accounts/${merchantId}/products`);
    url.searchParams.set("pageSize", "1000");
    if (cursor !== null) url.searchParams.set("pageToken", cursor);
    const body = await readJson(url, {accept: "application/json", authorization: `Bearer ${token}`}, fetchFn);
    // Google omits repeated fields on an empty response. Explicit null is invalid.
    const products = body.products === undefined ? [] : body.products;
    if (!Array.isArray(products)) fail("MERCHANT_PRODUCT_SCHEMA_INVALID");
    const records = products.map(product => {
      const name = text(product?.name, "MERCHANT_PRODUCT_NAME_REQUIRED");
      if (!name.startsWith(`accounts/${merchantId}/products/`) || name.endsWith("/")) fail("MERCHANT_PRODUCT_ACCOUNT_MISMATCH");
      const offerId = text(product.offerId, "MERCHANT_OFFER_ID_REQUIRED");
      const feedLabel = text(product.feedLabel, "MERCHANT_FEED_REQUIRED");
      const contentLanguage = text(product.contentLanguage, "MERCHANT_LANGUAGE_REQUIRED");
      const dataSource = text(product.dataSource, "MERCHANT_SOURCE_REQUIRED");
      if (!dataSource.startsWith(`accounts/${merchantId}/dataSources/`)) fail("MERCHANT_SOURCE_ACCOUNT_MISMATCH");
      if (product.legacyLocal !== undefined && typeof product.legacyLocal !== "boolean") fail("MERCHANT_PRODUCT_SCHEMA_INVALID");
      return {key: JSON.stringify([merchantId, contentLanguage, feedLabel, offerId, product.legacyLocal === true]), native_product_id: offerId,
        product_context: {merchant_id: merchantId, feed_label: feedLabel, content_language: contentLanguage, data_source: dataSource},
        source_record: structuredClone(product)};
    });
    return {records, next: body.nextPageToken === undefined ? null : text(body.nextPageToken, "IDENTITY_CURSOR_INVALID")};
  }});
}

function sourceMatch(records) {
  return Object.freeze({state: records.length === 1 ? "exact_source_record" : records.length === 0 ? "unresolved" : "ambiguous",
    record: records.length === 1 ? records[0] : null, provider_link_verified: false});
}

export function matchMerchantProductIdentity(snapshot, {merchantId, feedLabel, itemId}) {
  if (snapshot?.complete !== true || snapshot.scope?.platform !== "google_ads" || !Array.isArray(snapshot.records)) {
    fail("IDENTITY_COMPLETE_SNAPSHOT_REQUIRED");
  }
  if (snapshot.context?.merchant_id !== numericId(merchantId)) fail("MERCHANT_PRODUCT_ACCOUNT_MISMATCH");
  text(feedLabel, "MERCHANT_FEED_REQUIRED");
  text(itemId, "MERCHANT_OFFER_ID_REQUIRED");
  // Language/local dimensions may be absent from Ads. Never pick the first match.
  return sourceMatch(snapshot.records.filter(row => row.native_product_id === itemId
    && row.product_context.feed_label === feedLabel));
}

export function matchMetaCatalogProductIdentity(snapshot, {catalogId, productId, namespace}) {
  if (snapshot?.complete !== true || snapshot.scope?.platform !== "meta" || !Array.isArray(snapshot.records)) {
    fail("IDENTITY_COMPLETE_SNAPSHOT_REQUIRED");
  }
  if (snapshot.context?.catalog_id !== numericId(catalogId)) fail("META_PRODUCT_CATALOG_MISMATCH");
  if (!["catalog_product_id", "retailer_id"].includes(namespace)) fail("META_PRODUCT_NAMESPACE_REQUIRED");
  text(productId, "META_PRODUCT_ID_REQUIRED");
  return sourceMatch(snapshot.records.filter(row => row[namespace] === productId));
}

export async function readMetaCatalogIdentitySnapshot({authority, accessToken, appSecret, fetchFn = fetch,
  maxPages = 100, maxRows = 10000}) {
  const scope = scopeOf(authority, "meta");
  const catalogId = numericId(authority.catalog_id);
  const token = text(accessToken, "IDENTITY_TOKEN_REQUIRED");
  const proof = createMetaAppSecretProof({accessToken: token, appSecret});
  if (typeof fetchFn !== "function") fail("IDENTITY_FETCH_REQUIRED");
  return collect({scope, context: {catalog_id: catalogId, graph_version: META_GRAPH_VERSION}, maxPages, maxRows,
    page: async cursor => {
      const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${catalogId}/products`);
      url.searchParams.set("fields", META_PRODUCT_IDENTITY_FIELDS.join(","));
      url.searchParams.set("limit", "100");
      url.searchParams.set("appsecret_proof", proof);
      if (cursor !== null) url.searchParams.set("after", cursor);
      const body = await readJson(url, {accept: "application/json", authorization: `Bearer ${token}`}, fetchFn);
      if (!Array.isArray(body.data)) fail("META_CATALOG_SCHEMA_INVALID");
      const records = body.data.map(product => {
        const id = numericId(product?.id);
        const retailerId = text(product.retailer_id, "META_RETAILER_ID_REQUIRED");
        if (numericId(product?.product_catalog?.id) !== catalogId) fail("META_PRODUCT_CATALOG_MISMATCH");
        return {key: id, catalog_product_id: id, retailer_id: retailerId,
          product_context: {catalog_id: catalogId, ...(product.product_feed == null ? {}
            : {product_feed_id: numericId(product.product_feed.id)})}, source_record: structuredClone(product)};
      });
      // Never follow provider paging.next URLs (which may contain credentials).
      // A cursor without next can be the last page; next without cursor is invalid.
      const next = body.paging?.next === undefined ? null
        : text(body.paging?.cursors?.after, "META_CATALOG_CURSOR_REQUIRED");
      return {records, next};
    }});
}
