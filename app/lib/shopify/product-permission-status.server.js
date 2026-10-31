// Fresh native read only. A navigation hint or client result never authorizes access.
export async function readProductPermissionStatus({verified, setup, available}) {
  if (available !== true) return "unavailable";
  try {
    const result = await setup.afterReturn({verified});
    return result?.basePermissionState === "permission_ready" ? "ready"
      : result?.basePermissionState === "resume_setup" ? "missing" : "unknown";
  } catch { return "unknown"; }
}

// One authenticated scope read for both independent UI grants, never an Orders data read.
export async function readShopifyPermissionStatuses({verified, setup, productsAvailable, ordersAvailable}) {
  let products = productsAvailable ? "unknown" : "unavailable";
  let orders = ordersAvailable ? "unknown" : "unavailable";
  if (!productsAvailable && !ordersAvailable) return {products, orders};
  try {
    const result = await setup.afterReturn({verified});
    if (productsAvailable) products = result?.basePermissionState === "permission_ready" ? "ready"
      : result?.basePermissionState === "resume_setup" ? "missing" : "unknown";
    const orderState = result?.ordersScopeState ?? result?.ordersPermissionState;
    if (ordersAvailable) orders = orderState === "permission_ready" ? "ready" : orderState === "not_connected" ? "missing" : "unknown";
  } catch {} // Unknown is never a grant or a reason to retry.
  return {products, orders};
}
