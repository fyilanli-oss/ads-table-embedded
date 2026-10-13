import type {LoaderFunctionArgs} from "react-router";
import {redirect} from "react-router";
import {database, providerTokenVault} from "../shopify.server";
import {createMetaOAuthRuntime} from "../lib/oauth/meta-oauth-runtime.server.js";
import {
  installedShopifySettingsUrl,
} from "../lib/shopify/installed-app-return.server.js";

function parameter(url: URL, name: string, maximum: number, required = false) {
  const value = url.searchParams.get(name);
  if (value === null) {
    if (required) throw new Error("META_CALLBACK_PARAMETER_REQUIRED");
    return null;
  }
  if (value.length < 1 || value.length > maximum) {
    throw new Error("META_CALLBACK_PARAMETER_INVALID");
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
    : "META_CALLBACK_FAILED";
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const runtime = createMetaOAuthRuntime({database, tokenVault: providerTokenVault});
  const url = new URL(request.url);
  let callbackReturn: {shopDomain: string} | null = null;

  try {
    const claimed = await runtime.oauthBoundary.claimCallback({
      provider: "meta",
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
    return redirect(
      installedShopifySettingsUrl(target.shopDomain, {
        metaStatus: completed.outcome === "denied" ? "cancelled" : "pending",
      }),
      {headers: {"cache-control": "no-store"}},
    );
  } catch (error) {
    if (callbackReturn) {
      return redirect(
        installedShopifySettingsUrl(callbackReturn.shopDomain, {
          metaStatus: "error",
          metaError: publicCode(error),
        }),
        {headers: {"cache-control": "no-store"}},
      );
    }
    return new Response("Meta could not be connected.", {
      status: 400,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
};
