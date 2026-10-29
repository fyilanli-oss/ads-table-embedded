import {randomUUID} from "node:crypto";
import {
  createOAuthTransactionBoundary,
  oauthInstallationAuthority,
} from "./oauth-transaction.server.js";
import {
  createOAuthTransactionRepository,
} from "../database/oauth-transaction-repository.server.js";
import {
  createMetaAccountSelectionRepository,
} from "../database/meta-account-selection-repository.server.js";
import {
  createProviderAccountAuthorityRepository,
} from "../database/provider-account-authority-repository.server.js";
import {
  createProviderConnectionLifecycle,
} from "./provider-connection-lifecycle.server.js";
import {
  discoverMetaAdAccounts,
  exchangeAndValidateMetaAuthorizationCode,
  inspectMetaAccessToken,
  MetaGraphError,
  readMetaOAuthConfig,
  revokeMetaAuthorization,
  buildMetaAuthorizationUrl,
} from "../providers/meta-graph.server.js";
import {createIdentityOAuthAuthorization} from "./identity-oauth-authorization.server.js";
import {OAuthPermissionProfileError} from "./oauth-permission-profile.server.js";

const PROVIDER = "meta";
const MAX_SELECTION = 3;

function authority(value) {
  return oauthInstallationAuthority({
    workspaceId: value.workspaceId,
    installGeneration: value.installGeneration,
    status: "active",
  });
}

function nowIso(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  return value.toISOString();
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
    if (!account || account.kind !== "advertiser" || account.reportingEligible !== true) {
      throw new Error("CONNECTED_ACCOUNT_NOT_PROVIDER_VERIFIED");
    }
    return account;
  }));
}

