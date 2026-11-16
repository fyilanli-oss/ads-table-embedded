import assert from "node:assert/strict";
import test from "node:test";
import {planIncrementalReport, planKlaviyoHourlySource, replaceVerifiedReportHours} from "../app/lib/refresh/incremental-report-plan.server.js";

const timeZone = "Europe/Istanbul";
const planAt = tickAt => planIncrementalReport({tickAt, timeZone, hourlySupported: true});

test("delayed queue ticks keep a stable hourly binding and the local date at midnight", () => {
  const planned = tickAt => planKlaviyoHourlySource({tickAt, timeZone});
  const binding = planned("2026-11-16T21:00:17.123Z");
  assert.deepEqual(binding, planned("2026-11-16T21:59:59.999Z"));
  assert.deepEqual(binding.window, {from: "2026-11-16", to: "2026-11-16"});
  assert.equal(binding.partitionId, "klaviyo-hourly-source:2026-11-16T19:00:00.000Z/2026-11-16T21:00:00.000Z");
  assert.deepEqual(planned("2026-11-16T22:00:01.000Z").window, {from: "2026-11-16", to: "2026-11-17"});
});

test("hourly binding handles fractional time zones and skips partial DST hours", () => {
  assert.equal(planKlaviyoHourlySource({tickAt: "2026-11-16T00:20:00.000Z",
    timeZone: "Asia/Kathmandu"}).end, "2026-11-16T00:15:00.000Z");
  assert.equal(planKlaviyoHourlySource({tickAt: "2026-10-03T16:01:00.000Z",
    timeZone: "Australia/Lord_Howe"}), null);
});

test("provider midnight keeps the prior day's final two hours separate from daily jobs", () => {
  const tickAt = "2026-11-16T21:00:00.000Z";
  const window = {start: tickAt, end: "2026-11-16T22:00:00.000Z"};
  const plan = planIncrementalReport({tickAt, timeZone, hourlySupported: true,
    dailyWindows: {today: window, yesterday: window}});
  assert.deepEqual(plan.hourly, {
    start: "2026-11-16T19:00:00.000Z", end: tickAt,
    hours: ["2026-11-16T19:00:00.000Z", "2026-11-16T20:00:00.000Z"],
  });
  assert.deepEqual(plan.daily.map(job => [job.kind, job.businessDate, job.scheduledFor, job.cutoff]), [
    ["yesterday", "2026-11-16", "2026-11-17", null],
    ["today", "2026-11-17", "2026-11-17", tickAt],
  ]);
  assert.deepEqual(planIncrementalReport({tickAt: window.end, timeZone,
    dailyWindows: {yesterday: window}}).daily, []);
});

test("unverified hour granularity leaves only daily work, even in a fractional-offset zone", () => {
  const tickAt = "2026-11-16T00:15:00.000Z";
  const input = {tickAt, timeZone: "Asia/Kathmandu",
    dailyWindows: {today: {start: tickAt, end: "2026-11-16T00:45:00.000Z"}}};
  const plan = planIncrementalReport(input);
  assert.equal(plan.hourly, null);
  assert.equal(plan.daily.length, 1);
  assert.equal(planIncrementalReport({...input, hourlySupported: true}).hourly.end, tickAt);
});

test("fall-back hours with identical local labels keep distinct UTC identities", () => {
  const plan = planIncrementalReport({tickAt: "2026-11-01T07:00:00.000Z",
    timeZone: "America/New_York", hourlySupported: true});
  assert.deepEqual(plan.hourly.hours, ["2026-11-01T05:00:00.000Z", "2026-11-01T06:00:00.000Z"]);
});

test("new overlapping hour replaces the prior snapshot, preserving hours outside the plan", () => {
  const first = planAt("2026-11-16T12:00:00.000Z");
  const second = planAt("2026-11-16T13:00:00.000Z");
  const snapshots = (plan, rows) => plan.hourly.hours.map((start, index) =>
    ({start, observedAt: plan.hourly.end, rows: rows[index]}));
  const original = snapshots(first, [[1], [3]]);
  const current = replaceVerifiedReportHours({plan: first, current: new Map(), snapshots: original});
  const next = replaceVerifiedReportHours({plan: second, current, snapshots: snapshots(second, [[5], []])});
  assert.deepEqual([...next.values()].map(snapshot => snapshot.rows), [[1], [5], []]);
  assert.deepEqual([...current.values()].map(snapshot => snapshot.rows), [[1], [3]]);
  assert.deepEqual(replaceVerifiedReportHours({plan: first, current: next, snapshots: original}), next);
  assert.throws(() => replaceVerifiedReportHours({plan: second, current: next,
    snapshots: [original[1], original[1]]}), /COVERAGE_REQUIRED|OBSERVATION_INVALID/);
});
