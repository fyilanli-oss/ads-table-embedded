import {normalizeGoogleCartDataSale, classifyGoogleReportingError} from "./google-reporting.server.js";

export const GOOGLE_LIVE_EVIDENCE_VERSION = "1.0.0";
export const GOOGLE_LIVE_EVIDENCE_SAFE_LOG_PREFIX =
  "[AdsTable Google live evidence safe]";
export const GOOGLE_LIVE_EVIDENCE_QUERY_FAMILIES = Object.freeze([
  "account_campaign_context",
  "cart_data_product_sales_daily",
  "shopping_product_daily",
  "pmax_listing_tree_current",
  "pmax_asset_group_channel_daily",
]);

const MAX_PAGES_PER_FAMILY = 20;
const MAX_ROWS_PER_FAMILY = 50_000;
const INPUT_KEYS = new Set(["provider"]);
const SAFE_CODE_PATTERN = /^[A-Z0-9_]{1,100}$/;
const ERROR_CONTEXT = new WeakMap();
const SALES_ROLES = Object.freeze([
  "Advertised",
  "Cross-sell",
  "Assisted",
  "Unclassified",
]);
const CART_FIELDS = Object.freeze([
  "segments.productMerchantId",
  "segments.productFeedLabel",
  "segments.productItemId",
  "segments.productSoldItemId",
  "segments.productSoldTitle",
  "metrics.unitsSold",
  "metrics.revenueMicros",
  "metrics.leadUnitsSold",
  "metrics.leadRevenueMicros",
  "metrics.crossSellUnitsSold",
  "metrics.crossSellRevenueMicros",
  "metrics.allUnitsSold",
  "metrics.allRevenueMicros",
  "metrics.allLeadUnitsSold",
  "metrics.allLeadRevenueMicros",
  "metrics.allCrossSellUnitsSold",
  "metrics.allCrossSellRevenueMicros",
]);
const PRODUCT_FIELDS = Object.freeze([
  "segments.productMerchantId",
  "segments.productFeedLabel",
  "segments.productItemId",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.costMicros",
  "metrics.conversions",
  "metrics.conversionsValue",
]);
const LISTING_FIELDS = Object.freeze([
  "assetGroupListingGroupFilter.assetGroup",
  "assetGroupListingGroupFilter.parentListingGroupFilter",
  "assetGroupListingGroupFilter.path",
  "assetGroupListingGroupFilter.type",
  "assetGroupListingGroupFilter.listingSource",
]);
const PMAX_CHANNEL_FIELDS = Object.freeze([
  "assetGroup.id",
  "assetGroup.status",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.costMicros",
  "metrics.conversions",
  "metrics.conversionsValue",
]);

export class GoogleLiveEvidenceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GoogleLiveEvidenceError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rememberErrorContext(error, context) {
  if ((typeof error === "object" && error !== null) || typeof error === "function") {
    ERROR_CONTEXT.set(error, Object.freeze({...context}));
  }
  return error;
}

async function readCompleteFamilyWithContext(input) {
  try {
    return await readCompleteFamily(input);
  } catch (error) {
    throw rememberErrorContext(error, {
      stage: "query_family_read",
      query_family: input.queryFamily,
    });
  }
}

export function validateGoogleLiveEvidenceInput(value) {
  if (!isRecord(value)) {
    throw new GoogleLiveEvidenceError(
      "GOOGLE_LIVE_EVIDENCE_INPUT_INVALID",
      "Request body must be an object",
    );
  }
  if (Object.keys(value).some((key) => !INPUT_KEYS.has(key))) {
    throw new GoogleLiveEvidenceError(
      "GOOGLE_LIVE_EVIDENCE_INPUT_FIELDS_INVALID",
      "Only provider is accepted",
    );
  }
  if (value.provider !== "google_ads") {
    throw new GoogleLiveEvidenceError(
      "GOOGLE_LIVE_EVIDENCE_PROVIDER_INVALID",
      "The Google evidence route accepts only google_ads",
    );
  }
  return Object.freeze({provider: "google_ads"});
}

