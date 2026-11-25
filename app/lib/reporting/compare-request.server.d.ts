export function handleCompareRequest(request: Request, dependencies: {
  authenticateAdmin: (request: Request) => Promise<unknown>;
  database: unknown;
}): Promise<Response>;
