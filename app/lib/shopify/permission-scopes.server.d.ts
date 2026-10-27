import type {PermissionContext, PermissionScopeEvidence} from "../oauth/identity-permission-preflight.server.js";
export const SHOPIFY_PERMISSION_SCOPES_QUERY: string;
export function readShopifyPermissionScopes(args: {
  context: PermissionContext;
  admin: {graphql(query: string, options: {tries: number}): Promise<{ok?: boolean; json(): Promise<unknown>}>};
  now?: () => Date;
}): Promise<PermissionScopeEvidence & Readonly<{appInstallationId: string}>>;
