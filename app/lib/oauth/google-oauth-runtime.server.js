import {randomUUID} from "node:crypto";
import {
  createOAuthTransactionBoundary,
  oauthInstallationAuthority,
} from "./oauth-transaction.server.js";
import {
  createOAuthTransactionRepository,
} from "../database/oauth-transaction-repository.server.js";
import {
  createGoogleAccountSelectionRepository,
} from "../database/google-account-selection-repository.server.js";
import {
  createProviderAccountAuthorityRepository,
} from "../database/provider-account-authority-repository.server.js";
import {
  createProviderConnectionLifecycle,
} from "./provider-connection-lifecycle.server.js";
import {
  exchangeGoogleAdsAuthorizationCode,
  readGoogleAdsOAuthConfig,
  refreshGoogleAdsAccessToken,
} from "../providers/google-ads-rest.server.js";
import {discoverGoogleAdsAccounts} from "../providers/google-account-discovery.server.js";

const PROVIDER = "google_ads";
const MAX_SELECTION = 3;

function nowIso(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  return value.toISOString();
}

function authority(value) {
  return oauthInstallationAuthority({
    workspaceId: value.workspaceId,
    installGeneration: value.installGeneration,
    status: "active",
  });
}

function advertiserAccounts(evidence) {
  return Object.freeze(
    evidence.accounts
      .filter((account) =>
        account.kind === "advertiser" && account.reportingEligible === true
      )
      .map((account) => Object.freeze({...account})),
  );
}

function selectedAdvertisers(accounts, selectedIds) {
  if (
    !Array.isArray(selectedIds)
    || selectedIds.length < 1
    || selectedIds.length > MAX_SELECTION
  ) throw new Error("CONNECTED_ACCOUNT_CARDINALITY_INVALID");
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error("CONNECTED_ACCOUNT_DUPLICATE");
  }
  const available = new Map(accounts.map((account) => [account.id, account]));
  return Object.freeze(selectedIds.map((id) => {
    const account = available.get(id);
    if (!account) throw new Error("CONNECTED_ACCOUNT_NOT_PROVIDER_VERIFIED");
    return account;
  }));
}

