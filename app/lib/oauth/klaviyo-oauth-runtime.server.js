import {randomUUID} from "node:crypto";
import {
  createOAuthTransactionBoundary,
  oauthInstallationAuthority,
} from "./oauth-transaction.server.js";
import {createOAuthTransactionRepository} from "../database/oauth-transaction-repository.server.js";
import {createKlaviyoSetupRepository} from "../database/klaviyo-setup-repository.server.js";
import {createProviderAccountAuthorityRepository} from "../database/provider-account-authority-repository.server.js";
import {
  discoverKlaviyoAccount,
  exchangeKlaviyoAuthorizationCode,
  readKlaviyoOAuthConfig,
  refreshKlaviyoAccessToken,
} from "../providers/klaviyo-api.server.js";

const PROVIDER = "klaviyo";

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
      if (connected) return Object.freeze({state: "connected", connection: connected});

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
  });
}
