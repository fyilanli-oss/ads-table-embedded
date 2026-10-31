import { OAUTH_CALLBACK_URIS } from "../oauth/oauth-transaction.server.js";
import {stampGoogleIdentityCredential} from "../oauth/google-identity-credential.server.js";
import {GOOGLE_REPORTING_SCOPE, oauthPermissionProfile, oauthPermissionProfileFromState,
  oauthPermissionScopes, validateIdentityOAuthGrantedScopes} from "../oauth/oauth-permission-profile.server.js";

export const GOOGLE_ADS_OAUTH_SCOPE = GOOGLE_REPORTING_SCOPE;
export const GOOGLE_ADS_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_ADS_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_ADS_REVOCATION_ENDPOINT =
  "https://oauth2.googleapis.com/revoke";
export const GOOGLE_ADS_REST_ORIGIN = "https://googleads.googleapis.com";
export const GOOGLE_ADS_REST_VERSION = "v25";

const CUSTOMER_RESOURCE_PATTERN = /^customers\/([0-9]+)$/;
const TOKEN_TYPE_PATTERN = /^Bearer$/i;
const restFailureMetadata = new WeakMap();
const REST_OPERATIONS = new Set(["list_accessible_customers", "search"]);
const GOOGLE_STATUSES = new Set(["CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED", "NOT_FOUND", "ALREADY_EXISTS", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "ABORTED", "OUT_OF_RANGE", "UNIMPLEMENTED", "INTERNAL", "UNAVAILABLE", "DATA_LOSS", "UNAUTHENTICATED"]);
// Fixed documented values only; uppercase-looking arbitrary payload is not safe.
const GOOGLE_FAILURE_CODES = new Set([
  "USER_PERMISSION_DENIED", "CUSTOMER_NOT_ENABLED", "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION",
  "CLOUD_PROJECT_NOT_UNDER_ORGANIZATION", "PROJECT_DISABLED", "SERVICE_ACCESS_DENIED",
  "DEVELOPER_TOKEN_NOT_APPROVED", "DEVELOPER_TOKEN_NOT_ON_ALLOWLIST", "DEVELOPER_TOKEN_PROHIBITED",
  "INCOMPLETE_SIGNUP", "INVALID_LOGIN_CUSTOMER_ID_SERVING_CUSTOMER_ID_COMBINATION", "METRIC_ACCESS_DENIED", "MISSING_TOS",
  "ADVANCED_PROTECTION_NOT_ENROLLED", "AUTHENTICATION_ERROR", "CLIENT_CUSTOMER_ID_INVALID", "CUSTOMER_NOT_FOUND",
  "DEVELOPER_TOKEN_INVALID", "GOOGLE_ACCOUNT_AUTHENTICATION_FAILED", "GOOGLE_ACCOUNT_DELETED",
  "GOOGLE_ACCOUNT_USER_AND_ADS_USER_MISMATCH", "INVALID_EMAIL_ADDRESS", "NOT_ADS_USER", "OAUTH_TOKEN_DISABLED",
  "OAUTH_TOKEN_EXPIRED", "OAUTH_TOKEN_HEADER_INVALID", "OAUTH_TOKEN_INVALID", "OAUTH_TOKEN_REVOKED",
  "ORGANIZATION_NOT_APPROVED", "ORGANIZATION_NOT_ASSOCIATED_WITH_DEVELOPER_TOKEN", "ORGANIZATION_NOT_RECOGNIZED",
  "TWO_STEP_VERIFICATION_NOT_ENROLLED", "ACCESS_PROHIBITED",
  "EXCESSIVE_LONG_TERM_QUERY_RESOURCE_CONSUMPTION", "EXCESSIVE_SHORT_TERM_QUERY_RESOURCE_CONSUMPTION",
  "PAYMENTS_PROFILE_ACTIVATION_RATE_LIMIT_EXCEEDED", "RESOURCE_EXHAUSTED", "RESOURCE_TEMPORARILY_EXHAUSTED",
  "BAD_RESOURCE_ID", "CANNOT_BE_EXECUTED_BY_MANAGER_ACCOUNT", "CLOUD_PROJECT_NOT_FOUND",
  "DEVELOPER_TOKEN_PARAMETER_MISSING", "EXPIRED_PAGE_TOKEN", "INVALID_CUSTOMER_ID", "INVALID_ENUM_VALUE",
  "INVALID_PAGE_SIZE", "INVALID_PAGE_TOKEN", "LOGIN_CUSTOMER_ID_PARAMETER_MISSING", "PAGE_SIZE_NOT_SUPPORTED",
  "REQUIRED_FIELD_MISSING", "RESOURCE_NAME_MALFORMED", "RESOURCE_NAME_MISSING", "RESOURCE_NOT_FOUND",
  "RPC_DEADLINE_TOO_SHORT", "UNSUPPORTED_VERSION", "DEADLINE_EXCEEDED", "ERROR_CODE_NOT_PUBLISHED",
  "INTERNAL_ERROR", "TRANSIENT_ERROR",
  "UNKNOWN", "UNSPECIFIED",
]);

