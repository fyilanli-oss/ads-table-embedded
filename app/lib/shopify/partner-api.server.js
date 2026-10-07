const ORG_ID_PATTERN = /^[1-9][0-9]*$/;
const APP_ID_PATTERN = /^gid:\/\/shopify\/App\/[1-9][0-9]*$/;

export const SHOPIFY_PARTNER_RUNTIME_ENV = Object.freeze({
  organizationId: "SHOPIFY_PARTNER_ORG_ID",
  accessToken: "SHOPIFY_PARTNER_API_ACCESS_TOKEN",
  appId: "SHOPIFY_APP_GID",
});

export function readShopifyPartnerRuntimeConfig(environment = process.env) {
  const organizationId = environment[SHOPIFY_PARTNER_RUNTIME_ENV.organizationId];
  const accessToken = environment[SHOPIFY_PARTNER_RUNTIME_ENV.accessToken];
  const appId = environment[SHOPIFY_PARTNER_RUNTIME_ENV.appId];

  if (typeof organizationId !== "string" || !ORG_ID_PATTERN.test(organizationId)) {
    throw new Error("SHOPIFY_PARTNER_ORG_ID_INVALID");
  }
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.trim() !== accessToken
  ) {
    throw new Error("SHOPIFY_PARTNER_API_ACCESS_TOKEN_INVALID");
  }
  if (typeof appId !== "string" || !APP_ID_PATTERN.test(appId)) {
    throw new Error("SHOPIFY_APP_GID_INVALID");
  }

  return Object.freeze({organizationId, accessToken, appId});
}

export function createShopifyPartnerApi({environment = process.env, fetchImpl = globalThis.fetch} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  const config = readShopifyPartnerRuntimeConfig(environment);

  return Object.freeze({
    appId: config.appId,
    async activeSubscription({apiVersion, query, variables}) {
      if (apiVersion !== "2026-07") {
        throw new Error("SHOPIFY_PARTNER_API_VERSION_MISMATCH");
      }
      if (typeof query !== "string" || query.length === 0 || !variables) {
        throw new Error("SHOPIFY_PARTNER_API_REQUEST_INVALID");
      }

      const response = await fetchImpl(
        `https://partners.shopify.com/${config.organizationId}/api/${apiVersion}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": config.accessToken,
          },
          body: JSON.stringify({query, variables}),
        },
      );

      if (!response || typeof response.json !== "function") {
        throw new Error("SHOPIFY_PARTNER_API_RESPONSE_INVALID");
      }
      const payload = await response.json();
      if (!response.ok) {
        throw new Error("SHOPIFY_PARTNER_API_HTTP_ERROR");
      }
      return payload;
    },
  });
}
