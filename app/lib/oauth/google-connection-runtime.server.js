const PROVIDER = "google_ads";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

function requiredMethod(value, method, label) {
  if (!value || typeof value[method] !== "function") {
    throw new TypeError(label + "." + method + " is required");
  }
}

function nowIso(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new TypeError("now must return a valid Date");
  }
  return value.toISOString();
}

function invalidGrant(error) {
  const details =
    error && typeof error === "object" && "details" in error
      ? error.details
      : null;
  return (
    details?.provider_status === "invalid_grant"
    || details?.provider_error_code === "invalid_grant"
  );
}

function providerEvidence(outcome, verifiedAt) {
  return Object.freeze({
    authority: "provider_disconnect_verified",
    provider: PROVIDER,
    outcome,
    verifiedAt,
    expiresAt: new Date(new Date(verifiedAt).valueOf() + 5 * 60 * 1000).toISOString(),
  });
}

async function revokeGoogleGrant({refreshToken, fetchFn}) {
  let response;
  try {
    response = await fetchFn(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({token: refreshToken}).toString(),
    });
  } catch {
    throw new Error("GOOGLE_REVOKE_FAILED");
  }
  if (response.ok) return "revoked";
  const body = await response.text().catch(() => "");
  if (response.status === 400 && /invalid_token/i.test(body)) {
    return "already_invalid";
  }
  throw new Error("GOOGLE_REVOKE_FAILED");
}

