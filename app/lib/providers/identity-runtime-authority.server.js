import {createShopifyRuntimeRepositories} from "../database/shopify-runtime-repositories.server.js";
import {createProviderAccountAuthorityRepository} from "../database/provider-account-authority-repository.server.js";
import {createProviderConnectionLifecycle} from "../oauth/provider-connection-lifecycle.server.js";
import {permissionContext} from "../oauth/identity-permission-preflight.server.js";
import {validateIdentityOAuthGrantedScopes} from "../oauth/oauth-permission-profile.server.js";
import {inspectGoogleIdentityCredential} from "../oauth/google-identity-credential.server.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KLAVIYO_SCOPES = ["campaigns:read", "events:read", "flows:read", "metrics:read"];
export class IdentityRuntimeAuthorityError extends Error {
  constructor(code) { super(code); this.name = "IdentityRuntimeAuthorityError"; this.code = code; }
}
function fail(code) { throw new IdentityRuntimeAuthorityError(code); }
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function scopes(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100
    || value.some(v => typeof v !== "string" || !v || v.length > 200 || /\s/.test(v))
    || new Set(value).size !== value.length) fail("IDENTITY_RUNTIME_SCOPES_INVALID");
  return [...value].sort();
}
function selectAccount(connection, provider) {
  if (!Array.isArray(connection.accounts) || connection.accounts.length > 3
    || new Set(connection.accounts.map(a => a?.id)).size !== connection.accounts.length) fail("IDENTITY_RUNTIME_ACCOUNT_INVALID");
  const account = provider === "klaviyo"
    ? connection.accounts.length === 1 && connection.reportingAccountId === null && connection.accounts[0]
    : connection.accounts.find(a => a.id === connection.reportingAccountId);
  if (!account || account.reporting_eligible !== true
    || (provider === "klaviyo" ? account.kind !== "account" || account.status !== "active" : account.kind !== "advertiser")
    || typeof account.id !== "string" || !account.id || account.id.length > 256 || /\s/.test(account.id)
    || (provider === "meta" && !/^act_[1-9][0-9]*$/.test(account.id))
    || (provider === "google_ads" && !/^[1-9][0-9]*$/.test(account.id))) fail("IDENTITY_RUNTIME_ACCOUNT_INVALID");
  const login = account.login_account_id ?? null;
  if (provider === "google_ads" && login !== null && (typeof login !== "string" || !/^[1-9][0-9]*$/.test(login))) fail("IDENTITY_RUNTIME_ACCOUNT_INVALID");
  // Project only authority fields, never account names or other profile information.
  return {id: account.id, kind: account.kind, reporting_eligible: true,
    status: account.status ?? null, login_account_id: provider === "google_ads" ? login : null};
}

