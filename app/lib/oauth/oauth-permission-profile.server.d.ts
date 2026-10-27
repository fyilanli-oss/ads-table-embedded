export type OAuthPermissionProfile = "reporting_v1" | "identity_v1";
export class OAuthPermissionProfileError extends Error { readonly code: string; constructor(code: string); }
export const GOOGLE_REPORTING_SCOPE: string;
export const GOOGLE_MERCHANT_OAUTH_SCOPE: string;
export const META_REPORTING_SCOPE: string;
export const META_CATALOG_PERMISSION_DEPENDENCIES: Readonly<Record<string, readonly string[]>>;
export function oauthPermissionProfile(provider: string, profile?: OAuthPermissionProfile): OAuthPermissionProfile;
export function bindOAuthPermissionProfile(provider: string, entropy: string, profile?: OAuthPermissionProfile): string;
export function oauthPermissionProfileFromState(provider: string, state: string): OAuthPermissionProfile;
export function oauthPermissionScopes(provider: string, profile?: OAuthPermissionProfile): readonly string[];
export function validateIdentityOAuthGrantedScopes(provider: string, nativeScopes: unknown): readonly string[];
