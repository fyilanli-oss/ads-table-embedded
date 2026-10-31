export const KLAVIYO_SPEND_ERROR = "Enter an amount from 0 to 99,999,999.99 with up to two decimal places.";

// Input feedback only. The existing server normalizer remains authoritative.
export function klaviyoSpendError(value) {
  return typeof value === "string" && /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)
    ? "" : KLAVIYO_SPEND_ERROR;
}

export function klaviyoSetupAccount(accounts, selectedId) {
  return accounts.find(account => account.id === selectedId) ?? null;
}
