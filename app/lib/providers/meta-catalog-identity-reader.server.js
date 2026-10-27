import {createMetaAppSecretProof, META_GRAPH_VERSION} from "./meta-graph.server.js";
import {validateIdentityOAuthGrantedScopes} from "../oauth/oauth-permission-profile.server.js";

export const META_CATALOG_IDENTITY_FIELDS = Object.freeze([
  "id", "retailer_id", "retailer_product_group_id", "product_catalog", "product_feed",
]);
export class MetaCatalogIdentityReadError extends Error {
  constructor(code, status = null) { super(code); this.name = "MetaCatalogIdentityReadError"; this.code = code; this.status = status; }
}
function fail(code, status) { throw new MetaCatalogIdentityReadError(code, status); }
function text(value, code = "META_CATALOG_IDENTITY_FIELD_INVALID") {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 8192
    || /[\u0000-\u001f\u007f]/.test(value)) fail(code);
  return value;
}
function numeric(value) {
  if (!/^[1-9][0-9]{0,29}$/.test(text(value))) fail("META_CATALOG_IDENTITY_ID_INVALID");
  return value;
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function metaCatalogIdentityScopeContext(authority) {
  if (authority?.platform !== "meta") fail("META_CATALOG_IDENTITY_PROVIDER_INVALID");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (![authority.workspace_id, authority.provider_connection_id].every(value => typeof value === "string" && uuid.test(value))
    || !Number.isSafeInteger(authority.installation_generation) || authority.installation_generation < 1) fail("META_CATALOG_IDENTITY_SCOPE_INVALID");
  const installationId = numeric(authority.installation_id);
  if (BigInt(installationId) > 9223372036854775807n) fail("META_CATALOG_IDENTITY_SCOPE_INVALID");
  return {workspace_id: authority.workspace_id, installation_id: installationId,
    installation_generation: authority.installation_generation, provider_connection_id: authority.provider_connection_id,
    platform: "meta", platform_account_id: text(authority.platform_account_id)};
}
function nextCursor(body) {
  if (!Object.hasOwn(body, "paging")) return null;
  const paging = body.paging;
  if (!paging || typeof paging !== "object" || Array.isArray(paging)) fail("META_CATALOG_IDENTITY_PAGING_INVALID");
  if (!Object.hasOwn(paging, "next")) return null;
  text(paging.next, "META_CATALOG_IDENTITY_PAGING_INVALID");
  // Use the continuation marker only; never request the supplied paging.next address.
  return text(paging.cursors?.after, "META_CATALOG_IDENTITY_CURSOR_REQUIRED");
}

// Native source only; declared grants alone never prove token freshness or an Ad/catalog link.
export async function readMetaCatalogSourceSnapshot({catalogId, grantedScopes, accessToken, appSecret,
  fetchFn = fetch, maxPages = 100, maxRows = 10000, signal} = {}) {
  numeric(catalogId);
  validateIdentityOAuthGrantedScopes("meta", grantedScopes);
  const token = text(accessToken, "META_CATALOG_IDENTITY_TOKEN_REQUIRED");
  if (/\s/.test(token)) fail("META_CATALOG_IDENTITY_TOKEN_REQUIRED");
  const proof = createMetaAppSecretProof({accessToken: token, appSecret});
  if (typeof fetchFn !== "function" || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000
    || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000) fail("META_CATALOG_IDENTITY_LIMIT_INVALID");
  const records = [], keys = new Set(), cursors = new Set();
  let pages = 0, after = null;
  for (;;) {
    if (signal?.aborted) fail("META_CATALOG_IDENTITY_ABORTED");
    if (pages >= maxPages) fail("META_CATALOG_IDENTITY_PAGE_LIMIT");
    const endpoint = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${catalogId}/products`);
    endpoint.searchParams.set("fields", META_CATALOG_IDENTITY_FIELDS.join(","));
    endpoint.searchParams.set("limit", "100"); endpoint.searchParams.set("appsecret_proof", proof);
    if (after !== null) endpoint.searchParams.set("after", after);
    let response, body;
    try { response = await fetchFn(endpoint.toString(), {method: "GET", redirect: "error", signal,
      headers: {authorization: `Bearer ${token}`, accept: "application/json"}}); }
    catch { fail(signal?.aborted ? "META_CATALOG_IDENTITY_ABORTED" : "META_CATALOG_IDENTITY_TRANSPORT_FAILED"); }
    if (!response?.ok) fail("META_CATALOG_IDENTITY_HTTP_FAILED", Number.isInteger(response?.status) ? response.status : null);
    try { body = await response.json(); }
    catch { fail(signal?.aborted ? "META_CATALOG_IDENTITY_ABORTED" : "META_CATALOG_IDENTITY_JSON_INVALID"); }
    if (signal?.aborted) fail("META_CATALOG_IDENTITY_ABORTED");
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.hasOwn(body, "error") || !Array.isArray(body.data)) fail("META_CATALOG_IDENTITY_RESPONSE_INVALID");
    pages++;
    for (const product of body.data) {
      if (!product || typeof product !== "object" || Array.isArray(product)) fail("META_CATALOG_IDENTITY_PRODUCT_INVALID");
      const id = numeric(product.id), retailerId = text(product.retailer_id);
      if (numeric(product.product_catalog?.id) !== catalogId) fail("META_CATALOG_IDENTITY_CATALOG_MISMATCH");
      if (Object.hasOwn(product, "retailer_product_group_id") && product.retailer_product_group_id !== null
        && product.retailer_product_group_id !== "") text(product.retailer_product_group_id);
      const productContext = {catalog_id: catalogId};
      if (Object.hasOwn(product, "product_feed") && product.product_feed !== null) {
        productContext.product_feed_id = numeric(product.product_feed?.id);
      }
      const key = JSON.stringify([catalogId, id]);
      if (keys.has(key)) fail("META_CATALOG_IDENTITY_DUPLICATE_PRODUCT");
      keys.add(key);
      if (records.length >= maxRows) fail("META_CATALOG_IDENTITY_ROW_LIMIT");
      records.push({key, catalog_product_id: id, retailer_id: retailerId,
        product_context: productContext, source_record: structuredClone(product)});
    }
    after = nextCursor(body);
    if (after === null) break;
    if (cursors.has(after)) fail("META_CATALOG_IDENTITY_CURSOR_REPEATED");
    cursors.add(after);
  }
  return freeze({version: "1.0.0", context: {catalog_id: catalogId, graph_version: META_GRAPH_VERSION},
    complete: true, pages, records, shopify_mapping_state: "not_resolved",
    provider_link_verified: false, authorizes_activation: false, canonical_scope_ready: false, persistable: false});
}

// Existing canonical reader retains its PK/grant gate and output contract.
export async function readMetaCatalogIdentitySnapshot({authority, accessToken, appSecret,
  fetchFn = fetch, maxPages = 100, maxRows = 10000, signal} = {}) {
  const scope = metaCatalogIdentityScopeContext(authority), catalogId = numeric(authority.catalog_id);
  validateIdentityOAuthGrantedScopes("meta", authority.granted_scopes);
  const source = await readMetaCatalogSourceSnapshot({catalogId, grantedScopes: [...authority.granted_scopes],
    accessToken, appSecret, fetchFn, maxPages, maxRows, signal});
  return freeze({version: "1.0.0", scope, context: source.context, complete: true, pages: source.pages,
    records: source.records, shopify_mapping_state: "not_resolved", provider_link_verified: false, authorizes_activation: false});
}

export function matchMetaCatalogProductIdentity(snapshot, {catalogId, namespace, productId, productFeedId} = {}) {
  numeric(catalogId);
  if (!["catalog_product_id", "retailer_id"].includes(namespace)) fail("META_CATALOG_IDENTITY_NAMESPACE_REQUIRED");
  text(productId);
  if (namespace === "catalog_product_id") numeric(productId);
  if (productFeedId !== undefined) numeric(productFeedId);
  if (snapshot?.scope?.platform !== "meta" || snapshot.complete !== true
    || snapshot.context?.catalog_id !== catalogId || !Array.isArray(snapshot.records)) fail("META_CATALOG_IDENTITY_LOOKUP_CONTEXT_INVALID");
  const matches = snapshot.records.filter(record => record[namespace] === productId
    && record.product_context.catalog_id === catalogId
    && (productFeedId === undefined || record.product_context.product_feed_id === productFeedId));
  return freeze({state: matches.length === 1 ? "exact_source_record" : matches.length ? "ambiguous" : "unresolved",
    record: matches.length === 1 ? matches[0] : null, namespace,
    provider_link_verified: false, shopify_mapping_state: "not_resolved", authorizes_activation: false});
}
