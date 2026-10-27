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
  klaviyoTokenRequiresRefresh,
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

export function selectKlaviyoAccount(accounts, accountId) {
  if (!Array.isArray(accounts) || typeof accountId !== "string" || accountId.length < 1) {
    throw new Error("KLAVIYO_ACCOUNT_SELECTION_INVALID");
  }
  const selected = accounts.find((account) => account?.id === accountId);
  if (!selected) throw new Error("KLAVIYO_ACCOUNT_SELECTION_INVALID");
  return selected;
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

export function createKlaviyoCredentialAuthority({
  tokenVault,
  lifecycle,
  setup,
  config,
  fetchFn = fetch,
  now = () => new Date(),
} = {}) {
  async function markConnectedReauthorization({installationAuthority, connected, reason}) {
    const current = await lifecycle.load({
      installationAuthority,
      connectionId: connected.connectionId,
      provider: PROVIDER,
    });
    if (!current || current.status !== "connected") return;
    await lifecycle.markReauthorizationRequired({
      installationAuthority,
      connectionId: connected.connectionId,
      provider: PROVIDER,
      expectedVersion: current.version,
      reason,
    });
  }

  function renewalEvidence(refreshed) {
    const verifiedAt = new Date(refreshed.verifiedAt);
    const tokenExpiry = new Date(refreshed.expiresAt);
    return Object.freeze({
      authority: "provider_credential_renewal_verified",
      provider: PROVIDER,
      scopes: refreshed.scopes,
      verifiedAt: verifiedAt.toISOString(),
      expiresAt: new Date(Math.min(
        tokenExpiry.valueOf(),
        verifiedAt.valueOf() + 10 * 60 * 1000,
      )).toISOString(),
    });
  }

  async function refreshBeforeProviderRequest({
    installationAuthority,
    stored,
    scopes,
    pendingConnectionId = null,
    connected = null,
  }) {
    let refreshed;
    try {
      refreshed = await refreshKlaviyoAccessToken({
        config,
        refreshToken: stored.refresh_token,
        scopes,
        scopeObservedAt: stored.scope_observed_at ?? null,
        fetchFn,
        now,
      });
    } catch (error) {
      if (error?.code === "KLAVIYO_REAUTHORIZATION_REQUIRED" && connected) {
        await markConnectedReauthorization({
          installationAuthority,
          connected,
          reason: "klaviyo_refresh_invalid_before_provider_request",
        });
      }
      throw error;
    }

    const replacement = await tokenVault.storeProviderTokenSet({
      installationAuthority,
      provider: PROVIDER,
      tokenSet: refreshed.tokenSet,
      expiresAt: refreshed.expiresAt,
    });
    let pending = null;
    try {
      if (connected) {
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
          providerEvidence: renewalEvidence(refreshed),
        });
      } else if (pendingConnectionId) {
        pending = await setup.stage({
          connectionId: pendingConnectionId,
          workspaceId: installationAuthority.workspaceId,
          installGeneration: installationAuthority.installGeneration,
          credentialId: replacement.credentialId,
          scopes: refreshed.scopes,
          verifiedAt: refreshed.verifiedAt,
        });
      } else {
        throw new Error("KLAVIYO_CREDENTIAL_OWNER_REQUIRED");
      }
    } catch (error) {
      await tokenVault.deleteProviderTokenSet({
        credentialId: replacement.credentialId,
        installationAuthority,
        provider: PROVIDER,
      }).catch(() => undefined);
      throw error;
    }
    return Object.freeze({tokenSet: refreshed.tokenSet, pending});
  }

  async function prepareCredential({
    installationAuthority,
    credentialId,
    scopes,
    pendingConnectionId = null,
    connected = null,
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
    if (!klaviyoTokenRequiresRefresh(stored, now)) {
      return Object.freeze({tokenSet: stored, scopes: grantedScopes, pending: null});
    }
    const refreshed = await refreshBeforeProviderRequest({
      installationAuthority,
      stored,
      scopes: grantedScopes,
      pendingConnectionId,
      connected,
    });
    return Object.freeze({
      tokenSet: refreshed.tokenSet,
      scopes: refreshed.tokenSet.scopes ?? grantedScopes ?? refreshed.tokenSet.scope,
      pending: refreshed.pending,
    });
  }

  async function discover({
    installationAuthority,
    credentialId,
    scopes,
    pendingConnectionId = null,
    connected = null,
  }) {
    const prepared = await prepareCredential({
      installationAuthority,
      credentialId,
      scopes,
      pendingConnectionId,
      connected,
    });
    try {
      const evidence = await discoverKlaviyoAccount({
        accessToken: prepared.tokenSet.access_token,
        scopes: prepared.scopes,
        fetchFn,
        now,
      });
      return Object.freeze({...evidence, pending: prepared.pending});
    } catch (error) {
      if (error?.code === "KLAVIYO_REAUTHORIZATION_REQUIRED" && connected) {
        await markConnectedReauthorization({
          installationAuthority,
          connected,
          reason: "klaviyo_accounts_authorization_invalid",
        });
      }
      throw error;
    }
  }

  return Object.freeze({prepareCredential, discover});
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
  const credentialAuthority = createKlaviyoCredentialAuthority({
    tokenVault,
    lifecycle,
    setup,
    config,
    fetchFn,
    now,
  });

  async function discoverWithCredential({
    installationAuthority,
    credentialId,
    connectionId,
    scopes,
  }) {
    return credentialAuthority.discover({
      installationAuthority,
      credentialId,
      scopes,
      pendingConnectionId: connectionId,
    });
  }

  async function discoverConnectedCredential({installationAuthority, connected}) {
    return credentialAuthority.discover({
      installationAuthority,
      credentialId: connected.credentialId,
      scopes: connected.grantedScopes,
      connected,
    });
  }

  return Object.freeze({
    config,
    oauthBoundary,

    async callbackReturn({workspaceId, installGeneration}) {
      return setup.callbackReturn({workspaceId, installGeneration});
    },

    async inspect({installationAuthority}) {
      const current = await lifecycle.loadCurrent({
        installationAuthority,
        provider: PROVIDER,
      });
      if (current?.status === "reauthorization_required") {
        return Object.freeze({state: "reauthorization_required"});
      }
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

      if (current?.status === "connected") {
        throw new Error("KLAVIYO_CONNECTED_AUTHORITY_INCONSISTENT");
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
        state: "pending_account_selection",
        pending: evidence.pending ?? pending,
        accounts: evidence.accounts,
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
          outcome: "pending_account_selection",
          owner,
          pending: staged,
          accounts: evidence.accounts,
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

    async complete({installationAuthority, accountId, estimatedSpend}) {
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
      const selected = selectKlaviyoAccount(evidence.accounts, accountId);
      return spend.complete({
        connectionId: current.connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        expectedVersion: current.version,
        account: accountForPersistence(selected),
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
      periodId,
      expectedCorrectionVersion,
      estimatedSpend,
    }) {
      const configuration = await spend.load({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
      });
      if (!configuration) throw new Error("CONNECTED_KLAVIYO_CONNECTION_REQUIRED");
      const selected = configuration.periods.find(
        (period) => period.id === periodId,
      );
      if (!selected || selected.correctionVersion !== expectedCorrectionVersion) {
        throw new Error("KLAVIYO_SPEND_PERIOD_SELECTION_INVALID");
      }
      return spend.correct({
        connectionId: configuration.connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        periodId: selected.id,
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
