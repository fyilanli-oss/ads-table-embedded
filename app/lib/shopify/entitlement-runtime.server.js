import {createRuntimePostgresClient} from "../database/runtime-postgres.server.js";
import {createShopifyRuntimeRepositories} from "../database/shopify-runtime-repositories.server.js";
import {
  reconcileShopifyAppPricingEntitlement,
} from "./app-pricing-entitlement.server.js";
import {bootstrapWorkspaceInstallation} from "./installation-authority.server.js";
import {
  createShopifyPartnerApi,
  readShopifyPartnerRuntimeConfig,
} from "./partner-api.server.js";

export function createVerifiedShopifyEntitlementRuntime({
  database,
  partnerApi,
}) {
  const repositories = createShopifyRuntimeRepositories(database);
  if (!partnerApi || typeof partnerApi.activeSubscription !== "function") {
    throw new TypeError("partnerApi.activeSubscription is required");
  }

  return Object.freeze({
    async reconcile({session, shop, observedAt = new Date()}) {
      const installation = await bootstrapWorkspaceInstallation({
        session,
        shop,
        verifiedAt: observedAt,
        repository: repositories.installation,
      });

      return reconcileShopifyAppPricingEntitlement({
        installation: {
          authority: "shopify_installation_verified",
          shopId: shop.shopId,
          shopDomain: shop.myshopifyDomain,
          installGeneration: installation.installGeneration,
        },
        appId: partnerApi.appId,
        partnerApi,
        repository: repositories.entitlement,
        observedAt,
      });
    },
  });
}

export function createProductionShopifyEntitlementRuntime({
  environment = process.env,
  database,
  partnerApi,
} = {}) {
  const partnerConfig = readShopifyPartnerRuntimeConfig(environment);
  const api = partnerApi ?? createShopifyPartnerApi({environment});
  if (api.appId !== partnerConfig.appId) {
    throw new Error("SHOPIFY_PARTNER_APP_ID_MISMATCH");
  }
  const runtimeDatabase = database ?? createRuntimePostgresClient({environment});
  return createVerifiedShopifyEntitlementRuntime({
    database: runtimeDatabase,
    partnerApi: api,
  });
}
