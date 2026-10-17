import type {HeadersFunction, LoaderFunctionArgs} from "react-router";
import {boundary} from "@shopify/shopify-app-react-router/server";
import {authenticate, database, providerTokenVault} from "../shopify.server";
import {
  resolveShopifyRouteAuthority,
} from "../lib/shopify/shopify-route-authority.server.js";
import {createKlaviyoOAuthRuntime} from "../lib/oauth/klaviyo-oauth-runtime.server.js";
import {buildKlaviyoAuthorizationUrl} from "../lib/providers/klaviyo-api.server.js";

export const loader = async ({request}: LoaderFunctionArgs) => {
  const verified = await resolveShopifyRouteAuthority({
    request,
    authenticateAdmin: authenticate.admin,
    database,
  });
  const runtime = createKlaviyoOAuthRuntime({
    database,
    tokenVault: providerTokenVault,
  });
  const started = await runtime.oauthBoundary.begin({
    installationAuthority: verified.installationAuthority,
    provider: "klaviyo",
  });
  return verified.context.redirect(
    buildKlaviyoAuthorizationUrl({
      config: runtime.config,
      state: started.state,
      pkceChallenge: started.pkceChallenge,
    }),
    {target: "_top"},
  );
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
