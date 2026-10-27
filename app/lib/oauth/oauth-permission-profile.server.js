export const GOOGLE_REPORTING_SCOPE = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_MERCHANT_OAUTH_SCOPE = "https://www.googleapis.com/auth/content";
export const META_REPORTING_SCOPE = "ads_read";
export const META_CATALOG_PERMISSION_DEPENDENCIES = Object.freeze({
  catalog_management: Object.freeze(["business_management"]),
  business_management: Object.freeze(["pages_read_engagement", "pages_show_list"]),
  pages_read_engagement: Object.freeze(["pages_show_list"]),
  pages_show_list: Object.freeze([]),
});
const IDENTITY_SUFFIX = ".identity-v1";

export class OAuthPermissionProfileError extends Error {
  constructor(code) {
    super(code);
    this.name = "OAuthPermissionProfileError";
    this.code = code;
  }
}

export function oauthPermissionProfile(provider, profile = "reporting_v1") {
  if (!["google_ads", "meta", "klaviyo"].includes(provider)
    || !["reporting_v1", "identity_v1"].includes(profile)
    || (profile === "identity_v1" && provider === "klaviyo")) {
    throw new OAuthPermissionProfileError("OAUTH_PERMISSION_PROFILE_INVALID");
  }
  return profile;
}

export function bindOAuthPermissionProfile(provider, entropy, profile = "reporting_v1") {
  oauthPermissionProfile(provider, profile);
  if (typeof entropy !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(entropy)) {
    throw new OAuthPermissionProfileError("OAUTH_STATE_ENTROPY_INVALID");
  }
  return profile === "identity_v1" ? entropy + IDENTITY_SUFFIX : entropy;
}

// Parsing does not prove a valid transaction. Callback must claim the full state digest.
export function oauthPermissionProfileFromState(provider, state) {
  if (typeof state !== "string" || state.length < 1 || state.length > 128) throw new OAuthPermissionProfileError("OAUTH_STATE_INVALID");
  if (/^[A-Za-z0-9_-]{43}$/.test(state)) return oauthPermissionProfile(provider);
  if (!/^[A-Za-z0-9_-]{43}\.identity-v1$/.test(state)) throw new OAuthPermissionProfileError("OAUTH_STATE_PROFILE_INVALID");
  return oauthPermissionProfile(provider, "identity_v1");
}

export function oauthPermissionScopes(provider, profile = "reporting_v1") {
  oauthPermissionProfile(provider, profile);
  if (!["google_ads", "meta"].includes(provider)) throw new OAuthPermissionProfileError("OAUTH_SCOPE_PROFILE_PROVIDER_INVALID");
  const base = provider === "google_ads" ? GOOGLE_REPORTING_SCOPE : META_REPORTING_SCOPE;
  const extra = provider === "google_ads" ? [GOOGLE_MERCHANT_OAUTH_SCOPE] : Object.keys(META_CATALOG_PERMISSION_DEPENDENCIES);
  return Object.freeze(profile === "identity_v1" ? [base, ...extra] : [base]);
}

export function validateIdentityOAuthGrantedScopes(provider, nativeScopes) {
  const values = provider === "google_ads" && typeof nativeScopes === "string" && nativeScopes.trim()
    ? nativeScopes.trim().split(/\s+/) : provider === "meta" && Array.isArray(nativeScopes) ? [...nativeScopes] : null;
  if (!values || values.length < 1 || values.length > 100
    || values.some(value => typeof value !== "string" || !value || value.length > 200 || /\s/.test(value))
    || new Set(values).size !== values.length) throw new OAuthPermissionProfileError("OAUTH_IDENTITY_SCOPE_RESPONSE_INVALID");
  if (oauthPermissionScopes(provider, "identity_v1").some(scope => !values.includes(scope))) {
    throw new OAuthPermissionProfileError("OAUTH_IDENTITY_SCOPE_NOT_GRANTED");
  }
  return Object.freeze(values);
}