// Metadata is derived at the actual REST failure, never from a caller's error
// details. No header/request-id, endpoint, account, query or payload leaves here.
function restRequestFailure(message, details, operation) {
  const error = new GoogleAdsRestError("GOOGLE_ADS_REST_REQUEST_FAILED", message, details);
  restFailureMetadata.set(error, Object.freeze({
    operation: REST_OPERATIONS.has(operation) ? operation : null,
    http_status: Number.isInteger(details.status) && details.status >= 200 && details.status <= 599 ? details.status : null,
    provider_status: GOOGLE_STATUSES.has(details.provider_status) ? details.provider_status : null,
    provider_error_code: GOOGLE_FAILURE_CODES.has(details.provider_error_code) ? details.provider_error_code : null,
  }));
  return error;
}
export function googleAdsRestFailureMetadata(error) {
  return restFailureMetadata.get(error) ?? null;
}

export class GoogleAdsRestError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "GoogleAdsRestError";
    this.code = code;
    this.details = details;
  }
}

function nonEmpty(value, code, maximum = 4096) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
  ) {
    throw new GoogleAdsRestError(code, code);
  }
  return value;
}

function optionalNonEmpty(value, code, maximum = 4096) {
  if (value === undefined || value === null || value === "") return null;
  return nonEmpty(value, code, maximum);
}

function exactRedirect(value) {
  const redirect = nonEmpty(value, "GOOGLE_ADS_OAUTH_REDIRECT_URI_INVALID", 2048);
  if (redirect !== OAUTH_CALLBACK_URIS.google_ads) {
    throw new GoogleAdsRestError(
      "GOOGLE_ADS_OAUTH_REDIRECT_URI_MISMATCH",
      "Google Ads redirect URI does not match the accepted callback contract",
    );
  }
  return redirect;
}

export function readGoogleAdsOAuthConfig(environment = process.env) {
  return Object.freeze({
    clientId: nonEmpty(
      environment?.GOOGLE_ADS_OAUTH_CLIENT_ID,
      "GOOGLE_ADS_OAUTH_CLIENT_ID_REQUIRED",
    ),
    clientSecret: nonEmpty(
      environment?.GOOGLE_ADS_OAUTH_CLIENT_SECRET,
      "GOOGLE_ADS_OAUTH_CLIENT_SECRET_REQUIRED",
    ),
    redirectUri: exactRedirect(environment?.GOOGLE_ADS_OAUTH_REDIRECT_URI),
    developerToken: optionalNonEmpty(
      environment?.GOOGLE_ADS_DEVELOPER_TOKEN,
      "GOOGLE_ADS_DEVELOPER_TOKEN_INVALID",
      256,
    ),
  });
}

export function buildGoogleAdsAuthorizationUrl({
  config,
  state,
  pkceChallenge,
  loginHint = null,
}) {
  const url = new URL(GOOGLE_ADS_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", nonEmpty(config?.clientId, "GOOGLE_ADS_OAUTH_CLIENT_ID_REQUIRED"));
  url.searchParams.set("redirect_uri", exactRedirect(config?.redirectUri));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", oauthPermissionScopes("google_ads", oauthPermissionProfileFromState("google_ads", state)).join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", nonEmpty(state, "GOOGLE_ADS_OAUTH_STATE_REQUIRED", 128));
  url.searchParams.set(
    "code_challenge",
    nonEmpty(pkceChallenge, "GOOGLE_ADS_OAUTH_PKCE_CHALLENGE_REQUIRED", 128),
  );
  url.searchParams.set("code_challenge_method", "S256");
  if (loginHint !== null) {
    url.searchParams.set("login_hint", nonEmpty(loginHint, "GOOGLE_ADS_OAUTH_LOGIN_HINT_INVALID", 320));
  }
  return url.toString();
}

