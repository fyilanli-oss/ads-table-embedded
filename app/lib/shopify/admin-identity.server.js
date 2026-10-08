import {normalizeShopDomain} from "./installation-authority.server.js";

const SHOP_ID_PATTERN = /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/;

function idTokenShopDomain(sessionToken) {
  if (!sessionToken || typeof sessionToken.dest !== "string") {
    throw new Error("VERIFIED_SHOPIFY_ID_TOKEN_REQUIRED");
  }

  let hostname;
  try {
    const destination = new URL(sessionToken.dest);
    if (destination.protocol !== "https:" || destination.pathname !== "/") {
      throw new Error("INVALID_SHOPIFY_ID_TOKEN_DESTINATION");
    }
    hostname = destination.hostname;
  } catch (error) {
    if (error?.message === "INVALID_SHOPIFY_ID_TOKEN_DESTINATION") throw error;
    throw new Error("INVALID_SHOPIFY_ID_TOKEN_DESTINATION");
  }
  return normalizeShopDomain(hostname);
}

export async function readVerifiedShopifyAdminIdentity({
  sessionToken,
  admin,
}) {
  if (!admin || typeof admin.graphql !== "function") {
    throw new TypeError("verified Shopify Admin client is required");
  }

  const shopDomain = idTokenShopDomain(sessionToken);
  const response = await admin.graphql(`#graphql
    query AdsTableVerifiedShopIdentity {
      shop {
        id
        myshopifyDomain
      }
    }
  `);
  const body = await response.json();
  if (body?.errors || !body?.data?.shop) {
    throw new Error("SHOPIFY_ADMIN_IDENTITY_QUERY_FAILED");
  }

  const shopId = body.data.shop.id;
  const adminShopDomain = normalizeShopDomain(body.data.shop.myshopifyDomain);
  if (typeof shopId !== "string" || !SHOP_ID_PATTERN.test(shopId)) {
    throw new Error("INVALID_SHOPIFY_SHOP_GID");
  }
  if (shopDomain !== adminShopDomain) {
    throw new Error("SHOP_ID_TOKEN_ADMIN_IDENTITY_MISMATCH");
  }

  return Object.freeze({
    session: Object.freeze({
      authority: "shopify_id_token_verified",
      shopDomain,
    }),
    shop: Object.freeze({
      authority: "shopify_admin_verified",
      shopId,
      myshopifyDomain: adminShopDomain,
    }),
  });
}
