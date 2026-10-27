import {OAUTH_CALLBACK_URIS} from "../oauth/oauth-transaction.server.js";

export const KLAVIYO_AUTHORIZATION_ENDPOINT = "https://www.klaviyo.com/oauth/authorize";
export const KLAVIYO_TOKEN_ENDPOINT = "https://a.klaviyo.com/oauth/token";
export const KLAVIYO_REVOCATION_ENDPOINT = "https://a.klaviyo.com/oauth/revoke";
export const KLAVIYO_ACCOUNTS_ENDPOINT = "https://a.klaviyo.com/api/accounts/";
export const KLAVIYO_API_REVISION = "2026-10-15";
export const KLAVIYO_OAUTH_SCOPES = Object.freeze([
  "accounts:read",
  "campaigns:read",
  "flows:read",
  "events:read",
  "metrics:read",
]);

const TOKEN_TYPE_PATTERN = /^Bearer$/i;

export class KlaviyoApiError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "KlaviyoApiError";
    this.code = code;
    this.details = details;
  }
}

function nonEmpty(value, code, maximum = 4096) {
  if (
    typeof value !== "string" || value.length < 1 || value.length > maximum
    || value !== value.trim()
  ) throw new KlaviyoApiError(code, code);
  return value;
}

function exactRedirect(value) {
  const redirect = nonEmpty(value, "KLAVIYO_OAUTH_REDIRECT_URI_INVALID", 2048);
  if (redirect !== OAUTH_CALLBACK_URIS.klaviyo) {
    throw new KlaviyoApiError(
      "KLAVIYO_OAUTH_REDIRECT_URI_MISMATCH",
      "Klaviyo redirect URI does not match the accepted callback contract",
    );
  }
  return redirect;
}

