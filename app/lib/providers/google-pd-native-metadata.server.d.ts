export const GOOGLE_PD_METADATA_QUERIES: Readonly<{account: string; actions: string}>;
/** Requires the existing same-account quota/authority-bound client. */
export function readGooglePdNativeMetadata(input: {
  client: {search(input: {customerId: string; query: string; pageToken: string | null}): Promise<any>};
  accountId: string;
  currency: string;
  timezone: string;
  limits: {maxPages: number; maxRows: number; maxBytes: number};
}): Promise<Readonly<Record<string, any>>>;
