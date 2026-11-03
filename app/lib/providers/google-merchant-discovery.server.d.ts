export const GOOGLE_MERCHANT_DISCOVERY_HEADER: "x-adstable-google-merchant-discovery";
export function handleGoogleMerchantDiscoveryRequest(options: {
  request: Request;
  authenticateAdmin: (request: Request) => Promise<unknown>;
  database: unknown;
  tokenVault: unknown;
  environment?: Record<string, string | undefined>;
}): Promise<Response>;
