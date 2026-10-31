const FEATURES = new Set(["google_ads", "meta", "klaviyo", "shopify_products", "shopify_orders"]);
const INTENTS = new Set(["permission_connect", "permission_status", "permission_revoke_products", "permission_revoke_orders", "permission_select_accounts", "permission_select_reporting"]);
const CODES = new Set([
  "IDENTITY_OAUTH_CONNECTION_STATE_NOT_ELIGIBLE", "IDENTITY_OAUTH_DISCONNECT_INCOMPLETE",
  "IDENTITY_OAUTH_CONNECTION_CHANGED", "IDENTITY_OAUTH_START_DISABLED", "ACTIVE_INSTALLATION_REQUIRED",
  "IDENTITY_OAUTH_WRITE_UNCONFIRMED", "IDENTITY_OAUTH_CLAIM_REQUIRED", "IDENTITY_OAUTH_SCOPE_DOWNGRADE",
  "OAUTH_IDENTITY_SCOPE_NOT_GRANTED", "OAUTH_IDENTITY_SCOPE_RESPONSE_INVALID",
  "GOOGLE_ADS_OAUTH_CLIENT_ID_REQUIRED", "GOOGLE_ADS_OAUTH_CLIENT_SECRET_REQUIRED",
  "GOOGLE_ADS_OAUTH_REDIRECT_URI_INVALID", "GOOGLE_ADS_OAUTH_REDIRECT_URI_MISMATCH",
  "PERMISSION_SETTINGS_START_UNCONFIRMED", "PERMISSION_SETTINGS_SCOPE_BINDING_CHANGED",
  "COMBINED_SETUP_LIFECYCLE_UNAVAILABLE", "COMBINED_SETUP_CONNECTION_CHANGED",
]);

// Only exact allowlisted literals leave this function. Never log the raw error.
export function logPermissionFailure({feature, intent, requestId, error}) {
  try {
    let code = "PERMISSION_OPERATION_UNCONFIRMED";
    if (error instanceof Error) {
      for (const key of ["code", "message"]) {
        const value = Object.getOwnPropertyDescriptor(error, key)?.value;
        if (CODES.has(value)) {code = value; break;}
      }
    }
    console.error(JSON.stringify({event: "adstable_permission_error", code,
      feature: FEATURES.has(feature) ? feature : "unknown",
      intent: INTENTS.has(intent) ? intent : "unknown",
      requestId: typeof requestId === "string" && /^[a-f0-9-]{36}$/.test(requestId) ? requestId : null}));
  } catch { /* Log delivery must not change the existing unknown response. */ }
}
