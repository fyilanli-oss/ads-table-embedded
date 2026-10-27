import {createGoogleAdsRestClient} from "./google-ads-rest.server.js";
import {merchantIdentityReadScope, readMerchantProductIdentitySnapshot} from "./google-product-identity-reader.server.js";
import {inspectGoogleIdentityCredential} from "../oauth/google-identity-credential.server.js";
import {validateIdentityOAuthGrantedScopes} from "../oauth/oauth-permission-profile.server.js";

export const GOOGLE_MERCHANT_LINK_QUERY = [
  "SELECT product_link.resource_name, product_link.merchant_center.merchant_center_id,",
  "product_link.product_link_id, product_link.type FROM product_link",
  "WHERE product_link.type = 'MERCHANT_CENTER'",
].join(" ");

export class GoogleMerchantLinkError extends Error {
  constructor(code) { super(code); this.name = "GoogleMerchantLinkError"; this.code = code; }
}
function fail(code) { throw new GoogleMerchantLinkError(code); }
function numeric(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)
    || BigInt(value) > 9223372036854775807n) fail("GOOGLE_MERCHANT_LINK_ID_INVALID");
  return value;
}
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function checkAbort(signal) { if (signal?.aborted) fail("GOOGLE_MERCHANT_LINK_ABORTED"); }
function limits(pages, rows) {
  return Number.isSafeInteger(pages) && pages >= 1 && pages <= 1000
    && Number.isSafeInteger(rows) && rows >= 1 && rows <= 100000;
}

// A complete native link read proves only the observed Ads-to-Merchant relationship.
export async function readGoogleMerchantAccountLink({adsClient, customerId, merchantId,
  maxPages = 100, maxLinks = 10000, signal} = {}) {
  numeric(customerId); numeric(merchantId);
  if (typeof adsClient?.search !== "function" || !limits(maxPages, maxLinks)) fail("GOOGLE_MERCHANT_LINK_INPUT_INVALID");
  let pageToken = null, pages = 0;
  const cursors = new Set(), names = new Set(), links = [];
  for (;;) {
    checkAbort(signal);
    if (pages >= maxPages) fail("GOOGLE_MERCHANT_LINK_PAGE_LIMIT");
    let page;
    try { page = await adsClient.search({customerId, query: GOOGLE_MERCHANT_LINK_QUERY, pageToken}); }
    catch { fail(signal?.aborted ? "GOOGLE_MERCHANT_LINK_ABORTED" : "GOOGLE_MERCHANT_LINK_READ_FAILED"); }
    checkAbort(signal);
    if (!page || !Array.isArray(page.results)) fail("GOOGLE_MERCHANT_LINK_RESPONSE_INVALID");
    pages += 1;
    for (const row of page.results) {
      const link = row?.productLink;
      if (link?.type !== "MERCHANT_CENTER") fail("GOOGLE_MERCHANT_LINK_RESPONSE_INVALID");
      const id = numeric(link.productLinkId), target = numeric(link.merchantCenter?.merchantCenterId);
      if (link.resourceName !== `customers/${customerId}/productLinks/${id}`) fail("GOOGLE_MERCHANT_LINK_CUSTOMER_MISMATCH");
      if (names.has(link.resourceName)) fail("GOOGLE_MERCHANT_LINK_DUPLICATE");
      names.add(link.resourceName);
      if (links.length >= maxLinks) fail("GOOGLE_MERCHANT_LINK_ROW_LIMIT");
      links.push({resource_name: link.resourceName, product_link_id: id, merchant_id: target,
        source_record: structuredClone(row)});
    }
    const next = page.next_page_token;
    if (next === null || next === "") break;
    if (typeof next !== "string" || !next || next !== next.trim() || next.length > 4096) fail("GOOGLE_MERCHANT_LINK_CURSOR_INVALID");
    if (cursors.has(next)) fail("GOOGLE_MERCHANT_LINK_CURSOR_REPEATED");
    cursors.add(next); pageToken = next;
  }
  const matches = links.filter(link => link.merchant_id === merchantId);
  return freeze({state: matches.length === 1 ? "confirmed" : matches.length ? "ambiguous" : "not_observed",
    customer_id: customerId, merchant_id: merchantId, complete: true, pages,
    link: matches.length === 1 ? matches[0] : null, authorizes_activation: false});
}

