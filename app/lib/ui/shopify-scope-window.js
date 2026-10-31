import {validShopifyScopeRequest} from "./permission-settings-response.js";

// App Bridge owns the consent window. This result never authorizes server reads.
export async function requestShopifyScopeWindow({preparation, owner, isCurrent, bridge = globalThis.shopify}) {
  const current = () => typeof isCurrent === "function" && isCurrent() === true;
  if (!validShopifyScopeRequest(preparation) || preparation.binding.shopId !== owner || !current()) throw new Error("SHOPIFY_SCOPE_WINDOW_BINDING_INVALID");
  const api = bridge?.scopes;
  if (typeof api?.request !== "function") throw new Error("SHOPIFY_SCOPE_WINDOW_UNAVAILABLE");
  let response;
  try { response = await api.request([preparation.scope]); }
  catch { throw new Error("SHOPIFY_SCOPE_WINDOW_UNKNOWN"); }
  if (!current()) throw new Error("SHOPIFY_SCOPE_WINDOW_OWNER_CHANGED");
  if (!response || !["granted-all", "declined-all"].includes(response.result)) throw new Error("SHOPIFY_SCOPE_WINDOW_UNKNOWN");
  // The caller must still perform one authenticated, installation-bound readback.
}
