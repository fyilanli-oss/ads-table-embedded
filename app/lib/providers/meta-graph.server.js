import {createHmac} from "node:crypto";
import {OAUTH_CALLBACK_URIS} from "../oauth/oauth-transaction.server.js";
import {META_REPORTING_SCOPE, oauthPermissionProfile, oauthPermissionProfileFromState,
  oauthPermissionScopes, validateIdentityOAuthGrantedScopes} from "../oauth/oauth-permission-profile.server.js";

export const META_GRAPH_VERSION = "v26.0";
export const META_OAUTH_SCOPE = META_REPORTING_SCOPE;
export const META_AUTHORIZATION_ORIGIN = "https://www.facebook.com";
export const META_GRAPH_ORIGIN = "https://graph.facebook.com";
const MAX_ACCOUNT_PAGES = 20;
const MAX_ACCOUNTS = 1000;
const ACCOUNT_FIELDS = "id,name,currency,account_status,timezone_name";

export class MetaGraphError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "MetaGraphError";
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
  ) throw new MetaGraphError(code, code);
  return value;
}

function exactVersion(value) {
  if (value !== META_GRAPH_VERSION) {
    throw new MetaGraphError(
      "META_GRAPH_VERSION_MISMATCH",
      `Meta Graph version must be ${META_GRAPH_VERSION}`,
    );
  }
  return value;
}

function exactRedirect(value) {
  const redirect = nonEmpty(value, "META_OAUTH_REDIRECT_URI_INVALID", 2048);
  if (redirect !== OAUTH_CALLBACK_URIS.meta) {
    throw new MetaGraphError(
      "META_OAUTH_REDIRECT_URI_MISMATCH",
      "Meta redirect URI does not match the accepted callback contract",
    );
  }
  return redirect;
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
  const code = Number(payload?.error?.code);
  return Number.isSafeInteger(code) ? code : null;
}

async function graphJson({url, method = "GET", headers = {}, body, fetchFn}) {
  const response = await fetchFn(url, {
    method,
    headers: {accept: "application/json", ...headers},
    ...(body === undefined ? {} : {body}),
  });
  const payload = await jsonResponse(response);
  if (!response.ok || !payload) {
    throw new MetaGraphError(
      "META_GRAPH_REQUEST_FAILED",
      "Meta Graph API rejected the request",
      {
        status: response.status,
        provider_error_code: providerError(payload),
        request_id:
          responseHeader(response, "x-fb-trace-id")
          ?? responseHeader(response, "x-fb-request-id"),
      },
    );
  }
  return payload;
}

export function readMetaOAuthConfig(environment = process.env) {
  return Object.freeze({
    appId: nonEmpty(environment?.META_APP_ID, "META_APP_ID_REQUIRED", 256),
    appSecret: nonEmpty(
      environment?.META_APP_SECRET,
      "META_APP_SECRET_REQUIRED",
      512,
    ),
    graphVersion: exactVersion(environment?.META_GRAPH_VERSION),
    redirectUri: exactRedirect(environment?.META_OAUTH_REDIRECT_URI),
  });
}

export function buildMetaAuthorizationUrl({config, state}) {
  const version = exactVersion(config?.graphVersion);
  const url = new URL(`/${version}/dialog/oauth`, META_AUTHORIZATION_ORIGIN);
  url.searchParams.set("client_id", nonEmpty(config?.appId, "META_APP_ID_REQUIRED", 256));
  url.searchParams.set("redirect_uri", exactRedirect(config?.redirectUri));
  url.searchParams.set("state", nonEmpty(state, "META_OAUTH_STATE_REQUIRED", 128));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", oauthPermissionScopes("meta", oauthPermissionProfileFromState("meta", state)).join(","));
  return url.toString();
}

function queryUrl(base, values) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(values)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function createMetaAppSecretProof({accessToken, appSecret}) {
  return createHmac(
    "sha256",
    nonEmpty(appSecret, "META_APP_SECRET_REQUIRED", 512),
  ).update(nonEmpty(accessToken, "META_ACCESS_TOKEN_REQUIRED", 8192)).digest("hex");
}

function accessToken(payload, code) {
  return nonEmpty(payload?.access_token, code, 8192);
}

function scopesOf(value) {
  const values = Array.isArray(value) ? value : [];
  return Object.freeze([...new Set(values.filter(
    (scope) => typeof scope === "string" && scope.length > 0 && scope.length <= 200,
  ))].sort());
}

