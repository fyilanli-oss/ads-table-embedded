import type {LoaderFunctionArgs} from "react-router";
import {redirect} from "react-router";
import {
  database,
  providerTokenVault,
} from "../shopify.server";
import {
  createGoogleOAuthRuntime,
} from "../lib/oauth/google-oauth-runtime.server.js";
import {
  oauthInstallationAuthority,
} from "../lib/oauth/oauth-transaction.server.js";
import {
  installedShopifySettingsUrl,
} from "../lib/shopify/installed-app-return.server.js";

function boundedParameter(
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

function callbackErrorCode(error: unknown) {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String((error as {code?: unknown}).code)
      : "";
  return /^[A-Z0-9_]{1,80}$/.test(candidate)
    ? candidate
    : "GOOGLE_CALLBACK_FAILED";
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const runtime = createGoogleOAuthRuntime({
    database,
    tokenVault: providerTokenVault,
  });
  const url = new URL(request.url);
  let owner: ReturnType<typeof oauthInstallationAuthority> | null = null;

  try {
    const state = boundedParameter(url, "state", 128, true);
    const code = boundedParameter(url, "code", 4096);
    const providerError = boundedParameter(url, "error", 128);
    const claimed = await runtime.oauthBoundary.claimCallback({
      provider: "google_ads",
      state,
      code,
      providerError,
    });
    owner = oauthInstallationAuthority({
      workspaceId: claimed.workspaceId,
      installGeneration: claimed.installGeneration,
      status: "active",
    });
    const target = await runtime.handoff.resolveCallbackReturn({
      installationAuthority: owner,
    });

    if (claimed.status === "denied") {
      return redirect(
        installedShopifySettingsUrl(target.shopDomain, {
          google_status: "cancelled",
        }),
        {headers: {"cache-control": "no-store"}},
      );
    }

    const pending = await runtime.handoff.completeCallback({
      claimed,
      installationAuthority: owner,
    });
    return redirect(
      installedShopifySettingsUrl(target.shopDomain, {
        google_setup: pending.transactionId,
      }),
      {headers: {"cache-control": "no-store"}},
    );
  } catch (error) {
    if (owner) {
      try {
        const target = await runtime.handoff.resolveCallbackReturn({
          installationAuthority: owner,
        });
        return redirect(
          installedShopifySettingsUrl(target.shopDomain, {
            google_status: "error",
            google_error: callbackErrorCode(error),
          }),
          {headers: {"cache-control": "no-store"}},
        );
      } catch {
        // Fall through to the bounded callback response.
      }
    }
    return new Response("Google Ads could not be connected.", {
      status: 400,
      headers: {"cache-control": "no-store", "content-type": "text/plain; charset=utf-8"},
    });
  }
};