function basicAuthorization(config) {
  const clientId = nonEmpty(config?.clientId, "KLAVIYO_CLIENT_ID_REQUIRED", 256);
  const clientSecret = nonEmpty(config?.clientSecret, "KLAVIYO_CLIENT_SECRET_REQUIRED", 1024);
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
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

function providerError(payload) {
  const value = payload?.error ?? payload?.errors?.[0]?.code ?? null;
  return typeof value === "string" && value.length <= 100 ? value : null;
}

function scopesOf(value) {
  const entries = typeof value === "string"
    ? value.split(/[\s,]+/)
    : Array.isArray(value) ? value : [];
  const scopes = [...new Set(entries.filter(
    (entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 200,
  ))].sort();
  if (!scopes.includes("accounts:read")) {
    throw new KlaviyoApiError(
      "KLAVIYO_ACCOUNTS_SCOPE_MISSING",
      "Klaviyo authorization did not grant accounts:read",
    );
  }
  return Object.freeze(scopes);
}

function validNow(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  return value;
}

export function readKlaviyoOAuthConfig(environment = process.env) {
  return Object.freeze({
    clientId: nonEmpty(environment?.KLAVIYO_CLIENT_ID, "KLAVIYO_CLIENT_ID_REQUIRED", 256),
    clientSecret: nonEmpty(environment?.KLAVIYO_CLIENT_SECRET, "KLAVIYO_CLIENT_SECRET_REQUIRED", 1024),
    redirectUri: exactRedirect(environment?.KLAVIYO_OAUTH_REDIRECT_URI),
  });
}

export function buildKlaviyoAuthorizationUrl({config, state, pkceChallenge}) {
  const url = new URL(KLAVIYO_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", nonEmpty(config?.clientId, "KLAVIYO_CLIENT_ID_REQUIRED", 256));
  url.searchParams.set("redirect_uri", exactRedirect(config?.redirectUri));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", KLAVIYO_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", nonEmpty(state, "KLAVIYO_OAUTH_STATE_REQUIRED", 128));
  url.searchParams.set(
    "code_challenge",
    nonEmpty(pkceChallenge, "KLAVIYO_OAUTH_PKCE_CHALLENGE_REQUIRED", 128),
  );
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function tokenRequest({config, form, fetchFn, invalidGrantCode}) {
  const response = await fetchFn(KLAVIYO_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: basicAuthorization(config),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  const payload = await jsonResponse(response);
  if (!response.ok || !payload) {
    const providerStatus = providerError(payload);
    throw new KlaviyoApiError(
      response.status === 400 && providerStatus === "invalid_grant"
        ? invalidGrantCode
        : "KLAVIYO_OAUTH_TOKEN_REQUEST_FAILED",
      "Klaviyo token endpoint rejected the request",
      {
        status: response.status,
        provider_status: providerStatus,
        request_id: responseHeader(response, "x-request-id"),
      },
    );
  }
  return payload;
}

function nativeTokenScopes(value) {
  if (typeof value !== "string" || !/^[\x21\x23-\x5B\x5D-\x7E]+(?: [\x21\x23-\x5B\x5D-\x7E]+)*$/.test(value)) {
    throw new KlaviyoApiError("KLAVIYO_SCOPE_RESPONSE_INVALID", "Klaviyo token scope response is malformed");
  }
  const values = value.split(" ");
  if (values.length > 100 || values.some(scope => scope.length > 200) || new Set(values).size !== values.length) {
    throw new KlaviyoApiError("KLAVIYO_SCOPE_RESPONSE_INVALID", "Klaviyo token scope response is malformed");
  }
  return scopesOf(values);
}

function normalizedTokenSet(payload, now, fallbackScopes = null, previousScopeObservedAt = null) {
  const accessToken = nonEmpty(payload?.access_token, "KLAVIYO_ACCESS_TOKEN_MISSING", 16384);
  const refreshToken = nonEmpty(payload?.refresh_token, "KLAVIYO_REFRESH_TOKEN_MISSING", 16384);
  const tokenType = nonEmpty(payload?.token_type, "KLAVIYO_TOKEN_TYPE_MISSING", 32);
  if (!TOKEN_TYPE_PATTERN.test(tokenType)) {
    throw new KlaviyoApiError("KLAVIYO_TOKEN_TYPE_INVALID", "Klaviyo token type must be Bearer");
  }
  const expiresIn = Number(payload?.expires_in);
  if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 86400) {
    throw new KlaviyoApiError("KLAVIYO_TOKEN_EXPIRY_INVALID", "Klaviyo token expiry is invalid");
  }
  const nativeScopePresent = Object.hasOwn(payload, "scope");
  if (!nativeScopePresent && fallbackScopes === null) {
    throw new KlaviyoApiError("KLAVIYO_SCOPE_RESPONSE_REQUIRED", "Klaviyo did not return token scopes");
  }
  const scopes = nativeScopePresent ? nativeTokenScopes(payload.scope) : scopesOf(fallbackScopes);
  const verifiedAt = validNow(now).toISOString();
  const scopeObservedAt = nativeScopePresent ? verifiedAt : previousScopeObservedAt;
  if (scopeObservedAt !== null) {
    const observed = Date.parse(scopeObservedAt);
    if (typeof scopeObservedAt !== "string" || !Number.isFinite(observed)
      || new Date(observed).toISOString() !== scopeObservedAt || observed > Date.parse(verifiedAt)) {
      throw new KlaviyoApiError("KLAVIYO_SCOPE_OBSERVATION_INVALID", "Klaviyo stored scope observation time is invalid");
    }
  }
  const expiresAt = new Date(new Date(verifiedAt).valueOf() + expiresIn * 1000).toISOString();
  return Object.freeze({
    tokenSet: Object.freeze({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      expires_at: expiresAt,
      scope: scopes.join(" "),
      scopes,
      scope_source: nativeScopePresent ? "native_token_response" : "retained_previous_grant",
      scope_observed_at: scopeObservedAt,
    }),
    scopes,
    verifiedAt,
    expiresAt,
  });
}

export function klaviyoTokenRequiresRefresh(
  tokenSet,
  now = () => new Date(),
  minimumValidityMs = 60_000,
) {
  if (!Number.isSafeInteger(minimumValidityMs) || minimumValidityMs < 0) {
    throw new TypeError("minimumValidityMs must be a non-negative safe integer");
  }
  const current = validNow(now).valueOf();
  const expiresAt = typeof tokenSet?.expires_at === "string"
    ? Date.parse(tokenSet.expires_at)
    : Number.NaN;
  return Number.isNaN(expiresAt) || expiresAt <= current + minimumValidityMs;
}

export async function exchangeKlaviyoAuthorizationCode({
  config,
  authorizationCode,
  pkceVerifier,
  fetchFn = fetch,
  now = () => new Date(),
}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const payload = await tokenRequest({
    config,
    fetchFn,
    invalidGrantCode: "KLAVIYO_OAUTH_SESSION_EXPIRED",
    form: {
      grant_type: "authorization_code",
      redirect_uri: exactRedirect(config?.redirectUri),
      code: nonEmpty(authorizationCode, "KLAVIYO_OAUTH_CODE_REQUIRED"),
      code_verifier: nonEmpty(pkceVerifier, "KLAVIYO_OAUTH_PKCE_VERIFIER_REQUIRED", 128),
    },
  });
  return normalizedTokenSet(payload, now);
}

export async function refreshKlaviyoAccessToken({
  config,
  refreshToken,
  scopes,
  scopeObservedAt = null,
  fetchFn = fetch,
  now = () => new Date(),
}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const payload = await tokenRequest({
    config,
    fetchFn,
    invalidGrantCode: "KLAVIYO_REAUTHORIZATION_REQUIRED",
    form: {
      grant_type: "refresh_token",
      refresh_token: nonEmpty(refreshToken, "KLAVIYO_REFRESH_TOKEN_REQUIRED", 16384),
    },
  });
  return normalizedTokenSet(payload, now, scopes, scopeObservedAt);
}

export async function discoverKlaviyoAccount({
  accessToken,
  scopes,
  fetchFn = fetch,
  now = () => new Date(),
}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const grantedScopes = scopesOf(scopes);
  const response = await fetchFn(KLAVIYO_ACCOUNTS_ENDPOINT, {
    method: "GET",
    headers: {
      accept: "application/vnd.api+json",
      authorization: `Bearer ${nonEmpty(accessToken, "KLAVIYO_ACCESS_TOKEN_REQUIRED", 16384)}`,
      revision: KLAVIYO_API_REVISION,
    },
  });
  const payload = await jsonResponse(response);
  if (!response.ok || !payload) {
    throw new KlaviyoApiError(
      response.status === 401
        ? "KLAVIYO_REAUTHORIZATION_REQUIRED"
        : response.status === 403
          ? "KLAVIYO_PERMISSION_DENIED"
          : "KLAVIYO_ACCOUNTS_REQUEST_FAILED",
      "Klaviyo Accounts API rejected the request",
      {
        status: response.status,
        provider_status: providerError(payload),
        request_id: responseHeader(response, "x-request-id"),
      },
    );
  }
  if (!Array.isArray(payload.data) || payload.data.length !== 1) {
    throw new KlaviyoApiError(
      "KLAVIYO_ACCOUNT_CARDINALITY_INVALID",
      "Klaviyo OAuth must resolve exactly one account",
    );
  }
  const item = payload.data[0];
  if (item?.type !== "account") {
    throw new KlaviyoApiError("KLAVIYO_ACCOUNT_SCHEMA_CHANGED", "Klaviyo account type is invalid");
  }
  const attributes = item?.attributes;
  const id = nonEmpty(item?.id, "KLAVIYO_ACCOUNT_ID_INVALID", 256);
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    throw new KlaviyoApiError("KLAVIYO_ACCOUNT_SCHEMA_CHANGED", "Klaviyo account attributes are missing");
  }
  const name = nonEmpty(
    attributes.contact_information?.organization_name ?? attributes.name ?? id,
    "KLAVIYO_ACCOUNT_NAME_INVALID",
    256,
  );
  const currency = nonEmpty(attributes.preferred_currency, "KLAVIYO_ACCOUNT_CURRENCY_INVALID", 3);
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new KlaviyoApiError("KLAVIYO_ACCOUNT_CURRENCY_INVALID", "Klaviyo account currency is invalid");
  }
  const timezone = nonEmpty(attributes.timezone, "KLAVIYO_ACCOUNT_TIMEZONE_INVALID", 100);
  try {
    new Intl.DateTimeFormat("en", {timeZone: timezone}).format(new Date(0));
  } catch {
    throw new KlaviyoApiError("KLAVIYO_ACCOUNT_TIMEZONE_INVALID", "Klaviyo account timezone is invalid");
  }
  const verifiedAt = validNow(now).toISOString();
  const expiresAt = new Date(new Date(verifiedAt).valueOf() + 10 * 60 * 1000).toISOString();
  const account = Object.freeze({
    id,
    name,
    kind: "account",
    reportingEligible: true,
    status: "active",
    currency,
    timezone,
    loginAccountId: null,
  });
  return Object.freeze({
    authority: "provider_account_access_verified",
    provider: "klaviyo",
    verifiedAt,
    expiresAt,
    scopes: grantedScopes,
    accounts: Object.freeze([account]),
    reportingAccountId: null,
  });
}

export async function revokeKlaviyoAuthorization({
  config,
  refreshToken,
  fetchFn = fetch,
}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const response = await fetchFn(KLAVIYO_REVOCATION_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: basicAuthorization(config),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      token: nonEmpty(refreshToken, "KLAVIYO_REFRESH_TOKEN_REQUIRED", 16384),
      token_type_hint: "refresh_token",
    }).toString(),
  });
  if (response.ok) return Object.freeze({outcome: "revoked"});
  const payload = await jsonResponse(response);
  if (response.status === 400 && providerError(payload) === "invalid_grant") {
    return Object.freeze({outcome: "already_invalid"});
  }
  throw new KlaviyoApiError(
    "KLAVIYO_OAUTH_REVOKE_FAILED",
    "Klaviyo revocation endpoint rejected the request",
    {
      status: response.status,
      provider_status: providerError(payload),
      request_id: responseHeader(response, "x-request-id"),
    },
  );
}
