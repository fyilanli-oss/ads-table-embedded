// Fresh native read only. A navigation hint or client result never authorizes access.
export async function readProductPermissionStatus({verified, setup, available}) {
  if (available !== true) return "unavailable";
  try {
    const result = await setup.afterReturn({verified});
    return result?.basePermissionState === "permission_ready" ? "ready"
      : result?.basePermissionState === "resume_setup" ? "missing" : "unknown";
  } catch { return "unknown"; }
}
