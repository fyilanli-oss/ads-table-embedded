export const GOOGLE_ACCEPTANCE_HEADER: "x-adstable-google-acceptance";
export function handleGoogleAcceptanceRequest(options: {
  request: Request;
  authenticateAdmin: (request: Request) => Promise<unknown>;
  database: unknown;
  tokenVault: unknown;
  environment?: Record<string, string | undefined>;
}): Promise<Response>;
