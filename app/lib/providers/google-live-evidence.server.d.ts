export const GOOGLE_LIVE_EVIDENCE_VERSION: "1.0.0";
export const GOOGLE_LIVE_EVIDENCE_SAFE_LOG_PREFIX: string;
export const GOOGLE_LIVE_EVIDENCE_QUERY_FAMILIES: readonly string[];

export class GoogleLiveEvidenceError extends Error {
  code: string;
  status: number;
}

export function validateGoogleLiveEvidenceInput(value: unknown): Readonly<{
  provider: "google_ads";
}>;

export function completedThirtyDayWindow(input: {
  now: Date | string | number;
  timeZone: string;
}): Readonly<{start: string; end: string}>;

export function createGoogleLiveEvidenceRuntime(input: {
  googleRuntime: {
    readEvidencePage(input: Record<string, unknown>): Promise<any>;
  };
  clock?: () => Date;
}): Readonly<{
  execute(input: Record<string, unknown>): Promise<any>;
}>;

export function buildGoogleLiveEvidenceSafeLog(
  result: Readonly<Record<string, any>>,
): Readonly<Record<string, any>>;

export function classifyGoogleLiveEvidenceError(error: unknown): Readonly<{
  status: number;
  code: string;
  class: string;
  provider_request_id: string | null;
}>;
