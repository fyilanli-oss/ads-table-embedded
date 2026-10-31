import {identityOAuthBinding, oauthPermissionProfile} from "./oauth-permission-profile.server.js";

export function identityOAuthBindingForCurrent(current) {
  if (current === null) return identityOAuthBinding({connectionId: null, version: null});
  if (!["connected", "pending_account_selection", "reauthorization_required", "disconnected"].includes(current.status)) {
    throw new Error("IDENTITY_OAUTH_CONNECTION_STATE_NOT_ELIGIBLE");
  }
  // An explicit new OAuth may reuse a retired connection identity, never its grant.
  if (current.status === "disconnected" && (current.credentialId !== null
    || typeof current.disconnectedAt !== "string" || !Number.isFinite(Date.parse(current.disconnectedAt)))) {
    throw new Error("IDENTITY_OAUTH_DISCONNECT_INCOMPLETE");
  }
  return identityOAuthBinding({connectionId: current.connectionId, version: current.version});
}

export function createIdentityOAuthAuthorization({lifecycle, enabled = false}) {
  if (typeof enabled !== "boolean") throw new TypeError("IDENTITY_OAUTH_SERVER_SWITCH_INVALID");
  const read = async ({installationAuthority, provider}) => {
    if (!enabled) throw new Error("IDENTITY_OAUTH_START_DISABLED");
    oauthPermissionProfile(provider, "identity_v1");
    return identityOAuthBindingForCurrent(await lifecycle.loadCurrent({installationAuthority, provider}));
  };
  return Object.freeze({
    beforeStart: read,
    async beforeCallback({installationAuthority, provider, binding}) {
      const expected = identityOAuthBinding(binding);
      const actual = await read({installationAuthority, provider});
      if (expected.connectionId !== actual.connectionId || expected.version !== actual.version) {
        throw new Error("IDENTITY_OAUTH_CONNECTION_CHANGED");
      }
    },
  });
}
