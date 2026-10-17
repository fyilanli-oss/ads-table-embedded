export function normalizeShopDomain(value: string): string;

export function bootstrapWorkspaceInstallation(input: {
  session: {
    authority: "shopify_id_token_verified";
    shopDomain: string;
  };
  shop: {
    authority: "shopify_admin_verified";
    shopId: string;
    myshopifyDomain: string;
  };
  verifiedAt: Date;
  repository: {
    bootstrap(input: {
      shopId: string;
      shopDomain: string;
      shopIdentitySha256: Buffer;
      verifiedAt: string;
    }): Promise<{
      workspaceId: string;
      installGeneration: number;
      status: "active";
      disposition: "created" | "existing" | "reactivated" | "new_generation";
      shopId: string;
      shopDomain: string;
    }>;
  };
}): Promise<{
  workspaceId: string;
  installGeneration: number;
  status: "active";
  disposition: "created" | "existing" | "reactivated" | "new_generation";
}>;
