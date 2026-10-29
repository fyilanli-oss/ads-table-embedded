import {permissionContext, identityPermissionRequirements, assessIdentityPermissionScopes} from "../oauth/identity-permission-preflight.server.js";
import {createShopifyRuntimeRepositories} from "../database/shopify-runtime-repositories.server.js";

import {SHOPIFY_PERMISSION_SCOPES_QUERY} from "./permission-scope-protocol.server.js";
export {SHOPIFY_PERMISSION_SCOPES_QUERY};

function readFailure(response) {
  const error = new Error("SHOPIFY_PERMISSION_SCOPES_READ_FAILED");
  error.code = "SHOPIFY_PERMISSION_SCOPES_READ_FAILED";
  const status = response?.status;
  error.details = Object.freeze({status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null});
  return error;
}

// admin must be the authenticated Admin client for the active installation in context.
// Caller must revalidate installation generation before using the result.
export async function readShopifyPermissionScopes({context: rawContext, admin, now = () => new Date()} = {}) {
  const context = permissionContext(rawContext);
  if (context.provider !== "shopify" || typeof admin?.graphql !== "function") {
    throw new TypeError("AUTHENTICATED_SHOPIFY_ADMIN_REQUIRED");
  }
  const startedAt = now();
  if (!(startedAt instanceof Date) || Number.isNaN(startedAt.valueOf())) throw new TypeError("VALID_NOW_REQUIRED");
  // One read. No OAuth/refresh/reauthorization, mutation, retry or fallback on any error.
  let response;
  let body;
  try {
    response = await admin.graphql(SHOPIFY_PERMISSION_SCOPES_QUERY, {tries: 1});
    if (response?.ok === false || typeof response?.json !== "function") throw new Error();
    body = await response.json();
  } catch {
    // Do not expose token-bearing SDK/transport messages or response bodies.
    throw readFailure(response);
  }
  if ((body?.errors && (!Array.isArray(body.errors) || body.errors.length > 0))
    || !body?.data?.shop || !body.data.currentAppInstallation) {
    throw readFailure(response);
  }
  const {shop, currentAppInstallation: installation} = body.data;
  if (shop.id !== context.shopId || shop.myshopifyDomain !== context.shopDomain) {
    throw new Error("SHOPIFY_PERMISSION_SHOP_MISMATCH");
  }
  if (!/^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/.test(installation.id || "")
    || !Array.isArray(installation.accessScopes) || installation.accessScopes.length > 100) {
    throw new Error("SHOPIFY_PERMISSION_SCOPES_RESPONSE_INVALID");
  }
  const scopes = Array.from(installation.accessScopes, entry => entry?.handle);
  if (scopes.some(scope => typeof scope !== "string" || scope.length > 200 || !/^[a-z][a-z0-9_]*$/.test(scope))
    || new Set(scopes).size !== scopes.length) throw new Error("SHOPIFY_PERMISSION_SCOPES_RESPONSE_INVALID");
  const completedAt = now();
  if (!(completedAt instanceof Date) || Number.isNaN(completedAt.valueOf()) || completedAt < startedAt) {
    throw new Error("SHOPIFY_PERMISSION_OBSERVATION_TIME_INVALID");
  }
  return Object.freeze({
    source: "shopify_current_app_installation", context,
    // Age starts at request time; a slow read cannot make old evidence fresh.
    observedAt: startedAt.toISOString(), complete: true,
    appInstallationId: installation.id, scopes: Object.freeze(scopes),
  });
}

// verified is the server result of Shopify authentication and installation resolution.
// This function compares scopes; it does not authorize product/order reads.
export async function inspectShopifyIdentityPermissionScopes({
  verified, database, includeOrders = false, includeOrderHistory = false, includeMarketingEvents = false,
  now = () => new Date(),
} = {}) {
  const owner = verified?.installationAuthority;
  const identity = verified?.identity;
  if (owner?.authority !== "shopify_installation_verified" || owner.status !== "active"
    || identity?.session?.authority !== "shopify_id_token_verified"
    || identity?.shop?.authority !== "shopify_admin_verified") {
    throw new Error("SHOPIFY_PERMISSION_VERIFIED_CALLER_REQUIRED");
  }
  const context = permissionContext({provider: "shopify", workspaceId: owner.workspaceId,
    installGeneration: owner.installGeneration, shopId: identity.shop.shopId,
    shopDomain: identity.shop.myshopifyDomain});
  if (identity.session.shopDomain !== context.shopDomain) {
    throw new Error("SHOPIFY_PERMISSION_VERIFIED_CALLER_MISMATCH");
  }
  const admin = verified?.context?.admin;
  if (typeof admin?.graphql !== "function") throw new TypeError("AUTHENTICATED_SHOPIFY_ADMIN_REQUIRED");
  identityPermissionRequirements({provider: "shopify", includeOrders, includeOrderHistory, includeMarketingEvents});
  const installation = createShopifyRuntimeRepositories(database).installation;
  const assertCurrent = async () => {
    let current;
    try {
      current = await installation.resolveActive({shopId: context.shopId, shopDomain: context.shopDomain});
    } catch {
      throw new Error("SHOPIFY_PERMISSION_INSTALLATION_READ_FAILED");
    }
    if (current.status !== "active" || current.workspaceId !== context.workspaceId
      || current.installGeneration !== context.installGeneration) {
      throw new Error("SHOPIFY_PERMISSION_INSTALLATION_CHANGED");
    }
  };
  await assertCurrent();
  const evidence = await readShopifyPermissionScopes({context, admin, now});
  await assertCurrent();
  const assessment = assessIdentityPermissionScopes({context, evidence,
    includeOrders, includeOrderHistory, includeMarketingEvents, now});
  return Object.freeze({context, evidence, assessment});
}
