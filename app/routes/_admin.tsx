import type {HeadersFunction, LoaderFunctionArgs} from "react-router";
import {Outlet, useLoaderData, useRouteError, useLocation, useNavigate} from "react-router";
import {useEffect, useRef, useState} from "react";
import {consumeProductPermissionReturn, consumeOrderPermissionReturn} from "../lib/ui/product-permission-return.js";
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
  const {pathname, key} = useLocation();
  const navigate = useNavigate();
  type RootDecision = {key: string; owner: string; state: "home" | "returning" | "failed"};
  const [decision, setDecision] = useState<RootDecision | null>(null);
  const processed = useRef<{key: string; owner: string} | null>(null);
  useEffect(() => {
    if (pathname !== "/") {processed.current = null; setDecision(null);}
    if (pathname !== "/" && pathname !== "/settings") return;
    if (pathname === "/" && processed.current && processed.current.key === key && processed.current.owner === permissionReturnOwner) return;
    const current = {key, owner: permissionReturnOwner};
    if (pathname === "/") processed.current = current;
    let pending = false;
    try {
      const products = consumeProductPermissionReturn(globalThis.sessionStorage, permissionReturnOwner);
      const orders = consumeOrderPermissionReturn(globalThis.sessionStorage, permissionReturnOwner);
      pending = products || orders;
    } catch {}
    if (pathname === "/" && pending) {
      setDecision({...current, state: "returning"});
      const failed = () => {if (processed.current === current) setDecision({...current, state: "failed"});};
      try {
        void Promise.resolve(navigate("/settings", {replace: true})).catch(failed);
      } catch { failed(); }
    } else if (pathname === "/") setDecision({...current, state: "home"});
  }, [pathname, key, permissionReturnOwner, navigate]);
  const rootState = decision && decision.key === key && decision.owner === permissionReturnOwner ? decision.state : null;
  return (
    <AppProvider apiKey={apiKey} polarisUrl={polarisUrl}>
      {pathname === "/" && rootState === "failed" ? <s-page heading="Settings"><s-banner tone="critical" heading="Could not return to Settings."><s-link href="/settings">Open Settings</s-link></s-banner></s-page>
        : pathname === "/" && rootState !== "home" ? null
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
