export type ProductPermissionStatus = "ready" | "missing" | "unknown" | "unavailable";
export function readProductPermissionStatus(args: {verified: any; setup: import("./progressive-permissions.server.js").ShopifyPermissionSetup; available: boolean}): Promise<ProductPermissionStatus>;
export function readShopifyPermissionStatuses(args: {verified: any; setup: import("./progressive-permissions.server.js").ShopifyPermissionSetup; productsAvailable: boolean; ordersAvailable: boolean}): Promise<{products: ProductPermissionStatus; orders: ProductPermissionStatus}>;
