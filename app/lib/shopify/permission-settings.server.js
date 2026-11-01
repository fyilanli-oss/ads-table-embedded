import {buildKlaviyoAuthorizationUrl} from "../providers/klaviyo-api.server.js";

// Deployment/readiness switches are server-owned. No browser field can open a
// release gate. The Settings composition supplies the explicit
// server release configuration. Klaviyo keeps its existing authorization path.
export const PERMISSION_SETTINGS_AVAILABILITY = Object.freeze({
  shopify_products: false, shopify_orders: false, google_ads: false, meta: false, klaviyo: true,
});
const features = Object.keys(PERMISSION_SETTINGS_AVAILABILITY);
const stages = new Set(["request_permissions", "select_account", "select_reporting_account", "reporting_selected", "review_setup"]);
const unavailable = feature => Object.freeze({kind: "unavailable", feature});
function validScopeBinding(value) {
  return value && /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(value.shopId ?? "")
    && /^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/.test(value.appInstallationId ?? "")
    && Number.isSafeInteger(value.installGeneration) && value.installGeneration >= 1
    && Object.keys(value).length === 3;
}
function selectionSnapshot(result) {
  if (!["select_account", "select_reporting_account", "reporting_selected"].includes(result?.setupResumeAction)) return undefined;
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
  return Object.freeze({connectionId: result.connectionId, version: result.connectionVersion,
    reportingAccountId, accounts: Object.freeze(accounts)});
}
export function providerStatus(feature, result) {
  if (!stages.has(result?.setupResumeAction)) throw new Error("PERMISSION_SETTINGS_STATUS_UNCONFIRMED");
  const projection = selectionSnapshot(result);
  if (result.setupResumeAction === "reporting_selected") {
    if (!projection || projection.accounts.length < 1 || projection.accounts.length > 3
      || !projection.accounts.some(account => account.id === projection.reportingAccountId)) throw new Error("PERMISSION_SETTINGS_SELECTION_UNCONFIRMED");
    return Object.freeze({kind: "status", feature, stage: result.setupResumeAction, connection: projection});
  }
  return Object.freeze({kind: "status", feature, stage: result.setupResumeAction, ...(projection ? {selection: projection} : {})});
}
function expectedBinding(value) {
  if (typeof value?.connectionId !== "string" || !value.connectionId || value.connectionId.length > 128
    || !Number.isSafeInteger(value.version) || value.version < 1) {
    throw new Error("PERMISSION_SETTINGS_BINDING_INVALID");
  }
  return Object.freeze({connectionId: value.connectionId, version: value.version});
}
function shopifyStatus(feature, result) {
  if (feature === "shopify_orders" && result?.ordersScopeState) {
    if (result.ordersScopeState === "permission_ready") return Object.freeze({kind: "status", feature, stage: "review_setup"});
    if (result.ordersScopeState === "not_connected" && result.basePermissionState !== "resume_setup") return Object.freeze({kind: "status", feature, stage: "request_permissions"});
  }
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
    async manage({feature, verified, expected, operation, reportingAccountId}) {
      if (!["google_ads", "meta"].includes(feature) || !["reporting", "disconnect"].includes(operation)) throw new Error("PERMISSION_SETTINGS_ACTION_INVALID");
      if (!check(feature, verified)) return unavailable(feature);
      const binding = expectedBinding(expected);
      const runtime = providerRuntime(feature);
      const before = await runtime.combinedSetup.reconcile({installationAuthority: verified.installationAuthority});
      if (before.setupResumeAction !== "reporting_selected" || before.connectionId !== binding.connectionId
        || before.connectionVersion !== binding.version) throw new Error("PERMISSION_SETTINGS_BINDING_INVALID");
      if (operation === "reporting") {
        if (!before.accounts.some(account => account.id === reportingAccountId)) throw new Error("PERMISSION_SETTINGS_ACCOUNTS_INVALID");
        const receipt = await runtime.changeReporting({installationAuthority: verified.installationAuthority, reportingAccountId});
        if (receipt?.connectionId !== binding.connectionId || receipt.reportingAccountId !== reportingAccountId) throw new Error("PERMISSION_SETTINGS_SELECTION_UNCONFIRMED");
      } else await runtime.disconnect({installationAuthority: verified.installationAuthority});
      const after = await runtime.combinedSetup.reconcile({installationAuthority: verified.installationAuthority});
      if (after.connectionId !== binding.connectionId || after.connectionVersion < binding.version
        || operation === "disconnect" && after.connectionVersion === binding.version
        || operation === "reporting" && (after.setupResumeAction !== "reporting_selected" || after.reportingAccountId !== reportingAccountId)
        || operation === "disconnect" && after.connectionState !== "disconnected") throw new Error("PERMISSION_SETTINGS_SELECTION_UNCONFIRMED");
      return providerStatus(feature, after);
    },
    async reconcile({feature, verified}) {
      if (!["google_ads", "meta"].includes(feature)) throw new Error("PERMISSION_SETTINGS_FEATURE_INVALID");
      if (!check(feature, verified)) return unavailable(feature);
      return providerStatus(feature, await providerRuntime(feature).combinedSetup.reconcile({installationAuthority: verified.installationAuthority}));
    },
    async revokeProducts({feature, verified, action}) {
      if (feature !== "shopify_products" || action !== "revoke") throw new Error("PERMISSION_SETTINGS_EXPLICIT_PRODUCTS_REVOKE_REQUIRED");
      if (!check(feature, verified)) return unavailable(feature);
      return shopifyStatus(feature, await shopify.revokeProducts({verified, action: "revoke"}));
    },
    async revokeOrders({feature, verified, action}) {
      if (feature !== "shopify_orders" || action !== "revoke") throw new Error("PERMISSION_SETTINGS_EXPLICIT_ORDERS_REVOKE_REQUIRED");
      if (!check(feature, verified)) return unavailable(feature);
      const result = await shopify.revokeOrders({verified, action: "revoke"});
      if (result?.ordersScopeState === "not_connected") return Object.freeze({kind: "status", feature, stage: "request_permissions"});
      return Object.freeze({kind: "unknown", feature});
    },
    async connect({feature, verified, action}) {
      if (action !== "connect") throw new Error("PERMISSION_SETTINGS_EXPLICIT_CONNECT_REQUIRED");
      if (!check(feature, verified)) return unavailable(feature);
      if (feature === "shopify_products" || feature === "shopify_orders") {
        const result = await (feature === "shopify_products" ? shopify.prepareProducts : shopify.prepareOrders)({verified, action: "connect"});
        if (result?.outcome === "scope_request_prepared") {
          const target = feature === "shopify_products" ? "read_products" : "read_orders";
          if (result.scope !== target || !validScopeBinding(result.binding)
            || result.binding.shopId !== verified.identity?.shop?.shopId
            || result.binding.installGeneration !== verified.installationAuthority.installGeneration) throw new Error("PERMISSION_SETTINGS_SCOPE_BINDING_INVALID");
          return Object.freeze({kind: "scope_request", feature, scope: target, binding: Object.freeze({...result.binding})});
        }
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
    async status({feature, verified, expectedScopeBinding}) {
      if (!check(feature, verified)) return unavailable(feature);
      if (expectedScopeBinding !== undefined && (!["shopify_products", "shopify_orders"].includes(feature)
        || !validScopeBinding(expectedScopeBinding)
        || expectedScopeBinding.shopId !== verified.identity?.shop?.shopId
        || expectedScopeBinding.installGeneration !== verified.installationAuthority.installGeneration)) throw new Error("PERMISSION_SETTINGS_SCOPE_BINDING_INVALID");
      if (feature === "shopify_products" || feature === "shopify_orders") {
        const result = await shopify.afterReturn({verified});
        if (expectedScopeBinding && (result.appInstallationId !== expectedScopeBinding.appInstallationId
          || result.shopId !== expectedScopeBinding.shopId || result.installGeneration !== expectedScopeBinding.installGeneration)) throw new Error("PERMISSION_SETTINGS_SCOPE_BINDING_CHANGED");
        return shopifyStatus(feature, result);
      }
      const runtime = providerRuntime(feature);
      if (feature !== "klaviyo") {
        const result = await runtime.combinedSetup.inspect({installationAuthority: verified.installationAuthority});
        return providerStatus(feature, result);
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
      // Read the committed next step, never repeat a successful selection write.
      const persisted = await runtime.combinedSetup.reconcile({installationAuthority: verified.installationAuthority});
      if (persisted.connectionId !== result.connectionId || persisted.connectionVersion !== result.connectionVersion
        || persisted.setupResumeAction !== result.setupResumeAction) throw new Error("PERMISSION_SETTINGS_SELECTION_UNCONFIRMED");
      return providerStatus(feature, persisted);
    },
  });
}
