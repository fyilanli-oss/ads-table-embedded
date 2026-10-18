const ROUTES = new Set(["/", "/ad-analysis", "/settings"]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

// Never inspect an error object: messages, causes and custom properties are untrusted data.
export function logServerFailure(stage, request) {
  const render = stage === "render";
  let route = "other";
  let method = "other";
  try {
    const pathname = new URL(request.url).pathname;
    if (ROUTES.has(pathname)) route = pathname;
    if (METHODS.has(request.method)) method = request.method;
  } catch {
    // Malformed log context must not replace the original application failure.
  }
  try {
    console.error(JSON.stringify({
      event: "adstable_server_error",
      code: render ? "SERVER_RENDER_FAILED" : "SERVER_REQUEST_FAILED",
      stage: render ? "render" : "request",
      route,
      method,
    }));
  } catch {
    // Logging failure must not change response status, shell rejection or recovery.
  }
}

export function handleServerError(_error, {request}) {
  if (!request.signal.aborted) logServerFailure("request", request);
}
