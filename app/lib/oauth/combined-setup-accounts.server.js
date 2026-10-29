import {validateIdentityOAuthGrantedScopes} from "./oauth-permission-profile.server.js";

function fail(code) {throw new Error(code);}
function sameBinding(left, right) {
  return left && right && left.connectionId === right.connectionId
    && left.version === right.version && left.credentialId === right.credentialId
    && left.status === right.status;
}

// Optional only for the unchanged legacy entries. Combined callers bind the exact
// server-read pending record before any credential discovery or selection write.
export function assertCombinedSetupAccountBinding(expected, pending) {
  if (expected === undefined) {
    if (Array.isArray(pending?.scopes) && pending.scopes.some(scope => scope === "https://www.googleapis.com/auth/content" || scope === "catalog_management")) {
      fail("COMBINED_SETUP_BOUND_ENTRY_REQUIRED");
    }
    return;
  }
  if (!expected || !pending || expected.connectionId !== pending.connectionId
    || expected.version !== pending.version || expected.credentialId !== pending.credentialId) {
    fail("COMBINED_SETUP_CONNECTION_CHANGED");
  }
}

// Server composition only. Existing reporting entries stay unchanged. This boundary
// does not issue asset evidence or turn an account-selection receipt into setup approval.
export function createCombinedSetupAccounts({provider, enabled, lifecycle, tokenVault, runtime}) {
  if (!["google_ads", "meta"].includes(provider) || typeof enabled !== "boolean") {
    fail("COMBINED_SETUP_CONFIGURATION_INVALID");
  }
  async function snapshot(installationAuthority) {
    if (!enabled) fail("IDENTITY_OAUTH_START_DISABLED");
    const current = await lifecycle.loadCurrent({installationAuthority, provider});
    if (!current) return null;
    if (!["connected", "pending_account_selection", "reauthorization_required"].includes(current.status)) {
      fail("COMBINED_SETUP_LIFECYCLE_UNAVAILABLE");
    }
    if (current.status === "reauthorization_required") return current;
    if (!Number.isSafeInteger(current.version) || current.version < 1 || !current.credentialId) {
      fail("COMBINED_SETUP_BINDING_INVALID");
    }
    const stored = await tokenVault.loadProviderTokenSet({installationAuthority, provider, credentialId: current.credentialId});
    if (stored?.permission_profile !== "identity_v1" || !stored.access_token) {
      fail("COMBINED_SETUP_IDENTITY_CREDENTIAL_REQUIRED");
    }
    // These are stored grants, not a fresh asset-access or app-approval observation.
    validateIdentityOAuthGrantedScopes(provider, provider === "google_ads" ? stored.scope : stored.scopes);
    const after = await lifecycle.loadCurrent({installationAuthority, provider});
    if (!sameBinding(current, after)) fail("COMBINED_SETUP_CONNECTION_CHANGED");
    return current;
  }
  function project(current, accounts = [], reportingAccountId = null, selectionState = current?.status ?? "disconnected") {
    const state = selectionState;
    const action = state === "connected" ? "reporting_selected"
      : state === "pending_reporting_account_selection" ? "select_reporting_account"
      : state === "pending_account_selection" ? "select_account" : "request_permissions";
    return Object.freeze({provider, connectionState: current?.status ?? "disconnected", selectionState: state,
      setupState: "resume_setup", setupComplete: false,
      setupReason: action === "reporting_selected" ? "reporting_account_selected"
        : action === "request_permissions" ? "authorization_required" : "account_selection_required",
      setupResumeAction: action, connectionId: current?.connectionId ?? null,
      connectionVersion: current?.version ?? null, reportingAccountId,
      accounts: Object.freeze(accounts.map(account => Object.freeze({id: account.id, name: account.name}))),
    });
  }
  async function select(installationAuthority, input, operation, expectedStatus, expectedConnection) {
    const expected = expectedConnection === undefined ? null : {
      connectionId: expectedConnection?.connectionId, version: expectedConnection?.version,
    };
    if (expected && (typeof expected.connectionId !== "string" || !expected.connectionId
      || !Number.isSafeInteger(expected.version) || expected.version < 1)) fail("COMBINED_SETUP_BINDING_INVALID");
    const before = await snapshot(installationAuthority);
    if (expected && (before?.connectionId !== expected.connectionId || before?.version !== expected.version)) {
      fail("COMBINED_SETUP_CONNECTION_CHANGED");
    }
    if (before?.status !== expectedStatus) fail("COMBINED_SETUP_SELECTION_STATE_INVALID");
    if (before.version >= Number.MAX_SAFE_INTEGER) fail("COMBINED_SETUP_BINDING_INVALID");
    const receipt = await operation({installationAuthority, ...input, combinedSetupBinding: {
      connectionId: before.connectionId, version: before.version, credentialId: before.credentialId,
    }});
    const finishing = operation === runtime.finishReporting;
    const expectedAccount = finishing ? input.reportingAccountId
      : input.selectedAccountIds.length === 1 ? input.selectedAccountIds[0] : null;
    const expectedState = expectedAccount === null ? "pending_account_selection" : "connected";
    // Never retry a lost write acknowledgement or report it as a declined permission.
    if (receipt?.connectionId !== before.connectionId || receipt.version !== before.version + 1
      || receipt.status !== expectedState || receipt.reportingAccountId !== expectedAccount
      || !finishing && receipt.connectedAccountCount !== input.selectedAccountIds.length) {
      fail("COMBINED_SETUP_SELECTION_UNCONFIRMED");
    }
    const after = await snapshot(installationAuthority);
    if (!after || after.connectionId !== receipt.connectionId || after.version !== receipt.version
      || after.status !== receipt.status || after.credentialId !== before.credentialId) {
      fail("COMBINED_SETUP_SELECTION_UNCONFIRMED");
    }
    if (after.status === "pending_account_selection" && !(receipt.connectedAccountCount > 1)) {
      fail("COMBINED_SETUP_SELECTION_UNCONFIRMED");
    }
    return project(after, [], receipt.reportingAccountId ?? null,
      after.status === "pending_account_selection" ? "pending_reporting_account_selection" : after.status);
  }
  return Object.freeze({
    async inspect({installationAuthority}) {
      const before = await snapshot(installationAuthority);
      if (!before || before.status === "reauthorization_required") return project(before);
      const result = await runtime.inspect({installationAuthority});
      const after = await snapshot(installationAuthority);
      const record = result?.state === "connected" ? result.connection : result?.pending;
      const phaseMatches = result?.state === before.status || before.status === "pending_account_selection"
        && result?.state === "pending_reporting_account_selection";
      if (!sameBinding(before, after) || !phaseMatches
        || record?.connectionId !== before.connectionId || record.credentialId !== before.credentialId
        || result.state !== "connected" && record.version !== before.version) {
        fail("COMBINED_SETUP_CONNECTION_CHANGED");
      }
      return project(after, result.accounts ?? record.accounts ?? [], record.reportingAccountId ?? null, result.state);
    },
    async select({installationAuthority, selectedAccountIds, expectedConnection}) {
      return select(installationAuthority, {selectedAccountIds}, runtime.select, "pending_account_selection", expectedConnection);
    },
    async finishReporting({installationAuthority, reportingAccountId, expectedConnection}) {
      return select(installationAuthority, {reportingAccountId}, runtime.finishReporting, "pending_account_selection", expectedConnection);
    },
  });
}
