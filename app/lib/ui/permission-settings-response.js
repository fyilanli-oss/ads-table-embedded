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
    && ["unavailable", "unknown", "authorization", "status"].includes(reply?.kind)
    && (reply.kind !== "authorization" || permissionAuthorizationTarget(reply.feature, reply.authorizationUrl) !== null)
    && (reply.kind !== "status" || ["request_permissions", "select_account", "select_reporting_account",
      "verify_assets", "review_setup", "klaviyo_cost_missing", "existing_reporting_connection", "products_required"].includes(reply.stage));
}
