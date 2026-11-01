export type PermissionFeature = "shopify_products" | "shopify_orders" | "google_ads" | "meta" | "klaviyo";
export type PermissionPhase = "idle" | "explaining" | "unavailable" | "hiding_for_connect" | "hiding_for_cancel" | "starting" | "awaiting_status" | "unknown";
export type PermissionSnapshot = Readonly<{phase: PermissionPhase; feature: PermissionFeature | null; session: number}>;
export function permissionResumeTarget(stage: unknown): "explanation" | "account" | "reporting_account" | "activation_pending" | "cost" | "check_status";
export function createPermissionExplanationFlow(args?: {
  request?: (feature: PermissionFeature) => void | Promise<unknown>;
  canRequest?: (feature: PermissionFeature) => boolean;
}): Readonly<{
  readonly snapshot: PermissionSnapshot;
  invalidate(): PermissionSnapshot;
  open(feature: PermissionFeature): PermissionSnapshot | null;
  connect(session: number, hideOverlay: () => void): boolean;
  hide(session: number): boolean;
  afterHide(session: number): Promise<boolean>;
  statusObserved(session: number, feature: PermissionFeature): boolean;
}>;