function responseHeader(response, name) {
  return response?.headers?.get?.(name) ?? null;
}

async function jsonResponse(response) {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function publicProviderError(payload) {
  const status = payload?.error?.status ?? payload?.error ?? null;
  return typeof status === "string" && status.length <= 100 ? status : null;
}

function publicProviderFailureCode(payload) {
  const details = payload?.error?.details;
  if (!Array.isArray(details)) return null;
  for (const detail of details) {
    if (!Array.isArray(detail?.errors)) continue;
    for (const providerError of detail.errors) {
      const errorCode = providerError?.errorCode;
      if (!errorCode || typeof errorCode !== "object") continue;
      for (const value of Object.values(errorCode)) {
        if (typeof value === "string" && /^[A-Z0-9_]{1,100}$/.test(value)) {
          return value;
        }
      }
    }
  }
  return null;
}

async function postTokenForm({ form, fetchFn }) {
  const response = await fetchFn(GOOGLE_ADS_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const payload = await jsonResponse(response);
  if (!response.ok) {
    throw new GoogleAdsRestError(
      "GOOGLE_ADS_OAUTH_TOKEN_EXCHANGE_FAILED",
      "Google OAuth token endpoint rejected the request",
      {
        status: response.status,
        provider_status: publicProviderError(payload),
        request_id: responseHeader(response, "x-guploader-uploadid"),
      },
    );
  }
  return payload;
}

function normalizedTokenSet(payload, { requireRefreshToken, existingRefreshToken = null }) {
  const accessToken = nonEmpty(payload?.access_token, "GOOGLE_ADS_OAUTH_ACCESS_TOKEN_MISSING");
  const tokenType = nonEmpty(payload?.token_type, "GOOGLE_ADS_OAUTH_TOKEN_TYPE_MISSING", 32);
  if (!TOKEN_TYPE_PATTERN.test(tokenType)) {
    throw new GoogleAdsRestError(
      "GOOGLE_ADS_OAUTH_TOKEN_TYPE_INVALID",
      "Google OAuth token type must be Bearer",
    );
  }
  const expiresIn = Number(payload?.expires_in);
  if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 86400) {
    throw new GoogleAdsRestError(
      "GOOGLE_ADS_OAUTH_EXPIRY_INVALID",
      "Google OAuth token expiry is invalid",
    );
  }
  const refreshToken =
    typeof payload?.refresh_token === "string" && payload.refresh_token.length > 0
      ? payload.refresh_token
      : existingRefreshToken;
  if (requireRefreshToken && !refreshToken) {
    throw new GoogleAdsRestError(
      "GOOGLE_ADS_OAUTH_REFRESH_TOKEN_MISSING",
      "Google OAuth response did not include an offline refresh token",
    );
  }
  return Object.freeze({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    scope: typeof payload?.scope === "string" ? payload.scope : GOOGLE_ADS_OAUTH_SCOPE,
  });
}

export async function exchangeGoogleAdsAuthorizationCode({
  config,
  authorizationCode,
  pkceVerifier,
  fetchFn = fetch,
  permissionProfile = "reporting_v1",
  now = () => new Date(),
}) {
  oauthPermissionProfile("google_ads", permissionProfile);
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const payload = await postTokenForm({
    fetchFn,
    form: {
      client_id: nonEmpty(config?.clientId, "GOOGLE_ADS_OAUTH_CLIENT_ID_REQUIRED"),
      client_secret: nonEmpty(config?.clientSecret, "GOOGLE_ADS_OAUTH_CLIENT_SECRET_REQUIRED"),
      code: nonEmpty(authorizationCode, "GOOGLE_ADS_OAUTH_CODE_REQUIRED"),
      code_verifier: nonEmpty(pkceVerifier, "GOOGLE_ADS_OAUTH_PKCE_VERIFIER_REQUIRED", 128),
      grant_type: "authorization_code",
      redirect_uri: exactRedirect(config?.redirectUri),
    },
  });
  if (permissionProfile === "identity_v1") validateIdentityOAuthGrantedScopes("google_ads", payload?.scope);
  const normalized = normalizedTokenSet(payload, { requireRefreshToken: true });
  return permissionProfile === "identity_v1" ? stampGoogleIdentityCredential(normalized, now) : normalized;
}

export async function revokeGoogleAdsAuthorization({
  token,
  fetchFn = fetch,
}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const response = await fetchFn(GOOGLE_ADS_REVOCATION_ENDPOINT, {
    method: "POST",
    headers: {"content-type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      token: nonEmpty(token, "GOOGLE_ADS_OAUTH_REVOCATION_TOKEN_REQUIRED"),
    }).toString(),
  });
  if (response.ok) {
    return Object.freeze({outcome: "revoked"});
  }
  const payload = await jsonResponse(response);
  if (response.status === 400 && payload?.error === "invalid_token") {
    return Object.freeze({outcome: "already_invalid"});
  }
  throw new GoogleAdsRestError(
    "GOOGLE_ADS_OAUTH_REVOKE_FAILED",
    "Google OAuth revocation endpoint rejected the request",
    {
      status: response.status,
      provider_status: publicProviderError(payload),
      request_id: responseHeader(response, "x-guploader-uploadid"),
    },
  );
}

