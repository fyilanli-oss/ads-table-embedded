export function resolveShopifyRouteAuthority(input: {
  request: Request;
  authenticateAdmin: (request: Request) => Promise<any>;
  database: any;
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
