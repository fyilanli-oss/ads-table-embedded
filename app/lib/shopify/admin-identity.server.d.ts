export interface VerifiedShopifyAdminIdentity {
  readonly session: {
    readonly authority: "shopify_id_token_verified";
    readonly shopDomain: string;
  };
  readonly shop: {
    readonly authority: "shopify_admin_verified";
    readonly shopId: string;
    readonly myshopifyDomain: string;
  };
}

export function readVerifiedShopifyAdminIdentity(args: {
  admin: {graphql(query: string): Promise<{json(): Promise<unknown>}>};
  sessionToken: {dest?: string} | undefined;
}): Promise<VerifiedShopifyAdminIdentity>;
