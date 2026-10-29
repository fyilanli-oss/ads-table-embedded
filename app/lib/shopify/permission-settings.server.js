import {buildKlaviyoAuthorizationUrl} from "../providers/klaviyo-api.server.js";

// Deployment/readiness switches are server-owned. No form field or environment
// shortcut can open a release gate. Klaviyo keeps its existing authorization path.
export const PERMISSION_SETTINGS_AVAILABILITY = Object.freeze({
  shopify_products: false, shopify_orders: false, google_ads: false, meta: false, klaviyo: true,
});
const features = Object.keys(PERMISSION_SETTINGS_AVAILABILITY);
const stages = new Set(["request_permissions", "select_account", "select_reporting_account", "verify_assets", "review_setup"]);
const unavailable = feature => Object.freeze({kind: "unavailable", feature});
function selectionSnapshot(result) {
  if (!["select_account", "select_reporting_account", "verify_assets"].includes(result?.setupResumeAction)) return undefined;
  if (typeof result.connectionId !== "string" || !result.connectionId || result.connectionId.length > 128
    || !Number.isSafeInteger(result.connectionVersion) || result.connectionVersion < 1) {
    throw new Error("PERMISSION_SETTINGS_BINDING_INVALID");
  }
  if (!Array.isArray(result.accounts) || result.accounts.length > 10000) throw new Error("PERMISSION_SETTINGS_ACCOUNTS_INVALID");
  const ids = new Set();
  const accounts = result.accounts.map(account => {
    if (typeof account?.id !== "string" || !account.id || account.id.length > 128 || ids.has(account.id)
      || typeof account.name !== "string" || account.name.length > 512) throw new Error("PERMISSION_SETTINGS_ACCOUNTS_INVALID");
    ids.add(account.id); return Object.freeze({id: account.id, name: account.name});
  });
  const reportingAccountId = result.reportingAccountId;
  if (reportingAccountId !== null && (typeof reportingAccountId !== "string" || !reportingAccountId || reportingAccountId.length > 128)) {
    throw new Error("PERMISSION_SETTINGS_BINDING_INVALID");
  }
  if (result.setupResumeAction === "verify_assets" && reportingAccountId === null) throw new Error("PERMISSION_SETTINGS_BINDING_INVALID");
  return Object.freeze({connectionId: result.connectionId, version: result.connectionVersion,
    reportingAccountId, accounts: Object.freeze(accounts)});
}
function expectedBinding(value, assets = false) {
  if (typeof value?.connectionId !== "string" || !value.connectionId || value.connectionId.length > 128
    || !Number.isSafeInteger(value.version) || value.version < 1
    || assets && (typeof value.reportingAccountId !== "string" || !value.reportingAccountId || value.reportingAccountId.length > 128)) {
    throw new Error("PERMISSION_SETTINGS_BINDING_INVALID");
  }
  return Object.freeze({connectionId: value.connectionId, version: value.version,
    ...(assets ? {reportingAccountId: value.reportingAccountId} : {})});
}
function shopifyStatus(feature, result) {
  if (feature === "shopify_orders" && result?.basePermissionState === "resume_setup") {
    return Object.freeze({kind: "status", feature, stage: "products_required"});
  }
  const value = feature === "shopify_products" ? result?.basePermissionState
    : result?.basePermissionState === "permission_ready" ? result?.ordersPermissionState
    : result?.basePermissionState;
  if (value === "permission_ready") return Object.freeze({kind: "status", feature, stage: "review_setup"});
  if (["resume_setup", "not_connected", "blocked_by_products"].includes(value)) {
    return Object.freeze({kind: "status", feature, stage: "request_permissions"});
  }
  return Object.freeze({kind: "unknown", feature});
}

