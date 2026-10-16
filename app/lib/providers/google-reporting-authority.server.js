import {oauthInstallationAuthority} from "../oauth/oauth-transaction.server.js";
import {
  createProviderAccountAuthorityRepository,
} from "../database/provider-account-authority-repository.server.js";
import {
  createGoogleAdsRestClient,
  readGoogleAdsOAuthConfig,
} from "./google-ads-rest.server.js";
import {fetchGoogleReportingPage} from "./google-reporting.server.js";

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

  return Object.freeze({
    async readEvidencePage({
      installationAuthority,
      queryFamily,
      dateWindow,
      pageToken = null,
    }) {
      const installation = owner(installationAuthority);
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
        typeof stored?.access_token !== "string"
        || stored.access_token.length < 1
        || stored.access_token !== stored.access_token.trim()
      ) throw new Error("GOOGLE_ADS_ACCESS_TOKEN_UNAVAILABLE");

      const client = createGoogleAdsRestClient({
        accessToken: stored.access_token,
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
