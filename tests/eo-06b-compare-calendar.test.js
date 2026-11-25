import assert from "node:assert/strict";
import test from "node:test";
import {resolveComparisonCalendar} from "../app/lib/reporting/compare-calendar.server.js";

const october = {view: "summary", startDate: "2026-10-01", endDate: "2026-10-07"};
const dates = (startDate, endDate) => ({startDate, endDate});

test("uses inclusive dates and returns only the primary period by default", () => {
  assert.deepEqual(resolveComparisonCalendar(october), {
    mode: "none",
    dayCount: 7,
    primary: dates("2026-10-01", "2026-10-07"),
    comparison: null,
  });
});

test("previous period is adjacent and uses the same number of calendar days", () => {
  assert.deepEqual(resolveComparisonCalendar({
    ...october, comparison: {mode: "previous-period"},
  }).comparison, dates("2026-09-24", "2026-09-30"));

  const march = resolveComparisonCalendar({
    view: "daily", ...dates("2026-03-07", "2026-03-09"), comparison: {mode: "previous-period"},
  });
  assert.equal(march.dayCount, 3);
  assert.deepEqual(march.comparison, dates("2026-03-04", "2026-03-06"));
});

test("previous year anchors the start and keeps equal length around leap days", () => {
  const comparison = {mode: "previous-year"};
  assert.deepEqual(resolveComparisonCalendar({...october, comparison}).comparison,
    dates("2025-10-01", "2025-10-07"));
  assert.deepEqual(resolveComparisonCalendar({
    view: "daily", ...dates("2024-02-28", "2024-03-01"), comparison,
  }).comparison, dates("2023-02-28", "2023-03-02"));
  assert.deepEqual(resolveComparisonCalendar({
    view: "daily", ...dates("2024-02-29", "2024-02-29"), comparison,
  }).comparison, dates("2023-02-28", "2023-02-28"));
});

test("custom ranges require valid, ordered dates and matching lengths", () => {
  const custom = (startDate, endDate) => resolveComparisonCalendar({
    ...october, comparison: {mode: "custom", startDate, endDate},
  });
  assert.deepEqual(custom("2026-09-10", "2026-09-16").comparison, dates("2026-09-10", "2026-09-16"));
  assert.throws(() => custom("2026-09-10", "2026-09-15"), /COMPARE_DAY_COUNT_MISMATCH/);
  assert.throws(() => custom("2026-09-16", "2026-09-10"), /COMPARE_RANGE_REVERSED/);
  assert.throws(() => custom("2026-02-29", "2026-03-06"), /COMPARE_DATE_INVALID/);
});

test("applies 90-day Summary/Table and 31-day Daily limits to both windows", () => {
  for (const view of ["summary", "table"]) {
    assert.equal(resolveComparisonCalendar({view, ...dates("2026-01-01", "2026-03-31")}).dayCount, 90);
    assert.throws(() => resolveComparisonCalendar({view, ...dates("2026-01-01", "2026-04-01")}),
      /COMPARE_RANGE_TOO_LONG/);
  }
  assert.equal(resolveComparisonCalendar({view: "daily", ...dates("2026-01-01", "2026-01-31")}).dayCount, 31);
  assert.throws(() => resolveComparisonCalendar({view: "daily", ...dates("2026-01-01", "2026-02-01")}),
    /COMPARE_RANGE_TOO_LONG/);
  assert.throws(() => resolveComparisonCalendar({
    ...october, view: "daily", comparison: {mode: "custom", ...dates("2026-01-01", "2026-02-01")},
  }), /COMPARE_RANGE_TOO_LONG/);
});

test("rejects unknown views or modes and invalid or unrepresentable dates", () => {
  assert.throws(() => resolveComparisonCalendar({...october, view: "unknown"}), /COMPARE_VIEW_INVALID/);
  assert.throws(() => resolveComparisonCalendar({...october, comparison: {mode: "unknown"}}), /COMPARE_MODE_INVALID/);
  assert.throws(() => resolveComparisonCalendar({...october, startDate: "2026-10-01T00:00:00Z"}),
    /COMPARE_DATE_INVALID/);
  assert.throws(() => resolveComparisonCalendar({
    view: "daily", ...dates("0001-01-01", "0001-01-01"), comparison: {mode: "previous-period"},
  }), /COMPARE_DATE_OUT_OF_RANGE/);
});
