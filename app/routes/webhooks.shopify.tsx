import type {ActionFunctionArgs} from "react-router";
import {database} from "../shopify.server";
import {
  InvalidShopifyWebhookError,
  verifyShopifyWebhookRequest,
} from "../lib/shopify/privacy-webhook.server.js";
import {
  createPrivacyLifecycleRuntime,
} from "../lib/shopify/privacy-lifecycle.server.js";

export const action = async ({request}: ActionFunctionArgs) => {
  try {
    const claim = await verifyShopifyWebhookRequest(request);
    await createPrivacyLifecycleRuntime({database}).claimVerifiedWebhook(claim);
    return new Response(null, {status: 202});
  } catch (error) {
    if (error instanceof InvalidShopifyWebhookError) {
      return new Response(null, {status: 401});
    }
    throw error;
  }
};