export function createMetaOAuthRuntime({
  database,
  tokenVault,
  environment = process.env,
  fetchFn = fetch,
  now = () => new Date(),
  randomUUIDFn = randomUUID,
  identityAuthorizationEnabled = false,
} = {}) {
  const config = readMetaOAuthConfig(environment);
  const lifecycle = createProviderConnectionLifecycle({database, now});
  const identityAuthorization = createIdentityOAuthAuthorization({lifecycle, enabled: identityAuthorizationEnabled});
  const oauthBoundary = createOAuthTransactionBoundary({
    repository: createOAuthTransactionRepository(database),
    verifierVault: tokenVault,
    now,
    identityStartGuard: identityAuthorization.beforeStart,
  });
  const selections = createMetaAccountSelectionRepository(database);
  const accountAuthority = createProviderAccountAuthorityRepository(database);

  async function inspectIdentityCredential(stored) {
    if (stored.permission_profile === undefined || stored.permission_profile === "reporting_v1") return null;
    if (stored.permission_profile !== "identity_v1") {
      throw new MetaGraphError("META_IDENTITY_CREDENTIAL_METADATA_REQUIRED", "Meta identity credential purpose is missing");
    }
    return inspectMetaAccessToken({config, accessToken: stored.access_token,
      permissionProfile: "identity_v1", fetchFn, now});
  }

  async function discoverWithCredential({installationAuthority, credentialId}) {
    const stored = await tokenVault.loadProviderTokenSet({
      credentialId,
      installationAuthority,
      provider: PROVIDER,
    });
    if (!stored?.access_token) throw new Error("META_ACCESS_TOKEN_UNAVAILABLE");
    const grant = await inspectIdentityCredential(stored);
    const evidence = await discoverMetaAdAccounts({
      accessToken: stored.access_token,
      appSecret: config.appSecret,
      scopes: grant?.scopes ?? stored.scopes,
      graphVersion: config.graphVersion,
      fetchFn,
      now,
    });
    if (!grant) return evidence;
    const expiresAt = new Date(Math.min(Date.parse(grant.expiresAt), Date.parse(evidence.expiresAt),
      Date.parse(grant.verifiedAt) + 600000)).toISOString();
    if (Date.parse(expiresAt) <= Date.parse(nowIso(now))) {
      throw new MetaGraphError("META_IDENTITY_SCOPE_EVIDENCE_STALE", "Meta identity permission evidence expired during account discovery");
    }
    return Object.freeze({...evidence, expiresAt});
  }

  return Object.freeze({
    config,
    oauthBoundary,

    // Prepared entry: current routes do not call it; the server gate defaults closed.
    async beginCombinedSetup({installationAuthority}) {
      const started = await oauthBoundary.begin({installationAuthority, provider: PROVIDER, permissionProfile: "identity_v1"});
      return Object.freeze({permissionProfile: "identity_v1", authorizationUrl: buildMetaAuthorizationUrl({config, state: started.state})});
    },

    async callbackReturn({workspaceId, installGeneration}) {
      return selections.callbackReturn({workspaceId, installGeneration});
    },

    async inspect({installationAuthority}) {
      const connected = await accountAuthority.load({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        provider: PROVIDER,
      });
      if (connected) {
        const stored = await tokenVault.loadProviderTokenSet({
          credentialId: connected.credentialId,
          installationAuthority,
          provider: PROVIDER,
        });
        if (typeof stored?.access_token !== "string" || stored.access_token.length < 1) {
          throw new Error("META_ACCESS_TOKEN_UNAVAILABLE");
        }
        const expiresAt = typeof stored?.expires_at === "string"
          ? Date.parse(stored.expires_at)
          : Number.NaN;
        if (!Number.isNaN(expiresAt) && expiresAt <= now().valueOf()) {
          const current = await lifecycle.load({
            installationAuthority,
            provider: PROVIDER,
            connectionId: connected.connectionId,
          });
          if (current?.status === "connected") {
            await lifecycle.markReauthorizationRequired({
              installationAuthority,
              provider: PROVIDER,
              connectionId: connected.connectionId,
              expectedVersion: current.version,
              reason: "meta_token_expired_before_settings_load",
            });
          }
          throw new MetaGraphError(
            "META_REAUTHORIZATION_REQUIRED",
            "Meta authorization is expired",
          );
        }
        await inspectIdentityCredential(stored);
        return Object.freeze({state: "connected", connection: connected});
      }

      const pendingReporting = await selections.loadPendingReporting({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
      });
      if (pendingReporting) {
        const stored = await tokenVault.loadProviderTokenSet({installationAuthority,
          provider: PROVIDER, credentialId: pendingReporting.credentialId});
        if (!stored?.access_token) throw new Error("META_ACCESS_TOKEN_UNAVAILABLE");
        await inspectIdentityCredential(stored);
        return Object.freeze({
          state: "pending_reporting_account_selection",
          pending: pendingReporting,
          accounts: pendingReporting.accounts,
        });
      }

      const pending = await selections.loadPending({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
      });
      if (!pending) return Object.freeze({state: "disconnected"});
      const evidence = await discoverWithCredential({
        installationAuthority,
        credentialId: pending.credentialId,
      });
      return Object.freeze({
        state: "pending_account_selection",
        pending,
        accounts: evidence.accounts,
      });
    },

    async completeCallback({claimed}) {
      const owner = authority(claimed);
      if (claimed.status === "denied") {
        return Object.freeze({
          outcome: "denied",
          ...(claimed.permissionProfile === "identity_v1" ? {
            setupState: "resume_setup", setupReason: "authorization_not_completed", setupComplete: false,
            setupResumeAction: "request_permissions",
          } : {}),
          owner,
          callbackReturn: await selections.callbackReturn(owner),
        });
      }

      let credential = null;
      let identityWriteAttempted = false;
      try {
        if (claimed.permissionProfile === "identity_v1") {
          await identityAuthorization.beforeCallback({installationAuthority: owner, provider: PROVIDER, binding: claimed.identityBinding});
        }
        const exchanged = await exchangeAndValidateMetaAuthorizationCode({
          config,
          authorizationCode: claimed.authorizationCode,
          permissionProfile: claimed.permissionProfile,
          fetchFn,
          now,
        });
        if (claimed.permissionProfile !== "identity_v1") credential = await tokenVault.storeProviderTokenSet({
          installationAuthority: owner,
          provider: PROVIDER,
          tokenSet: exchanged.tokenSet,
          expiresAt: exchanged.expiresAt,
        });
        const evidence = await discoverMetaAdAccounts({
          accessToken: exchanged.tokenSet.access_token,
          appSecret: config.appSecret,
          scopes: exchanged.scopes,
          graphVersion: config.graphVersion,
          fetchFn,
          now,
        });
        if (claimed.permissionProfile === "identity_v1") {
          await identityAuthorization.beforeCallback({installationAuthority: owner, provider: PROVIDER, binding: claimed.identityBinding});
        }
        if (claimed.permissionProfile === "identity_v1") {
          identityWriteAttempted = true;
          const committed = await tokenVault.commitIdentityOAuthCredential({installationAuthority:owner,
            provider:PROVIDER,transactionId:claimed.transactionId,connectionId:randomUUIDFn(),
            binding:claimed.identityBinding,tokenSet:exchanged.tokenSet,scopes:evidence.scopes,
            accounts:evidence.accounts,verifiedAt:evidence.verifiedAt,expiresAt:exchanged.expiresAt});
          return Object.freeze({outcome:committed.status==="connected"?"pending_asset_verification":committed.status,
            connectionState:committed.status,owner,pending:committed,
            setupState:"resume_setup",setupComplete:false,
            setupReason:committed.status==="connected"?"asset_verification_required":"account_selection_required",
            setupResumeAction:committed.status==="connected"?"verify_assets":"select_account",
            callbackReturn:await selections.callbackReturn(owner)});
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
        if (identityWriteAttempted) throw error;
        if (credential?.credentialId) {
          await tokenVault.deleteProviderTokenSet({
            credentialId: credential.credentialId,
            installationAuthority: owner,
            provider: PROVIDER,
          }).catch(() => undefined);
        }
        const finalized = await oauthBoundary.finalizeExchange({
          transactionId: claimed.transactionId,
          success: false,
        }).then(result => result?.transactionId === claimed.transactionId && result.status === "failed", () => false);
        if (claimed.permissionProfile === "identity_v1" && error instanceof OAuthPermissionProfileError
          && error.code === "OAUTH_IDENTITY_SCOPE_NOT_GRANTED") {
          if (!finalized) throw new Error("IDENTITY_OAUTH_FINALIZATION_UNCONFIRMED");
          return Object.freeze({outcome:"pending_permissions",owner,
            setupState:"resume_setup",setupReason:"permissions_incomplete",setupComplete:false,
            setupResumeAction:"request_permissions",
            callbackReturn:await selections.callbackReturn(owner)});
        }
        throw error;
      }
    },

    async select({installationAuthority, selectedAccountIds}) {
      const pending = await selections.loadPending({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
      });
      if (!pending) throw new Error("PENDING_ACCOUNT_SELECTION_REQUIRED");
      const evidence = await discoverWithCredential({
        installationAuthority,
        credentialId: pending.credentialId,
      });
      const chosen = selectedAdvertisers(evidence.accounts, selectedAccountIds);
      return selections.complete({
        connectionId: pending.connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        expectedVersion: pending.version,
        accounts: chosen.map((account) => ({
          id: account.id,
          name: account.name,
          kind: "advertiser",
          reporting_eligible: true,
          status: account.status,
          currency: account.currency,
          timezone: account.timezone,
          login_account_id: null,
        })),
        verifiedAt: evidence.verifiedAt,
      });
    },

    async finishReporting({installationAuthority, reportingAccountId}) {
      const pending = await selections.loadPendingReporting({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
      });
      if (!pending) throw new Error("PENDING_REPORTING_ACCOUNT_SELECTION_REQUIRED");
      if (!pending.accounts.some((account) => account.id === reportingAccountId)) {
        throw new Error("REPORTING_ACCOUNT_NOT_SELECTED");
      }
      const evidence = await discoverWithCredential({
        installationAuthority,
        credentialId: pending.credentialId,
      });
      const verified = evidence.accounts.find((account) => account.id === reportingAccountId);
      if (!verified) throw new Error("REPORTING_ACCOUNT_NOT_PROVIDER_VERIFIED");
      return selections.completeReporting({
        connectionId: pending.connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        expectedVersion: pending.version,
        providerAccountId: verified.id,
        verifiedAt: evidence.verifiedAt,
      });
    },

    async changeReporting({installationAuthority, reportingAccountId}) {
      const connected = await accountAuthority.load({
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        provider: PROVIDER,
      });
      if (!connected) throw new Error("CONNECTED_META_CONNECTION_REQUIRED");
      if (!connected.accounts.some((account) => account.id === reportingAccountId)) {
        throw new Error("REPORTING_ACCOUNT_NOT_SELECTED");
      }
      const evidence = await discoverWithCredential({
        installationAuthority,
        credentialId: connected.credentialId,
      });
      const verified = evidence.accounts.find((account) => account.id === reportingAccountId);
      if (!verified) throw new Error("REPORTING_ACCOUNT_NOT_PROVIDER_VERIFIED");
      return accountAuthority.selectReportingAccount({
        connectionId: connected.connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        provider: PROVIDER,
        providerAccountId: verified.id,
        verifiedAt: evidence.verifiedAt,
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
        throw new Error("CONNECTED_META_CONNECTION_REQUIRED");
      }
      const stored = await tokenVault.loadProviderTokenSet({
        credentialId: connected.credentialId,
        installationAuthority,
        provider: PROVIDER,
      });
      if (!stored?.access_token) throw new Error("META_REVOCATION_TOKEN_UNAVAILABLE");
      const revoked = await revokeMetaAuthorization({
        accessToken: stored.access_token,
        appSecret: config.appSecret,
        graphVersion: config.graphVersion,
        fetchFn,
      });
      const requested = await lifecycle.requestDisconnect({
        installationAuthority,
        provider: PROVIDER,
        connectionId: connected.connectionId,
        expectedVersion: current.version,
        reason: "merchant_requested_meta_disconnect",
      });
      return lifecycle.finalizeDisconnect({
        installationAuthority,
        provider: PROVIDER,
        connectionId: connected.connectionId,
        expectedVersion: requested.version,
        reason: "merchant_requested_meta_disconnect",
        providerEvidence: {
          authority: "provider_disconnect_verified",
          provider: PROVIDER,
          outcome: revoked.outcome,
          verifiedAt: nowIso(now),
          expiresAt: new Date(now().valueOf() + 60_000).toISOString(),
        },
      });
    },
  });
}
