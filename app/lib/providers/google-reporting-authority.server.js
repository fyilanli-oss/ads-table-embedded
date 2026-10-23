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

  async function collect(context, queryFamily, dateWindow) {
    const client = clientFor(context);
    const rows = [];
    const pdMetricRows = [];
    const requestIds = [];
    const seen = new Set();
    let cursor = null;
    let first = null;
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      const page = await fetchGoogleReportingPage({client, customerId: context.reportingAccount.id,
        queryFamily, dateWindow, pageToken: cursor});
      if (!first) first = page;
      const offset = rows.length;
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
          provider_request_ids: Object.freeze(requestIds)})});
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
