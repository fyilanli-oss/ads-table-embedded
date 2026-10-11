export declare function resolveShopifyRouteAuthority(options: {
  request: Request;
  authenticateAdmin(request: Request): Promise<any>;
  database: unknown;
}): Promise<{
  context: any;
  identity: any;
  installation: any;
  installationAuthority: {
    authority: "shopify_installation_verified";
    workspaceId: string;
    installGeneration: number;
    status: "active";
  };
}>;
