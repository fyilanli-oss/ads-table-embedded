export function handleQueueCronRequest(request: Request, options?: {
  environment?: NodeJS.ProcessEnv;
  createDatabase?: (args: {environment: NodeJS.ProcessEnv}) => {query: (...args: unknown[]) => Promise<unknown>; close: () => Promise<void>};
}): Promise<Response>;
