import {
  createOAuthTransactionBoundary,
  oauthInstallationAuthority,
} from "./oauth-transaction.server.js";
import {
  createGoogleAuthorizationHandoff,
} from "./google-authorization-handoff.server.js";
import {
  createOAuthTransactionRepository,
} from "../database/oauth-transaction-repository.server.js";
import {
  createProviderAuthorizationHandoffRepository,
} from "../database/provider-authorization-handoff-repository.server.js";
import {
  createProviderAccountAuthorityRepository,
} from "../database/provider-account-authority-repository.server.js";
import {
  exchangeGoogleAdsAuthorizationCode,
  readGoogleAdsOAuthConfig,
  refreshGoogleAdsAccessToken,
} from "../providers/google-ads-rest.server.js";
import {
  discoverGoogleAdsAccounts,
} from "../providers/google-account-discovery.server.js";

export function createGoogleOAuthRuntime({
  database,
  tokenVault,
  environment = process.env,
  fetchFn = fetch,
  now = () => new Date(),
} = {}) {
  const config = readGoogleAdsOAuthConfig(environment);
  const oauthBoundary = createOAuthTransactionBoundary({
    repository: createOAuthTransactionRepository(database),
    verifierVault: tokenVault,
    now,
  });
  const handoffRepository =
    createProviderAuthorizationHandoffRepository(database);
  const handoff = createGoogleAuthorizationHandoff({
    oauthBoundary,
    tokenVault,
    repository: handoffRepository,
    exchangeAuthorizationCode: (value) =>
      exchangeGoogleAdsAuthorizationCode({...value, config, fetchFn}),
    refreshAccessToken: (value) =>
      refreshGoogleAdsAccessToken({...value, config, fetchFn}),
    discoverAccounts: ({accessToken}) =>
      discoverGoogleAdsAccounts({
        accessToken,
        developerToken: config.developerToken,
        fetchFn,
        now,
      }),
    now,
  });

  return Object.freeze({
    config,
    oauthBoundary,
    installationAuthority: oauthInstallationAuthority,
    handoff,
    accountAuthority: createProviderAccountAuthorityRepository(database),
  });
}
