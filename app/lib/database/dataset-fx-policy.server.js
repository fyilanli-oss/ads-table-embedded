export const DATASET_FX_POLICY = "frankfurter-ecb-weekend-v1";
export const DATASET_FX_PROVIDER = "frankfurter_ecb_v2";
export const DATASET_FX_SCHEMA = "frankfurter-ecb-proof-v1";
// Existing merchant reporting-currency reference, verified against ECB coverage.
export const REPORTING_CURRENCIES = Object.freeze(["USD", "EUR", "TRY", "GBP", "JPY", "CNY", "AUD", "CAD", "CHF", "SEK", "NOK", "DKK", "PLN"]);
export function datasetFxPublicationDate(day) {
  if (typeof day !== "string" || !/^\d{4}-\d\d-\d\d$/.test(day)) throw Error("DATASET_FX_DATE_INVALID");
  const date = new Date(day + "T00:00:00.000Z");
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== day || date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 9995) throw Error("DATASET_FX_DATE_INVALID");
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 2 : 1));
  return date.toISOString().slice(0, 10);
}
export function datasetFxUrl(source, target, day) {
  if (!REPORTING_CURRENCIES.includes(source) || !REPORTING_CURRENCIES.includes(target) || source === target || datasetFxPublicationDate(day) !== day) throw Error("DATASET_FX_PAIR_INVALID");
  return `https://api.frankfurter.dev/v2/providers/ECB/rate/${source}/${target}?date=${day}`;
}
