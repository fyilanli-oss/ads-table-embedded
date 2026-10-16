export const GOOGLE_REPORTING_QUERY_FAMILIES: readonly string[];

export class GoogleReportingError extends Error {
  code: string;
  details: unknown;
}

export function buildGoogleReportingQueries(input: {
  dateWindow: {start: string; end: string};
}): Readonly<Record<string, string>>;

export function fetchGoogleReportingPage(input: {
  client: {search(input: Record<string, unknown>): Promise<any>};
  customerId: string;
  queryFamily: string;
  dateWindow: {start: string; end: string};
  pageToken?: string | null;
}): Promise<Readonly<Record<string, unknown>>>;

export function normalizeGoogleCartDataSale(
  row: Readonly<Record<string, any>>,
): Readonly<Record<string, any>>;

export function resolvePmaxSaleChannel(input: {
  sale: Readonly<Record<string, any>>;
  advertisedProduct: Readonly<Record<string, any>>;
  businessWindow: Readonly<Record<string, any>>;
  listingEvidence: Readonly<Record<string, any>>;
}): Readonly<Record<string, any>>;

export function classifyGoogleReportingError(error: unknown): Readonly<{
  class: string;
  retryable: false;
  retry_after_ms: null;
  provider_request_id: string | null;
  message: string;
}>;
