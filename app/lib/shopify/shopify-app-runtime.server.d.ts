export interface ShopifyAppRuntime {
  database: unknown;
  publicConfig: {
    apiKey: string;
    polarisUrl: string;
  };
  shopify: {
    addDocumentResponseHeaders: (...args: any[]) => any;
    authenticate: any;
    sessionStorage: any;
  };
}

export function createShopifyAppRuntime(args?: {
  environment?: NodeJS.ProcessEnv;
  database?: unknown;
  sessionStorage?: unknown;
}): ShopifyAppRuntime;
