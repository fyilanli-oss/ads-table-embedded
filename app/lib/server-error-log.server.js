import {googleAdsRestFailureMetadata} from "./providers/google-ads-rest.server.js";

const ROUTES = new Set(["/", "/ad-analysis", "/settings"]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
function emit(record) { console.error(JSON.stringify(record)); }

// Never inspect an error object: messages, causes and custom properties are untrusted data.
export function logServerFailure(stage, request) {
  const render = stage === "render";
  let route = "other";
  let method = "other";
  try {
    const pathname = new URL(request.url).pathname;
    if (ROUTES.has(pathname)) route = pathname;
    if (METHODS.has(request.method)) method = request.method;
  } catch {
    // Malformed log context must not replace the original application failure.
  }
  try {
    emit({
      event: "adstable_server_error",
      code: render ? "SERVER_RENDER_FAILED" : "SERVER_REQUEST_FAILED",
      stage: render ? "render" : "request",
      route,
      method,
    });
  } catch {
    // Logging failure must not change response status, shell rejection or recovery.
  }
}

export function handleServerError(_error, {request}) {
  if (!request.signal.aborted) logServerFailure("request", request);
}

const FEATURES = new Set(["google_ads", "meta", "klaviyo", "shopify_products", "shopify_orders"]);
const INTENTS = new Set(["permission_connect", "permission_callback", "permission_status", "permission_reconcile", "permission_change_reporting", "permission_disconnect", "permission_revoke_products", "permission_revoke_orders", "permission_select_accounts", "permission_select_reporting"]);
const CODES = new Set([
  "IDENTITY_OAUTH_CONNECTION_STATE_NOT_ELIGIBLE", "IDENTITY_OAUTH_DISCONNECT_INCOMPLETE",
  "IDENTITY_OAUTH_CONNECTION_CHANGED", "IDENTITY_OAUTH_START_DISABLED", "ACTIVE_INSTALLATION_REQUIRED",
  "IDENTITY_OAUTH_WRITE_UNCONFIRMED", "IDENTITY_OAUTH_CLAIM_REQUIRED", "IDENTITY_OAUTH_SCOPE_DOWNGRADE",
  "OAUTH_IDENTITY_SCOPE_NOT_GRANTED", "OAUTH_IDENTITY_SCOPE_RESPONSE_INVALID",
  "GOOGLE_ADS_OAUTH_TOKEN_EXCHANGE_FAILED", "GOOGLE_ADS_OAUTH_REFRESH_TOKEN_MISSING",
  "IDENTITY_OAUTH_FINALIZATION_UNCONFIRMED", "GOOGLE_CALLBACK_FAILED",
  "GOOGLE_ADS_REST_REQUEST_FAILED",
  "GOOGLE_ADS_OAUTH_CLIENT_ID_REQUIRED", "GOOGLE_ADS_OAUTH_CLIENT_SECRET_REQUIRED",
  "GOOGLE_ADS_OAUTH_REDIRECT_URI_INVALID", "GOOGLE_ADS_OAUTH_REDIRECT_URI_MISMATCH",
  "PERMISSION_SETTINGS_START_UNCONFIRMED", "PERMISSION_SETTINGS_SCOPE_BINDING_CHANGED",
  "COMBINED_SETUP_LIFECYCLE_UNAVAILABLE", "COMBINED_SETUP_CONNECTION_CHANGED",
]);

// Only exact allowlisted literals leave this log. Never log the raw error.
export function logPermissionFailure({feature, intent, requestId, error}) {
  try {
    let code = "PERMISSION_OPERATION_UNCONFIRMED";
    if (error instanceof Error) {
      for (const key of ["code", "message"]) {
        const value = Object.getOwnPropertyDescriptor(error, key)?.value;
        if (CODES.has(value)) {code = value; break;}
      }
    }
    const rest = feature === "google_ads" && intent === "permission_callback" && code === "GOOGLE_ADS_REST_REQUEST_FAILED"
      ? googleAdsRestFailureMetadata(error) : null;
    emit({event: "adstable_permission_error", code,
      feature: FEATURES.has(feature) ? feature : "unknown",
      intent: INTENTS.has(intent) ? intent : "unknown",
      requestId: typeof requestId === "string" && /^[a-f0-9-]{36}$/.test(requestId) ? requestId : null,
      ...(rest ? {google_rest: rest} : {})});
  } catch { /* Log delivery must not change the existing unknown response. */ }
}
