const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function instant(value) {
  const milliseconds = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(milliseconds)
    || new Date(milliseconds).toISOString() !== value) {
    throw Error("REPORT_PLAN_INSTANT_INVALID");
  }
  return milliseconds;
}

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

// Plans dates and intervals only. Provider admission owns capability evidence,
// while the daily writer owns eligibility, revision checks and receipts.
export function planIncrementalReport({tickAt, timeZone, hourlySupported, dailyWindows = {}}) {
  const tick = instant(tickAt);
  if (typeof timeZone !== "string" || !timeZone) throw Error("REPORT_PLAN_TIMEZONE_INVALID");
  const calendar = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(calendar.formatToParts(tick).map(part => [part.type, part.value]));
  const today = [parts.year, parts.month, parts.day].join("-");
  const yesterday = iso(Date.parse(today) - DAY_MS).slice(0, 10);
  const hourly = hourlySupported === true && Number(parts.minute) === 0
    && Number(parts.second) === 0 && tick % 1_000 === 0
    ? Object.freeze({
      start: iso(tick - 2 * HOUR_MS),
      end: tickAt,
      hours: Object.freeze([iso(tick - 2 * HOUR_MS), iso(tick - HOUR_MS)]),
    })
    : null;

  const daily = [];
  for (const [kind, businessDate] of [["yesterday", yesterday], ["today", today]]) {
    const window = dailyWindows[kind];
    if (!window) continue;
    const start = instant(window.start), end = instant(window.end);
    if (end <= start) throw Error("REPORT_PLAN_DAILY_WINDOW_INVALID");
    if (tick >= start && tick < end) {
      // The caller must claim this key once per account, metric and calendar day.
      daily.push(Object.freeze({kind, businessDate, timeZone, scheduledFor: today,
        cutoff: kind === "today" ? tickAt : null}));
    }
  }
  return Object.freeze({timeZone, hourly, daily: Object.freeze(daily)});
}

// Apply complete, already verified hour snapshots for one series. This pure
// transition has no daily state input and cannot commit or attest to a write.
export function replaceVerifiedReportHours({plan, current, snapshots}) {
  const hours = plan.hourly?.hours;
  if (!hours || snapshots.length !== hours.length) throw Error("REPORT_HOURLY_COVERAGE_REQUIRED");

  const next = new Map(current);
  const remaining = new Set(hours);
  for (const snapshot of snapshots) {
    if (!remaining.delete(snapshot.start) || !Array.isArray(snapshot.rows)) {
      throw Error("REPORT_HOURLY_COVERAGE_REQUIRED");
    }
    const observed = instant(snapshot.observedAt);
    if (observed < instant(plan.hourly.end)) throw Error("REPORT_HOURLY_OBSERVATION_INVALID");
    const previous = current.get(snapshot.start);
    if (!previous || observed > instant(previous.observedAt)) {
      next.set(snapshot.start, snapshot);
    }
  }
  return next;
}
