import {createIdentityRuntimeAuthorityLoader} from "../providers/identity-runtime-authority.server.js";
import {createMetaAppSecretProof, inspectMetaAccessToken, META_GRAPH_VERSION} from "../providers/meta-graph.server.js";
import {runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";
import {quotaBoundaryControl} from "../refresh/quota-native-fetch.server.js";

class AssetDiscoveryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new AssetDiscoveryError(`COMBINED_DISCOVERY_${code}`); };
const numeric = value => typeof value === "string" && /^[1-9][0-9]{0,29}$/.test(value);

// List candidates only. A visible item is not an Ads link, usable product catalog,
// product identity match, setup activation, or permission to persist a binding.
export function createCombinedSetupAssetDiscovery({provider, enabled = false, database, tokenVault, config,
  fetchFn = fetch, now = () => new Date(), maxPages = 100, maxRows = 10000, maxElapsedMs = 120000} = {}) {
  if (!["google_ads", "meta"].includes(provider) || typeof enabled !== "boolean" || typeof fetchFn !== "function"
    || typeof now !== "function" || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000
    || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000
    || !Number.isSafeInteger(maxElapsedMs) || maxElapsedMs < 1 || maxElapsedMs > 600000) fail("CONFIG_INVALID");
  const nativeConfig = {appId: config?.appId, appSecret: config?.appSecret, graphVersion: config?.graphVersion};
  return Object.freeze({async discover({verified, installationAuthority, expectedConnection, businessId, signal} = {}) {
    if (!enabled) fail("DISABLED");
    if (!installationAuthority || installationAuthority.authority !== "shopify_installation_verified"
      || installationAuthority.status !== "active" || verified?.installationAuthority?.workspaceId !== installationAuthority.workspaceId
      || verified.installationAuthority.installGeneration !== installationAuthority.installGeneration) fail("OWNER_MISMATCH");
    const expected = {connectionId: expectedConnection?.connectionId, version: expectedConnection?.version,
      reportingAccountId: expectedConnection?.reportingAccountId};
    if (typeof expected.connectionId !== "string" || !expected.connectionId || !Number.isSafeInteger(expected.version)
      || expected.version < 1 || typeof expected.reportingAccountId !== "string" || !expected.reportingAccountId) fail("BINDING_INVALID");
    const business = businessId ?? null;
    if (business !== null && (provider !== "meta" || !numeric(business))) fail("TARGET_INVALID");
    if (provider === "meta" && (nativeConfig.graphVersion !== META_GRAPH_VERSION || !numeric(nativeConfig.appId)
      || typeof nativeConfig.appSecret !== "string" || !nativeConfig.appSecret)) fail("CONFIG_INVALID");
    return runIdentityReadDeadline({signal, timeoutMs: maxElapsedMs, run: async childSignal => {
      const loader = createIdentityRuntimeAuthorityLoader({verified, database, tokenVault, provider, now, signal: childSignal});
      let current, quota = null, pages = 0, rows = 0;
      const time = () => { const value = now(); if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) fail("TIME_INVALID"); return value.valueOf(); };
      const started = time();
      const check = () => { const value = time(); if (childSignal.aborted) fail("ABORTED"); if (value < started || value - started > maxElapsedMs) fail("STALE"); };
      const recheck = async () => {
        check(); current = await loader.loadCurrent(); check();
        if (current.connectionId !== expected.connectionId || current.connectionVersion !== expected.version
          || current.account.id !== expected.reportingAccountId) fail("CONNECTION_CHANGED");
      };
      const boundFetch = async (endpoint, init) => {
        await recheck();
        let response;
        try { response = await fetchFn(endpoint, {...init, method: "GET", redirect: "error", signal: childSignal}); }
        catch (error) { if (quotaBoundaryControl(error)) quota = error; throw error; }
        check();
        return {ok: response?.ok, status: response?.status, headers: response?.headers, async json() {
          const value = await response.json(); await recheck(); return value;
        }};
      };
      const json = async endpoint => {
        const response = await boundFetch(endpoint, {headers: {authorization: `Bearer ${current.tokenSet.access_token}`, accept: "application/json"}});
        if (!response.ok) fail("HTTP_FAILED");
        const body = await response.json();
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "error")) fail("RESPONSE_INVALID");
        return body;
      };
      try {
        await recheck();
        let grant = null;
        if (provider === "meta") grant = await inspectMetaAccessToken({config: nativeConfig,
          accessToken: current.tokenSet.access_token, permissionProfile: "identity_v1", fetchFn: boundFetch, now});
        const appProof = provider === "meta" ? createMetaAppSecretProof({accessToken: current.tokenSet.access_token, appSecret: nativeConfig.appSecret}) : null;
        async function list(path) {
          let cursor = null;
          const cursors = new Set(), ids = new Set(), values = [];
          for (;;) {
            if (++pages > maxPages) fail("PAGE_LIMIT");
            const endpoint = new URL(provider === "google_ads" ? "https://merchantapi.googleapis.com/accounts/v1/accounts"
              : `https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`);
            if (provider === "google_ads") {
              endpoint.searchParams.set("pageSize", "100");
              if (cursor !== null) endpoint.searchParams.set("pageToken", cursor);
            } else {
              endpoint.searchParams.set("fields", "id,name"); endpoint.searchParams.set("limit", "100");
              endpoint.searchParams.set("appsecret_proof", appProof);
              if (cursor !== null) endpoint.searchParams.set("after", cursor);
            }
            const body = await json(endpoint.toString());
            const records = provider === "google_ads" ? Object.hasOwn(body, "accounts") ? body.accounts : [] : body.data;
            if (!Array.isArray(records) || (rows += records.length) > maxRows) fail("ROWS_INVALID_OR_LIMIT");
            for (const record of records) {
              const id = provider === "google_ads" ? record?.accountId : record?.id;
              const name = provider === "google_ads" ? record?.accountName : record?.name;
              if (!numeric(id) || ids.has(id) || provider === "google_ads" && (BigInt(id) > 9223372036854775807n || record.name !== `accounts/${id}`)
                || typeof name !== "string" || !name || name.length > 512) fail("ITEM_INVALID_OR_DUPLICATE");
              ids.add(id); values.push(Object.freeze({id, name}));
            }
            let next = null;
            if (provider === "google_ads") {
              if (Object.hasOwn(body, "nextPageToken") && body.nextPageToken !== "") {
                if (typeof body.nextPageToken !== "string") fail("CURSOR_INVALID");
                next = body.nextPageToken;
              }
            } else if (body.paging !== undefined) {
              if (!body.paging || typeof body.paging !== "object" || Array.isArray(body.paging)) fail("CURSOR_INVALID");
              if (Object.hasOwn(body.paging, "next")) {
                if (typeof body.paging.next !== "string" || !body.paging.next) fail("CURSOR_INVALID");
                next = body.paging.cursors?.after;
              }
            }
            if (next === null) break;
            if (typeof next !== "string" || !next || next.length > 4096 || cursors.has(next)) fail("CURSOR_INVALID");
            cursors.add(next); cursor = next; // Never follow paging.next.
          }
          return values;
        }
        let candidates, candidateKind;
        if (provider === "google_ads") { candidates = await list(null); candidateKind = "merchant_accounts"; }
        else {
          const businesses = await list("me/businesses");
          if (business === null) { candidates = businesses; candidateKind = "businesses"; }
          else {
            if (!businesses.some(value => value.id === business)) fail("BUSINESS_NOT_VISIBLE");
            const owned = await list(`${business}/owned_product_catalogs`);
            const shared = await list(`${business}/client_product_catalogs`);
            const merged = new Map(owned.map(value => [value.id, value]));
            for (const value of shared) {
              if (merged.has(value.id) && merged.get(value.id).name !== value.name) fail("CATALOG_CONFLICT");
              merged.set(value.id, value);
            }
            candidates = [...merged.values()]; candidateKind = "catalogs";
          }
          const final = await inspectMetaAccessToken({config: nativeConfig, accessToken: current.tokenSet.access_token,
            permissionProfile: "identity_v1", fetchFn: boundFetch, now});
          if (JSON.stringify([...grant.scopes].sort()) !== JSON.stringify([...final.scopes].sort())) fail("GRANT_CHANGED");
          grant = {...final, expiresAt: new Date(Math.min(Date.parse(grant.expiresAt), Date.parse(final.expiresAt))).toISOString()};
        }
        await recheck();
        const expires = Math.min(started + 600000, Date.parse(provider === "meta" ? grant.expiresAt : current.tokenSet.expires_at) - 60000);
        if (!Number.isFinite(expires) || expires <= time()) fail("STALE");
        return Object.freeze({provider, candidateKind, businessId: business, candidates: Object.freeze(candidates),
          workspaceId: current.installation.workspaceId, installGeneration: current.installation.installGeneration,
          connectionId: current.connectionId, connectionVersion: current.connectionVersion, reportingAccountId: current.account.id,
          complete: true, observedAt: new Date(started).toISOString(), expiresAt: new Date(expires).toISOString(),
          assetAccessVerified: false, authorizesActivation: false, persisted: false});
      } catch (error) {
        if (quota !== null) throw quota;
        if (quotaBoundaryControl(error)) throw error;
        if (error instanceof AssetDiscoveryError) throw error;
        fail(childSignal.aborted ? "ABORTED" : "FAILED");
      }
    }});
  }});
}
