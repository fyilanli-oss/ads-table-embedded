import {prepareCustomerSourceRun,completeCustomerSourceRun} from "../database/customer-source-privacy.server.js";
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

export function createPrivacyLifecycleRuntime({database, repository, sourcePrivacy = null, customerSourceScope = true} = {}) {
  const persistence = repository ?? createPrivacyLifecycleRepository(database, {customerSourceScope: customerSourceScope || sourcePrivacy !== null});

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

    prepareCustomerSourceRun(runId) {
      if (sourcePrivacy === null) throw Error("SOURCE_PRIVACY_NOT_CONFIGURED");
      return prepareCustomerSourceRun({database,cipher:sourcePrivacy.cipher,runId});
    },
    completeCustomerSourceRun(preparedRun,disclosureReceipt=null) {
      if (sourcePrivacy === null) throw Error("SOURCE_PRIVACY_NOT_CONFIGURED");
      return completeCustomerSourceRun({database,preparedRun,disclosureReceipt});
    },
    async executeDeletionRun(deletionRunId) {
      if (
        typeof deletionRunId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deletionRunId)
      ) {
        throw new TypeError("deletionRunId must be a UUID");
      }
      if (sourcePrivacy !== null) {
        const response=await database.query("select privacy.customer_source_run_kind($1::uuid) as kind",[deletionRunId]);
        if(response.rows?.length!==1)throw Error("SOURCE_PRIVACY_RUN_INVALID");
        if(response.rows[0].kind!==null){
          const run=await prepareCustomerSourceRun({database,cipher:sourcePrivacy.cipher,runId:deletionRunId});
          // Non-empty disclosure is held. This worker never invents a delivery receipt.
          const result=await completeCustomerSourceRun({database,preparedRun:run});
          return Object.freeze({deletionRunId,status:result.status,manifestId:result.manifestId,result:result.result});
        }
      }
      return persistence.executeDeletionRun(deletionRunId);
    },
  });
}
