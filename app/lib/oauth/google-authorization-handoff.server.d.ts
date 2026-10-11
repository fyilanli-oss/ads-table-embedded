export interface GoogleInstallationAuthority {
  authority: "shopify_installation_verified";
  status: "active";
  workspaceId: string;
  installGeneration: number;
}

export interface GoogleAccountEvidence {
  id: string;
  name: string;
  kind: "advertiser" | "manager";
  reportingEligible: boolean;
  status?: string | null;
  currency?: string | null;
  timezone?: string | null;
  loginAccountId?: string | null;
}

export declare function createGoogleAuthorizationHandoff(options: {
  oauthBoundary: {
    finalizeExchange(value: {transactionId: string; success: boolean}): Promise<{status: string}>;
  };
  tokenVault: {
    storeProviderTokenSet(value: object): Promise<{credentialId: string}>;
    loadProviderTokenSet(value: object): Promise<Record<string, unknown> | null>;
    deleteProviderTokenSet(value: object): Promise<boolean>;
  };
  repository: {
    create(value: object): Promise<Record<string, unknown>>;
    load(value: object): Promise<Record<string, unknown> | null>;
    consume(value: object): Promise<Record<string, unknown>>;
    expire(value: object): Promise<number>;
  };
  exchangeAuthorizationCode(value: object): Promise<Record<string, unknown>>;
  refreshAccessToken(value: object): Promise<Record<string, unknown>>;
  discoverAccounts(value: object): Promise<{
    accounts: GoogleAccountEvidence[];
    scopes?: string[];
    verifiedAt?: string;
  }>;
  now?: () => Date;
  randomUUIDFn?: () => string;
}): {
  completeCallback(value: object): Promise<Record<string, unknown>>;
  discover(value: object): Promise<Record<string, unknown>>;
  select(value: object): Promise<Record<string, unknown>>;
  expire(value?: {limit?: number}): Promise<number>;
};
