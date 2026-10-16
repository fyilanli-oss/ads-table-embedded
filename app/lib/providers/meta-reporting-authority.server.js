import {oauthInstallationAuthority} from "../oauth/oauth-transaction.server.js";
import {
  createProviderAccountAuthorityRepository,
} from "../database/provider-account-authority-repository.server.js";
import {META_GRAPH_VERSION} from "./meta-graph.server.js";
import {
  fetchMetaAdChannelInsightsPage,
  fetchMetaProductBreakdownInsightsPage,
} from "./meta-reporting.server.js";

const PROVIDER = "meta";

function connectedReportingAccount(connection) {
  if (!connection) throw new Error("CONNECTED_META_CONNECTION_REQUIRED");
  if (
    typeof connection.reportingAccountId !== "string"
    || !/^act_[0-9]+$/.test(connection.reportingAccountId)
  ) throw new Error("META_REPORTING_ACCOUNT_REQUIRED");
  const selected = connection.accounts.find(
    (account) => account.id === connection.reportingAccountId,
  );
  if (
    !selected
    || selected.kind !== "advertiser"
    || selected.reporting_eligible !== true
  ) throw new Error("META_REPORTING_ACCOUNT_AUTHORITY_INVALID");
  return connection.reportingAccountId;
}

function owner(value) {
  return oauthInstallationAuthority({
    workspaceId: value?.workspaceId,
    installGeneration: value?.installGeneration,
    status: value?.status,
  });
}

export function createMetaReportingAuthorityRuntime({
  database,
  tokenVault,
  graphVersion = META_GRAPH_VERSION,
  fetchFn = fetch,
} = {}) {
  if (!tokenVault || typeof tokenVault.loadProviderTokenSet !== "function") {
    throw new TypeError("tokenVault.loadProviderTokenSet is required");
  }
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const accountAuthority = createProviderAccountAuthorityRepository(database);

  return Object.freeze({
    async readDailyEvidencePages({
      installationAuthority,
      dateWindow,
      channelAfter = null,
      productAfter = null,
    }) {
      const installation = owner(installationAuthority);
      const connection = await accountAuthority.load({
        workspaceId: installation.workspaceId,
        installGeneration: installation.installGeneration,
        provider: PROVIDER,
      });
      const reportingAccountId = connectedReportingAccount(connection);
      const stored = await tokenVault.loadProviderTokenSet({
        credentialId: connection.credentialId,
        installationAuthority: installation,
        provider: PROVIDER,
      });
      if (
        typeof stored?.access_token !== "string"
        || stored.access_token.length < 1
        || stored.access_token !== stored.access_token.trim()
      ) throw new Error("META_ACCESS_TOKEN_UNAVAILABLE");

      const channel = await fetchMetaAdChannelInsightsPage({
        accessToken: stored.access_token,
        adAccountId: reportingAccountId,
        dateWindow,
        after: channelAfter,
        graphVersion,
        fetchFn,
      });
      const product = await fetchMetaProductBreakdownInsightsPage({
        accessToken: stored.access_token,
        adAccountId: reportingAccountId,
        dateWindow,
        after: productAfter,
        graphVersion,
        fetchFn,
      });

      return Object.freeze({
        provider: PROVIDER,
        authority: Object.freeze({
          connection_id: connection.connectionId,
          reporting_account_id: reportingAccountId,
        }),
        channel,
        product,
      });
    },
  });
}
