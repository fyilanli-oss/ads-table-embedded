export type ShopifyPrivacyWebhookTopic =
  | "app/uninstalled"
  | "customers/data_request"
  | "customers/redact"
  | "shop/redact";

export interface VerifiedShopifyWebhookClaim {
  readonly verified: true;
  readonly webhookId: string;
  readonly eventId: string | null;
  readonly topic: ShopifyPrivacyWebhookTopic;
  readonly shopId: string;
  readonly shopDomain: string;
  readonly shopIdentitySha256: Buffer;
  readonly payloadSha256: string;
  readonly apiVersion: string | null;
  readonly triggeredAt: string | null;
  readonly receivedAt: string;
}

export class InvalidShopifyWebhookError extends Error {
  constructor(code: string);
}

export function verifyShopifyWebhookRequest(
  request: Request,
  options?: {
    environment?: {SHOPIFY_API_SECRET?: string};
    receivedAt?: Date;
  },
): Promise<VerifiedShopifyWebhookClaim>;
