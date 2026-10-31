import type {LoaderFunctionArgs} from "react-router";
import {redirect} from "react-router";
import {
  database,
  providerTokenVault,
  permissionRelease,
} from "../shopify.server";
import {createGoogleOAuthRuntime} from "../lib/oauth/google-oauth-runtime.server.js";
import {logPermissionFailure} from "../lib/server-error-log.server.js";
import {
  installedShopifySettingsUrl,
} from "../lib/shopify/installed-app-return.server.js";

function parameter(
  url: URL,
  name: string,
  maximum: number,
  required = false,
) {
  const value = url.searchParams.get(name);
  if (value === null) {
    if (required) throw new Error("GOOGLE_CALLBACK_PARAMETER_REQUIRED");
    return null;
  }
  if (value.length < 1 || value.length > maximum) {
    throw new Error("GOOGLE_CALLBACK_PARAMETER_INVALID");
  }
  return value;
}

function publicCode(error: unknown) {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String((error as {code?: unknown}).code)
      : error instanceof Error
        ? error.message
        : "";
  return /^[A-Z0-9_]{1,80}$/.test(candidate)
    ? candidate
    : "GOOGLE_CALLBACK_FAILED";
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const runtime = createGoogleOAuthRuntime({
    database,
    tokenVault: providerTokenVault,
    identityAuthorizationEnabled: permissionRelease?.availability.google_ads === true,
  });
  const url = new URL(request.url);
  let callbackReturn: {shopDomain: string} | null = null;

  try {
    const claimed = await runtime.oauthBoundary.claimCallback({
      provider: "google_ads",
      state: parameter(url, "state", 128, true),
      code: parameter(url, "code", 4096),
      providerError: parameter(url, "error", 128),
    });
    const target = await runtime.callbackReturn({
      workspaceId: claimed.workspaceId,
      installGeneration: claimed.installGeneration,
    });
    callbackReturn = target;
    const completed = await runtime.completeCallback({claimed});
    if (completed.outcome === "pending_permissions") {
      logPermissionFailure({feature: "google_ads", intent: "permission_callback", requestId: null,
        error: new Error("OAUTH_IDENTITY_SCOPE_NOT_GRANTED")});
    }

    return redirect(
      installedShopifySettingsUrl(target.shopDomain, {
        googleStatus:
          completed.outcome === "denied" ? "cancelled"
            : completed.outcome === "pending_permissions" ? "permissions_incomplete" : "pending",
      }),
      {headers: {"cache-control": "no-store"}},
    );
  } catch (error) {
    logPermissionFailure({feature: "google_ads", intent: "permission_callback", requestId: null, error});
    if (callbackReturn) {
      return redirect(
        installedShopifySettingsUrl(callbackReturn.shopDomain, {
          googleStatus: "error",
          googleError: publicCode(error),
        }),
        {headers: {"cache-control": "no-store"}},
      );
    }
    return new Response("Google Ads could not be connected.", {
      status: 400,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
};
