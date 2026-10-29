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
      "verify_assets", "review_setup", "klaviyo_cost_missing", "existing_reporting_connection", "products_required"].includes(reply.stage))
    && (reply?.selection === undefined || reply.kind === "status" && validSelection(reply.selection, reply.feature))
    && (reply?.expiresAt === undefined || typeof reply.expiresAt === "string" && Date.parse(reply.expiresAt) > Date.now());
}

function validSelection(value, feature) {
  if (typeof value?.connectionId !== "string" || !value.connectionId || value.connectionId.length > 128
    || !Number.isSafeInteger(value.version) || value.version < 1 || !Array.isArray(value.accounts) || value.accounts.length > 10000
    || value.reportingAccountId !== null && (typeof value.reportingAccountId !== "string" || !value.reportingAccountId || value.reportingAccountId.length > 128)) return false;
  const ids = new Set();
  const accountsValid = value.accounts.every(account => {
    if (typeof account?.id !== "string" || !account.id || account.id.length > 128 || ids.has(account.id)
      || typeof account.name !== "string" || account.name.length > 512) return false;
    ids.add(account.id); return true;
  });
  if (!accountsValid || value.assetOptions === undefined) return accountsValid;
  const options = value.assetOptions;
  if (value.reportingAccountId === null || options?.complete !== true || options.accessVerified !== false || typeof options.expiresAt !== "string"
    || !(Date.parse(options.expiresAt) > Date.now()) || !Array.isArray(options.candidates) || options.candidates.length > 10000
    || (feature === "google_ads" ? options.candidateKind !== "merchant_accounts"
      : feature !== "meta" || !["businesses", "catalogs"].includes(options.candidateKind))
    || (options.candidateKind === "catalogs" ? typeof options.businessId !== "string" || !/^[1-9][0-9]{0,29}$/.test(options.businessId)
      : options.businessId !== null)) return false;
  const candidates = new Set();
  return options.candidates.every(value => {
    if (typeof value?.id !== "string" || !/^[1-9][0-9]{0,29}$/.test(value.id) || candidates.has(value.id)
      || typeof value.name !== "string" || !value.name || value.name.length > 512) return false;
    candidates.add(value.id); return true;
  });
}
