import {sourcePayloadHash, canonicalSourceJson} from "../database/source-evidence-store.server.js";
import {klaviyoBusinessDayTimeframe} from "../providers/klaviyo-reporting.server.js";

export const MATURITY_VERSION = "eo05c-maturity-v1";
const fail = code => {throw Error("MATURITY_" + code);};
export const freezeMaturity = value => {if (value && typeof value === "object") {Object.values(value).forEach(freezeMaturity); Object.freeze(value);} return value;};
export const maturityDate = value => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value
    || Number(value.slice(0, 4)) < 1900 || Number(value.slice(0, 4)) > 9990) fail("DATE_INVALID");
  return value;
};
export const maturityInstant = value => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("CLOCK_INVALID");
  return value;
};
const windowDays = (value, max) => typeof value === "string" && /^(0|[1-9][0-9]{0,2})$/.test(value) && Number(value) <= max;
const enumValue = v => typeof v === "string" && /^[A-Z][A-Z_]+$/.test(v) && !["UNKNOWN", "UNSPECIFIED"].includes(v);

/** Pure calculation only. This result is NOT a native-observation/storage authority. */
export function deriveMaturityPolicy({provider, timeZone, native}) {
  if (!["google_ads", "meta", "klaviyo"].includes(provider) || typeof timeZone !== "string") fail("POLICY_INPUT_INVALID");
  try {new Intl.DateTimeFormat("en", {timeZone}).format();} catch {fail("TIMEZONE_INVALID");}
  let horizon = null;
  if (provider === "google_ads" && native?.complete === true && Array.isArray(native.before) && native.before.length
    && native.before.length <= 20000 && canonicalSourceJson(native.before) === canonicalSourceJson(native.after)) {
    const seen = new Set(); let valid = true; const windows = [];
    for (const action of native.before) {
      if (!/^customers\/[0-9]+\/conversionActions\/[0-9]+$/.test(action.resource ?? "") || seen.has(action.resource)
        || !["ENABLED", "HIDDEN", "REMOVED"].includes(action.status)
        || !["ADD_TO_CART", "BEGIN_CHECKOUT", "PURCHASE"].includes(action.category)
        || !enumValue(action.model) || !enumValue(action.counting)
        || !windowDays(action.click_days, 90) || !windowDays(action.view_days, 30)) valid = false;
      seen.add(action.resource);
      if (action.status === "ENABLED") windows.push(Number(action.click_days), Number(action.view_days));
    }
    if (valid && windows.length) horizon = Math.max(...windows);
  } else if (provider === "meta" && native?.complete === true && Array.isArray(native.settings) && native.settings.length > 0 && native.settings.length <= 20000) {
    const seen = new Set(), windows = []; let valid = true;
    for (const row of native.settings) {
      if (!/^[1-9][0-9]*$/.test(row.ad_id ?? "") || seen.has(row.ad_id) || typeof row.setting !== "string") {valid = false; continue;}
      seen.add(row.ad_id);
      const labels = row.setting.split(",").map(v => v.trim());
      if (!labels.length || new Set(labels).size !== labels.length) valid = false;
      for (const label of labels) {
        if (!/^(?:1|7|28)d_(?:click|view)$|^1d_ev$/.test(label)) valid = false;
        else windows.push(Number(label.split("d_")[0]));
      }
    }
    if (valid && windows.length) horizon = Math.max(...windows);
  }
  // Klaviyo documented defaults never establish this account's actual settings.
  const reason = horizon === null ? provider === "klaviyo" ? "account_attribution_not_observed" : "native_settings_unverified" : null;
  const fingerprint = sourcePayloadHash({version: MATURITY_VERSION, provider, timeZone, native});
  return freezeMaturity({version: MATURITY_VERSION, state: horizon === null ? "unknown" : "known", horizonDays: horizon, reason, fingerprint, timeZone});
}

export function maturityBoundary({businessDate, timeZone, horizonDays}) {
  maturityDate(businessDate);
  if (!Number.isInteger(horizonDays) || horizonDays < 0 || horizonDays > 365) fail("HORIZON_INVALID");
  // End of the source day + H calendar days + one complete provider day.
  const next = new Date(Date.parse(businessDate) + (horizonDays + 2) * 86400000).toISOString().slice(0, 10);
  try {return new Date(klaviyoBusinessDayTimeframe({businessDate: next, timeZone}).start).toISOString();}
  catch {fail("TIMEZONE_OR_DAY_INVALID");}
}

export function evaluateMaturity({businessDate, policy, now, reconciliation = null}) {
  maturityDate(businessDate); maturityInstant(now);
  if (!policy || policy.version !== MATURITY_VERSION || !["known", "unknown"].includes(policy.state)) fail("POLICY_INPUT_INVALID");
  if (policy.state === "unknown") return freezeMaturity({state: "unknown", reason: policy.reason, notBefore: null});
  const notBefore = maturityBoundary({businessDate, timeZone: policy.timeZone, horizonDays: policy.horizonDays});
  if (now < notBefore) return freezeMaturity({state: "provisional", reason: "attribution_window_open", notBefore});
  if (!reconciliation || reconciliation.complete !== true || reconciliation.reportVerified !== true
    || reconciliation.policyFingerprint !== policy.fingerprint || typeof reconciliation.startedAt !== "string"
    || typeof reconciliation.completedAt !== "string") return freezeMaturity({state: "provisional", reason: "post_window_reconciliation_required", notBefore});
  maturityInstant(reconciliation.startedAt); maturityInstant(reconciliation.completedAt);
  if (reconciliation.startedAt < notBefore || reconciliation.completedAt < reconciliation.startedAt || reconciliation.completedAt > now)
    return freezeMaturity({state: "provisional", reason: "post_window_reconciliation_required", notBefore});
  return freezeMaturity({state: "final", reason: null, notBefore});
}
