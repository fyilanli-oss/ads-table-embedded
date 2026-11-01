const nativeTargets = Object.freeze({
  google_ads: ["https://accounts.google.com", "/o/oauth2/v2/auth"],
  meta: ["https://www.facebook.com", "/v26.0/dialog/oauth"],
  klaviyo: ["https://www.klaviyo.com", "/oauth/authorize"],
});

export function permissionAuthorizationTarget(feature, value) {
  if (!Object.hasOwn(nativeTargets, feature) || typeof value !== "string") return null;
  try {
    const target = new URL(value);
    const [origin, pathname] = nativeTargets[feature];
    return target.origin === origin && target.pathname === pathname && !target.username && !target.password
      ? target.toString() : null;
  } catch { return null; }
}

export function permissionResponseMatches(reply, pending) {
  return !!pending && reply?.requestId === pending.requestId && reply?.feature === pending.feature
    && ["unavailable", "unknown", "authorization", "status", "scope_request"].includes(reply?.kind)
    && (reply.kind !== "scope_request" || validShopifyScopeRequest(reply))
    && (reply.kind !== "authorization" || permissionAuthorizationTarget(reply.feature, reply.authorizationUrl) !== null)
    && (reply.kind !== "status" || ["request_permissions", "select_account", "select_reporting_account",
      "reporting_selected", "review_setup", "klaviyo_cost_missing", "existing_reporting_connection", "products_required"].includes(reply.stage))
    && (reply?.selection === undefined || reply.kind === "status"
      && ["select_account", "select_reporting_account"].includes(reply.stage) && validSelection(reply.selection))
    && (reply?.connection === undefined || reply.kind === "status" && reply.stage === "reporting_selected"
      && validSelection(reply.connection) && reply.connection.accounts.length >= 1 && reply.connection.accounts.length <= 3
      && reply.connection.accounts.some(account => account.id === reply.connection.reportingAccountId))
    && (!(reply.kind === "status" && ["google_ads", "meta"].includes(reply.feature))
      || (reply.stage === "reporting_selected" ? reply.connection !== undefined
        : !["select_account", "select_reporting_account"].includes(reply.stage) || reply.selection !== undefined))
    && reply?.expiresAt === undefined;
}

export function validShopifyScopeRequest(value) {
  const target = value?.feature === "shopify_products" ? "read_products" : value?.feature === "shopify_orders" ? "read_orders" : null;
  const b = value?.binding;
  return target !== null && value?.kind === "scope_request" && value.scope === target
    && /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(b?.shopId ?? "")
    && /^gid:\/\/shopify\/AppInstallation\/[1-9][0-9]*$/.test(b?.appInstallationId ?? "")
    && Number.isSafeInteger(b?.installGeneration) && b.installGeneration >= 1
    && Object.keys(b).length === 3 && value.authorizationUrl === undefined;
}

function validSelection(value) {
  if (value?.assetOptions !== undefined) return false;
  if (typeof value?.connectionId !== "string" || !value.connectionId || value.connectionId.length > 128
    || !Number.isSafeInteger(value.version) || value.version < 1 || !Array.isArray(value.accounts) || value.accounts.length > 10000
    || value.reportingAccountId !== null && (typeof value.reportingAccountId !== "string" || !value.reportingAccountId || value.reportingAccountId.length > 128)) return false;
  const ids = new Set();
  return value.accounts.every(account => {
    if (typeof account?.id !== "string" || !account.id || account.id.length > 128 || ids.has(account.id)
      || typeof account.name !== "string" || account.name.length > 512) return false;
    ids.add(account.id); return true;
  });
}
