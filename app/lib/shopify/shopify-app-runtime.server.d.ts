export interface TokenVaultStartup {
  contractVersion: number;
  activeKeyVersion: number;
  readableKeyVersions: readonly number[];
}

export interface ShopifyAppRuntime {
  database: unknown;
  tokenVault: {
    assertRuntimeReady: () => Promise<TokenVaultStartup>;
  };
  tokenVaultStartup: TokenVaultStartup;
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
}): Promise<ShopifyAppRuntime>;
