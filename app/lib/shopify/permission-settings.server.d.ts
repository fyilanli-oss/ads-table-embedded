import type {PermissionFeature} from "../ui/permission-explanation-flow.js";
export const PERMISSION_SETTINGS_AVAILABILITY: Readonly<Record<PermissionFeature, boolean>>;
export type PermissionSelection = Readonly<{
  connectionId: string; version: number; reportingAccountId: string | null;
  accounts: readonly Readonly<{id: string; name: string}>[];
}>;
export type PermissionSettingsResult = Readonly<
  {kind: "unavailable" | "unknown"; feature: PermissionFeature}
  | {kind: "authorization"; feature: PermissionFeature; authorizationUrl: string}
  | {kind: "scope_request"; feature: "shopify_products" | "shopify_orders"; scope: "read_products" | "read_orders"; binding: import("./progressive-permissions.server.js").ShopifyScopeBinding}
  | {kind: "status"; feature: PermissionFeature; stage: string; selection?: PermissionSelection}
>;
export function createPermissionSettings(args: {
  shopify: import("./progressive-permissions.server.js").ShopifyPermissionSetup;
  providerRuntime: (provider: "google_ads" | "meta" | "klaviyo") => any;
  availability?: Readonly<Record<PermissionFeature, boolean>>;
}): Readonly<{
  revokeProducts(args: {feature: "shopify_products"; verified: any; action: "revoke"}): Promise<PermissionSettingsResult>;
  revokeOrders(args: {feature: "shopify_orders"; verified: any; action: "revoke"}): Promise<PermissionSettingsResult>;
  connect(args: {feature: PermissionFeature; verified: any; action: "connect"}): Promise<PermissionSettingsResult>;
  status(args: {feature: PermissionFeature; verified: any; expectedScopeBinding?: import("./progressive-permissions.server.js").ShopifyScopeBinding}): Promise<PermissionSettingsResult>;
  select(args: {feature: PermissionFeature; verified: any; expected: {connectionId: string; version: number};
    operation: "accounts" | "reporting"; selectedAccountIds?: string[]; reportingAccountId?: string}): Promise<PermissionSettingsResult>;
}>;
