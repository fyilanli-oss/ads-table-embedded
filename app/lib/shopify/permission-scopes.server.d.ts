import type {PermissionContext, PermissionScopeEvidence} from "../oauth/identity-permission-preflight.server.js";
import type {VerifiedShopifyAdminIdentity} from "./admin-identity.server.js";
import {assessIdentityPermissionScopes} from "../oauth/identity-permission-preflight.server.js";
export const SHOPIFY_PERMISSION_SCOPES_QUERY: string;
export function readShopifyPermissionScopes(args: {
  context: PermissionContext;
  admin: {graphql(query: string, options: {tries: number}): Promise<{ok?: boolean; json(): Promise<unknown>}>};
  now?: () => Date;
}): Promise<PermissionScopeEvidence & Readonly<{appInstallationId: string}>>;
export function inspectShopifyIdentityPermissionScopes(args: {
  verified: {
    identity: VerifiedShopifyAdminIdentity;
    installationAuthority: {authority: "shopify_installation_verified"; workspaceId: string; installGeneration: number; status: "active"};
    context: {admin: Parameters<typeof readShopifyPermissionScopes>[0]["admin"]};
  };
  database: {query(sql: string, values: unknown[]): Promise<{rows: unknown[]}>};
  includeOrders?: boolean;
  includeOrderHistory?: boolean;
  includeMarketingEvents?: boolean;
  now?: () => Date;
}): Promise<Readonly<{
  context: PermissionContext;
  evidence: Awaited<ReturnType<typeof readShopifyPermissionScopes>>;
  assessment: ReturnType<typeof assessIdentityPermissionScopes>;
}>>;
export function isShopifyPermissionInspection(value: unknown): boolean;
