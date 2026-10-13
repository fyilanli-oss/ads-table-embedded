import {randomUUID} from "node:crypto";
import {
  createOAuthTransactionBoundary,
  oauthInstallationAuthority,
} from "./oauth-transaction.server.js";
import {createOAuthTransactionRepository} from "../database/oauth-transaction-repository.server.js";
import {createKlaviyoSetupRepository} from "../database/klaviyo-setup-repository.server.js";
import {createProviderAccountAuthorityRepository} from "../database/provider-account-authority-repository.server.js";
import {createKlaviyoSpendRepository} from "../database/klaviyo-spend-repository.server.js";
import {createProviderConnectionLifecycle} from "./provider-connection-lifecycle.server.js";
import {
  discoverKlaviyoAccount,
  exchangeKlaviyoAuthorizationCode,
  readKlaviyoOAuthConfig,
  refreshKlaviyoAccessToken,
  revokeKlaviyoAuthorization,
} from "../providers/klaviyo-api.server.js";

const PROVIDER = "klaviyo";
const SPEND_PATTERN = /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/;

export function normalizeKlaviyoEstimatedSpend(value) {
  if (typeof value !== "string" || !SPEND_PATTERN.test(value)) {
    throw new Error("KLAVIYO_ESTIMATED_SPEND_INVALID");
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 99999999.99) {
    throw new Error("KLAVIYO_ESTIMATED_SPEND_INVALID");
  }
  return amount.toFixed(2);
}

function accountForPersistence(account) {
  return Object.freeze({
    id: account.id,
    name: account.name,
    status: account.status,
    currency: account.currency,
    timezone: account.timezone,
  });
}

function authority(value) {
  return oauthInstallationAuthority({
    workspaceId: value.workspaceId,
    installGeneration: value.installGeneration,
    status: "active",
  });
}

