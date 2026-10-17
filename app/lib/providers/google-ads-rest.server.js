import { OAUTH_CALLBACK_URIS } from "../oauth/oauth-transaction.server.js";

export const GOOGLE_ADS_OAUTH_SCOPE = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_ADS_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_ADS_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_ADS_REVOCATION_ENDPOINT =
  "https://oauth2.googleapis.com/revoke";
export const GOOGLE_ADS_REST_ORIGIN = "https://googleads.googleapis.com";
export const GOOGLE_ADS_REST_VERSION = "v25";

const CUSTOMER_RESOURCE_PATTERN = /^customers\/([0-9]+)$/;
const TOKEN_TYPE_PATTERN = /^Bearer$/i;

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
  url.searchParams.set("scope", GOOGLE_ADS_OAUTH_SCOPE);
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
}) {
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
  return normalizedTokenSet(payload, { requireRefreshToken: true });
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
}) {
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
  return normalizedTokenSet(payload, {
    requireRefreshToken: true,
    existingRefreshToken: retainedRefreshToken,
  });
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

async function googleJson({ url, method, headers, body, fetchFn }) {
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
    throw new GoogleAdsRestError(
      "GOOGLE_ADS_REST_REQUEST_FAILED",
      "Google Ads REST request failed",
      {
        status: response.status,
        provider_status: publicProviderError(payload),
        provider_error_code: publicProviderFailureCode(payload),
        request_id: requestId,
      },
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
      });
      if (!Array.isArray(result.payload?.results ?? [])) {
        throw new GoogleAdsRestError(
          "GOOGLE_ADS_SEARCH_SCHEMA_CHANGED",
          "Google Ads search response is malformed",
          { request_id: result.requestId },
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
