import type {HeadersFunction, LoaderFunctionArgs} from "react-router";
import {Outlet, useLoaderData, useRouteError} from "react-router";
import {AppProvider} from "@shopify/shopify-app-react-router/react";
import {boundary} from "@shopify/shopify-app-react-router/server";
import {
  authenticate,
  database,
  publicShopifyConfig,
} from "../shopify.server";
import {
  readVerifiedShopifyAdminIdentity,
} from "../lib/shopify/admin-identity.server.js";
import {
  createProductionShopifyEntitlementRuntime,
} from "../lib/shopify/entitlement-runtime.server.js";

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {admin, sessionToken} = await authenticate.admin(request);
  const identity = await readVerifiedShopifyAdminIdentity({
    admin,
    sessionToken,
  });
  await createProductionShopifyEntitlementRuntime({database}).reconcile(identity);

  return publicShopifyConfig;
};

export default function AuthenticatedAdminLayout() {
  const {apiKey, polarisUrl} = useLoaderData<typeof loader>();
  return (
    <AppProvider apiKey={apiKey} polarisUrl={polarisUrl}>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
