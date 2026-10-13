import {
  createProviderAccountAuthorityRepository,
} from "../database/provider-account-authority-repository.server.js";
import {fetchMetaRawInsightsPage} from "./meta-channel.server.js";

export const META_CHANNEL_LIVE_GATE_LOOKBACK_DAYS = 31;
const MAXIMUM_SCAN_PAGES = 20;
const MAXIMUM_EXACT_PAGES = 10;
const MAXIMUM_ROWS = 2_000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isoDateInTimeZone(value, timeZone) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const selected = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${selected.year}-${selected.month}-${selected.day}`;
  } catch {
    fail("META_CHANNEL_ACCOUNT_TIMEZONE_INVALID");
  }
}

function subtractDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) fail("META_CHANNEL_DATE_INVALID");
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function previousClosedMetaDate(now, timeZone) {
  return subtractDays(isoDateInTimeZone(now, timeZone), 1);
}

async function readAllPages({
  reportingAccountId,
  start,
  end,
  accessToken,
  fetchFn,
  maximumPages,
}) {
  const rows = [];
  const requestIds = [];
  const seen = new Set();
  let cursor = null;
  let pageCount = 0;
  do {
    const key = cursor ?? "__FIRST_PAGE__";
    if (seen.has(key)) fail("META_CHANNEL_LIVE_GATE_CURSOR_LOOP");
    seen.add(key);
    if (pageCount >= maximumPages) fail("META_CHANNEL_LIVE_GATE_PAGE_LIMIT");
    const page = await fetchMetaRawInsightsPage({
      reportingAccountId,
      start,
      end,
      accessToken,
      cursor,
      fetchFn,
    });
    pageCount += 1;
    rows.push(...page.rows);
    if (rows.length > MAXIMUM_ROWS) fail("META_CHANNEL_LIVE_GATE_ROW_LIMIT");
    if (page.provider_request_id) requestIds.push(page.provider_request_id);
    cursor = page.next_cursor;
  } while (cursor !== null);
  return Object.freeze({rows: Object.freeze(rows), pageCount, requestIds});
}

function nonNegative(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) fail(`META_CHANNEL_${field}_INVALID`);
  return parsed;
}

function providerMetricEvidence(rows, field) {
  const entries = new Map();
  let malformedEntryCount = 0;
  for (const row of rows) {
    const list = row?.[field];
    if (list === null || list === undefined) continue;
    if (!Array.isArray(list)) {
      malformedEntryCount += 1;
      continue;
    }
    for (const item of list) {
      const actionType = typeof item?.action_type === "string" ? item.action_type.trim() : "";
      const rawValue = item?.value === null || item?.value === undefined
        ? ""
        : String(item.value).trim();
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(actionType) || !/^\d+(?:\.\d+)?$/.test(rawValue)) {
        malformedEntryCount += 1;
        continue;
      }
      const key = `${actionType}\u0000${rawValue}`;
      const prior = entries.get(key);
      entries.set(key, Object.freeze({
        action_type: actionType,
        value: rawValue,
        entry_count: (prior?.entry_count ?? 0) + 1,
      }));
    }
  }
  return Object.freeze({
    source_field: field,
    source_row_count: rows.length,
    entry_count: [...entries.values()].reduce((sum, entry) => sum + entry.entry_count, 0),
    malformed_entry_count: malformedEntryCount,
    entries: Object.freeze([...entries.values()].sort((left, right) =>
      left.action_type.localeCompare(right.action_type)
      || left.value.localeCompare(right.value))),
  });
}

function actionTotal(rows, actionType) {
  let total = 0;
  for (const row of rows) {
    const list = row?.actions;
    if (list == null) continue;
    if (!Array.isArray(list)) fail("META_CHANNEL_ACTIONS_INVALID");
    const matches = list.filter((entry) => entry?.action_type === actionType);
    if (matches.length > 1) fail("META_CHANNEL_ACTION_DUPLICATE");
    if (matches.length === 1) total += nonNegative(matches[0].value, "ACTION_VALUE");
  }
  return total;
}

function summarize(rows, account) {
  const currencies = new Set(rows.map((row) => String(row?.account_currency ?? "")));
  if (currencies.size !== 1 || !currencies.has(account.currency)) {
    fail("META_CHANNEL_ACCOUNT_CURRENCY_MISMATCH");
  }
  return Object.freeze({
    row_count: rows.length,
    campaign_count: new Set(rows.map((row) => String(row.campaign_id))).size,
    adset_count: new Set(rows.map((row) => String(row.adset_id))).size,
    ad_count: new Set(rows.map((row) => String(row.ad_id))).size,
    impression_total: rows.reduce(
      (sum, row) => sum + nonNegative(row.impressions, "IMPRESSIONS"),
      0,
    ),
    link_click_total: actionTotal(rows, "link_click"),
    spend_total: rows.reduce((sum, row) => sum + nonNegative(row.spend, "SPEND"), 0),
    source_currency: account.currency,
    actions: providerMetricEvidence(rows, "actions"),
    action_values: providerMetricEvidence(rows, "action_values"),
  });
}

export function createMetaChannelReadOnlyGate({
  database,
  tokenVault,
  fetchFn = fetch,
  now = () => new Date(),
} = {}) {
  const connections = createProviderAccountAuthorityRepository(database);
  return Object.freeze({
    async execute({installationAuthority}) {
      const connection = await connections.load({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        provider: "meta",
      });
      if (!connection?.reportingAccountId) fail("META_CHANNEL_REPORTING_ACCOUNT_REQUIRED");
      const account = connection.accounts.find(
        (candidate) => candidate.id === connection.reportingAccountId,
      );
      if (!account || typeof account.timezone !== "string" || typeof account.currency !== "string") {
        fail("META_CHANNEL_REPORTING_ACCOUNT_EVIDENCE_INVALID");
      }
      const stored = await tokenVault.loadProviderTokenSet({
        credentialId: connection.credentialId,
        installationAuthority,
        provider: "meta",
      });
      if (!stored?.access_token) fail("META_ACCESS_TOKEN_UNAVAILABLE");

      const scanEnd = previousClosedMetaDate(now(), account.timezone);
      const scanStart = subtractDays(scanEnd, META_CHANNEL_LIVE_GATE_LOOKBACK_DAYS - 1);
      const scan = await readAllPages({
        reportingAccountId: connection.reportingAccountId,
        start: scanStart,
        end: scanEnd,
        accessToken: stored.access_token,
        fetchFn,
        maximumPages: MAXIMUM_SCAN_PAGES,
      });
      const providerDates = scan.rows
        .map((row) => String(row?.date_start ?? ""))
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort();
      const providerDate = providerDates.at(-1) ?? null;
      if (providerDate === null) {
        return Object.freeze({
          status: "PASS_META_CHANNEL_READ_ONLY",
          provider_result_status: "empty",
          lookback_days: META_CHANNEL_LIVE_GATE_LOOKBACK_DAYS,
          scan_start: scanStart,
          scan_end: scanEnd,
          scan_page_count: scan.pageCount,
          dataset_v2_writes: 0,
          scheduler_started: false,
          backfill_started: false,
        });
      }

      const exact = await readAllPages({
        reportingAccountId: connection.reportingAccountId,
        start: providerDate,
        end: providerDate,
        accessToken: stored.access_token,
        fetchFn,
        maximumPages: MAXIMUM_EXACT_PAGES,
      });
      for (const row of exact.rows) {
        if (row.date_start !== providerDate || row.date_stop !== providerDate) {
          fail("META_CHANNEL_EXACT_DATE_MISMATCH");
        }
      }
      return Object.freeze({
        status: "PASS_META_CHANNEL_READ_ONLY",
        provider_result_status: "non_empty",
        lookback_days: META_CHANNEL_LIVE_GATE_LOOKBACK_DAYS,
        scan_start: scanStart,
        scan_end: scanEnd,
        provider_date: providerDate,
        scan_page_count: scan.pageCount,
        exact_page_count: exact.pageCount,
        ...summarize(exact.rows, account),
        dataset_v2_writes: 0,
        scheduler_started: false,
        backfill_started: false,
      });
    },
  });
}

export {providerMetricEvidence};
