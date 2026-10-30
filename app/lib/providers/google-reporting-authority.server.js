import {oauthInstallationAuthority} from "../oauth/oauth-transaction.server.js";
import {
  createProviderAccountAuthorityRepository,
} from "../database/provider-account-authority-repository.server.js";
import {
  createGoogleAdsRestClient,
  GoogleAdsRestError,
  readGoogleAdsOAuthConfig,
  refreshGoogleAdsAccessToken,
} from "./google-ads-rest.server.js";
import {buildGoogleReportingQueries, fetchGoogleReportingPage, GoogleReportingError} from "./google-reporting.server.js";
import {buildGoogleSearchSourceLinks, buildGoogleShoppingSourceLinks} from "./google-source-links.server.js";
import {GOOGLE_PD_FLOW_FAMILIES} from "./google-pd-orchestration.server.js";
import {readGooglePdNativeMetadata} from "./google-pd-native-metadata.server.js";

const PROVIDER = "google_ads";
const CUSTOMER_ID_PATTERN = /^[0-9]+$/;

function owner(value) {
  return oauthInstallationAuthority({
    workspaceId: value?.workspaceId,
    installGeneration: value?.installGeneration,
    status: value?.status,
  });
}

function connectedReportingAccount(connection) {
  if (!connection) throw new Error("CONNECTED_GOOGLE_CONNECTION_REQUIRED");
  if (
    typeof connection.reportingAccountId !== "string"
    || !CUSTOMER_ID_PATTERN.test(connection.reportingAccountId)
  ) throw new Error("GOOGLE_REPORTING_ACCOUNT_REQUIRED");
  const selected = connection.accounts.find(
    (account) => account.id === connection.reportingAccountId,
  );
  if (
    !selected
    || selected.kind !== "advertiser"
    || selected.reporting_eligible !== true
  ) throw new Error("GOOGLE_REPORTING_ACCOUNT_AUTHORITY_INVALID");
  const loginAccountId = selected.login_account_id ?? null;
  if (loginAccountId !== null && !CUSTOMER_ID_PATTERN.test(loginAccountId)) {
    throw new Error("GOOGLE_LOGIN_ACCOUNT_AUTHORITY_INVALID");
  }
  if (typeof selected.timezone !== "string" || selected.timezone.length < 1) {
    throw new Error("GOOGLE_REPORTING_ACCOUNT_TIMEZONE_REQUIRED");
  }
  if (typeof selected.currency !== "string" || !/^[A-Z]{3}$/.test(selected.currency)) {
    throw new Error("GOOGLE_REPORTING_ACCOUNT_CURRENCY_REQUIRED");
  }
  return Object.freeze({
    id: selected.id,
    loginAccountId,
    currency: selected.currency,
    timezone: selected.timezone,
  });
}

