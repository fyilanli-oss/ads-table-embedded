export type PermissionProvider = "google_ads" | "meta" | "klaviyo" | "shopify";
export interface PermissionContext {
  readonly provider: PermissionProvider;
  readonly workspaceId: string;
  readonly installGeneration: number;
  readonly shopId: string;
  readonly shopDomain: string;
  readonly connectionId?: string;
  readonly accountId?: string;
}
export interface PermissionScopeEvidence {
  readonly source: "google_oauth_native_scope_response" | "meta_token_inspection_native_scopes" | "klaviyo_oauth_native_scope_response" | "shopify_current_app_installation";
  readonly context: PermissionContext;
  readonly observedAt: string;
  readonly complete: boolean;
  readonly scopes: readonly string[];
}
export interface PermissionRequirements {
  readonly provider: PermissionProvider;
  readonly scopes: readonly string[];
  readonly additionalChecks: readonly string[];
  readonly usage: "read_only";
  readonly permissionsMayAllowWrites: boolean;
}
export const GOOGLE_MERCHANT_OAUTH_SCOPE: string;
export const META_CATALOG_PERMISSION_DEPENDENCIES: Readonly<Record<string, readonly string[]>>;
export function permissionContext(context: PermissionContext): PermissionContext;
export function identityPermissionRequirements(args: {
  provider: PermissionProvider;
  includeOrderHistory?: boolean;
  includeMarketingEvents?: boolean;
}): PermissionRequirements;
export function assessIdentityPermissionScopes(args: {
  context: PermissionContext;
  evidence?: PermissionScopeEvidence | null;
  includeOrderHistory?: boolean;
  includeMarketingEvents?: boolean;
  now?: () => Date;
}): Readonly<{
  provider: PermissionProvider;
  scopeStatus: "unknown" | "observed_missing" | "observed_sufficient";
  reason: string;
  checkedAt: string;
  requiredScopes: readonly string[];
  missingScopes: readonly string[] | null;
  satisfiedBy: readonly Readonly<{requiredScope: string; grantedScope: string}>[];
  additionalChecks: readonly string[];
  authorizesActivation: false;
}>;
