import {randomUUID} from "node:crypto";
import {
  createPrivacyLifecycleRepository,
} from "../database/privacy-lifecycle-repository.server.js";
import {normalizeShopDomain} from "./installation-authority.server.js";
import {shopIdentitySha256} from "./shop-identity.server.js";

function verifiedShop(value) {
  if (!value || value.authority !== "shopify_admin_verified") {
    throw new Error("VERIFIED_SHOPIFY_ADMIN_IDENTITY_REQUIRED");
  }
  return {
    shopId: value.shopId,
    shopDomain: normalizeShopDomain(value.myshopifyDomain),
  };
}

export function createPrivacyLifecycleRuntime({database, repository} = {}) {
  const persistence = repository ?? createPrivacyLifecycleRepository(database);

  return Object.freeze({
    async claimVerifiedWebhook(claim) {
      if (!claim || claim.verified !== true) {
        throw new Error("VERIFIED_SHOPIFY_WEBHOOK_REQUIRED");
      }
      return persistence.claimWebhook(claim);
    },

    async requestMerchantDeletion({
      shop,
      installGeneration,
      requestedAt = new Date(),
      requestKey = randomUUID(),
    }) {
      const identity = verifiedShop(shop);
      if (!Number.isSafeInteger(installGeneration) || installGeneration < 1) {
        throw new TypeError("installGeneration must be a positive integer");
      }
      if (!(requestedAt instanceof Date) || Number.isNaN(requestedAt.valueOf())) {
        throw new TypeError("requestedAt must be a valid Date");
      }
      return persistence.requestWorkspaceDeletion({
        requestKey: "merchant:" + requestKey,
        ...identity,
        installGeneration,
        shopIdentitySha256: shopIdentitySha256(identity.shopId),
        requestedAt: requestedAt.toISOString(),
      });
    },

    executeDeletionRun(deletionRunId) {
      if (
        typeof deletionRunId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deletionRunId)
      ) {
        throw new TypeError("deletionRunId must be a UUID");
      }
      return persistence.executeDeletionRun(deletionRunId);
    },
  });
}
