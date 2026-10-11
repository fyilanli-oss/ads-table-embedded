import {randomUUID} from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER = "google_ads";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/adwords";

function installationAuthority(value) {
  if (
    !value
    || value.authority !== "shopify_installation_verified"
    || value.status !== "active"
    || !UUID_PATTERN.test(value.workspaceId || "")
    || !Number.isSafeInteger(value.installGeneration)
    || value.installGeneration < 1
  ) {
    throw new Error("GOOGLE_HANDOFF_VERIFIED_INSTALLATION_REQUIRED");
  }
  return value;
}

function isoNow(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  return value.toISOString();
}

function requiredMethod(value, method, label) {
  if (!value || typeof value[method] !== "function") {
    throw new TypeError(label + "." + method + " is required");
  }
}

function tokenForVault(token) {
  if (!token || typeof token.refresh_token !== "string" || token.refresh_token.length < 1) {
    throw new Error("GOOGLE_OFFLINE_REFRESH_TOKEN_REQUIRED");
  }
  return {
    refresh_token: token.refresh_token,
    token_type: typeof token.token_type === "string" ? token.token_type : "Bearer",
    scope: typeof token.scope === "string" ? token.scope : GOOGLE_SCOPE,
  };
}

function normalizeEvidence(value, observedAt) {
  if (!value || !Array.isArray(value.accounts) || value.accounts.length < 1) {
    throw new Error("GOOGLE_ACCOUNT_EVIDENCE_INVALID");
  }
  const ids = new Set();
  const accounts = value.accounts.map((account) => {
    if (
      !account
      || typeof account.id !== "string"
      || account.id.trim().length < 1
      || typeof account.name !== "string"
      || account.name.trim().length < 1
      || !["advertiser", "manager"].includes(account.kind)
      || typeof account.reportingEligible !== "boolean"
      || (account.kind === "manager" && account.reportingEligible)
      || ids.has(account.id)
    ) {
      throw new Error("GOOGLE_ACCOUNT_EVIDENCE_INVALID");
    }
    ids.add(account.id);
    return Object.freeze({...account});
  });
  return Object.freeze({
    authority: "provider_account_access_verified",
    provider: PROVIDER,
    verifiedAt: value.verifiedAt ?? observedAt,
    scopes: Object.freeze(
      Array.isArray(value.scopes) && value.scopes.length > 0
        ? [...value.scopes]
        : [GOOGLE_SCOPE],
    ),
    accounts: Object.freeze(accounts),
  });
}

function selectedAccounts(evidence, selectedAccountIds, reportingAccountId) {
  if (
    !Array.isArray(selectedAccountIds)
    || selectedAccountIds.length < 1
    || selectedAccountIds.length > 3
    || new Set(selectedAccountIds).size !== selectedAccountIds.length
    || typeof reportingAccountId !== "string"
    || !selectedAccountIds.includes(reportingAccountId)
  ) {
    throw new Error("GOOGLE_ACCOUNT_SELECTION_INVALID");
  }
  const byId = new Map(evidence.accounts.map((account) => [account.id, account]));
  const selected = selectedAccountIds.map((id) => byId.get(id));
  if (
    selected.some((account) =>
      !account
      || account.kind !== "advertiser"
      || account.reportingEligible !== true
    )
  ) {
    throw new Error("GOOGLE_ACCOUNT_SELECTION_NOT_VERIFIED_OR_INELIGIBLE");
  }
  return selected.map((account) => ({
    id: account.id,
    name: account.name,
    kind: account.kind,
    reporting_eligible: account.reportingEligible,
    status: account.status ?? null,
    currency: account.currency ?? null,
    timezone: account.timezone ?? null,
    login_account_id: account.loginAccountId ?? null,
  }));
}

