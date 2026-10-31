export const KLAVIYO_SPEND_ERROR: string;
export function klaviyoSpendError(value: unknown): string;
export function klaviyoSetupAccount<T extends {id: string}>(accounts: T[], selectedId: string | null): T | null;
