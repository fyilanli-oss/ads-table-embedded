import {createIdentityRuntimeAuthorityLoader} from "./identity-runtime-authority.server.js";
import {createGoogleAdsRestClient} from "./google-ads-rest.server.js";
import {readGoogleMerchantAccountLink} from "./google-merchant-account-link.server.js";
import {readMerchantProductSourceSnapshot} from "./google-product-identity-reader.server.js";
import {quotaBoundaryControl} from "../refresh/quota-native-fetch.server.js";

export class GoogleIdentityCollectionError extends Error {
  constructor(code) {super(code); this.name = "GoogleIdentityCollectionError"; this.code = code;}
}
function fail(code) {throw new GoogleIdentityCollectionError(code);}
function freeze(value) {
  if (value && typeof value === "object") {for (const v of Object.values(value)) freeze(v); Object.freeze(value);}
  return value;
}
function positiveInt64(value) {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

// Prepared server-only read. merchantId is a target, never authority: a native active Ads
// relationship must match it before source collection. No caller loadCurrent override.
export async function collectGoogleMerchantIdentityEvidence({verified, database, tokenVault, merchantId, developerToken,
  fetchFn = fetch, now = () => new Date(), signal, maxPages = 100, maxRows = 10000,
  maxLinkPages = 100, maxLinks = 10000, maxElapsedMs = 120000} = {}) {
  if (!positiveInt64(merchantId) || typeof developerToken !== "string" || !developerToken || developerToken.length > 256
    || /[\u0000-\u0020\u007f]/.test(developerToken) || typeof fetchFn !== "function" || typeof now !== "function"
    || ![maxPages, maxRows, maxLinkPages, maxLinks, maxElapsedMs].every(Number.isSafeInteger)
    || maxPages < 1 || maxPages > 1000 || maxLinkPages < 1 || maxLinkPages > 1000
    || maxRows < 1 || maxRows > 100000 || maxLinks < 1 || maxLinks > 100000
    || maxElapsedMs < 1 || maxElapsedMs > 600000) fail("GOOGLE_IDENTITY_COLLECTION_INPUT_INVALID");
  function clock() {
    const value = now(); if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) fail("GOOGLE_IDENTITY_TIME_INVALID");
    return value.valueOf();
  }
  const started = clock(), loader = createIdentityRuntimeAuthorityLoader({verified, database, tokenVault, provider: "google_ads", now, signal});
  let current, nativeQuotaControl = null;
  function check() {
    if (signal?.aborted) fail("GOOGLE_IDENTITY_ABORTED");
    const time = clock(); if (time < started || time - started > maxElapsedMs) fail("GOOGLE_IDENTITY_OBSERVATION_STALE");
  }
  async function recheck() {
    check(); current = await loader.loadCurrent(); check();
    if (!positiveInt64(current.account.id) || current.account.login_account_id !== null && !positiveInt64(current.account.login_account_id)) fail("GOOGLE_IDENTITY_ACCOUNT_INVALID");
  }
  const boundFetch = async (endpoint, init) => {
    await recheck(); let response;
    try {response = await fetchFn(endpoint, {...init, redirect: "error", signal});}
    catch (error) {if (quotaBoundaryControl(error)) nativeQuotaControl = error; throw error;}
    check();
    return {ok: response?.ok, status: response?.status, headers: response?.headers, async json() {
      const body = await response.json(); check(); await recheck(); return body;
    }};
  };
  try {
    await recheck();
    const adsClient = createGoogleAdsRestClient({accessToken: current.tokenSet.access_token, developerToken,
      loginCustomerId: current.account.login_account_id, fetchFn: boundFetch});
    const linkOptions = {adsClient, customerId: current.account.id, merchantId, maxPages: maxLinkPages, maxLinks, signal};
    const before = await readGoogleMerchantAccountLink(linkOptions);
    if (before.state !== "confirmed") fail("GOOGLE_IDENTITY_MERCHANT_LINK_NOT_CONFIRMED");
    await recheck();
    const source = await readMerchantProductSourceSnapshot({merchantId, accessToken: current.tokenSet.access_token,
      fetchFn: boundFetch, signal, maxPages, maxRows});
    await recheck();
    const after = await readGoogleMerchantAccountLink(linkOptions);
    if (after.state !== "confirmed" || before.link.resource_name !== after.link.resource_name) fail("GOOGLE_IDENTITY_MERCHANT_LINK_CHANGED");
    await recheck();
    return freeze({provider: "google_ads", source: "native_Ads_Merchant_link_and_product_collection",
      account_id: current.account.id, merchant_id: merchantId, connection_id: current.connectionId,
      connection_version: current.connectionVersion, installation: current.installation, shop: current.shop,
      native_source: source, link_evidence: {before, after,
        started_at: new Date(started).toISOString(), completed_at: new Date(clock()).toISOString()},
      provider_link_verified: true, relationship_scope: "observed_direct_Ads_Merchant_relationship_only",
      installation_id: null, canonical_scope_ready: false, shopify_mapping_state: "not_resolved",
      authorizes_activation: false, persistable: false, mapping_write_performed: false, source_facts_changed: false,
      remaining: ["trusted_installation_primary_key_and_Ads_selection_epoch_reads", "verified_source_format_rule_binding",
        "Shopify_candidate_verification_composition", "quota_dispatch_and_prewrite_controls"]});
  } catch (error) {
    if (nativeQuotaControl !== null) throw nativeQuotaControl;
    if (quotaBoundaryControl(error)) throw error;
    if (error instanceof GoogleIdentityCollectionError) throw error;
    fail(signal?.aborted ? "GOOGLE_IDENTITY_ABORTED" : "GOOGLE_IDENTITY_COLLECTION_FAILED");
  }
}