export function createGoogleAuthorizationHandoff({
  oauthBoundary,
  tokenVault,
  repository,
  exchangeAuthorizationCode,
  refreshAccessToken,
  discoverAccounts,
  now = () => new Date(),
  randomUUIDFn = randomUUID,
}) {
  requiredMethod(oauthBoundary, "finalizeExchange", "oauthBoundary");
  for (const method of [
    "storeProviderTokenSet",
    "loadProviderTokenSet",
    "deleteProviderTokenSet",
  ]) {
    requiredMethod(tokenVault, method, "tokenVault");
  }
  for (const method of ["create", "load", "consume", "expire"]) {
    requiredMethod(repository, method, "repository");
  }
  if (typeof exchangeAuthorizationCode !== "function") {
    throw new TypeError("exchangeAuthorizationCode is required");
  }
  if (typeof refreshAccessToken !== "function") {
    throw new TypeError("refreshAccessToken is required");
  }
  if (typeof discoverAccounts !== "function") {
    throw new TypeError("discoverAccounts is required");
  }

  async function resolveFreshEvidence(transactionId, owner) {
    const observedAt = isoNow(now);
    const pending = await repository.load({
      transactionId,
      workspaceId: owner.workspaceId,
      installGeneration: owner.installGeneration,
      provider: PROVIDER,
      observedAt,
    });
    if (!pending || pending.status !== "awaiting_selection") {
      throw new Error("GOOGLE_AUTHORIZATION_HANDOFF_UNAVAILABLE");
    }
    const stored = await tokenVault.loadProviderTokenSet({
      credentialId: pending.credentialId,
      installationAuthority: owner,
      provider: PROVIDER,
    });
    if (!stored || typeof stored.refresh_token !== "string") {
      throw new Error("GOOGLE_AUTHORIZATION_CREDENTIAL_UNAVAILABLE");
    }
    const refreshed = await refreshAccessToken({refreshToken: stored.refresh_token});
    if (!refreshed || typeof refreshed.access_token !== "string") {
      throw new Error("GOOGLE_ACCESS_TOKEN_REFRESH_FAILED");
    }
    const discovered = await discoverAccounts({accessToken: refreshed.access_token});
    return {
      pending,
      evidence: normalizeEvidence(discovered, observedAt),
    };
  }

  return Object.freeze({
    async completeCallback({claimed, installationAuthority: authority}) {
      const owner = installationAuthority(authority);
      if (
        !claimed
        || claimed.status !== "claimed"
        || claimed.provider !== PROVIDER
        || !UUID_PATTERN.test(claimed.transactionId || "")
        || claimed.workspaceId !== owner.workspaceId
        || claimed.installGeneration !== owner.installGeneration
      ) {
        throw new Error("GOOGLE_CALLBACK_AUTHORITY_MISMATCH");
      }

      let credentialId = null;
      let finalized = false;
      try {
        const token = await exchangeAuthorizationCode({
          authorizationCode: claimed.authorizationCode,
          pkceVerifier: claimed.pkceVerifier,
        });
        const stored = await tokenVault.storeProviderTokenSet({
          installationAuthority: owner,
          provider: PROVIDER,
          tokenSet: tokenForVault(token),
        });
        credentialId = stored.credentialId;
        const exchange = await oauthBoundary.finalizeExchange({
          transactionId: claimed.transactionId,
          success: true,
        });
        finalized = exchange.status === "exchanged";
        if (!finalized) throw new Error("GOOGLE_OAUTH_EXCHANGE_FINALIZE_FAILED");

        const pending = await repository.create({
          transactionId: claimed.transactionId,
          workspaceId: owner.workspaceId,
          installGeneration: owner.installGeneration,
          provider: PROVIDER,
          credentialId,
          createdAt: isoNow(now),
        });
        if (!pending || pending.status !== "awaiting_selection") {
          throw new Error("GOOGLE_AUTHORIZATION_HANDOFF_CREATE_FAILED");
        }
        return Object.freeze({
          transactionId: pending.transactionId,
          status: pending.status,
          expiresAt: pending.expiresAt,
        });
      } catch (error) {
        if (credentialId) {
          try {
            await tokenVault.deleteProviderTokenSet({
              credentialId,
              installationAuthority: owner,
              provider: PROVIDER,
            });
          } catch {
            // Expiry cleanup remains the authoritative fallback.
          }
        }
        if (!finalized) {
          try {
            await oauthBoundary.finalizeExchange({
              transactionId: claimed.transactionId,
              success: false,
            });
          } catch {
            // The OAuth state machine remains authoritative.
          }
        }
        throw error;
      }
    },

    async discover({transactionId, installationAuthority: authority}) {
      const owner = installationAuthority(authority);
      const {pending, evidence} = await resolveFreshEvidence(transactionId, owner);
      return Object.freeze({
        transactionId: pending.transactionId,
        expiresAt: pending.expiresAt,
        accounts: evidence.accounts,
      });
    },

    async select({
      transactionId,
      installationAuthority: authority,
      selectedAccountIds,
      reportingAccountId,
    }) {
      const owner = installationAuthority(authority);
      const {evidence} = await resolveFreshEvidence(transactionId, owner);
      const accounts = selectedAccounts(
        evidence,
        selectedAccountIds,
        reportingAccountId,
      );
      const connectionId = randomUUIDFn();
      if (!UUID_PATTERN.test(connectionId || "")) {
        throw new Error("GOOGLE_CONNECTION_ID_INVALID");
      }
      return repository.consume({
        transactionId,
        connectionId,
        workspaceId: owner.workspaceId,
        installGeneration: owner.installGeneration,
        provider: PROVIDER,
        grantedScopes: evidence.scopes,
        accounts,
        reportingAccountId,
        verifiedAt: evidence.verifiedAt,
        consumedAt: isoNow(now),
      });
    },

    async expire({limit = 100} = {}) {
      return repository.expire({observedAt: isoNow(now), limit});
    },
  });
}