export function createGoogleOAuthRuntime({
  database,
  tokenVault,
  environment = process.env,
  fetchFn = fetch,
  now = () => new Date(),
  randomUUIDFn = randomUUID,
} = {}) {
  const config = readGoogleAdsOAuthConfig(environment);
  const oauthBoundary = createOAuthTransactionBoundary({
    repository: createOAuthTransactionRepository(database),
    verifierVault: tokenVault,
    now,
  });
  const selections = createGoogleAccountSelectionRepository(database);
  const accountAuthority = createProviderAccountAuthorityRepository(database);
  const lifecycle = createProviderConnectionLifecycle({database, now});

  async function discoverWithCredential({
    installationAuthority,
    credentialId,
    connectionId = null,
    scopes = null,
  }) {
    const stored = await tokenVault.loadProviderTokenSet({
      credentialId,
      installationAuthority,
      provider: PROVIDER,
    });
    if (!stored?.refresh_token) {
      throw new Error("GOOGLE_ADS_REFRESH_TOKEN_UNAVAILABLE");
    }
    const refreshed = await refreshGoogleAdsAccessToken({
      config,
      refreshToken: stored.refresh_token,
      fetchFn,
    });
    const evidence = await discoverGoogleAdsAccounts({
      accessToken: refreshed.access_token,
      developerToken: config.developerToken,
      fetchFn,
      now,
    });
    const advertisers = advertiserAccounts(evidence);
    if (advertisers.length < 1) {
      throw new Error("GOOGLE_ADS_ENABLED_CUSTOMERS_EMPTY");
    }

    if (connectionId && scopes) {
      const replacement = await tokenVault.storeProviderTokenSet({
        installationAuthority,
        provider: PROVIDER,
        tokenSet: refreshed,
      });
      const staged = await selections.stage({
        connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        credentialId: replacement.credentialId,
        scopes,
        verifiedAt: evidence.verifiedAt,
      });
      return Object.freeze({evidence, advertisers, pending: staged});
    }
    return Object.freeze({evidence, advertisers});
  }

  return Object.freeze({
    config,
    oauthBoundary,

    async inspect({installationAuthority}) {
      const connected = await accountAuthority.load({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        provider: PROVIDER,
      });
      if (connected) {
        return Object.freeze({state: "connected", connection: connected});
      }
      const pending = await selections.loadPending({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
      });
      if (!pending) return Object.freeze({state: "disconnected"});

      const discovered = await discoverWithCredential({
        installationAuthority,
        credentialId: pending.credentialId,
        connectionId: pending.connectionId,
        scopes: pending.scopes,
      });
      return Object.freeze({
        state: "pending_account_selection",
        pending: discovered.pending,
        accounts: discovered.advertisers,
      });
    },

    async completeCallback({claimed}) {
      const owner = authority(claimed);
      if (claimed.status === "denied") {
        return Object.freeze({
          outcome: "denied",
          owner,
          callbackReturn: await selections.callbackReturn(owner),
        });
      }

      let credential = null;
      try {
        const tokenSet = await exchangeGoogleAdsAuthorizationCode({
          config,
          authorizationCode: claimed.authorizationCode,
          pkceVerifier: claimed.pkceVerifier,
          fetchFn,
        });
        credential = await tokenVault.storeProviderTokenSet({
          installationAuthority: owner,
          provider: PROVIDER,
          tokenSet,
        });
        const evidence = await discoverGoogleAdsAccounts({
          accessToken: tokenSet.access_token,
          developerToken: config.developerToken,
          fetchFn,
          now,
        });
        const advertisers = advertiserAccounts(evidence);
        if (advertisers.length < 1) {
          throw new Error("GOOGLE_ADS_ENABLED_CUSTOMERS_EMPTY");
        }
        const staged = await selections.stage({
          connectionId: randomUUIDFn(),
          workspaceId: owner.workspaceId,
          installGeneration: owner.installGeneration,
          credentialId: credential.credentialId,
          scopes: evidence.scopes,
          verifiedAt: evidence.verifiedAt,
        });
        await oauthBoundary.finalizeExchange({
          transactionId: claimed.transactionId,
          success: true,
        });
        return Object.freeze({
          outcome: "pending_account_selection",
          owner,
          pending: staged,
          callbackReturn: await selections.callbackReturn(owner),
        });
      } catch (error) {
        if (credential?.credentialId) {
          await tokenVault.deleteProviderTokenSet({
            credentialId: credential.credentialId,
            installationAuthority: owner,
            provider: PROVIDER,
          }).catch(() => undefined);
        }
        await oauthBoundary.finalizeExchange({
          transactionId: claimed.transactionId,
          success: false,
        }).catch(() => undefined);
        throw error;
      }
    },

    async select({installationAuthority, selectedAccountIds, reportingAccountId}) {
      const pending = await selections.loadPending({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
      });
      if (!pending) throw new Error("PENDING_ACCOUNT_SELECTION_REQUIRED");
      const discovered = await discoverWithCredential({
        installationAuthority,
        credentialId: pending.credentialId,
        connectionId: pending.connectionId,
        scopes: pending.scopes,
      });
      const chosen = selectedAdvertisers(
        discovered.advertisers,
        selectedAccountIds,
      );
      if (!chosen.some((account) => account.id === reportingAccountId)) {
        throw new Error("REPORTING_ACCOUNT_NOT_SELECTED");
      }
      return selections.complete({
        connectionId: discovered.pending.connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        expectedVersion: discovered.pending.version,
        accounts: chosen.map((account) => ({
          id: account.id,
          name: account.name,
          kind: "advertiser",
          reporting_eligible: true,
          status: account.status,
          currency: account.currency,
          timezone: account.timezone,
          login_account_id: account.loginAccountId,
        })),
        reportingAccountId,
        verifiedAt: discovered.evidence.verifiedAt,
      });
    },

    async cancel({installationAuthority}) {
      const pending = await selections.loadPending({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
      });
      if (!pending) return Object.freeze({status: "disconnected"});
      return selections.cancel({
        connectionId: pending.connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        expectedVersion: pending.version,
        cancelledAt: nowIso(now),
      });
    },

    async disconnect({installationAuthority}) {
      const connected = await accountAuthority.load({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        provider: PROVIDER,
      });
      if (!connected) return Object.freeze({status: "disconnected"});
      const current = await lifecycle.load({
        installationAuthority,
        provider: PROVIDER,
        connectionId: connected.connectionId,
      });
      if (!current || current.status !== "connected") {
        throw new Error("CONNECTED_GOOGLE_CONNECTION_REQUIRED");
      }
      const requested = await lifecycle.requestDisconnect({
        installationAuthority,
        provider: PROVIDER,
        connectionId: connected.connectionId,
        expectedVersion: current.version,
        reason: "merchant_requested_google_disconnect",
      });
      return lifecycle.finalizeDisconnect({
        installationAuthority,
        provider: PROVIDER,
        connectionId: connected.connectionId,
        expectedVersion: requested.version,
        reason: "merchant_requested_google_disconnect",
        providerEvidence: {
          authority: "provider_disconnect_verified",
          provider: PROVIDER,
          outcome: "local_authority_removed",
          verifiedAt: nowIso(now),
          expiresAt: new Date(now().valueOf() + 60_000).toISOString(),
        },
      });
    },
  });
}