export function createPermissionSettings({shopify, providerRuntime, availability = PERMISSION_SETTINGS_AVAILABILITY}) {
  // Capture switches, not a caller-mutable reference. They are only an outer gate:
  // the native runtime must still enforce its own permission/release/owner guards.
  const enabled = Object.freeze(Object.fromEntries(features.map(feature => [feature, availability[feature] === true])));
  function check(feature, verified) {
    if (!features.includes(feature)) throw new Error("PERMISSION_SETTINGS_FEATURE_INVALID");
    if (!verified?.installationAuthority || !verified?.context) throw new Error("PERMISSION_SETTINGS_AUTHORITY_REQUIRED");
    return enabled[feature];
  }
  return Object.freeze({
    async connect({feature, verified, action}) {
      if (action !== "connect") throw new Error("PERMISSION_SETTINGS_EXPLICIT_CONNECT_REQUIRED");
      if (!check(feature, verified)) return unavailable(feature);
      if (feature === "shopify_products" || feature === "shopify_orders") {
        const result = await (feature === "shopify_products" ? shopify.requestProducts : shopify.requestOrders)({verified, action: "connect"});
        return shopifyStatus(feature, result);
      }
      const runtime = providerRuntime(feature);
      if (feature !== "klaviyo") {
        const result = await runtime.beginCombinedSetup({installationAuthority: verified.installationAuthority});
        if (result?.permissionProfile !== "identity_v1" || typeof result.authorizationUrl !== "string") {
          throw new Error("PERMISSION_SETTINGS_START_UNCONFIRMED");
        }
        return Object.freeze({kind: "authorization", feature, authorizationUrl: result.authorizationUrl});
      }
      const started = await runtime.oauthBoundary.begin({installationAuthority: verified.installationAuthority, provider: "klaviyo"});
      return Object.freeze({kind: "authorization", feature, authorizationUrl: buildKlaviyoAuthorizationUrl({
        config: runtime.config, state: started.state, pkceChallenge: started.pkceChallenge,
      })});
    },
    async status({feature, verified}) {
      if (!check(feature, verified)) return unavailable(feature);
      if (feature === "shopify_products" || feature === "shopify_orders") {
        const result = await shopify.afterReturn({verified});
        return shopifyStatus(feature, result);
      }
      const runtime = providerRuntime(feature);
      if (feature !== "klaviyo") {
        const result = await runtime.combinedSetup.inspect({installationAuthority: verified.installationAuthority});
        if (!stages.has(result?.setupResumeAction)) throw new Error("PERMISSION_SETTINGS_STATUS_UNCONFIRMED");
        const selection = selectionSnapshot(result);
        return Object.freeze({kind: "status", feature, stage: result.setupResumeAction, ...(selection ? {selection} : {})});
      }
      const result = await runtime.inspect({installationAuthority: verified.installationAuthority});
      const stage = result.state === "pending_account_selection" ? "select_account"
        : result.state === "connected" ? "existing_reporting_connection"
        : ["disconnected", "reauthorization_required"].includes(result.state) ? "request_permissions" : null;
      if (!stage) throw new Error("PERMISSION_SETTINGS_STATUS_UNCONFIRMED");
      return Object.freeze({kind: "status", feature, stage});
    },
    async select({feature, verified, expected, selectedAccountIds, reportingAccountId, operation}) {
      if (!["google_ads", "meta"].includes(feature)) throw new Error("PERMISSION_SETTINGS_FEATURE_INVALID");
      if (!check(feature, verified)) return unavailable(feature);
      const binding = expectedBinding(expected);
      if (binding.version >= Number.MAX_SAFE_INTEGER) throw new Error("PERMISSION_SETTINGS_BINDING_INVALID");
      const runtime = providerRuntime(feature);
      let result;
      if (operation === "accounts") {
        if (!Array.isArray(selectedAccountIds) || selectedAccountIds.length < 1 || selectedAccountIds.length > 3
          || selectedAccountIds.some(id => typeof id !== "string" || !id || id.length > 128)
          || new Set(selectedAccountIds).size !== selectedAccountIds.length) throw new Error("PERMISSION_SETTINGS_ACCOUNTS_INVALID");
        result = await runtime.combinedSetup.select({installationAuthority: verified.installationAuthority,
          expectedConnection: binding, selectedAccountIds: [...selectedAccountIds]});
      } else if (operation === "reporting") {
        if (typeof reportingAccountId !== "string" || !reportingAccountId || reportingAccountId.length > 128) throw new Error("PERMISSION_SETTINGS_ACCOUNTS_INVALID");
        result = await runtime.combinedSetup.finishReporting({installationAuthority: verified.installationAuthority,
          expectedConnection: binding, reportingAccountId});
      } else throw new Error("PERMISSION_SETTINGS_ACTION_INVALID");
      if (!stages.has(result?.setupResumeAction) || result.setupComplete !== false || result.provider !== feature
        || result.connectionId !== binding.connectionId || result.connectionVersion !== binding.version + 1) {
        throw new Error("PERMISSION_SETTINGS_SELECTION_UNCONFIRMED");
      }
      // A receipt without an inventory is not an account list; next Resume reads
      // the new version before opening the next selector.
      return Object.freeze({kind: "status", feature, stage: result.setupResumeAction});
    },
    async verifyAssets({feature, verified, expected, merchantId, businessId, catalogId}) {
      if (!["google_ads", "meta"].includes(feature)) throw new Error("PERMISSION_SETTINGS_FEATURE_INVALID");
      if (!check(feature, verified)) return unavailable(feature);
      const binding = expectedBinding(expected, true);
      const numeric = value => typeof value === "string" && /^[1-9][0-9]{0,29}$/.test(value);
      if (feature === "google_ads" ? !numeric(merchantId) || BigInt(merchantId) > 9223372036854775807n
        : !numeric(businessId) || !numeric(catalogId)) throw new Error("PERMISSION_SETTINGS_ASSET_TARGET_INVALID");
      const result = await providerRuntime(feature).combinedSetup.verifyAssets({
        installationAuthority: verified.installationAuthority, verified, expectedConnection: binding,
        ...(feature === "google_ads" ? {merchantId} : {businessId, catalogId}),
      });
      if (result?.provider !== feature || result.accessState !== "verified" || result.authorizesActivation !== false
        || result.setupComplete !== false || result.persisted !== false || result.connectionId !== binding.connectionId
        || result.connectionVersion !== binding.version || result.reportingAccountId !== binding.reportingAccountId
        || result.workspaceId !== verified.installationAuthority.workspaceId || result.installGeneration !== verified.installationAuthority.installGeneration
        || typeof result.expiresAt !== "string" || !(Date.parse(result.expiresAt) > Date.now())) throw new Error("PERMISSION_SETTINGS_ASSET_UNCONFIRMED");
      const asset = result.assetAccess;
      if (feature === "google_ads" ? asset?.merchantId !== merchantId || asset.accountAccessVerified !== true
        || asset.productsEndpointReadable !== true || asset.relationship !== "observed_direct_ads_merchant_link"
        : asset?.businessId !== businessId || asset.catalogId !== catalogId || asset.advertiserAccessVerified !== true
          || asset.productsEndpointReadable !== true || asset.relationship !== "selected_business_asset_access_only_not_ad_catalog_delivery") {
        throw new Error("PERMISSION_SETTINGS_ASSET_UNCONFIRMED");
      }
      return Object.freeze({kind: "status", feature, stage: "review_setup", expiresAt: result.expiresAt});
    },
    async discoverAssets({feature, verified, expected, businessId}) {
      if (!["google_ads", "meta"].includes(feature)) throw new Error("PERMISSION_SETTINGS_FEATURE_INVALID");
      if (!check(feature, verified)) return unavailable(feature);
      const binding = expectedBinding(expected, true);
      const business = feature === "meta" ? businessId ?? null : null;
      if (business !== null && (typeof business !== "string" || !/^[1-9][0-9]{0,29}$/.test(business))) {
        throw new Error("PERMISSION_SETTINGS_ASSET_TARGET_INVALID");
      }
      const result = await providerRuntime(feature).combinedSetup.discoverAssets({verified,
        installationAuthority: verified.installationAuthority, expectedConnection: binding,
        ...(business !== null ? {businessId: business} : {}),
      });
      const candidateKind = feature === "google_ads" ? "merchant_accounts" : business === null ? "businesses" : "catalogs";
      if (result?.provider !== feature || result.complete !== true || result.assetAccessVerified !== false
        || result.authorizesActivation !== false || result.persisted !== false || result.candidateKind !== candidateKind
        || result.connectionId !== binding.connectionId || result.connectionVersion !== binding.version
        || result.reportingAccountId !== binding.reportingAccountId || result.workspaceId !== verified.installationAuthority.workspaceId
        || result.installGeneration !== verified.installationAuthority.installGeneration || result.businessId !== business
        || typeof result.expiresAt !== "string" || !(Date.parse(result.expiresAt) > Date.now())
        || !Array.isArray(result.candidates) || result.candidates.length > 10000) throw new Error("PERMISSION_SETTINGS_DISCOVERY_UNCONFIRMED");
      const ids = new Set();
      const candidates = result.candidates.map(value => {
        if (typeof value?.id !== "string" || !/^[1-9][0-9]{0,29}$/.test(value.id) || ids.has(value.id)
          || typeof value.name !== "string" || !value.name || value.name.length > 512) throw new Error("PERMISSION_SETTINGS_DISCOVERY_UNCONFIRMED");
        ids.add(value.id); return Object.freeze({id: value.id, name: value.name});
      });
      return Object.freeze({kind: "status", feature, stage: "verify_assets", selection: Object.freeze({...binding,
        accounts: Object.freeze([]), assetOptions: Object.freeze({candidateKind, businessId: result.businessId,
          candidates: Object.freeze(candidates), expiresAt: result.expiresAt, complete: true, accessVerified: false})})});
    },
  });
}