function clock(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) fail("GOOGLE_MERCHANT_LINK_TIME_INVALID");
  return value.valueOf();
}
function currentContext(current, now) {
  const scope = merchantIdentityReadScope(current?.authority);
  numeric(scope.platform_account_id); numeric(current.authority.merchant_id);
  if (current.status !== "connected" || !Number.isSafeInteger(current.connectionVersion) || current.connectionVersion < 1
    || typeof current.credentialId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current.credentialId)) fail("GOOGLE_MERCHANT_LINK_AUTHORITY_INVALID");
  if (inspectGoogleIdentityCredential(current.tokenSet, now).needsRefresh) fail("GOOGLE_MERCHANT_LINK_CREDENTIAL_REFRESH_REQUIRED");
  if (typeof current.tokenSet.access_token !== "string" || !current.tokenSet.access_token
    || /[\s\u007f]/.test(current.tokenSet.access_token) || current.tokenSet.access_token.length > 4096) fail("GOOGLE_MERCHANT_LINK_CREDENTIAL_INVALID");
  const nativeScopes = validateIdentityOAuthGrantedScopes("google_ads", current.tokenSet.scope);
  if ([...current.authority.granted_scopes].sort().join(" ") !== [...nativeScopes].sort().join(" ")) fail("GOOGLE_MERCHANT_LINK_SCOPE_MISMATCH");
  const loginCustomerId = current.loginCustomerId ?? null;
  if (loginCustomerId !== null) numeric(loginCustomerId);
  return {scope, fingerprint: JSON.stringify([scope, current.authority.merchant_id, current.connectionVersion,
    current.credentialId, loginCustomerId, current.tokenSet.access_token, [...nativeScopes].sort(),
    current.tokenSet.scope_verified_at, current.tokenSet.expires_at])};
}

// loadCurrent is a trusted server dependency, never a browser-supplied authority object.
export async function readLinkedMerchantProductIdentitySnapshot({loadCurrent, developerToken,
  fetchFn = fetch, now = () => new Date(), signal, maxPages = 100, maxRows = 10000,
  maxLinkPages = 100, maxLinks = 10000, maxElapsedMs = 120000} = {}) {
  if (typeof loadCurrent !== "function" || typeof fetchFn !== "function" || typeof now !== "function"
    || typeof developerToken !== "string" || !developerToken || /\s/.test(developerToken)
    || developerToken.length > 256 || !Number.isSafeInteger(maxElapsedMs) || maxElapsedMs < 1
    || maxElapsedMs > 600000 || !limits(maxPages, maxRows) || !limits(maxLinkPages, maxLinks)) fail("GOOGLE_MERCHANT_LINK_INPUT_INVALID");
  const started = clock(now);
  async function load() {
    checkAbort(signal);
    let current;
    try { current = structuredClone(await loadCurrent()); } catch { fail("GOOGLE_MERCHANT_LINK_AUTHORITY_UNAVAILABLE"); }
    return {current, ...currentContext(current, now)};
  }
  const first = await load();
  function ensureTime() {
    const time = clock(now);
    if (time < started || time - started > maxElapsedMs) fail("GOOGLE_MERCHANT_LINK_OBSERVATION_STALE");
    checkAbort(signal);
    return time;
  }
  async function recheck() {
    const next = await load();
    if (next.fingerprint !== first.fingerprint) fail("GOOGLE_MERCHANT_LINK_AUTHORITY_CHANGED");
    ensureTime();
  }
  const boundFetch = (endpoint, init) => {
    ensureTime();
    return fetchFn(endpoint, {...init, redirect: "error", signal});
  };
  const adsClient = createGoogleAdsRestClient({accessToken: first.current.tokenSet.access_token, developerToken,
    loginCustomerId: first.current.loginCustomerId ?? null, fetchFn: boundFetch});
  const linkOptions = {adsClient, customerId: first.scope.platform_account_id,
    merchantId: first.current.authority.merchant_id, maxPages: maxLinkPages, maxLinks, signal};
  const before = await readGoogleMerchantAccountLink(linkOptions);
  if (before.state !== "confirmed") fail("GOOGLE_MERCHANT_LINK_NOT_CONFIRMED");
  await recheck();
  const snapshot = await readMerchantProductIdentitySnapshot({authority: first.current.authority,
    accessToken: first.current.tokenSet.access_token, fetchFn: boundFetch, maxPages, maxRows, signal});
  await recheck();
  const after = await readGoogleMerchantAccountLink(linkOptions);
  if (after.state !== "confirmed" || after.link.resource_name !== before.link.resource_name) fail("GOOGLE_MERCHANT_LINK_CHANGED");
  await recheck();
  const completed = ensureTime();
  return freeze({snapshot, link_evidence: {before, after, scope: first.scope,
    started_at: new Date(started).toISOString(), completed_at: new Date(completed).toISOString()},
  provider_link_verified: true, shopify_mapping_state: "not_resolved", authorizes_activation: false});
}
