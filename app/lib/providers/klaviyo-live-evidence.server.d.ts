export const KLAVIYO_LIVE_EVIDENCE_VERSION: "1.0.0";
export const KLAVIYO_LIVE_EVIDENCE_SAFE_LOG_PREFIX: string;
export const KLAVIYO_LIVE_EVIDENCE_FAMILIES: readonly string[];

export class KlaviyoLiveEvidenceError extends Error {
  code: string;
  status: number;
  details: Record<string, any> | null;
}

export function validateKlaviyoLiveEvidenceInput(value: unknown): Readonly<{
  provider: "klaviyo";
}>;

export function summarizeKlaviyoLiveEvidence(
  result: Record<string, any>,
): Readonly<Record<string, any>>;

export function createKlaviyoLiveEvidenceRuntime(input: {
  klaviyoRuntime: {
    readDailyEvidenceSnapshot(input: Record<string, any>): Promise<Record<string, any>>;
  };
}): Readonly<{
  execute(input: Record<string, any>): Promise<Readonly<Record<string, any>>>;
}>;

export function buildKlaviyoLiveEvidenceSafeLog(
  result: Readonly<Record<string, any>>,
): Readonly<Record<string, any>>;

export function classifyKlaviyoLiveEvidenceError(error: unknown): Readonly<{
  status: number;
  code: string;
  class: string;
  completed_families: string[];
}>;

export function buildKlaviyoLiveEvidenceSafeFailureLog(
  failure: ReturnType<typeof classifyKlaviyoLiveEvidenceError>,
  stage?: string,
): Readonly<Record<string, any>>;
