import type {
  VerifiedShopifyWebhookClaim,
} from "./privacy-webhook.server.js";

interface PrivacyLifecycleRepository {
  claimWebhook(claim: VerifiedShopifyWebhookClaim): Promise<unknown>;
  requestWorkspaceDeletion(input: {
    requestKey: string;
    shopId: string;
    shopDomain: string;
    installGeneration: number;
    shopIdentitySha256: Buffer;
    requestedAt: string;
  }): Promise<unknown>;
  executeDeletionRun(deletionRunId: string): Promise<unknown>;
}

export interface PrivacyLifecycleRuntime {
  claimVerifiedWebhook(claim: VerifiedShopifyWebhookClaim): Promise<unknown>;
  requestMerchantDeletion(input: {
    shop: {
      authority: "shopify_admin_verified";
      shopId: string;
      myshopifyDomain: string;
    };
    installGeneration: number;
    requestedAt?: Date;
    requestKey?: string;
  }): Promise<unknown>;
  executeDeletionRun(deletionRunId: string): Promise<unknown>;
}

export function createPrivacyLifecycleRuntime(options?: {
  database?: unknown;
  repository?: PrivacyLifecycleRepository;
}): PrivacyLifecycleRuntime;
