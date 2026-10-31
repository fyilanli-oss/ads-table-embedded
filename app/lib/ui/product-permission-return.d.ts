export function rememberProductPermissionReturn(storage: Pick<Storage, "setItem" | "getItem">, owner: unknown, now?: number): boolean;
export function consumeProductPermissionReturn(storage: Pick<Storage, "getItem" | "removeItem">, owner: unknown, now?: number): boolean;
export function clearProductPermissionReturn(storage: Pick<Storage, "getItem" | "removeItem">, owner: unknown): void;
