import type {inspectShopifyIdentityPermissionScopes} from "./permission-scopes.server.js";
export const SHOPIFY_OPTIONAL_SCOPES_QUERY: string;
type Verified = Parameters<typeof inspectShopifyIdentityPermissionScopes>[0]["verified"] & {
  context: {scopes?: {request(scopes: string[]): Promise<void>; revoke?(scopes: string[]): Promise<{revoked: string[]}>; query?(): Promise<{required: string[]; optional: string[]; granted: string[]}>}};
};
type ReadInput = {verified: Verified; signal?: AbortSignal};
export interface ShopifyPermissionSetupReadback {
  readonly outcome: "native_readback" | "already_granted" | "products_permission_required";
  readonly nativeRequestInvoked: boolean;
  readonly basePermissionState: "permission_ready" | "resume_setup" | "unknown";
  readonly ordersPermissionState: "permission_ready" | "not_connected" | "blocked_by_products" | "unknown";
  readonly ordersRequiredForBase: false;
  readonly appInstallationId: string;
  readonly observedAt: string;
  readonly authorizesActivation: false;
  readonly ordersDataAccessAuthorized: false;
  readonly overlapVerified: false;
  readonly historyAccessAuthorized: false;
}
export interface ShopifyPermissionSetup {
  inspect(args: ReadInput): Promise<Readonly<ShopifyPermissionSetupReadback>>;
  afterReturn(args: ReadInput): Promise<Readonly<ShopifyPermissionSetupReadback>>;
  requestProducts(args: ReadInput & {action: "connect" | "cancel"}): Promise<Readonly<ShopifyPermissionSetupReadback> | Readonly<{outcome: "cancelled"; nativeRequestInvoked: false; authorizesActivation: false}>>;
  requestOrders(args: ReadInput & {action: "connect" | "cancel"}): ReturnType<ShopifyPermissionSetup["requestProducts"]>;
  revokeProducts(args: ReadInput & {action: "revoke" | "cancel"}): ReturnType<ShopifyPermissionSetup["requestProducts"]>;
}
export function createShopifyProgressivePermissions(args: {
  database: Parameters<typeof inspectShopifyIdentityPermissionScopes>[0]["database"];
  apiKey: string;
  requiredScopes?: string[];
  requestsEnabled?: boolean;
  optionalScopesReleased?: boolean;
  now?: () => Date;
  maxElapsedMs?: number;
}): Readonly<ShopifyPermissionSetup>;
