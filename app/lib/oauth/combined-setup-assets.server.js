import {createIdentityRuntimeAuthorityLoader} from "../providers/identity-runtime-authority.server.js";
import {createGoogleAdsRestClient} from "../providers/google-ads-rest.server.js";
import {readGoogleMerchantAccountLink} from "../providers/google-merchant-account-link.server.js";
import {createMetaAppSecretProof, inspectMetaAccessToken, discoverMetaAdAccounts, META_GRAPH_VERSION} from "../providers/meta-graph.server.js";
import {runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";
import {quotaBoundaryControl} from "../refresh/quota-native-fetch.server.js";

export class CombinedSetupAssetError extends Error {
  constructor(code) {super(code); this.name = "CombinedSetupAssetError"; this.code = code;}
}
function fail(code) {throw new CombinedSetupAssetError(code);}
function numeric(value, int64 = false) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,29}$/.test(value)
    || int64 && BigInt(value) > 9223372036854775807n) fail("COMBINED_ASSET_TARGET_INVALID");
  return value;
}
function frozen(value) {
  if (value && typeof value === "object") {for (const child of Object.values(value)) frozen(child); Object.freeze(value);}
  return value;
}

// Server-only prepared entry. Target IDs select what to check; they are never
// authority. No caller evidence/reader/config override, no persistent setup grant.
export function createCombinedSetupAssetAccess({provider, enabled = false, database, tokenVault, config,
  fetchFn = fetch, now = () => new Date(), maxPages = 100, maxRows = 10000, maxElapsedMs = 120000} = {}) {
  if (!["google_ads", "meta"].includes(provider) || typeof enabled !== "boolean"
    || typeof fetchFn !== "function" || typeof now !== "function"
    || ![maxPages, maxRows, maxElapsedMs].every(Number.isSafeInteger)
    || maxPages < 1 || maxPages > 1000 || maxRows < 1 || maxRows > 100000
    || maxElapsedMs < 1 || maxElapsedMs > 600000) fail("COMBINED_ASSET_CONFIG_INVALID");
  // Detach server configuration before any asynchronous operation.
  const nativeConfig = provider === "google_ads" ? {developerToken: config?.developerToken}
    : {appId: config?.appId, appSecret: config?.appSecret, graphVersion: config?.graphVersion};

  return Object.freeze({async verify({installationAuthority, verified, merchantId, businessId, catalogId, signal, expectedConnection} = {}) {
    if (!enabled) fail("IDENTITY_OAUTH_START_DISABLED");
    const actual = verified?.installationAuthority;
    if (!installationAuthority || installationAuthority.authority !== "shopify_installation_verified"
      || installationAuthority.status !== "active" || actual?.workspaceId !== installationAuthority.workspaceId
      || actual?.installGeneration !== installationAuthority.installGeneration) fail("COMBINED_ASSET_OWNER_MISMATCH");
    // Scalars are captured here; changing a request object cannot retarget a later read.
    const target = provider === "google_ads" ? {merchantId: numeric(merchantId, true)}
      : {businessId: numeric(businessId), catalogId: numeric(catalogId)};
    const expected = expectedConnection === undefined ? null : {
      connectionId: expectedConnection?.connectionId, version: expectedConnection?.version,
      reportingAccountId: expectedConnection?.reportingAccountId,
    };
    if (expected && (typeof expected.connectionId !== "string" || !expected.connectionId
      || !Number.isSafeInteger(expected.version) || expected.version < 1
      || typeof expected.reportingAccountId !== "string" || !expected.reportingAccountId)) fail("COMBINED_ASSET_TARGET_INVALID");
    if (provider === "meta" && (nativeConfig.graphVersion !== META_GRAPH_VERSION
      || !/^[1-9][0-9]*$/.test(nativeConfig.appId ?? "") || typeof nativeConfig.appSecret !== "string"
      || !nativeConfig.appSecret)) fail("COMBINED_ASSET_CONFIG_INVALID");
    return runIdentityReadDeadline({signal, timeoutMs: maxElapsedMs, run: async childSignal => {
      const loader = createIdentityRuntimeAuthorityLoader({verified, database, tokenVault, provider, now, signal: childSignal});
      let current, nativeQuotaControl = null;
      const clock = () => {
        const time = now(); if (!(time instanceof Date) || !Number.isFinite(time.valueOf())) fail("COMBINED_ASSET_TIME_INVALID");
        return time.valueOf();
      };
      const started = clock();
      function check() {
        if (childSignal.aborted) fail("COMBINED_ASSET_ABORTED");
        const time = clock(); if (time < started || time - started > maxElapsedMs) fail("COMBINED_ASSET_OBSERVATION_STALE");
      }
      async function recheck() {
        check(); current = await loader.loadCurrent(); check();
        if (expected && (current.connectionId !== expected.connectionId || current.connectionVersion !== expected.version
          || current.account.id !== expected.reportingAccountId)) fail("COMBINED_ASSET_CONNECTION_CHANGED");
      }
      const boundFetch = async (endpoint, init) => {
        await recheck(); let response;
        try {response = await fetchFn(endpoint, {...init, redirect: "error", signal: childSignal});}
        catch (error) {if (quotaBoundaryControl(error)) nativeQuotaControl = error; throw error;}
        check();
        return {ok: response?.ok, status: response?.status, headers: response?.headers, async json() {
          const body = await response.json(); await recheck(); return body;
        }};
      };
      async function json(endpoint, headers) {
        const response = await boundFetch(endpoint, {method: "GET", headers});
        if (!response?.ok) fail("COMBINED_ASSET_HTTP_FAILED");
        const body = await response.json();
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "error")) {
          fail("COMBINED_ASSET_RESPONSE_INVALID");
        }
        return body;
      }
      try {
        await recheck();
        let evidence, credentialDeadline;
        if (provider === "google_ads") {
          const merchant = target.merchantId;
          const client = createGoogleAdsRestClient({accessToken: current.tokenSet.access_token,
            developerToken: nativeConfig.developerToken, loginCustomerId: current.account.login_account_id, fetchFn: boundFetch});
          const linkOptions = {adsClient: client, customerId: current.account.id, merchantId: merchant,
            maxPages, maxLinks: maxRows, signal: childSignal};
          const before = await readGoogleMerchantAccountLink(linkOptions);
          if (before.state !== "confirmed") fail("COMBINED_ASSET_MERCHANT_LINK_NOT_CONFIRMED");
          const headers = {authorization: `Bearer ${current.tokenSet.access_token}`, accept: "application/json"};
          async function account() {
            const result = await json(`https://merchantapi.googleapis.com/accounts/v1/accounts/${merchant}`, headers);
            if (result.name !== `accounts/${merchant}` || result.accountId !== merchant) fail("COMBINED_ASSET_MERCHANT_ACCOUNT_MISMATCH");
          }
          await account();
          const sample = await json(`https://merchantapi.googleapis.com/products/v1/accounts/${merchant}/products?pageSize=1`, headers);
          // Proto JSON may omit an empty repeated field. This is an access probe,
          // never an inventory count, a complete product scan or identity mapping.
          const products = Object.hasOwn(sample, "products") ? sample.products : [];
          if (!Array.isArray(products) || products.length > 1 || products.some(p => typeof p?.name !== "string"
            || !p.name.startsWith(`accounts/${merchant}/products/`) || p.name.endsWith("/"))) fail("COMBINED_ASSET_PRODUCTS_RESPONSE_INVALID");
          await account();
          const after = await readGoogleMerchantAccountLink(linkOptions);
          if (after.state !== "confirmed" || after.link.resource_name !== before.link.resource_name) fail("COMBINED_ASSET_MERCHANT_LINK_CHANGED");
          evidence = {merchantId: merchant, accountAccessVerified: true, productsEndpointReadable: true,
            relationship: "observed_direct_ads_merchant_link", linkResource: before.link.resource_name};
          credentialDeadline = Date.parse(current.tokenSet.expires_at) - 60000;
        } else {
          const grant = await inspectMetaAccessToken({config: nativeConfig, accessToken: current.tokenSet.access_token,
            permissionProfile: "identity_v1", fetchFn: boundFetch, now});
          async function advertiserAccess(scopes) {
            const discovery = await discoverMetaAdAccounts({accessToken: current.tokenSet.access_token,
              appSecret: nativeConfig.appSecret, scopes, graphVersion: META_GRAPH_VERSION, fetchFn: boundFetch, now});
            if (!discovery.accounts.some(a => a.id === current.account.id && a.kind === "advertiser" && a.reportingEligible === true)) {
              fail("COMBINED_ASSET_ADVERTISER_ACCESS_NOT_CONFIRMED");
            }
          }
          // Business visibility is not the token user's current advertiser access.
          // Reuse the native OAuth account reader as a separate before/after check.
          await advertiserAccess(grant.scopes);
          const headers = {authorization: `Bearer ${current.tokenSet.access_token}`, accept: "application/json"};
          const proof = createMetaAppSecretProof({accessToken: current.tokenSet.access_token, appSecret: nativeConfig.appSecret});
          async function graph(path, fields = "id", after = null, limit = null) {
            const endpoint = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`);
            endpoint.searchParams.set("fields", fields); endpoint.searchParams.set("appsecret_proof", proof);
            if (limit !== null) endpoint.searchParams.set("limit", limit);
            if (after !== null) endpoint.searchParams.set("after", after);
            return json(endpoint.toString(), headers);
          }
          const business = await graph(target.businessId);
          if (business.id !== target.businessId) fail("COMBINED_ASSET_BUSINESS_MISMATCH");
          let pages = 0, rows = 0;
          async function member(edges, id, adAccount = false) {
            for (const edge of edges) {
              let after = null; const cursors = new Set(), ids = new Set();
              for (;;) {
                if (++pages > maxPages) fail("COMBINED_ASSET_PAGE_LIMIT");
                const body = await graph(`${target.businessId}/${edge}`, "id", after, "100");
                if (!Array.isArray(body.data)) fail("COMBINED_ASSET_MEMBERSHIP_RESPONSE_INVALID");
                rows += body.data.length; if (rows > maxRows) fail("COMBINED_ASSET_ROW_LIMIT");
                for (const record of body.data) {
                  if (adAccount ? !/^act_[1-9][0-9]{0,29}$/.test(record?.id ?? "")
                    : typeof record?.id !== "string" || !/^[1-9][0-9]{0,29}$/.test(record.id)) fail("COMBINED_ASSET_MEMBERSHIP_RESPONSE_INVALID");
                  if (ids.has(record.id)) fail("COMBINED_ASSET_MEMBERSHIP_DUPLICATE"); ids.add(record.id);
                }
                if (ids.has(id)) return edge; // Positive membership needs no full inventory scan.
                if (body.paging === undefined) break;
                if (!body.paging || typeof body.paging !== "object" || Array.isArray(body.paging)) fail("COMBINED_ASSET_CURSOR_INVALID");
                if (!Object.hasOwn(body.paging, "next")) break;
                const next = body.paging.cursors?.after;
                if (typeof body.paging.next !== "string" || !body.paging.next || typeof next !== "string"
                  || !next || next.length > 4096 || cursors.has(next)) fail("COMBINED_ASSET_CURSOR_INVALID");
                cursors.add(next); after = next; // Never fetch provider-supplied paging.next.
              }
            }
            fail("COMBINED_ASSET_NOT_IN_SELECTED_BUSINESS");
          }
          const adEdges = ["owned_ad_accounts", "client_ad_accounts"], catalogEdges = ["owned_product_catalogs", "client_product_catalogs"];
          const beforeAd = await member(adEdges, current.account.id, true);
          const beforeCatalog = await member(catalogEdges, target.catalogId);
          const catalog = await graph(target.catalogId);
          if (catalog.id !== target.catalogId) fail("COMBINED_ASSET_CATALOG_MISMATCH");
          const sample = await graph(`${target.catalogId}/products`, "id", null, "1");
          if (!Array.isArray(sample.data) || sample.data.length > 1
            || sample.data.some(p => typeof p?.id !== "string" || !/^[1-9][0-9]{0,29}$/.test(p.id))) fail("COMBINED_ASSET_PRODUCTS_RESPONSE_INVALID");
          if (await member(adEdges, current.account.id, true) !== beforeAd
            || await member(catalogEdges, target.catalogId) !== beforeCatalog) fail("COMBINED_ASSET_BUSINESS_MEMBERSHIP_CHANGED");
          const finalGrant = await inspectMetaAccessToken({config: nativeConfig, accessToken: current.tokenSet.access_token,
            permissionProfile: "identity_v1", fetchFn: boundFetch, now});
          if (JSON.stringify([...grant.scopes].sort()) !== JSON.stringify([...finalGrant.scopes].sort())) fail("COMBINED_ASSET_NATIVE_GRANT_CHANGED");
          await advertiserAccess(finalGrant.scopes);
          credentialDeadline = Math.min(Date.parse(grant.expiresAt), Date.parse(finalGrant.expiresAt));
          evidence = {businessId: target.businessId, catalogId: target.catalogId, accountMembership: beforeAd,
            catalogMembership: beforeCatalog, advertiserAccessVerified: true, productsEndpointReadable: true,
            relationship: "selected_business_asset_access_only_not_ad_catalog_delivery"};
        }
        await recheck();
        const completed = clock(), expires = Math.min(started + 600000, credentialDeadline);
        if (!Number.isFinite(expires) || expires <= completed) fail("COMBINED_ASSET_OBSERVATION_STALE");
        return frozen({provider, accessState: "verified", setupState: "resume_setup", setupComplete: false,
          setupReason: "setup_activation_pending", setupResumeAction: "review_setup",
          workspaceId: current.installation.workspaceId, installGeneration: current.installation.installGeneration,
          installationId: current.installation_id, connectionId: current.connectionId, connectionVersion: current.connectionVersion,
          reportingAccountId: current.account.id, reportingSelectionEpoch: current.reporting_selection_epoch,
          observedAt: new Date(started).toISOString(), completedAt: new Date(completed).toISOString(), expiresAt: new Date(expires).toISOString(),
          assetAccess: evidence, developerAppApproval: "not_evaluated", authorizesActivation: false,
          persisted: false, productMappingVerified: false, salesRolesVerified: false});
      } catch (error) {
        if (nativeQuotaControl !== null) throw nativeQuotaControl;
        if (quotaBoundaryControl(error)) throw error;
        if (error instanceof CombinedSetupAssetError) throw error;
        fail(childSignal.aborted ? "COMBINED_ASSET_ABORTED" : "COMBINED_ASSET_VERIFICATION_FAILED");
      }
    }});
  }});
}