export function createGoogleReportingAuthorityRuntime({
  database,
  tokenVault,
  environment = process.env,
  fetchFn = fetch,
} = {}) {
  if (!tokenVault || typeof tokenVault.loadProviderTokenSet !== "function") {
    throw new TypeError("tokenVault.loadProviderTokenSet is required");
  }
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const config = readGoogleAdsOAuthConfig(environment);
  const accountAuthority = createProviderAccountAuthorityRepository(database);
  let preparedAuthorityPromise = null;
  let preparedInstallationKey = null;

  async function prepareEvidenceExecution({installationAuthority}) {
    const installation = owner(installationAuthority);
    const installationKey = JSON.stringify([installation.workspaceId, installation.installGeneration]);
    if (preparedInstallationKey !== null && preparedInstallationKey !== installationKey) {
      throw new GoogleReportingError("GOOGLE_REPORTING_EXECUTION_SCOPE_MISMATCH", "Google execution belongs to another installation");
    }
    if (preparedAuthorityPromise) return preparedAuthorityPromise;
    preparedInstallationKey = installationKey;
    preparedAuthorityPromise = (async () => {
      const connection = await accountAuthority.load({
        workspaceId: installation.workspaceId,
        installGeneration: installation.installGeneration,
        provider: PROVIDER,
      });
      const reportingAccount = connectedReportingAccount(connection);
      const stored = await tokenVault.loadProviderTokenSet({
        credentialId: connection.credentialId,
        installationAuthority: installation,
        provider: PROVIDER,
      });
      if (
        typeof stored?.refresh_token !== "string"
        || stored.refresh_token.length < 1
        || stored.refresh_token !== stored.refresh_token.trim()
      ) {
        throw new GoogleAdsRestError(
          "GOOGLE_ADS_REFRESH_TOKEN_UNAVAILABLE",
          "Google Ads refresh token is unavailable",
        );
      }

      const refreshed = await refreshGoogleAdsAccessToken({
        config,
        refreshToken: stored.refresh_token,
        fetchFn,
      });
      return Object.freeze({
        connection,
        reportingAccount,
        accessToken: refreshed.access_token,
      });
    })();
    return preparedAuthorityPromise;
  }

  function clientFor(context) {
    return createGoogleAdsRestClient({accessToken: context.accessToken, developerToken: config.developerToken,
      loginCustomerId: context.reportingAccount.loginAccountId, fetchFn});
  }

  async function collect(context, queryFamily, dateWindow, bounds = null, nativeMetadata = false) {
    const client = clientFor(context);
    const rows = [];
    const pdMetricRows = [];
    const requestIds = [];
    const seen = new Set();
    let cursor = null;
    let first = null;
    let bytes = 0;
    const spans = [];
    for (let pageNumber = 0; pageNumber < (bounds?.maxPages ?? 20); pageNumber++) {
      const page = await fetchGoogleReportingPage({client, customerId: context.reportingAccount.id,
        queryFamily, dateWindow, pageToken: cursor, nativeMetadata});
      if (!first) first = page;
      const offset = rows.length;
      if (bounds) {
        bytes += Buffer.byteLength(JSON.stringify(page), "utf8");
        if (bytes > bounds.maxBytes || offset + page.rows.length > bounds.maxRows) {
          throw new GoogleReportingError("GOOGLE_PD_READ_BOUND_EXCEEDED", "Google PD read bound exceeded");
        }
        spans.push(Object.freeze({page_index: pageNumber, row_start: offset, row_count: page.rows.length,
          provider_request_id: page.provider_request_id, query_fingerprint: page.evidence.query_fingerprint}));
      }
      pdMetricRows.push(...(page.pd_metric_rows ?? []).map(row => Object.freeze({
        ...row, source_row_index: row.source_row_index + offset,
      })));
      rows.push(...page.rows);
      if (page.provider_request_id) requestIds.push(page.provider_request_id);
      if (rows.length > 20_000) throw new GoogleReportingError("GOOGLE_REPORTING_ROW_LIMIT_EXCEEDED", "Google row limit exceeded");
      if (page.next_cursor === null) return Object.freeze({...first, rows: Object.freeze(rows),
        ...(first.pd_metric_rows ? {pd_metric_rows: Object.freeze(pdMetricRows)} : {}), next_cursor: null,
        observation_state: rows.length ? "present" : "not_observed_in_this_execution",
        evidence: Object.freeze({...first.evidence, page_count: pageNumber + 1,
          provider_request_ids: Object.freeze(requestIds), ...(bounds ? {page_spans: Object.freeze(spans)} : {})})});
      if (typeof page.next_cursor !== "string" || page.next_cursor.length < 1 || page.next_cursor.length > 4096) {
        throw new GoogleReportingError("GOOGLE_REPORTING_CURSOR_INVALID", "Google cursor is invalid");
      }
      if (seen.has(page.next_cursor)) throw new GoogleReportingError("GOOGLE_REPORTING_CURSOR_LOOP", "Google cursor loop detected");
      seen.add(page.next_cursor);
      cursor = page.next_cursor;
    }
    throw new GoogleReportingError("GOOGLE_REPORTING_PAGE_LIMIT_EXCEEDED", "Google page limit exceeded");
  }

  return Object.freeze({
    prepareEvidenceExecution,
    async readPdEvidenceSnapshot({installationAuthority, dateWindow, flow, limits, nativeMetadata = false}) {
      const pair = Object.hasOwn(GOOGLE_PD_FLOW_FAMILIES, flow ?? "") ? GOOGLE_PD_FLOW_FAMILIES[flow] : null;
      if (typeof nativeMetadata !== "boolean" || !pair || dateWindow?.start !== dateWindow?.end || !limits
        || !["maxPages", "maxRows", "maxBytes"].every(k => Number.isSafeInteger(limits[k]) && limits[k] > 0)
        || limits.maxPages > 20 || limits.maxRows > 20_000) {
        throw new GoogleReportingError("GOOGLE_PD_READ_INPUT_INVALID", "Google PD read input is invalid");
      }
      const dates = Object.freeze({...dateWindow}), bounds = Object.freeze({...limits});
      buildGoogleReportingQueries({dateWindow: dates});
      const context = await prepareEvidenceExecution({installationAuthority});
      const nativeInput = {client: clientFor(context), accountId: context.reportingAccount.id, currency: context.reportingAccount.currency,
        timezone: context.reportingAccount.timezone, limits: bounds};
      const before = nativeMetadata ? await readGooglePdNativeMetadata(nativeInput) : null;
      const sourceBounds = nativeMetadata ? {...bounds, maxRows: bounds.maxRows - before.observed_rows,
        maxBytes: bounds.maxBytes - before.observed_response_bytes} : bounds;
      if (sourceBounds.maxRows < 0 || sourceBounds.maxBytes <= 0) throw new GoogleReportingError("GOOGLE_PD_READ_BOUND_EXCEEDED", "Google PD read bound exceeded");
      const performance = await collect(context, pair[0], dates, sourceBounds, nativeMetadata);
      const remaining = {...sourceBounds, maxRows: sourceBounds.maxRows - performance.rows.length,
        maxBytes: sourceBounds.maxBytes - Buffer.byteLength(JSON.stringify(performance), "utf8")};
      if (remaining.maxBytes <= 0) throw new GoogleReportingError("GOOGLE_PD_READ_BOUND_EXCEEDED", "Google PD read bound exceeded");
      const conversions = await collect(context, pair[1], dates, remaining);
      const afterBounds = {...remaining, maxRows: remaining.maxRows - conversions.rows.length,
        maxBytes: remaining.maxBytes - Buffer.byteLength(JSON.stringify(conversions), "utf8")};
      if (nativeMetadata && (afterBounds.maxRows < 1 || afterBounds.maxBytes <= 0)) throw new GoogleReportingError("GOOGLE_PD_READ_BOUND_EXCEEDED", "Google PD read bound exceeded");
      const after = nativeMetadata ? await readGooglePdNativeMetadata({...nativeInput, limits: afterBounds}) : null;
      if (performance.rows.length + conversions.rows.length > bounds.maxRows
        || Buffer.byteLength(JSON.stringify([performance, conversions]), "utf8") > bounds.maxBytes) {
        throw new GoogleReportingError("GOOGLE_PD_READ_BOUND_EXCEEDED", "Google PD read bound exceeded");
      }
      const result = {provider: PROVIDER, flow, date_window: dates, authority: Object.freeze({
        connection_id: context.connection.connectionId, reporting_account_id: context.reportingAccount.id,
        reporting_account_currency: context.reportingAccount.currency, reporting_account_timezone: context.reportingAccount.timezone,
      }), results: Object.freeze({performance, conversions}), ...(nativeMetadata ? {native_metadata: {before, after}} : {}), publishable: false};
      if (nativeMetadata && ([before, after].reduce((n, m) => n + m.account.rows.length + m.actions.rows.length, performance.rows.length + conversions.rows.length) > bounds.maxRows
        || Buffer.byteLength(JSON.stringify(result), "utf8") > bounds.maxBytes)) throw new GoogleReportingError("GOOGLE_PD_READ_BOUND_EXCEEDED", "Google PD read bound exceeded");
      return Object.freeze(result);
    },
    async readSearchSourceEvidenceSnapshot({installationAuthority, dateWindow}) {
      const installation = owner(installationAuthority);
      buildGoogleReportingQueries({dateWindow});
      const context = await prepareEvidenceExecution({installationAuthority});
      const results = {};
      for (const family of ["search_ad_channel_daily", "search_cart_data_product_sales_daily"]) {
        results[family] = await collect(context, family, dateWindow);
      }
      const sourceLinks = buildGoogleSearchSourceLinks({scope: {
        workspace_id: installation.workspaceId, install_generation: installation.installGeneration,
        connection_id: context.connection.connectionId, reporting_account_id: context.reportingAccount.id,
      }, dateWindow, pdRows: results.search_ad_channel_daily.rows,
      saleRows: results.search_cart_data_product_sales_daily.rows});
      return Object.freeze({provider: PROVIDER, authority: Object.freeze({
        connection_id: context.connection.connectionId, reporting_account_id: context.reportingAccount.id,
        reporting_account_currency: context.reportingAccount.currency, reporting_account_timezone: context.reportingAccount.timezone,
      }), results: Object.freeze(results), source_links: sourceLinks, publishable: false});
    },
    async readShoppingSourceEvidenceSnapshot({installationAuthority, dateWindow}) {
      const installation = owner(installationAuthority);
      buildGoogleReportingQueries({dateWindow});
      const context = await prepareEvidenceExecution({installationAuthority});
      const results = {};
      // The scoped cart report replaces, never adds to, the general cart report here.
      for (const family of ["ad_group_channel_daily", "shopping_product_daily", "shopping_cart_data_product_sales_daily"]) {
        results[family] = await collect(context, family, dateWindow);
      }
      const sourceLinks = buildGoogleShoppingSourceLinks({scope: {
        workspace_id: installation.workspaceId, install_generation: installation.installGeneration,
        connection_id: context.connection.connectionId, reporting_account_id: context.reportingAccount.id,
      }, dateWindow, pdRows: results.ad_group_channel_daily.rows,
      productRows: results.shopping_product_daily.rows, saleRows: results.shopping_cart_data_product_sales_daily.rows});
      return Object.freeze({provider: PROVIDER, authority: Object.freeze({
        connection_id: context.connection.connectionId, reporting_account_id: context.reportingAccount.id,
        reporting_account_currency: context.reportingAccount.currency, reporting_account_timezone: context.reportingAccount.timezone,
      }), results: Object.freeze(results), source_links: sourceLinks, publishable: false});
    },
    async readEvidencePage({
      installationAuthority,
      queryFamily,
      dateWindow,
      pageToken = null,
    }) {
      const {connection, reportingAccount, accessToken} =
        await prepareEvidenceExecution({installationAuthority});

      const client = createGoogleAdsRestClient({
        accessToken,
        developerToken: config.developerToken,
        loginCustomerId: reportingAccount.loginAccountId,
        fetchFn,
      });
      const page = await fetchGoogleReportingPage({
        client,
        customerId: reportingAccount.id,
        queryFamily,
        dateWindow,
        pageToken,
      });

      return Object.freeze({
        provider: PROVIDER,
        authority: Object.freeze({
          connection_id: connection.connectionId,
          reporting_account_id: reportingAccount.id,
          reporting_account_currency: reportingAccount.currency,
          reporting_account_timezone: reportingAccount.timezone,
        }),
        page,
      });
    },
  });
}
