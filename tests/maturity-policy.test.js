import test from "node:test";
import assert from "node:assert/strict";
import {deriveMaturityPolicy, evaluateMaturity, maturityBoundary} from "../app/lib/refresh/maturity-policy.server.js";

const action = (overrides = {}) => ({resource: "customers/123/conversionActions/1", status: "ENABLED", category: "PURCHASE",
  model: "GOOGLE_ADS_LAST_CLICK", counting: "MANY_PER_CLICK", click_days: "28", view_days: "1", ...overrides});
const google = actions => ({provider: "google_ads", timeZone: "UTC", native: {complete: true, before: actions, after: structuredClone(actions)}});
const meta = setting => ({provider: "meta", timeZone: "UTC", native: {complete: true, settings: [{ad_id: "123", setting}]}});

test("Google maximum derives from enabled native actions; no28-day global constant or inactive action inflation", () => {
  const p = deriveMaturityPolicy(google([action(), action({resource: "customers/123/conversionActions/2", status: "HIDDEN", click_days: "90"})]));
  assert.equal(p.horizonDays, 28); assert.equal(p.state, "known");
  assert.equal(deriveMaturityPolicy(google([action({click_days: "7", view_days: "30"})])).horizonDays, 30);
  assert.equal(deriveMaturityPolicy(google([action({click_days: "0", view_days: "0"})])).horizonDays, 0);
  assert.equal(deriveMaturityPolicy(google([action({status: "HIDDEN"})])).state, "unknown");
});
for (const patch of [{status: null}, {status: "UNKNOWN"}, {model: "UNKNOWN"}, {click_days: "91"}, {view_days: "31"}, {click_days: null}, {click_days: "7.5"}]) {
  test(`Google incomplete/unsupported native setting stays unknown: ${JSON.stringify(patch)}`, () => assert.equal(deriveMaturityPolicy(google([action(patch)])).state, "unknown"));
}
test("missing/empty/changed/duplicate metadata cannot invent a zero horizon", () => {
  assert.equal(deriveMaturityPolicy(google([])).state, "unknown");
  assert.equal(deriveMaturityPolicy(google([action(), action()])).state, "unknown");
  const changed = google([action()]); changed.native.after[0].click_days = "7";
  assert.equal(deriveMaturityPolicy(changed).state, "unknown");
  changed.native.complete = false;
  assert.equal(deriveMaturityPolicy(changed).state, "unknown");
});
test("Meta parses actual per-Ad native labels and preserves unsupported/empty/duplicate states", () => {
  assert.equal(deriveMaturityPolicy(meta("7d_click,1d_view")).horizonDays, 7);
  assert.equal(deriveMaturityPolicy(meta("1d_ev")).horizonDays, 1);
  const p = meta("1d_click"); p.native.settings.push({ad_id: "456", setting: "28d_click"});
  assert.equal(deriveMaturityPolicy(p).horizonDays, 28);
  for (const s of ["", "default", "7", "7d_click,7d_click", "skan_click", "90d_click", "7d_click,unknown"]) assert.equal(deriveMaturityPolicy(meta(s)).state, "unknown");
  p.native.settings.push(p.native.settings[0]); assert.equal(deriveMaturityPolicy(p).state, "unknown");
});
test("Klaviyo documented default, empty configuration and fake verified fields never become account truth", () => {
  for (const native of [{complete: false}, {complete: true, reference_days: 5, account_settings_verified: true}, {complete: true, settings: [{ad_id: "1", setting: "7d_click"}]}]) {
    const p = deriveMaturityPolicy({provider: "klaviyo", timeZone: "UTC", native});
    assert.equal(p.state, "unknown"); assert.equal(p.horizonDays, null); assert.equal(p.reason, "account_attribution_not_observed");
    assert.equal(evaluateMaturity({businessDate: "2026-11-01", policy: p, now: "2026-12-01T00:00:00.000Z"}).state, "unknown");
  }
});
test("provider-day end + horizon + one complete local day respects DST and fractional timezones", () => {
  assert.equal(maturityBoundary({businessDate: "2026-11-01", timeZone: "UTC", horizonDays: 7}), "2026-11-10T00:00:00.000Z");
  assert.equal(maturityBoundary({businessDate: "2026-10-31", timeZone: "America/New_York", horizonDays: 0}), "2026-11-02T05:00:00.000Z");
  assert.equal(maturityBoundary({businessDate: "2026-03-07", timeZone: "America/New_York", horizonDays: 0}), "2026-03-09T04:00:00.000Z");
  assert.equal(maturityBoundary({businessDate: "2026-11-01", timeZone: "Asia/Kathmandu", horizonDays: 0}), "2026-11-02T18:15:00.000Z");
});
test("passing the clock alone is never final; only successful matching post-window report verification advances", () => {
  const policy = deriveMaturityPolicy(meta("7d_click")), businessDate = "2026-11-01", now = "2026-11-10T01:00:00.000Z";
  const reconciliation = {complete: true, reportVerified: true, policyFingerprint: policy.fingerprint, startedAt: "2026-11-10T00:00:00.000Z", completedAt: now};
  assert.equal(evaluateMaturity({businessDate, policy, now: "2026-11-09T23:59:59.999Z"}).reason, "attribution_window_open");
  assert.equal(evaluateMaturity({businessDate, policy, now}).state, "provisional");
  assert.equal(evaluateMaturity({businessDate, policy, now, reconciliation}).state, "final");
  for (const change of [{complete: false}, {reportVerified: false}, {policyFingerprint: "different"}, {startedAt: "2026-11-09T23:59:59.999Z"}, {completedAt: "2026-11-11T00:00:00.000Z"}]) {
    assert.equal(evaluateMaturity({businessDate, policy, now, reconciliation: {...reconciliation, ...change}}).state, "provisional");
  }
});
test("new configuration fingerprint invalidates old reconciliation; no mutation of native settings", () => {
  const input = meta("7d_click"), before = JSON.stringify(input), old = deriveMaturityPolicy(input);
  assert.equal(JSON.stringify(input), before); assert.ok(Object.isFrozen(old));
  const changed = deriveMaturityPolicy(meta("28d_click")); assert.notEqual(old.fingerprint, changed.fingerprint);
  const r = evaluateMaturity({businessDate: "2026-11-01", policy: changed, now: "2026-12-10T00:00:00.000Z",
    reconciliation: {complete: true, reportVerified: true, policyFingerprint: old.fingerprint, startedAt: "2026-12-09T00:00:00.000Z", completedAt: "2026-12-09T01:00:00.000Z"}});
  assert.equal(r.state, "provisional");
});
test("invalid dates, timezone, horizon and clock are rejected, not silently remapped", () => {
  for (const businessDate of ["2026-02-29", "2026-13-01", "2026-01-01T00:00:00Z", "1899-01-01"]) assert.throws(() => maturityBoundary({businessDate, timeZone: "UTC", horizonDays: 7}));
  for (const horizonDays of [-1, null, "7", 7.5, 366]) assert.throws(() => maturityBoundary({businessDate: "2026-11-01", timeZone: "UTC", horizonDays}));
  assert.throws(() => deriveMaturityPolicy({...meta("7d_click"), timeZone: "invalid"}));
  assert.throws(() => evaluateMaturity({businessDate: "2026-11-01", policy: deriveMaturityPolicy(meta("7d_click")), now: "today"}));
});
