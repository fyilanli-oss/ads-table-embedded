import {useRef} from "react";
import type {ActionFunctionArgs, LoaderFunctionArgs} from "react-router";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import {AppProvider} from "@shopify/shopify-app-react-router/react";
import {publicShopifyConfig} from "../shopify.server";
import {normalizeShopDomain} from "../lib/shopify/installation-authority.server.js";
import {
  installedShopifyKlaviyoStartUrl,
} from "../lib/shopify/installed-app-return.server.js";

type ActionData = {ok: false; error: string} | undefined;

const noStore = {"cache-control": "no-store"};

export const loader = async (_args: LoaderFunctionArgs) => data(
  publicShopifyConfig,
  {headers: noStore},
);

export const action = async ({request}: ActionFunctionArgs) => {
  const form = await request.formData();
  try {
    const shop = normalizeShopDomain(String(form.get("shop") ?? ""));
    return redirect(installedShopifyKlaviyoStartUrl(shop), {headers: noStore});
  } catch {
    return data(
      {ok: false, error: "Enter a valid .myshopify.com store domain."} satisfies ActionData,
      {status: 400, headers: noStore},
    );
  }
};

export default function KlaviyoInstallEntry() {
  const {apiKey, polarisUrl} = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopField = useRef<any>(null);
  const working = navigation.state !== "idle";

  const continueToShopify = () => {
    if (working) return;
    const form = new FormData();
    form.set("shop", String(shopField.current?.value ?? ""));
    submit(form, {method: "post"});
  };

  return (
    <AppProvider apiKey={apiKey} polarisUrl={polarisUrl}>
      <s-page heading="Connect AdsTable to Klaviyo">
        <s-section heading="Shopify store">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Enter the .myshopify.com domain of the Shopify store where AdsTable is installed.
            </s-paragraph>
            <s-text-field
              ref={shopField}
              label="Shopify store domain"
              placeholder="store-name.myshopify.com"
              required
              autocomplete="off"
              maxLength={255}
              error={actionData?.error}
            />
            <s-button
              variant="primary"
              loading={working}
              onClick={continueToShopify}
            >
              {working ? "Continuing to Shopify…" : "Continue to Shopify"}
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