// Internal server dependency only. `verified` must come from authenticated read-only Shopify
// authority resolution, never request JSON. This exports no route or browser-safe response.
export function createIdentityRuntimeAuthorityLoader({verified, database, tokenVault, provider,
  now = () => new Date(), signal} = {}) {
  if (!["google_ads", "meta", "klaviyo"].includes(provider)) fail("IDENTITY_RUNTIME_PROVIDER_INVALID");
  if (typeof tokenVault?.loadProviderTokenSet !== "function" || typeof now !== "function") fail("IDENTITY_RUNTIME_DEPENDENCY_REQUIRED");
  const callerOwner = verified?.installationAuthority, callerShop = verified?.identity?.shop;
  const installation = freeze({authority: callerOwner?.authority, status: callerOwner?.status,
    workspaceId: callerOwner?.workspaceId, installGeneration: callerOwner?.installGeneration});
  const shop = freeze({authority: callerShop?.authority, shopId: callerShop?.shopId, myshopifyDomain: callerShop?.myshopifyDomain});
  if (installation?.authority !== "shopify_installation_verified" || installation.status !== "active"
    || verified?.identity?.session?.authority !== "shopify_id_token_verified"
    || shop?.authority !== "shopify_admin_verified" || verified.identity.session.shopDomain !== shop.myshopifyDomain
    || typeof verified?.context?.admin?.graphql !== "function") fail("IDENTITY_RUNTIME_VERIFIED_CALLER_REQUIRED");
  // Reuse the canonical shop/workspace/generation validator, without fabricating account authority.
  const shopContext = permissionContext({provider: "shopify", workspaceId: installation.workspaceId,
    installGeneration: installation.installGeneration, shopId: shop.shopId, shopDomain: shop.myshopifyDomain});
  const installations = createShopifyRuntimeRepositories(database).installation;
  const accounts = createProviderAccountAuthorityRepository(database);
  const lifecycle = createProviderConnectionLifecycle({database});
  let pinned = null, loading = false, stopped = false;
  function abort() { if (signal?.aborted) fail("IDENTITY_RUNTIME_ABORTED"); }
  async function read() {
    abort();
    const current = await installations.resolveActive({shopId: shop.shopId, shopDomain: shop.myshopifyDomain});
    if (current.status !== "active" || current.workspaceId !== shopContext.workspaceId
      || current.installGeneration !== shopContext.installGeneration) fail("IDENTITY_RUNTIME_INSTALLATION_CHANGED");
    const state = await lifecycle.loadCurrent({installationAuthority: installation, provider});
    if (state?.status !== "connected" || !UUID.test(state.connectionId ?? "") || !UUID.test(state.credentialId ?? "")
      || !Number.isSafeInteger(state.version) || state.version < 1) fail("IDENTITY_RUNTIME_CONNECTED_CREDENTIAL_REQUIRED");
    const connection = await accounts.load({workspaceId: installation.workspaceId, installGeneration: installation.installGeneration, provider});
    if (!connection || connection.connectionId !== state.connectionId || connection.credentialId !== state.credentialId) fail("IDENTITY_RUNTIME_CONNECTION_MISMATCH");
    const account = selectAccount(connection, provider), granted = scopes(connection.grantedScopes);
    if (provider === "klaviyo") {
      if (KLAVIYO_SCOPES.some(s => !granted.includes(s))) fail("IDENTITY_RUNTIME_SCOPE_MISSING");
    } else validateIdentityOAuthGrantedScopes(provider, provider === "google_ads" ? granted.join(" ") : granted);
    abort();
    return {status: "connected", connectionVersion: state.version, credentialId: state.credentialId,
      connectionId: state.connectionId, provider, account, grantedScopes: granted};
  }
  return Object.freeze({async loadCurrent() {
    if (stopped) fail("IDENTITY_RUNTIME_EXECUTION_STOPPED");
    // One loader belongs to one execution; prevent overlapping reads from racing its baseline.
    if (loading) fail("IDENTITY_RUNTIME_CONCURRENT_LOAD");
    loading = true;
    try {
      const before = await read();
      const tokenSet = structuredClone(await tokenVault.loadProviderTokenSet({credentialId: before.credentialId,
        installationAuthority: installation, provider}));
      abort();
      if (typeof tokenSet?.access_token !== "string" || !tokenSet.access_token
        || tokenSet.access_token.length > (provider === "klaviyo" ? 16384 : 4096)
        || /[\u0000-\u0020\u007f]/.test(tokenSet.access_token)) fail("IDENTITY_RUNTIME_TOKEN_INVALID");
      if (provider === "google_ads") {
        if (inspectGoogleIdentityCredential(tokenSet, now).needsRefresh) fail("IDENTITY_RUNTIME_CREDENTIAL_REFRESH_REQUIRED");
        if (JSON.stringify([...validateIdentityOAuthGrantedScopes(provider, tokenSet.scope)].sort()) !== JSON.stringify(before.grantedScopes)) fail("IDENTITY_RUNTIME_TOKEN_SCOPE_MISMATCH");
      } else if (provider === "meta") {
        if (tokenSet.permission_profile !== "identity_v1") fail("IDENTITY_RUNTIME_IDENTITY_PROFILE_REQUIRED");
        // Native app/scopes/deadlines are inspected by the existing Meta catalog compositor.
      } else {
        const time = now();
        if (!(time instanceof Date) || !Number.isFinite(time.valueOf())) fail("IDENTITY_RUNTIME_TIME_INVALID");
        const expiry = Date.parse(tokenSet.expires_at);
        if (!Number.isFinite(expiry) || expiry <= time.valueOf() + 60000) fail("IDENTITY_RUNTIME_CREDENTIAL_REFRESH_REQUIRED");
        if (JSON.stringify(scopes(tokenSet.scopes)) !== JSON.stringify(before.grantedScopes)) fail("IDENTITY_RUNTIME_TOKEN_SCOPE_MISMATCH");
        // scope_source/observed_at remain unchanged; this read never renews grant evidence.
      }
      const after = await read();
      if (JSON.stringify(before) !== JSON.stringify(after)) fail("IDENTITY_RUNTIME_AUTHORITY_CHANGED");
      const signature = JSON.stringify([before, tokenSet]);
      if (pinned !== null && pinned !== signature) fail("IDENTITY_RUNTIME_AUTHORITY_CHANGED");
      pinned = signature;
      return freeze({...before, installation: structuredClone(installation), shop: structuredClone(shop), tokenSet,
        // Existing resolve_active_installation returns workspace/generation/status, NOT its bigint PK.
        // Never derive it from generation or accept it from the caller. SQL review remains step 14.
        canonical_scope_ready: false, installation_id: null,
        remaining: ["trusted_installation_primary_key_read", "reporting_selection_epoch_read", "provider_source_context_and_rule_binding"],
        native_permission_revalidated: false, authorizes_activation: false, persistable: false});
    } catch (error) {
      stopped = true;
      if (error instanceof IdentityRuntimeAuthorityError) throw error;
      // Never forward vault, SQL or native credential values in error text.
      fail(signal?.aborted ? "IDENTITY_RUNTIME_ABORTED" : "IDENTITY_RUNTIME_AUTHORITY_READ_FAILED");
    } finally { loading = false; }
  }});
}
