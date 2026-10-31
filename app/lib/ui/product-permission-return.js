// Navigation intent only: never a permission receipt, credential or return address.
const KEY = "adstable.products-return.v1";
const TTL = 10 * 60 * 1000;
const validOwner = owner => typeof owner === "string" && /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(owner);

export function rememberProductPermissionReturn(storage, owner, now = Date.now()) {
  if (!validOwner(owner) || !Number.isSafeInteger(now) || now < 0) return false;
  const value = JSON.stringify({version: 1, owner, startedAt: now});
  try {
    storage.setItem(KEY, value);
    return storage.getItem(KEY) === value;
  } catch { return false; }
}

export function consumeProductPermissionReturn(storage, owner, now = Date.now()) {
  if (!validOwner(owner) || !Number.isSafeInteger(now) || now < 0) return false;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return false;
    // Consume before navigation: reloads, StrictMode and malformed/stale hints cannot loop.
    storage.removeItem(KEY);
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
