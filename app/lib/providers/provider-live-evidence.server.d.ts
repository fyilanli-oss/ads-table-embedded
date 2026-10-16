export const PROVIDER_LIVE_EVIDENCE_VERSION: "1.0.0";
export const PROVIDER_LIVE_EVIDENCE_SAFE_LOG_PREFIX: "[AdsTable provider live evidence safe]";
export const META_PRODUCT_ACCEPTED_FIELDS: readonly [
  "product_id",
  "impressions",
  "clicks",
  "spend",
  "converted_product_quantity",
  "converted_product_value",
];

export class ProviderLiveEvidenceError extends Error {
  code: string;
  status: number;
}

export function validateProviderLiveEvidenceInput(value: unknown): Readonly<{
  provider: "meta";
  businessDate: string;
}>;

export function summarizeMetaLiveEvidence(
  result: Record<string, any>,
  businessDate: string,
): Readonly<Record<string, any>>;

export function buildProviderLiveEvidenceSafeLog(
  result: Record<string, any>,
): Readonly<Record<string, any>>;

export function createProviderLiveEvidenceRuntime(input: {
  metaRuntime: {
    readDailyEvidencePages(input: Record<string, any>): Promise<Record<string, any>>;
  };
}): {
  execute(input: {
    installationAuthority: Record<string, any>;
    input: unknown;
  }): Promise<Readonly<Record<string, any>>>;
};

export function classifyProviderLiveEvidenceError(error: unknown): Readonly<{
  status: number;
  code: string;
  class: string;
  provider_request_id: string | null;
}>;
