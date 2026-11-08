import {klaviyoBusinessDayTimeframe} from "../providers/klaviyo-reporting.server.js";

export const REPORT_RETENTION_POLICY_VERSION = "report-source-3y-v1";
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).sort().join() === keys.slice().sort().join();
const fail = () => {throw Error("REPORT_RETENTION_POLICY_INVALID");};
export function reportRetentionPolicy() {return Object.freeze({version: REPORT_RETENTION_POLICY_VERSION, calendarYears: 3});}
export function readReportRetentionPolicy(input) {
  if (!exact(input, ["version", "calendarYears"]) || input.version !== REPORT_RETENTION_POLICY_VERSION || input.calendarYears !== 3) fail();
  return reportRetentionPolicy();
}
/** Through the third local anniversary business day. Feb29 clamps to Feb28;
 * expiry is the NEXT local midnight. No ingestion/read/replay clock. */
export function resolveReportRetentionPolicy({businessDate, timeZone}) {
  try {
    if (typeof businessDate !== "string" || !/^\d{4}-\d\d-\d\d$/.test(businessDate)
      || new Date(businessDate).toISOString().slice(0, 10) !== businessDate || typeof timeZone !== "string" || !timeZone) fail();
    const [year, month, day] = businessDate.split("-").map(Number);
    if (year < 1900 || year > 9995) fail();
    const lastDay = new Date(Date.UTC(year + 3, month, 0)).getUTCDate();
    const nextDay = new Date(Date.UTC(year + 3, month - 1, Math.min(day, lastDay)) + 86400000).toISOString().slice(0, 10);
    const start = klaviyoBusinessDayTimeframe({businessDate: nextDay, timeZone}).start;
    return Object.freeze({version: REPORT_RETENTION_POLICY_VERSION, until: new Date(start).toISOString()});
  } catch {fail();}
}
export function resolveReportWritePolicy(policy, rows) {
  if (policy?.version !== REPORT_RETENTION_POLICY_VERSION) return policy;
  const marker = Object.hasOwn(policy, "calendarYears");
  if (marker) readReportRetentionPolicy(policy); else if (!exact(policy, ["version", "until"])) fail();
  if (!Array.isArray(rows) || !rows.length) fail();
  const resolved = rows.map(item => resolveReportRetentionPolicy({businessDate: item.row?.business_date, timeZone: item.row?.source_timezone}));
  if (resolved.some(p => p.until !== resolved[0].until) || !marker && policy.until !== resolved[0].until) fail();
  return resolved[0];
}
