import {buildKlaviyoAuthorizationUrl} from "../providers/klaviyo-api.server.js";

// Deployment/readiness switches are server-owned. No form field or environment
// shortcut can open a release gate. Klaviyo keeps its existing authorization path.
export const PERMISSION_SETTINGS_AVAILABILITY = Object.freeze({
  shopify_products: false, shopify_orders: false, google_ads: false, meta: false, klaviyo: true,
});
const features = Object.keys(PERMISSION_SETTINGS_AVAILABILITY);
const stages = new Set(["request_permissions", "select_account", "select_reporting_account", "verify_assets", "review_setup"]);
const unavailable = feature => Object.freeze({kind: "unavailable", feature});
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
        return Object.freeze({kind: "status", feature, stage: result.setupResumeAction});
      }
      const result = await runtime.inspect({installationAuthority: verified.installationAuthority});
      const stage = result.state === "pending_account_selection" ? "select_account"
        : result.state === "connected" ? "existing_reporting_connection"
        : ["disconnected", "reauthorization_required"].includes(result.state) ? "request_permissions" : null;
      if (!stage) throw new Error("PERMISSION_SETTINGS_STATUS_UNCONFIRMED");
      return Object.freeze({kind: "status", feature, stage});
    },
  });
}