function expiryIso(data, now) {
  const current = now();
  if (!(current instanceof Date) || Number.isNaN(current.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  const candidates = [data?.expires_at, data?.data_access_expires_at]
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  if (candidates.length < 1) {
    throw new MetaGraphError(
      "META_TOKEN_EXPIRY_MISSING",
      "Meta did not return a bounded token expiry",
    );
  }
  const expiry = Math.min(...candidates);
  if (expiry * 1000 <= current.valueOf()) {
    throw new MetaGraphError(
      "META_REAUTHORIZATION_REQUIRED",
      "Meta authorization is expired",
    );
  }
  return new Date(expiry * 1000).toISOString();
}

export async function exchangeAndValidateMetaAuthorizationCode({
  config,
  authorizationCode,
  fetchFn = fetch,
  now = () => new Date(),
  permissionProfile = "reporting_v1",
}) {
  oauthPermissionProfile("meta", permissionProfile);
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const base = `${META_GRAPH_ORIGIN}/${exactVersion(config?.graphVersion)}`;
  const short = await graphJson({
    url: queryUrl(`${base}/oauth/access_token`, {
      client_id: nonEmpty(config?.appId, "META_APP_ID_REQUIRED", 256),
      client_secret: nonEmpty(config?.appSecret, "META_APP_SECRET_REQUIRED", 512),
      redirect_uri: exactRedirect(config?.redirectUri),
      code: nonEmpty(authorizationCode, "META_OAUTH_CODE_REQUIRED"),
    }),
    fetchFn,
  });
  const shortToken = accessToken(short, "META_SHORT_LIVED_TOKEN_MISSING");

  const long = await graphJson({
    url: queryUrl(`${base}/oauth/access_token`, {
      grant_type: "fb_exchange_token",
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: shortToken,
    }),
    fetchFn,
  });
  const longToken = accessToken(long, "META_LONG_LIVED_TOKEN_MISSING");

  const debugUrl = new URL(`${base}/debug_token`);
  debugUrl.searchParams.set("input_token", longToken);
  const debug = await graphJson({
    url: debugUrl.toString(),
    headers: {authorization: `Bearer ${config.appId}|${config.appSecret}`},
    fetchFn,
  });
  const data = debug?.data;
  if (!data || data.is_valid !== true) {
    throw new MetaGraphError(
      "META_REAUTHORIZATION_REQUIRED",
      "Meta token validation failed",
    );
  }
  if (String(data.app_id ?? "") !== config.appId) {
    throw new MetaGraphError("META_TOKEN_APP_MISMATCH", "Meta token belongs to another app");
  }
  const scopes = scopesOf(data.scopes);
  if (permissionProfile === "identity_v1") validateIdentityOAuthGrantedScopes("meta", data.scopes);
  if (!scopes.includes(META_OAUTH_SCOPE)) {
    throw new MetaGraphError("META_ADS_READ_SCOPE_MISSING", "Meta ads_read scope is missing");
  }
  const expiresAt = expiryIso(data, now);
  return Object.freeze({
    tokenSet: Object.freeze({
      access_token: longToken,
      token_type: "Bearer",
      scopes,
      expires_at: expiresAt,
    }),
    scopes,
    expiresAt,
  });
}

function account(value) {
  const id = String(value?.id ?? "");
  if (!/^act_[0-9]+$/.test(id)) {
    throw new MetaGraphError("META_AD_ACCOUNT_ID_INVALID", "Meta returned an invalid ad account id");
  }
  const name = typeof value?.name === "string" && value.name.trim()
    ? value.name.trim()
    : id;
  const currency = typeof value?.currency === "string" && /^[A-Z]{3}$/.test(value.currency)
    ? value.currency
    : null;
  const timezone = typeof value?.timezone_name === "string" && value.timezone_name.length <= 100
    ? value.timezone_name
    : null;
  return Object.freeze({
    id,
    name,
    kind: "advertiser",
    reportingEligible: true,
    status: value?.account_status == null ? null : String(value.account_status),
    currency,
    timezone,
    loginAccountId: null,
  });
}

export async function discoverMetaAdAccounts({
  accessToken,
  appSecret,
  scopes = [META_OAUTH_SCOPE],
  graphVersion = META_GRAPH_VERSION,
  fetchFn = fetch,
  now = () => new Date(),
}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const verifiedAt = now();
  if (!(verifiedAt instanceof Date) || Number.isNaN(verifiedAt.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  const accounts = new Map();
  const seenCursors = new Set();
  let after = null;

  for (let page = 0; page < MAX_ACCOUNT_PAGES; page += 1) {
    const url = new URL(
      `/${exactVersion(graphVersion)}/me/adaccounts`,
      META_GRAPH_ORIGIN,
    );
    url.searchParams.set("fields", ACCOUNT_FIELDS);
    url.searchParams.set("limit", "100");
    url.searchParams.set("appsecret_proof", createMetaAppSecretProof({accessToken, appSecret}));
    if (after !== null) url.searchParams.set("after", after);
    let payload;
    try {
      payload = await graphJson({
        url: url.toString(),
        headers: {authorization: `Bearer ${nonEmpty(accessToken, "META_ACCESS_TOKEN_REQUIRED", 8192)}`},
        fetchFn,
      });
    } catch (error) {
      if (
        error instanceof MetaGraphError
        && (error.details?.status === 401 || error.details?.provider_error_code === 190)
      ) {
        throw new MetaGraphError("META_REAUTHORIZATION_REQUIRED", "Meta authorization is no longer valid");
      }
      throw error;
    }
    if (!Array.isArray(payload.data)) {
      throw new MetaGraphError("META_AD_ACCOUNTS_SCHEMA_CHANGED", "Meta ad-account response is malformed");
    }
    for (const item of payload.data) {
      const normalized = account(item);
      accounts.set(normalized.id, normalized);
      if (accounts.size > MAX_ACCOUNTS) {
        throw new MetaGraphError("META_AD_ACCOUNT_LIMIT_EXCEEDED", "Meta account discovery limit exceeded");
      }
    }
    const cursor = payload?.paging?.cursors?.after;
    const hasNext = typeof payload?.paging?.next === "string" && payload.paging.next.length > 0;
    if (!hasNext) break;
    if (typeof cursor !== "string" || cursor.length < 1 || cursor.length > 4096 || seenCursors.has(cursor)) {
      throw new MetaGraphError("META_AD_ACCOUNT_PAGINATION_INVALID", "Meta pagination cursor is invalid");
    }
    seenCursors.add(cursor);
    after = cursor;
    if (page === MAX_ACCOUNT_PAGES - 1) {
      throw new MetaGraphError("META_AD_ACCOUNT_PAGE_LIMIT_EXCEEDED", "Meta account pagination limit exceeded");
    }
  }

  if (accounts.size < 1) {
    throw new MetaGraphError("META_AD_ACCOUNTS_EMPTY", "No eligible Meta ad account was found");
  }
  const normalizedScopes = scopesOf(scopes);
  if (!normalizedScopes.includes(META_OAUTH_SCOPE)) {
    throw new MetaGraphError("META_ADS_READ_SCOPE_MISSING", "Meta ads_read scope is missing");
  }
  return Object.freeze({
    authority: "provider_account_access_verified",
    provider: "meta",
    verifiedAt: verifiedAt.toISOString(),
    expiresAt: new Date(verifiedAt.valueOf() + 10 * 60 * 1000).toISOString(),
    scopes: normalizedScopes,
    accounts: Object.freeze([...accounts.values()].sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    )),
  });
}

export async function revokeMetaAuthorization({
  accessToken,
  appSecret,
  graphVersion = META_GRAPH_VERSION,
  fetchFn = fetch,
}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const url = new URL(`${META_GRAPH_ORIGIN}/${exactVersion(graphVersion)}/me/permissions`);
  url.searchParams.set("appsecret_proof", createMetaAppSecretProof({accessToken, appSecret}));
  const response = await fetchFn(url.toString(), {
    method: "DELETE",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${nonEmpty(accessToken, "META_REVOCATION_TOKEN_REQUIRED", 8192)}`,
    },
  });
  const payload = await jsonResponse(response);
  if (response.ok && payload?.success !== false) {
    return Object.freeze({outcome: "revoked"});
  }
  if ((response.status === 400 || response.status === 401) && providerError(payload) === 190) {
    return Object.freeze({outcome: "already_invalid"});
  }
  throw new MetaGraphError(
    "META_OAUTH_REVOKE_FAILED",
    "Meta authorization could not be revoked",
    {
      status: response.status,
      provider_error_code: providerError(payload),
      request_id:
        responseHeader(response, "x-fb-trace-id")
        ?? responseHeader(response, "x-fb-request-id"),
    },
  );
}

export const META_AD_ACCOUNT_FIELDS = Object.freeze(ACCOUNT_FIELDS.split(","));