export function createKlaviyoOAuthRuntime({
  database,
  tokenVault,
  environment = process.env,
  fetchFn = fetch,
  now = () => new Date(),
  randomUUIDFn = randomUUID,
} = {}) {
  const config = readKlaviyoOAuthConfig(environment);
  const oauthBoundary = createOAuthTransactionBoundary({
    repository: createOAuthTransactionRepository(database),
    verifierVault: tokenVault,
    now,
  });
  const setup = createKlaviyoSetupRepository(database);
  const accountAuthority = createProviderAccountAuthorityRepository(database);
  const spend = createKlaviyoSpendRepository(database);
  const lifecycle = createProviderConnectionLifecycle({database, now, randomUUIDFn});

  async function discoverWithCredential({
    installationAuthority,
    credentialId,
    connectionId,
    scopes,
  }) {
    const stored = await tokenVault.loadProviderTokenSet({
      credentialId,
      installationAuthority,
      provider: PROVIDER,
    });
    if (!stored?.access_token || !stored?.refresh_token) {
      throw new Error("KLAVIYO_CREDENTIAL_UNAVAILABLE");
    }
    const grantedScopes = stored.scopes ?? scopes ?? stored.scope;
    try {
      return await discoverKlaviyoAccount({
        accessToken: stored.access_token,
        scopes: grantedScopes,
        fetchFn,
        now,
      });
    } catch (error) {
      if (error?.code !== "KLAVIYO_REAUTHORIZATION_REQUIRED") throw error;
      const refreshed = await refreshKlaviyoAccessToken({
        config,
        refreshToken: stored.refresh_token,
        scopes: grantedScopes,
        fetchFn,
        now,
      });
      const replacement = await tokenVault.storeProviderTokenSet({
        installationAuthority,
        provider: PROVIDER,
        tokenSet: refreshed.tokenSet,
        expiresAt: refreshed.expiresAt,
      });
      try {
        const evidence = await discoverKlaviyoAccount({
          accessToken: refreshed.tokenSet.access_token,
          scopes: refreshed.scopes,
          fetchFn,
          now,
        });
        const pending = await setup.stage({
          connectionId,
          workspaceId: installationAuthority.workspaceId,
          installGeneration: installationAuthority.installGeneration,
          credentialId: replacement.credentialId,
          scopes: evidence.scopes,
          verifiedAt: evidence.verifiedAt,
        });
        return Object.freeze({...evidence, pending});
      } catch (refreshError) {
        await tokenVault.deleteProviderTokenSet({
          credentialId: replacement.credentialId,
          installationAuthority,
          provider: PROVIDER,
        }).catch(() => undefined);
        throw refreshError;
      }
    }
  }

  async function discoverConnectedCredential({installationAuthority, connected}) {
    const stored = await tokenVault.loadProviderTokenSet({
      credentialId: connected.credentialId,
      installationAuthority,
      provider: PROVIDER,
    });
    if (!stored?.access_token || !stored?.refresh_token) {
      throw new Error("KLAVIYO_CREDENTIAL_UNAVAILABLE");
    }
    const grantedScopes = stored.scopes ?? connected.grantedScopes ?? stored.scope;
    try {
      return await discoverKlaviyoAccount({
        accessToken: stored.access_token,
        scopes: grantedScopes,
        fetchFn,
        now,
      });
    } catch (error) {
      if (error?.code !== "KLAVIYO_REAUTHORIZATION_REQUIRED") throw error;
      const refreshed = await refreshKlaviyoAccessToken({
        config,
        refreshToken: stored.refresh_token,
        scopes: grantedScopes,
        fetchFn,
        now,
      });
      const replacement = await tokenVault.storeProviderTokenSet({
        installationAuthority,
        provider: PROVIDER,
        tokenSet: refreshed.tokenSet,
        expiresAt: refreshed.expiresAt,
      });
      try {
        const evidence = await discoverKlaviyoAccount({
          accessToken: refreshed.tokenSet.access_token,
          scopes: refreshed.scopes,
          fetchFn,
          now,
        });
        const current = await lifecycle.load({
          installationAuthority,
          connectionId: connected.connectionId,
          provider: PROVIDER,
        });
        if (!current || current.status !== "connected") {
          throw new Error("CONNECTED_KLAVIYO_CONNECTION_REQUIRED");
        }
        await lifecycle.renewCredential({
          installationAuthority,
          connectionId: connected.connectionId,
          provider: PROVIDER,
          expectedVersion: current.version,
          expectedCredentialId: connected.credentialId,
          newCredentialId: replacement.credentialId,
          providerEvidence: {
            authority: "provider_credential_renewal_verified",
            provider: PROVIDER,
            scopes: evidence.scopes,
            verifiedAt: evidence.verifiedAt,
            expiresAt: evidence.expiresAt,
          },
        });
        return evidence;
      } catch (refreshError) {
        await tokenVault.deleteProviderTokenSet({
          credentialId: replacement.credentialId,
          installationAuthority,
          provider: PROVIDER,
        }).catch(() => undefined);
        throw refreshError;
      }
    }
  }

  return Object.freeze({
    config,
    oauthBoundary,

    async callbackReturn({workspaceId, installGeneration}) {
      return setup.callbackReturn({workspaceId, installGeneration});
    },

    async inspect({installationAuthority}) {
      const connected = await accountAuthority.load({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        provider: PROVIDER,
      });
      if (connected) {
        const configuration = await spend.load({
          workspaceId: installationAuthority.workspaceId,
          installGeneration: installationAuthority.installGeneration,
        });
        if (!configuration) throw new Error("KLAVIYO_SPEND_CONFIGURATION_REQUIRED");
        return Object.freeze({
          state: "connected",
          connection: connected,
          spend: configuration,
        });
      }

      const pending = await setup.loadPending({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
      });
      if (!pending) return Object.freeze({state: "disconnected"});
      const evidence = await discoverWithCredential({
        installationAuthority,
        credentialId: pending.credentialId,
        connectionId: pending.connectionId,
        scopes: pending.scopes,
      });
      return Object.freeze({
        state: "pending_completion",
        pending: evidence.pending ?? pending,
        account: evidence.accounts[0],
      });
    },

    async completeCallback({claimed}) {
      const owner = authority(claimed);
      if (claimed.status === "denied") {
        return Object.freeze({
          outcome: "denied",
          owner,
          callbackReturn: await setup.callbackReturn(owner),
        });
      }

      let credential = null;
      try {
        const exchanged = await exchangeKlaviyoAuthorizationCode({
          config,
          authorizationCode: claimed.authorizationCode,
          pkceVerifier: claimed.pkceVerifier,
          fetchFn,
          now,
        });
        credential = await tokenVault.storeProviderTokenSet({
          installationAuthority: owner,
          provider: PROVIDER,
          tokenSet: exchanged.tokenSet,
          expiresAt: exchanged.expiresAt,
        });
        const evidence = await discoverKlaviyoAccount({
          accessToken: exchanged.tokenSet.access_token,
          scopes: exchanged.scopes,
          fetchFn,
          now,
        });
        const staged = await setup.stage({
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
          outcome: "pending_completion",
          owner,
          pending: staged,
          account: evidence.accounts[0],
          callbackReturn: await setup.callbackReturn(owner),
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

    async complete({installationAuthority, estimatedSpend}) {
      const pending = await setup.loadPending({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
      });
      if (!pending) throw new Error("PENDING_KLAVIYO_SETUP_REQUIRED");
      const evidence = await discoverWithCredential({
        installationAuthority,
        credentialId: pending.credentialId,
        connectionId: pending.connectionId,
        scopes: pending.scopes,
      });
      const current = evidence.pending ?? pending;
      return spend.complete({
        connectionId: current.connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        expectedVersion: current.version,
        account: accountForPersistence(evidence.accounts[0]),
        amount: normalizeKlaviyoEstimatedSpend(estimatedSpend),
        verifiedAt: evidence.verifiedAt,
      });
    },

    async updateSpend({installationAuthority, estimatedSpend}) {
      const connected = await accountAuthority.load({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        provider: PROVIDER,
      });
      if (!connected) throw new Error("CONNECTED_KLAVIYO_CONNECTION_REQUIRED");
      const evidence = await discoverConnectedCredential({
        installationAuthority,
        connected,
      });
      const current = await lifecycle.load({
        installationAuthority,
        connectionId: connected.connectionId,
        provider: PROVIDER,
      });
      if (!current || current.status !== "connected") {
        throw new Error("CONNECTED_KLAVIYO_CONNECTION_REQUIRED");
      }
      return spend.append({
        connectionId: connected.connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        expectedVersion: current.version,
        account: accountForPersistence(evidence.accounts[0]),
        amount: normalizeKlaviyoEstimatedSpend(estimatedSpend),
        verifiedAt: evidence.verifiedAt,
      });
    },

    async changeValue({
      installationAuthority,
      effectiveFrom,
      expectedCorrectionVersion,
      estimatedSpend,
    }) {
      const configuration = await spend.load({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
      });
      if (!configuration) throw new Error("CONNECTED_KLAVIYO_CONNECTION_REQUIRED");
      const selected = configuration.periods.find(
        (period) => period.effectiveFrom === effectiveFrom,
      );
      if (!selected || selected.correctionVersion !== expectedCorrectionVersion) {
        throw new Error("KLAVIYO_SPEND_PERIOD_SELECTION_INVALID");
      }
      return spend.correct({
        connectionId: configuration.connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        effectiveFrom: selected.effectiveFrom,
        expectedCorrectionVersion: selected.correctionVersion,
        amount: normalizeKlaviyoEstimatedSpend(estimatedSpend),
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
        connectionId: connected.connectionId,
        provider: PROVIDER,
      });
      if (!current || current.status !== "connected") {
        throw new Error("CONNECTED_KLAVIYO_CONNECTION_REQUIRED");
      }
      const stored = await tokenVault.loadProviderTokenSet({
        credentialId: connected.credentialId,
        installationAuthority,
        provider: PROVIDER,
      });
      if (!stored?.refresh_token) throw new Error("KLAVIYO_REVOCATION_TOKEN_UNAVAILABLE");
      const revoked = await revokeKlaviyoAuthorization({
        config,
        refreshToken: stored.refresh_token,
        fetchFn,
      });
      const requested = await lifecycle.requestDisconnect({
        installationAuthority,
        provider: PROVIDER,
        connectionId: connected.connectionId,
        expectedVersion: current.version,
        reason: "merchant_requested_klaviyo_disconnect",
      });
      const verifiedAt = now().toISOString();
      return lifecycle.finalizeDisconnect({
        installationAuthority,
        provider: PROVIDER,
        connectionId: connected.connectionId,
        expectedVersion: requested.version,
        reason: "merchant_requested_klaviyo_disconnect",
        providerEvidence: {
          authority: "provider_disconnect_verified",
          provider: PROVIDER,
          outcome: revoked.outcome,
          verifiedAt,
          expiresAt: new Date(new Date(verifiedAt).valueOf() + 60_000).toISOString(),
        },
      });
    },
  });
}
