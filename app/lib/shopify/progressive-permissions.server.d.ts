import type {inspectShopifyIdentityPermissionScopes} from "./permission-scopes.server.js";
export const SHOPIFY_OPTIONAL_SCOPES_QUERY: string;
type Verified = Parameters<typeof inspectShopifyIdentityPermissionScopes>[0]["verified"] & {
  context: {scopes?: {revoke?(scopes: string[]): Promise<{revoked: string[]}>; query?(): Promise<{required: string[]; optional: string[]; granted: string[]}>}};
};
type ReadInput = {verified: Verified; signal?: AbortSignal};
export interface ShopifyPermissionSetupReadback {
  readonly outcome: "native_readback" | "already_granted" | "products_permission_required";
  readonly nativeRequestInvoked: boolean;
  readonly basePermissionState: "permission_ready" | "resume_setup" | "unknown";
  readonly ordersPermissionState: "permission_ready" | "not_connected" | "blocked_by_products" | "unknown";
  readonly ordersScopeState: "permission_ready" | "not_connected";
  readonly ordersRequiredForBase: false;
  readonly appInstallationId: string;
  readonly shopId: string;
  readonly installGeneration: number;
  readonly observedAt: string;
  readonly authorizesActivation: false;
  readonly ordersDataAccessAuthorized: false;
  readonly overlapVerified: false;
  readonly historyAccessAuthorized: false;
}
export interface ShopifyPermissionSetup {
  inspect(args: ReadInput): Promise<Readonly<ShopifyPermissionSetupReadback>>;
  afterReturn(args: ReadInput): Promise<Readonly<ShopifyPermissionSetupReadback>>;
  prepareProducts(args: ReadInput & {action: "connect" | "cancel"}): Promise<Readonly<ShopifyPermissionSetupReadback> | ShopifyPermissionPreparation | ShopifyPermissionCancelled>;
  prepareOrders(args: ReadInput & {action: "connect" | "cancel"}): ReturnType<ShopifyPermissionSetup["prepareProducts"]>;
  revokeProducts(args: ReadInput & {action: "revoke" | "cancel"}): Promise<Readonly<ShopifyPermissionSetupReadback> | ShopifyPermissionCancelled>;
  revokeOrders(args: ReadInput & {action: "revoke" | "cancel"}): ReturnType<ShopifyPermissionSetup["revokeProducts"]>;
}
type ShopifyPermissionCancelled = Readonly<{outcome: "cancelled"; nativeRequestInvoked: false; authorizesActivation: false}>;
export type ShopifyScopeBinding = Readonly<{shopId: string; appInstallationId: string; installGeneration: number}>;
export type ShopifyPermissionPreparation = Readonly<{outcome: "scope_request_prepared"; scope: "read_products" | "read_orders"; binding: ShopifyScopeBinding; authorizesActivation: false}>;
export function createShopifyProgressivePermissions(args: {
  database: Parameters<typeof inspectShopifyIdentityPermissionScopes>[0]["database"];
  apiKey: string;
  requiredScopes?: string[];
  requestsEnabled?: boolean;
  optionalScopesReleased?: boolean;
  now?: () => Date;
  maxElapsedMs?: number;
}): Readonly<ShopifyPermissionSetup>;