export async function refreshGoogleAdsAccessToken({
  config,
  refreshToken,
  fetchFn = fetch,
  permissionProfile = "reporting_v1",
  now = () => new Date(),
}) {
  oauthPermissionProfile("google_ads", permissionProfile);
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const retainedRefreshToken = nonEmpty(
    refreshToken,
    "GOOGLE_ADS_OAUTH_REFRESH_TOKEN_REQUIRED",
  );
  const payload = await postTokenForm({
    fetchFn,
    form: {
      client_id: nonEmpty(config?.clientId, "GOOGLE_ADS_OAUTH_CLIENT_ID_REQUIRED"),
      client_secret: nonEmpty(config?.clientSecret, "GOOGLE_ADS_OAUTH_CLIENT_SECRET_REQUIRED"),
      refresh_token: retainedRefreshToken,
      grant_type: "refresh_token",
    },
  });
  if (permissionProfile === "identity_v1") validateIdentityOAuthGrantedScopes("google_ads", payload?.scope);
  const normalized = normalizedTokenSet(payload, {
    requireRefreshToken: true,
    existingRefreshToken: retainedRefreshToken,
  });
  return permissionProfile === "identity_v1" ? stampGoogleIdentityCredential(normalized, now) : normalized;
}

function customerId(value, code = "GOOGLE_ADS_CUSTOMER_ID_INVALID") {
  const normalized = String(value ?? "").replaceAll("-", "");
  if (!/^[0-9]+$/.test(normalized)) {
    throw new GoogleAdsRestError(code, code);
  }
  return normalized;
}

function googleHeaders({ accessToken, developerToken, loginCustomerId = null }) {
  const headers = {
    authorization: `Bearer ${nonEmpty(accessToken, "GOOGLE_ADS_ACCESS_TOKEN_REQUIRED")}`,
    "content-type": "application/json",
  };
  const optionalDeveloperToken = optionalNonEmpty(
    developerToken,
    "GOOGLE_ADS_DEVELOPER_TOKEN_INVALID",
    256,
  );
  if (optionalDeveloperToken !== null) {
    headers["developer-token"] = optionalDeveloperToken;
  }
  if (loginCustomerId !== null) {
    headers["login-customer-id"] = customerId(
      loginCustomerId,
      "GOOGLE_ADS_LOGIN_CUSTOMER_ID_INVALID",
    );
  }
  return headers;
}

