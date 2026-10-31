export type ProductPermissionStatus = "ready" | "missing" | "unknown" | "unavailable";
export function readProductPermissionStatus(args: {verified: any; setup: import("./progressive-permissions.server.js").ShopifyPermissionSetup; available: boolean}): Promise<ProductPermissionStatus>;
