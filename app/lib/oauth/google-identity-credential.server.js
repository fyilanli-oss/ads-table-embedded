import {validateIdentityOAuthGrantedScopes} from "./oauth-permission-profile.server.js";

function currentTime(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new Error("GOOGLE_IDENTITY_CREDENTIAL_TIME_INVALID");
  }
  return value.valueOf();
}

export function stampGoogleIdentityCredential(tokenSet, now = () => new Date()) {
  validateIdentityOAuthGrantedScopes("google_ads", tokenSet.scope);
  if (!Number.isInteger(tokenSet.expires_in) || tokenSet.expires_in < 1 || tokenSet.expires_in > 86400) {
    throw new Error("GOOGLE_IDENTITY_CREDENTIAL_TIME_INVALID");
  }
  const issued = currentTime(now);
  return Object.freeze({...tokenSet, permission_profile: "identity_v1",
    scope_verified_at: new Date(issued).toISOString(),
    expires_at: new Date(issued + tokenSet.expires_in * 1000).toISOString()});
}

export function inspectGoogleIdentityCredential(tokenSet, now = () => new Date()) {
  if (tokenSet.permission_profile !== "identity_v1") {
    throw new Error("GOOGLE_IDENTITY_CREDENTIAL_METADATA_REQUIRED");
  }
  validateIdentityOAuthGrantedScopes("google_ads", tokenSet.scope);
  const issued = Date.parse(tokenSet.scope_verified_at);
  const expires = Date.parse(tokenSet.expires_at);
  const current = currentTime(now);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)
    || new Date(issued).toISOString() !== tokenSet.scope_verified_at
    || new Date(expires).toISOString() !== tokenSet.expires_at
    || issued > current || !Number.isInteger(tokenSet.expires_in)
    || tokenSet.expires_in < 1 || tokenSet.expires_in > 86400
    || expires - issued !== tokenSet.expires_in * 1000) {
    throw new Error("GOOGLE_IDENTITY_CREDENTIAL_TIME_INVALID");
  }
  return Object.freeze({needsRefresh: expires - current <= 60000});
}
