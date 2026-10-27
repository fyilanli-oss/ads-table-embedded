import {createMetaAppSecretProof, inspectMetaAccessToken, META_GRAPH_VERSION} from "./meta-graph.server.js";
import {metaCatalogIdentityScopeContext, readMetaCatalogIdentitySnapshot} from "./meta-catalog-identity-reader.server.js";
import {validateIdentityOAuthGrantedScopes} from "../oauth/oauth-permission-profile.server.js";

export class MetaCatalogReferenceError extends Error {
  constructor(code) { super(code); this.name = "MetaCatalogReferenceError"; this.code = code; }
}
function fail(code) { throw new MetaCatalogReferenceError(code); }
function id(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,29}$/.test(value)) fail("META_CATALOG_REFERENCE_ID_INVALID");
  return value;
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function abort(signal) { if (signal?.aborted) fail("META_CATALOG_REFERENCE_ABORTED"); }
function token(value) {
  if (typeof value !== "string" || !value || value.length > 8192 || /[\s\u007f]/.test(value)) fail("META_CATALOG_REFERENCE_TOKEN_INVALID");
  return value;
}
async function readNode({nodeId, fields, accessToken, appSecret, fetchFn, signal}) {
  abort(signal);
  const endpoint = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${nodeId}`);
  endpoint.searchParams.set("fields", fields);
  endpoint.searchParams.set("appsecret_proof", createMetaAppSecretProof({accessToken, appSecret}));
  let response, body;
  try {
    response = await fetchFn(endpoint.toString(), {method: "GET", redirect: "error", signal,
      headers: {authorization: `Bearer ${accessToken}`}});
    if (!response?.ok) fail("META_CATALOG_REFERENCE_HTTP_FAILED");
    body = await response.json();
  } catch { fail(signal?.aborted ? "META_CATALOG_REFERENCE_ABORTED" : "META_CATALOG_REFERENCE_READ_FAILED"); }
  abort(signal);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "error")) fail("META_CATALOG_REFERENCE_RESPONSE_INVALID");
  return body;
}

// Observes this Ad Set's catalog reference, not a global catalog assignment or product delivery.
export async function readMetaAdSetCatalogReference({authority, accessToken, appSecret, fetchFn = fetch, signal} = {}) {
  const scope = metaCatalogIdentityScopeContext(authority);
  const adSetId = id(authority.adset_id), catalogId = id(authority.catalog_id);
  if (!/^act_[1-9][0-9]{0,29}$/.test(scope.platform_account_id)
    || typeof fetchFn !== "function") fail("META_CATALOG_REFERENCE_INPUT_INVALID");
  validateIdentityOAuthGrantedScopes("meta", authority.granted_scopes);
  accessToken = token(accessToken);
  const options = {accessToken, appSecret, fetchFn, signal};
  const adSet = await readNode({...options, nodeId: adSetId, fields: "id,account_id,promoted_object"});
  if (adSet.id !== adSetId || adSet.account_id !== scope.platform_account_id.slice(4)) fail("META_CATALOG_REFERENCE_ACCOUNT_MISMATCH");
  const promoted = adSet.promoted_object;
  if (!Object.hasOwn(adSet, "promoted_object") || !promoted || typeof promoted !== "object" || Array.isArray(promoted)) fail("META_CATALOG_REFERENCE_SCHEMA_INVALID");
  const direct = Object.hasOwn(promoted, "product_catalog_id") ? id(promoted.product_catalog_id) : null;
  const productSetId = Object.hasOwn(promoted, "product_set_id") ? id(promoted.product_set_id) : null;
  // Keep only the identity fields from promoted_object; unrelated signals are not evidence here.
  const references = {adset_id: adSetId, account_id: adSet.account_id,
    ...(direct === null ? {} : {product_catalog_id: direct}), ...(productSetId === null ? {} : {product_set_id: productSetId})};
  let resolved = direct, productSet = null;
  if (productSetId !== null) {
    const set = await readNode({...options, nodeId: productSetId, fields: "id,product_catalog"});
    if (set.id !== productSetId) fail("META_CATALOG_REFERENCE_PRODUCT_SET_MISMATCH");
    const parent = id(set.product_catalog?.id);
    if (direct !== null && parent !== direct) fail("META_CATALOG_REFERENCE_CONFLICTING");
    resolved = parent; productSet = {id: set.id, product_catalog: {id: parent}};
  }
  return freeze({state: resolved === catalogId ? "confirmed" : resolved === null ? "not_observed" : "different_catalog",
    scope, catalog_id: catalogId, observed_catalog_id: resolved, adset_id: adSetId,
    evidence: {adset_reference: references, product_set_reference: productSet},
    authorizes_activation: false, proves_product_delivery_or_Insights_namespace: false});
}
function clock(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) fail("META_CATALOG_REFERENCE_TIME_INVALID");
  return value.valueOf();
}
function contextOf(current) {
  const scope = metaCatalogIdentityScopeContext(current?.authority);
  id(current.authority.adset_id); id(current.authority.catalog_id);
  if (!/^act_[1-9][0-9]{0,29}$/.test(scope.platform_account_id) || current.status !== "connected"
    || !Number.isSafeInteger(current.connectionVersion) || current.connectionVersion < 1
    || typeof current.credentialId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current.credentialId)
    || current.tokenSet?.permission_profile !== "identity_v1") fail("META_CATALOG_REFERENCE_AUTHORITY_INVALID");
  token(current.tokenSet.access_token);
  const scopes = validateIdentityOAuthGrantedScopes("meta", current.authority.granted_scopes);
  return {scope, fingerprint: JSON.stringify([scope, current.authority.adset_id, current.authority.catalog_id,
    current.connectionVersion, current.credentialId, current.tokenSet.access_token, [...scopes].sort()])};
}

// loadCurrent must be bound to authenticated server lifecycle/vault/Reporting Account context.
export async function readReferencedMetaCatalogIdentitySnapshot({loadCurrent, config, fetchFn = fetch,
  now = () => new Date(), signal, maxPages = 100, maxRows = 10000, maxElapsedMs = 120000} = {}) {
  if (typeof loadCurrent !== "function" || typeof fetchFn !== "function" || typeof now !== "function"
    || config?.graphVersion !== META_GRAPH_VERSION || typeof config?.appId !== "string" || !/^[1-9][0-9]{0,29}$/.test(config.appId)
    || typeof config.appSecret !== "string" || !config.appSecret || config.appSecret.length > 512
    || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000
    || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000
    || !Number.isSafeInteger(maxElapsedMs) || maxElapsedMs < 1 || maxElapsedMs > 600000) fail("META_CATALOG_REFERENCE_INPUT_INVALID");
  config = Object.freeze({appId: config.appId, appSecret: config.appSecret, graphVersion: config.graphVersion});
  const started = clock(now);
  let permission = null;
  function ensureTime() {
    const current = clock(now);
    if (current < started || current - started > maxElapsedMs) fail("META_CATALOG_REFERENCE_OBSERVATION_STALE");
    if (permission !== null && Date.parse(permission.expiresAt) <= current) fail("META_CATALOG_REFERENCE_CREDENTIAL_EXPIRED");
    abort(signal); return current;
  }
  async function load() {
    ensureTime(); let current;
    try { current = structuredClone(await loadCurrent()); } catch { fail("META_CATALOG_REFERENCE_AUTHORITY_UNAVAILABLE"); }
    return {current, ...contextOf(current)};
  }
  const first = await load();
  async function recheck() {
    const current = await load();
    if (current.fingerprint !== first.fingerprint) fail("META_CATALOG_REFERENCE_AUTHORITY_CHANGED");
    ensureTime();
  }
  const boundFetch = (endpoint, options) => {ensureTime(); return fetchFn(endpoint, {...options, signal, redirect: "error"});};
  try { permission = await inspectMetaAccessToken({config, accessToken: first.current.tokenSet.access_token,
    permissionProfile: "identity_v1", fetchFn: boundFetch, now}); }
  catch { fail(signal?.aborted ? "META_CATALOG_REFERENCE_ABORTED" : "META_CATALOG_REFERENCE_TOKEN_INSPECTION_FAILED"); }
  ensureTime();
  await recheck();
  const authority = {...first.current.authority, granted_scopes: [...permission.scopes]};
  const options = {authority, accessToken: first.current.tokenSet.access_token, appSecret: config.appSecret, fetchFn: boundFetch, signal};
  const before = await readMetaAdSetCatalogReference(options);
  if (before.state !== "confirmed") fail("META_CATALOG_REFERENCE_NOT_CONFIRMED");
  await recheck();
  const snapshot = await readMetaCatalogIdentitySnapshot({...options, maxPages, maxRows});
  await recheck();
  const after = await readMetaAdSetCatalogReference(options);
  if (after.state !== "confirmed" || JSON.stringify(after.evidence) !== JSON.stringify(before.evidence)) fail("META_CATALOG_REFERENCE_CHANGED");
  await recheck();
  return freeze({snapshot, link_evidence: {before, after, permission, scope: first.scope,
    started_at: new Date(started).toISOString(), completed_at: new Date(ensureTime()).toISOString()},
    provider_link_verified: true, relationship_scope: "current_adset_catalog_reference_only",
    shopify_mapping_state: "not_resolved", authorizes_activation: false,
    proves_product_delivery_or_Insights_namespace: false});
}
