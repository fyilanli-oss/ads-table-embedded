import type {HeadersFunction, LoaderFunctionArgs} from "react-router";
import {Outlet, useLoaderData, useRouteError, useLocation, useNavigate} from "react-router";
import {useEffect, useState} from "react";
import {consumeProductPermissionReturn} from "../lib/ui/product-permission-return.js";
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

  return {...publicShopifyConfig, permissionReturnOwner: identity.shop.shopId};
};

export default function AuthenticatedAdminLayout() {
  const {apiKey, polarisUrl, permissionReturnOwner} = useLoaderData<typeof loader>();
  const {pathname} = useLocation();
  const navigate = useNavigate();
  const [returnState, setReturnState] = useState<"idle" | "returning" | "failed">("idle");
  useEffect(() => {
    if (pathname !== "/" && pathname !== "/settings") {setReturnState("idle"); return;}
    let pending = false;
    try { pending = consumeProductPermissionReturn(globalThis.sessionStorage, permissionReturnOwner); } catch {}
    if (pathname === "/" && pending) {
      setReturnState("returning");
      try {
        void Promise.resolve(navigate("/settings", {replace: true})).catch(() => setReturnState("failed"));
      } catch { setReturnState("failed"); }
    } else if (pathname === "/settings") setReturnState("idle");
  }, [pathname, permissionReturnOwner, navigate]);
  return (
    <AppProvider apiKey={apiKey} polarisUrl={polarisUrl}>
      {returnState === "returning" ? <s-page heading="Settings"><s-banner tone="info" heading="Settings'e dönülüyor…" /></s-page>
        : returnState === "failed" ? <s-page heading="Settings"><s-banner tone="critical" heading="Settings'e otomatik dönülemedi."><s-link href="/settings">Settings'i aç</s-link></s-banner></s-page>
        : <Outlet />}
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
