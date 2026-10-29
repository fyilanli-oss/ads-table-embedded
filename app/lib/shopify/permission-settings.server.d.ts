import type {PermissionFeature} from "../ui/permission-explanation-flow.js";
export const PERMISSION_SETTINGS_AVAILABILITY: Readonly<Record<PermissionFeature, boolean>>;
export type PermissionSettingsResult = Readonly<
  {kind: "unavailable" | "unknown"; feature: PermissionFeature}
  | {kind: "authorization"; feature: PermissionFeature; authorizationUrl: string}
  | {kind: "status"; feature: PermissionFeature; stage: string}
>;
export function createPermissionSettings(args: {
  shopify: import("./progressive-permissions.server.js").ShopifyPermissionSetup;
  providerRuntime: (provider: "google_ads" | "meta" | "klaviyo") => any;
  availability?: Readonly<Record<PermissionFeature, boolean>>;
}): Readonly<{
  connect(args: {feature: PermissionFeature; verified: any; action: "connect"}): Promise<PermissionSettingsResult>;
  status(args: {feature: PermissionFeature; verified: any}): Promise<PermissionSettingsResult>;
}>;
