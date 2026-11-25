const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(?!0000)\d{4}-\d{2}-\d{2}$/;
const VIEW_LIMITS = new Map([["summary", 90], ["table", 90], ["daily", 31]]);

function parseDay(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new RangeError("COMPARE_DATE_INVALID");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || formatDay(date) !== value) {
    throw new RangeError("COMPARE_DATE_INVALID");
  }
  return date;
}

function formatDay(date) {
  const value = date.toISOString().split("T")[0];
  if (!DATE_PATTERN.test(value)) throw new RangeError("COMPARE_DATE_OUT_OF_RANGE");
  return value;
}

function shiftDay(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function previousYearStart(date) {
  const result = new Date(date.getTime());
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() - 1);
  if (result.getUTCMonth() !== month) result.setUTCDate(0);
  return result;
}

function boundedDayCount(start, end, maxDays) {
  if (end < start) throw new RangeError("COMPARE_RANGE_REVERSED");
  const dayCount = (end - start) / DAY_MS + 1;
  if (dayCount > maxDays) throw new RangeError("COMPARE_RANGE_TOO_LONG");
  return dayCount;
}

// Inputs are business-date labels in the installed shop's calendar. UTC is
// used only for calendar arithmetic so daylight-saving shifts do not alter a day count.
export function resolveComparisonCalendar({view, startDate, endDate, comparison = {mode: "none"}}) {
  const maxDays = VIEW_LIMITS.get(view);
  if (maxDays === undefined) throw new RangeError("COMPARE_VIEW_INVALID");

  const primaryStart = parseDay(startDate);
  const primaryEnd = parseDay(endDate);
  const dayCount = boundedDayCount(primaryStart, primaryEnd, maxDays);
  const primary = {startDate, endDate};
  const mode = comparison?.mode;
  let comparisonStart;
  let comparisonEnd;

  switch (mode) {
    case "none":
      return {mode, dayCount, primary, comparison: null};
    case "previous-period":
      comparisonStart = shiftDay(primaryStart, -dayCount);
      comparisonEnd = shiftDay(primaryStart, -1);
      break;
    case "previous-year":
      comparisonStart = previousYearStart(primaryStart);
      comparisonEnd = shiftDay(comparisonStart, dayCount - 1);
      break;
    case "custom":
      comparisonStart = parseDay(comparison.startDate);
      comparisonEnd = parseDay(comparison.endDate);
      if (boundedDayCount(comparisonStart, comparisonEnd, maxDays) !== dayCount) {
        throw new RangeError("COMPARE_DAY_COUNT_MISMATCH");
      }
      break;
    default:
      throw new RangeError("COMPARE_MODE_INVALID");
  }

  return {
    mode,
    dayCount,
    primary,
    comparison: {startDate: formatDay(comparisonStart), endDate: formatDay(comparisonEnd)},
  };
}
