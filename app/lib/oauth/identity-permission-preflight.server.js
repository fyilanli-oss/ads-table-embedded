import {GOOGLE_ADS_OAUTH_SCOPE} from "../providers/google-ads-rest.server.js";
import {META_OAUTH_SCOPE} from "../providers/meta-graph.server.js";
import {KLAVIYO_OAUTH_SCOPES} from "../providers/klaviyo-api.server.js";
import {normalizeShopDomain} from "../shopify/installation-authority.server.js";

export const GOOGLE_MERCHANT_OAUTH_SCOPE = "https://www.googleapis.com/auth/content";
export const META_CATALOG_PERMISSION_DEPENDENCIES = Object.freeze({
  catalog_management: Object.freeze(["business_management"]),
  business_management: Object.freeze(["pages_read_engagement", "pages_show_list"]),
  pages_read_engagement: Object.freeze(["pages_show_list"]),
  pages_show_list: Object.freeze([]),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHOP_ID = /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/;
const SOURCES = Object.freeze({
  google_ads: "google_oauth_native_scope_response",
  meta: "meta_token_inspection_native_scopes",
  klaviyo: "klaviyo_oauth_native_scope_response",
  shopify: "shopify_current_app_installation",
});
const MAX_AGE_MS = 10 * 60 * 1000;
const READ_EQUIVALENTS = Object.freeze({
  read_products: "write_products",
  read_orders: "write_orders",
  read_marketing_events: "write_marketing_events",
});

function exactString(value, maximum = 255) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && value === value.trim() && !/[\x00-\x20\x7f]/.test(value);
}

function currentTime(now) {
  const date = now();
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new TypeError("VALID_NOW_REQUIRED");
  return date;
}

// Context comes from trusted server orchestration, never a browser DTO.
export function permissionContext(value) {
  if (!value || !Object.hasOwn(SOURCES, value.provider)
    || !UUID.test(value.workspaceId || "")
    || !Number.isSafeInteger(value.installGeneration) || value.installGeneration < 1
    || !SHOP_ID.test(value.shopId || "")) throw new TypeError("PERMISSION_CONTEXT_INVALID");
  const shopDomain = normalizeShopDomain(value.shopDomain);
  if (shopDomain !== value.shopDomain) throw new TypeError("PERMISSION_SHOP_DOMAIN_NOT_CANONICAL");
  const context = {
    provider: value.provider, workspaceId: value.workspaceId,
    installGeneration: value.installGeneration, shopId: value.shopId, shopDomain,
  };
  if (value.provider !== "shopify") {
    if (!UUID.test(value.connectionId || "") || !exactString(value.accountId)) {
      throw new TypeError("PERMISSION_CONNECTION_ACCOUNT_REQUIRED");
    }
    context.connectionId = value.connectionId;
    context.accountId = value.accountId;
  }
  return Object.freeze(context);
}

export function identityPermissionRequirements({
  provider, includeOrderHistory = false, includeMarketingEvents = false,
} = {}) {
  if (!Object.hasOwn(SOURCES, provider)) throw new TypeError("PERMISSION_PROVIDER_UNSUPPORTED");
  if (typeof includeOrderHistory !== "boolean" || typeof includeMarketingEvents !== "boolean"
    || (provider !== "shopify" && (includeOrderHistory || includeMarketingEvents))) {
    throw new TypeError("PERMISSION_FEATURE_SELECTION_INVALID");
  }
  let scopes;
  let additionalChecks;
  if (provider === "google_ads") {
    scopes = [GOOGLE_ADS_OAUTH_SCOPE, GOOGLE_MERCHANT_OAUTH_SCOPE];
    additionalChecks = ["merchant_api_enabled", "merchant_developer_registration_for_application_project",
      "google_oauth_app_verification", "selected_merchant_account_and_product_read"];
  } else if (provider === "meta") {
    scopes = [META_OAUTH_SCOPE, ...Object.keys(META_CATALOG_PERMISSION_DEPENDENCIES)];
    additionalChecks = ["meta_app_review_for_other_business_data", "meta_business_verification_for_advanced_access",
      "selected_business_catalog_admin_access_and_product_read"];
  } else if (provider === "klaviyo") {
    scopes = [...KLAVIYO_OAUTH_SCOPES];
    additionalChecks = ["selected_klaviyo_account_read", "verified_shopify_ordered_product_metric_and_event_read"];
  } else {
    scopes = ["read_products", "read_orders"];
    additionalChecks = ["shopify_product_read", "shopify_order_line_read", "shopify_protected_customer_data_access"];
    if (includeOrderHistory) {
      scopes.push("read_all_orders");
      additionalChecks.push("shopify_all_orders_application_approval_and_historical_read");
    }
    if (includeMarketingEvents) {
      scopes.push("read_marketing_events");
      additionalChecks.push("shopify_marketing_event_visibility_and_journey_read");
    }
  }
  return Object.freeze({provider, scopes: Object.freeze(scopes), additionalChecks: Object.freeze(additionalChecks),
    usage: "read_only", permissionsMayAllowWrites: provider === "google_ads" || provider === "meta"});
}

function normalizedScopes(value) {
  if (!Array.isArray(value) || value.length > 100
    || [...value].some(scope => !exactString(scope, 200)) || new Set(value).size !== value.length) return null;
  return new Set(value);
}

// Scope comparison only: matching strings do not grant asset access or authorize activation.
export function assessIdentityPermissionScopes({
  context: rawContext, evidence = null, includeOrderHistory = false, includeMarketingEvents = false,
  now = () => new Date(),
} = {}) {
  const context = permissionContext(rawContext);
  const requirements = identityPermissionRequirements({provider: context.provider, includeOrderHistory, includeMarketingEvents});
  const checkedAt = currentTime(now).toISOString();
  const result = (scopeStatus, reason, missingScopes = null, satisfiedBy = []) => Object.freeze({
    provider: context.provider, scopeStatus, reason, checkedAt,
    requiredScopes: requirements.scopes,
    missingScopes: missingScopes === null ? null : Object.freeze(missingScopes),
    satisfiedBy: Object.freeze(satisfiedBy),
    additionalChecks: requirements.additionalChecks,
    // Not a capability token, app-review proof, verified asset binding or live readiness.
    authorizesActivation: false,
  });
  if (evidence === null || evidence === undefined) return result("unknown", "not_observed");
  if (evidence.source !== SOURCES[context.provider]) return result("unknown", "native_scope_source_required");
  if (evidence.complete !== true) return result("unknown", "incomplete_scope_evidence");
  let observedContext;
  try { observedContext = permissionContext(evidence.context); }
  catch { return result("unknown", "invalid_evidence_context"); }
  if (Object.keys(context).some(key => context[key] !== observedContext[key])) {
    return result("unknown", "evidence_context_mismatch");
  }
  const observedAt = new Date(evidence.observedAt);
  if (typeof evidence.observedAt !== "string" || Number.isNaN(observedAt.valueOf())
    || observedAt.toISOString() !== evidence.observedAt) return result("unknown", "invalid_observation_time");
  const age = new Date(checkedAt).valueOf() - observedAt.valueOf();
  if (age < 0 || age > MAX_AGE_MS) return result("unknown", "stale_or_future_scope_evidence");
  const granted = normalizedScopes(evidence.scopes);
  if (!granted) return result("unknown", "invalid_scope_list");
  const satisfiedBy = [];
  const missing = [];
  for (const scope of requirements.scopes) {
    const equivalent = context.provider === "shopify" ? READ_EQUIVALENTS[scope] : null;
    const matchingGrant = granted.has(scope) ? scope : equivalent && granted.has(equivalent) ? equivalent : null;
    if (matchingGrant) satisfiedBy.push(Object.freeze({requiredScope: scope, grantedScope: matchingGrant}));
    else missing.push(scope);
  }
  return result(missing.length ? "observed_missing" : "observed_sufficient", "complete_native_scope_list", missing, satisfiedBy);
}