function calendarDateInTimeZone(instant, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
  } catch {
    throw new GoogleLiveEvidenceError(
      "GOOGLE_LIVE_EVIDENCE_TIMEZONE_INVALID",
      "Reporting Account timezone is invalid",
      502,
    );
  }
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftCalendarDate(value, days) {
  const instant = new Date(`${value}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function completedThirtyDayWindow({now, timeZone}) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.valueOf())) {
    throw new GoogleLiveEvidenceError(
      "GOOGLE_LIVE_EVIDENCE_CLOCK_INVALID",
      "Evidence clock is invalid",
      502,
    );
  }
  const today = calendarDateInTimeZone(instant, timeZone);
  const end = shiftCalendarDate(today, -1);
  return Object.freeze({start: shiftCalendarDate(end, -29), end});
}

function nestedValue(row, path) {
  return path.split(".").reduce(
    (value, key) => value && typeof value === "object" ? value[key] : undefined,
    row,
  );
}

function valueState(value) {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "empty" : "present";
  if (typeof value === "string") {
    if (value.length === 0) return "empty";
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric === 0 ? "zero" : "present_numeric";
    return "present";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value === 0 ? "zero" : "present_numeric";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return "present";
  return "unexpected";
}

function fieldStateCounts(rows, fields) {
  return Object.freeze(Object.fromEntries(fields.map((field) => {
    const counts = {};
    for (const row of rows) {
      const state = valueState(nestedValue(row, field));
      counts[state] = (counts[state] ?? 0) + 1;
    }
    return [field, Object.freeze(counts)];
  })));
}

function sameAuthority(left, right) {
  return left?.connection_id === right?.connection_id
    && left?.reporting_account_id === right?.reporting_account_id
    && left?.reporting_account_currency === right?.reporting_account_currency
    && left?.reporting_account_timezone === right?.reporting_account_timezone;
}

async function readCompleteFamily({
  googleRuntime,
  installationAuthority,
  queryFamily,
  dateWindow,
  expectedAuthority = null,
}) {
  const rows = [];
  const cursors = new Set();
  let pageToken = null;
  let pageCount = 0;
  let authority = expectedAuthority;
  do {
    if (pageCount >= MAX_PAGES_PER_FAMILY) {
      throw new GoogleLiveEvidenceError(
        "GOOGLE_LIVE_EVIDENCE_PAGE_LIMIT_EXCEEDED",
        "Google evidence pagination exceeded its safety limit",
        502,
      );
    }
    const result = await googleRuntime.readEvidencePage({
      installationAuthority,
      queryFamily,
      dateWindow,
      pageToken,
    });
    if (!result?.authority || !Array.isArray(result?.page?.rows)) {
      throw new GoogleLiveEvidenceError(
        "GOOGLE_LIVE_EVIDENCE_RESULT_INVALID",
        "Google reporting runtime returned an invalid evidence page",
        502,
      );
    }
    if (authority && !sameAuthority(authority, result.authority)) {
      throw new GoogleLiveEvidenceError(
        "GOOGLE_LIVE_EVIDENCE_AUTHORITY_CHANGED",
        "Google reporting authority changed during the execution",
        502,
      );
    }
    authority = result.authority;
    rows.push(...result.page.rows);
    pageCount += 1;
    if (rows.length > MAX_ROWS_PER_FAMILY) {
      throw new GoogleLiveEvidenceError(
        "GOOGLE_LIVE_EVIDENCE_ROW_LIMIT_EXCEEDED",
        "Google evidence row count exceeded its safety limit",
        502,
      );
    }
    pageToken = result.page.next_cursor;
    if (pageToken !== null) {
      if (typeof pageToken !== "string" || pageToken.length < 1 || cursors.has(pageToken)) {
        throw new GoogleLiveEvidenceError(
          "GOOGLE_LIVE_EVIDENCE_CURSOR_INVALID",
          "Google evidence pagination returned an invalid cursor",
          502,
        );
      }
      cursors.add(pageToken);
    }
  } while (pageToken !== null);

  return Object.freeze({
    authority,
    rows: Object.freeze(rows),
    page_count: pageCount,
    observation_state: rows.length === 0
      ? "not_observed_in_this_execution"
      : "present",
  });
}

function familySummary(result, fields) {
  return Object.freeze({
    row_count: result.rows.length,
    page_count: result.page_count,
    observation_state: result.observation_state,
    field_state_counts: fieldStateCounts(result.rows, fields),
  });
}

function salesRoleCounts(rows) {
  const counts = Object.fromEntries(SALES_ROLES.map((role) => [role, 0]));
  for (const row of rows) {
    const sale = normalizeGoogleCartDataSale(row);
    counts[sale.sales_role] += 1;
  }
  return Object.freeze(counts);
}

function accountTypeState(rows) {
  const values = rows
    .map((row) => row?.customer?.testAccount)
    .filter((value) => typeof value === "boolean");
  if (values.includes(true)) {
    throw new GoogleLiveEvidenceError(
      "GOOGLE_LIVE_EVIDENCE_TEST_ACCOUNT_NOT_ELIGIBLE",
      "A Google test account cannot provide serving evidence",
      422,
    );
  }
  return values.includes(false) ? "production_observed" : "not_observed";
}

export function createGoogleLiveEvidenceRuntime({googleRuntime, clock = () => new Date()}) {
  if (!googleRuntime || typeof googleRuntime.readEvidencePage !== "function") {
    throw new TypeError("googleRuntime.readEvidencePage is required");
  }
  if (typeof googleRuntime.prepareEvidenceExecution !== "function") {
    throw new TypeError("googleRuntime.prepareEvidenceExecution is required");
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function");

  return Object.freeze({
    async execute({installationAuthority, input}) {
      validateGoogleLiveEvidenceInput(input);
      const now = new Date(clock());
      if (Number.isNaN(now.valueOf())) {
        throw new GoogleLiveEvidenceError(
          "GOOGLE_LIVE_EVIDENCE_CLOCK_INVALID",
          "Evidence clock is invalid",
          502,
        );
      }
      try {
        await googleRuntime.prepareEvidenceExecution({installationAuthority});
      } catch (error) {
        throw rememberErrorContext(error, {
          stage: "credential_refresh",
          query_family: null,
        });
      }
      const seedDate = now.toISOString().slice(0, 10);
      const account = await readCompleteFamilyWithContext({
        googleRuntime,
        installationAuthority,
        queryFamily: GOOGLE_LIVE_EVIDENCE_QUERY_FAMILIES[0],
        dateWindow: {start: seedDate, end: seedDate},
      });
      const accountType = accountTypeState(account.rows);
      const timeZone = account.authority.reporting_account_timezone;
      const dateWindow = completedThirtyDayWindow({now, timeZone});
      const results = {account_campaign_context: account};

      for (const queryFamily of GOOGLE_LIVE_EVIDENCE_QUERY_FAMILIES.slice(1)) {
        results[queryFamily] = await readCompleteFamilyWithContext({
          googleRuntime,
          installationAuthority,
          queryFamily,
          dateWindow,
          expectedAuthority: account.authority,
        });
      }

      const cart = results.cart_data_product_sales_daily;
      const product = results.shopping_product_daily;
      const listing = results.pmax_listing_tree_current;
      const pmax = results.pmax_asset_group_channel_daily;
      const evidenceRowCount = cart.rows.length + product.rows.length
        + listing.rows.length + pmax.rows.length;

      return Object.freeze({
        status: "complete",
        provider: "google_ads",
        evidence_version: GOOGLE_LIVE_EVIDENCE_VERSION,
        publishable_to_dataset_v2: false,
        observation_state: evidenceRowCount === 0
          ? "not_observed_in_this_execution"
          : "present",
        reporting_window: Object.freeze({
          ...dateWindow,
          timezone: timeZone,
          completed_business_dates: 30,
        }),
        account: Object.freeze({
          account_type_state: accountType,
          campaign_context_row_count: account.rows.length,
          page_count: account.page_count,
        }),
        cart_data_sales: Object.freeze({
          ...familySummary(cart, CART_FIELDS),
          sales_role_counts: salesRoleCounts(cart.rows),
        }),
        product_performance: familySummary(product, PRODUCT_FIELDS),
        current_listing_tree: Object.freeze({
          ...familySummary(listing, LISTING_FIELDS),
          historical_channel_resolution: "not_performed_from_current_tree",
        }),
        pmax_asset_group_performance: familySummary(pmax, PMAX_CHANNEL_FIELDS),
        controls: Object.freeze({
          query_families_completed: Object.freeze([...GOOGLE_LIVE_EVIDENCE_QUERY_FAMILIES]),
          provider_retry_performed: false,
          alternate_route_used: false,
          database_write_performed: false,
          raw_provider_rows_exposed: false,
          raw_provider_identifiers_exposed: false,
          provider_request_ids_exposed: false,
          cursors_exposed: false,
          token_or_credential_exposed: false,
        }),
      });
    },
  });
}

export function buildGoogleLiveEvidenceSafeLog(result) {
  if (result?.status !== "complete" || result?.provider !== "google_ads") {
    throw new GoogleLiveEvidenceError(
      "GOOGLE_LIVE_EVIDENCE_SAFE_LOG_RESULT_INVALID",
      "Only completed Google evidence can be logged",
      502,
    );
  }
  return Object.freeze({
    event: "google_live_evidence_safe",
    ...result,
  });
}

export function classifyGoogleLiveEvidenceError(error) {
  if (error instanceof GoogleLiveEvidenceError) {
    return Object.freeze({
      status: error.status,
      code: error.code,
      class: error.status === 401
        ? "reauthorization_required"
        : error.status >= 500 ? "internal_adapter_failure" : "request_contract_invalid",
      provider_request_id: null,
    });
  }
  const refreshRequiresReauthorization =
    error?.code === "GOOGLE_ADS_REFRESH_TOKEN_UNAVAILABLE"
    || (
      error?.code === "GOOGLE_ADS_OAUTH_TOKEN_EXCHANGE_FAILED"
      && error?.details?.provider_status === "invalid_grant"
    );
  if (refreshRequiresReauthorization) {
    return Object.freeze({
      status: 401,
      code: "GOOGLE_ADS_REAUTHORIZATION_REQUIRED",
      class: "reauthorization_required",
      provider_request_id: null,
    });
  }
  const classified = classifyGoogleReportingError(error);
  const providerCode = error?.details?.provider_error_code;
  const publicCode = typeof providerCode === "string"
    && SAFE_CODE_PATTERN.test(providerCode)
    ? `GOOGLE_PROVIDER_${providerCode}`
    : "GOOGLE_LIVE_EVIDENCE_FAILED";
  return Object.freeze({
    status: classified.class === "reauthorization_required" ? 401 : 502,
    code: publicCode,
    class: classified.class,
    provider_request_id: classified.provider_request_id,
  });
}

export function buildGoogleLiveEvidenceSafeFailureLog(
  error,
  failure = classifyGoogleLiveEvidenceError(error),
  fallbackStage = "runtime_initialization_or_execution",
) {
  const context = ERROR_CONTEXT.get(error);
  const sourceCode = typeof error?.code === "string" && SAFE_CODE_PATTERN.test(error.code)
    ? error.code
    : null;
  const providerStatus = Number(error?.details?.status);
  const providerErrorCode = typeof error?.details?.provider_error_code === "string"
    && SAFE_CODE_PATTERN.test(error.details.provider_error_code)
    ? error.details.provider_error_code
    : null;
  return Object.freeze({
    event: "google_live_evidence_failed",
    status: "failed",
    code: failure.code,
    class: failure.class,
    stage: context?.stage ?? fallbackStage,
    query_family: context?.query_family ?? null,
    source_code: sourceCode,
    provider_http_status: Number.isInteger(providerStatus)
      && providerStatus >= 400 && providerStatus <= 599
      ? providerStatus
      : null,
    provider_error_code: providerErrorCode,
    provider_response_observed: Boolean(
      providerErrorCode
      || (Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus <= 599),
    ),
    provider_retry_performed: false,
    next_query_family_started: false,
  });
}