async function googleJson({ url, method, headers, body, fetchFn, operation }) {
  const response = await fetchFn(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await jsonResponse(response);
  const requestId =
    responseHeader(response, "request-id")
    ?? responseHeader(response, "x-google-request-id");
  if (!response.ok) {
    throw restRequestFailure(
      "Google Ads REST request failed",
      {
        status: response.status,
        provider_status: publicProviderError(payload),
        provider_error_code: publicProviderFailureCode(payload),
        request_id: requestId,
      }, operation,
    );
  }
  return Object.freeze({ payload, requestId });
}

export function createGoogleAdsRestClient({
  accessToken,
  developerToken,
  loginCustomerId = null,
  fetchFn = fetch,
} = {}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const headers = googleHeaders({accessToken, developerToken, loginCustomerId});

  return Object.freeze({
    async listAccessibleCustomers() {
      const result = await googleJson({
        url: `${GOOGLE_ADS_REST_ORIGIN}/${GOOGLE_ADS_REST_VERSION}/customers:listAccessibleCustomers`,
        method: "GET",
        operation: "list_accessible_customers",
        headers: googleHeaders({accessToken, developerToken, loginCustomerId: null}),
        fetchFn,
      });
      const names = result.payload?.resourceNames;
      if (!Array.isArray(names)) {
        throw new GoogleAdsRestError(
          "GOOGLE_ADS_ACCESSIBLE_CUSTOMERS_SCHEMA_CHANGED",
          "Google Ads accessible-customer response is malformed",
          { request_id: result.requestId },
        );
      }
      const customers = names.map((name) => {
        const match = CUSTOMER_RESOURCE_PATTERN.exec(name);
        if (!match) {
          throw new GoogleAdsRestError(
            "GOOGLE_ADS_ACCESSIBLE_CUSTOMER_INVALID",
            "Google Ads returned an invalid customer resource name",
            { request_id: result.requestId },
          );
        }
        return Object.freeze({ resource_name: name, customer_id: match[1] });
      });
      return Object.freeze({
        customers: Object.freeze(customers),
        request_id: result.requestId,
      });
    },

    async search({ customerId: selectedCustomerId, query, pageToken = null }) {
      const body = {
        query: nonEmpty(query, "GOOGLE_ADS_QUERY_REQUIRED", 100000),
      };
      if (pageToken !== null) {
        body.pageToken = nonEmpty(pageToken, "GOOGLE_ADS_PAGE_TOKEN_INVALID", 4096);
      }
      const result = await googleJson({
        url: `${GOOGLE_ADS_REST_ORIGIN}/${GOOGLE_ADS_REST_VERSION}/customers/${customerId(selectedCustomerId)}/googleAds:search`,
        method: "POST",
        headers,
        body,
        fetchFn,
        operation: "search",
      });
      if (result.payload && typeof result.payload === "object" && Object.hasOwn(result.payload, "error")) {
        throw restRequestFailure("Google Ads search returned an error", {
          status: 200, provider_status: publicProviderError(result.payload),
          provider_error_code: publicProviderFailureCode(result.payload), request_id: result.requestId,
        }, "search");
      }
      if (!result.payload || typeof result.payload !== "object" || Array.isArray(result.payload)
        || (Object.hasOwn(result.payload, "results") && !Array.isArray(result.payload.results))
        || (result.payload.results ?? []).some(row => !row || typeof row !== "object" || Array.isArray(row))) {
        throw new GoogleAdsRestError(
          "GOOGLE_ADS_SEARCH_SCHEMA_CHANGED",
          "Google Ads search response is malformed",
          { request_id: result.requestId },
        );
      }
      if (Object.hasOwn(result.payload ?? {}, "nextPageToken")
        && typeof result.payload.nextPageToken !== "string") {
        throw new GoogleAdsRestError(
          "GOOGLE_ADS_SEARCH_SCHEMA_CHANGED",
          "Google Ads search cursor is malformed",
          {request_id: result.requestId},
        );
      }
      return Object.freeze({
        results: Object.freeze([...(result.payload?.results ?? [])]),
        next_page_token:
          typeof result.payload?.nextPageToken === "string"
            ? result.payload.nextPageToken
            : null,
        total_results_count:
          Number.isSafeInteger(Number(result.payload?.totalResultsCount))
            ? Number(result.payload.totalResultsCount)
            : null,
        request_id: result.requestId,
      });
    },
  });
}
