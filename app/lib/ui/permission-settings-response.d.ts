import type {PermissionFeature} from "./permission-explanation-flow.js";
export function permissionAuthorizationTarget(feature: PermissionFeature, value: unknown): string | null;
export function permissionResponseMatches(reply: unknown, pending: {requestId: string; feature: PermissionFeature} | null): boolean;
export function validShopifyScopeRequest(value: unknown): boolean;