export function createGoogleConnectionRuntime({
  accountAuthority,
  connectionLifecycle,
  tokenVault,
  refreshAccessToken,
  discoverAccounts,
  fetchFn = fetch,
  now = () => new Date(),
}) {
  for (const [value, method, label] of [
    [accountAuthority, "load", "accountAuthority"],
    [accountAuthority, "selectReportingAccount", "accountAuthority"],
    [connectionLifecycle, "load", "connectionLifecycle"],
    [connectionLifecycle, "requestDisconnect", "connectionLifecycle"],
    [connectionLifecycle, "finalizeDisconnect", "connectionLifecycle"],
    [tokenVault, "loadProviderTokenSet", "tokenVault"],
  ]) {
    requiredMethod(value, method, label);
  }
  if (typeof refreshAccessToken !== "function") {
    throw new TypeError("refreshAccessToken is required");
  }
  if (typeof discoverAccounts !== "function") {
    throw new TypeError("discoverAccounts is required");
  }
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");

  async function load(installationAuthority) {
    const connection = await accountAuthority.load({
      workspaceId: installationAuthority.workspaceId,
      installGeneration: installationAuthority.installGeneration,
      provider: PROVIDER,
    });
    if (!connection) return null;
    const lifecycle = await connectionLifecycle.load({
      installationAuthority,
      connectionId: connection.connectionId,
      provider: PROVIDER,
    });
    if (!lifecycle) throw new Error("GOOGLE_CONNECTION_LIFECYCLE_MISSING");
    return {connection, lifecycle};
  }

  async function tokens(connection, installationAuthority) {
    const stored = await tokenVault.loadProviderTokenSet({
      credentialId: connection.credentialId,
      installationAuthority,
      provider: PROVIDER,
    });
    if (!stored || typeof stored.refresh_token !== "string") {
      throw new Error("GOOGLE_AUTHORIZATION_CREDENTIAL_UNAVAILABLE");
    }
    return stored;
  }

  async function finalizeAlreadyInvalid(state, installationAuthority, reason) {
    let lifecycle = state.lifecycle;
    if (lifecycle.status !== "disconnect_pending") {
      lifecycle = await connectionLifecycle.requestDisconnect({
        installationAuthority,
        connectionId: state.connection.connectionId,
        provider: PROVIDER,
        expectedVersion: lifecycle.version,
        reason,
      });
    }
    return connectionLifecycle.finalizeDisconnect({
      installationAuthority,
      connectionId: state.connection.connectionId,
      provider: PROVIDER,
      expectedVersion: lifecycle.version,
      reason,
      providerEvidence: providerEvidence("already_invalid", nowIso(now)),
    });
  }

  async function refresh(state, installationAuthority) {
    const stored = await tokens(state.connection, installationAuthority);
    try {
      const token = await refreshAccessToken({refreshToken: stored.refresh_token});
      if (!token || typeof token.access_token !== "string") {
        throw new Error("GOOGLE_ACCESS_TOKEN_REFRESH_FAILED");
      }
      return {stored, accessToken: token.access_token};
    } catch (error) {
      if (!invalidGrant(error)) throw error;
      await finalizeAlreadyInvalid(
        state,
        installationAuthority,
        "google_refresh_token_invalid_or_revoked",
      );
      return null;
    }
  }

  return Object.freeze({
    async inspect({installationAuthority}) {
      const state = await load(installationAuthority);
      if (!state) return Object.freeze({status: "not_connected"});
      if (state.lifecycle.status === "disconnected") {
        return Object.freeze({status: "disconnected"});
      }
      const refreshed = await refresh(state, installationAuthority);
      if (!refreshed) {
        return Object.freeze({status: "reauthorization_required"});
      }
      return Object.freeze({
        status: "connected",
        connection: state.connection,
        lifecycle: state.lifecycle,
      });
    },

    async changeReportingAccount({
      installationAuthority,
      providerAccountId,
    }) {
      const state = await load(installationAuthority);
      if (!state || state.lifecycle.status === "disconnected") {
        throw new Error("GOOGLE_CONNECTION_NOT_CONNECTED");
      }
      const refreshed = await refresh(state, installationAuthority);
      if (!refreshed) {
        throw new Error("GOOGLE_REAUTHORIZATION_REQUIRED");
      }
      const evidence = await discoverAccounts({accessToken: refreshed.accessToken});
      const account = evidence.accounts?.find(
        (candidate) =>
          candidate.id === providerAccountId
          && candidate.kind === "advertiser"
          && candidate.reportingEligible === true,
      );
      if (
        !account
        || !state.connection.accounts.some(
          (connected) => connected.id === providerAccountId,
        )
      ) {
        throw new Error("GOOGLE_REPORTING_ACCOUNT_NOT_VERIFIED");
      }
      return accountAuthority.selectReportingAccount({
        connectionId: state.connection.connectionId,
        workspaceId: installationAuthority.workspaceId,
        installGeneration: installationAuthority.installGeneration,
        provider: PROVIDER,
        providerAccountId,
        verifiedAt: evidence.verifiedAt ?? nowIso(now),
      });
    },

    async disconnect({installationAuthority}) {
      const state = await load(installationAuthority);
      if (!state || state.lifecycle.status === "disconnected") {
        return Object.freeze({
          status: "not_connected",
          providerGrantRevoked: false,
          localCredentialsRemoved: true,
          historicalDataPreserved: true,
        });
      }
      let outcome = "already_invalid";
      try {
        const stored = await tokens(state.connection, installationAuthority);
        outcome = await revokeGoogleGrant({
          refreshToken: stored.refresh_token,
          fetchFn,
        });
      } catch (error) {
        if (
          error instanceof Error
          && error.message === "GOOGLE_AUTHORIZATION_CREDENTIAL_UNAVAILABLE"
        ) {
          outcome = "already_invalid";
        } else {
          throw error;
        }
      }
      let lifecycle = state.lifecycle;
      if (lifecycle.status !== "disconnect_pending") {
        lifecycle = await connectionLifecycle.requestDisconnect({
          installationAuthority,
          connectionId: state.connection.connectionId,
          provider: PROVIDER,
          expectedVersion: lifecycle.version,
          reason: "merchant_requested_google_disconnect",
        });
      }
      await connectionLifecycle.finalizeDisconnect({
        installationAuthority,
        connectionId: state.connection.connectionId,
        provider: PROVIDER,
        expectedVersion: lifecycle.version,
        reason: "merchant_requested_google_disconnect",
        providerEvidence: providerEvidence(outcome, nowIso(now)),
      });
      return Object.freeze({
        status: "not_connected",
        providerGrantRevoked: outcome === "revoked",
        localCredentialsRemoved: true,
        historicalDataPreserved: true,
      });
    },
  });
}

export {GOOGLE_REVOKE_URL};
