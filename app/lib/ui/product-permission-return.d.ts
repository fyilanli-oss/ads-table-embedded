export function rememberProductPermissionReturn(storage: Pick<Storage, "setItem" | "getItem">, owner: unknown, now?: number): boolean;
export function consumeProductPermissionReturn(storage: Pick<Storage, "getItem" | "removeItem">, owner: unknown, now?: number): boolean;
export function clearProductPermissionReturn(storage: Pick<Storage, "getItem" | "removeItem">, owner: unknown): void;
export const rememberOrderPermissionReturn: typeof rememberProductPermissionReturn;
export const consumeOrderPermissionReturn: typeof consumeProductPermissionReturn;
export const clearOrderPermissionReturn: typeof clearProductPermissionReturn;
