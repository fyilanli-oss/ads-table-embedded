// Navigation intent only: never a permission receipt, credential or return address.
const TTL = 10 * 60 * 1000;
const validOwner = owner => typeof owner === "string" && /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(owner);

function remember(storage, owner, now, key) {
  if (!validOwner(owner) || !Number.isSafeInteger(now) || now < 0) return false;
  const value = JSON.stringify({version: 1, owner, startedAt: now});
  try {
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch { return false; }
}

function consume(storage, owner, now, key) {
  if (!validOwner(owner) || !Number.isSafeInteger(now) || now < 0) return false;
  try {
    const raw = storage.getItem(key);
    if (!raw) return false;
    // Consume before navigation: reloads, StrictMode and malformed/stale hints cannot loop.
    storage.removeItem(key);
    if (raw.length > 256) return false;
    const value = JSON.parse(raw);
    return value?.version === 1 && value.owner === owner && Number.isSafeInteger(value.startedAt)
      && value.startedAt >= 0 && value.startedAt <= now && now - value.startedAt <= TTL
      && Object.keys(value).length === 3;
  } catch { return false; }
}

export function clearProductPermissionReturn(storage, owner) {
  consumeProductPermissionReturn(storage, owner);
}
export const rememberProductPermissionReturn = (storage, owner, now = Date.now()) => remember(storage, owner, now, "adstable.products-return.v1");
export const consumeProductPermissionReturn = (storage, owner, now = Date.now()) => consume(storage, owner, now, "adstable.products-return.v1");
export const rememberOrderPermissionReturn = (storage, owner, now = Date.now()) => remember(storage, owner, now, "adstable.orders-return.v1");
export const consumeOrderPermissionReturn = (storage, owner, now = Date.now()) => consume(storage, owner, now, "adstable.orders-return.v1");
export const clearOrderPermissionReturn = (storage, owner) => {consumeOrderPermissionReturn(storage, owner);};
