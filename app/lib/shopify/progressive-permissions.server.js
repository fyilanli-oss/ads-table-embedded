import {inspectShopifyIdentityPermissionScopes} from "./permission-scopes.server.js";
import {assessIdentityPermissionScopes} from "../oauth/identity-permission-preflight.server.js";
import {createShopifyRuntimeRepositories} from "../database/shopify-runtime-repositories.server.js";
import {runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";

// Uses the raw optional handles, not SDK AuthScopes' expanded write->read aliases.
export const SHOPIFY_OPTIONAL_SCOPES_QUERY = `#graphql
  query AdsTableOptionalPermissionScopes {
    shop { id myshopifyDomain }
    currentAppInstallation { id }
    app { optionalAccessScopes { handle } }
  }
`;
const REAUTHORIZE = "X-Shopify-API-Request-Failure-Reauthorize-Url";
const fail = code => {throw new Error(`SHOPIFY_SETUP_${code}`);};
function scopeList(values) {
  if (!Array.isArray(values) || values.length > 100 || values.some(v => typeof v !== "string"
    || !/^[a-z][a-z0-9_]{0,199}$/.test(v)) || new Set(values).size !== values.length) fail("SCOPE_LIST_INVALID");
  return [...values].sort();
}
function equalScopes(left, right) {return JSON.stringify(scopeList(left)) === JSON.stringify(scopeList(right));}

// Internal server composition. `verified` is an authenticated Shopify authority,
// never a form/JSON object. No new route, permission grant, config release or writer.
export function createShopifyProgressivePermissions({database, apiKey, requiredScopes = [], requestsEnabled = false,
  optionalScopesReleased = false, now = () => new Date(), maxElapsedMs = 120000} = {}) {
  if (!/^[a-f0-9]{32}$/.test(apiKey ?? "") || typeof requestsEnabled !== "boolean"
    || typeof optionalScopesReleased !== "boolean" || typeof now !== "function") fail("CONFIGURATION_INVALID");
  const required = scopeList(requiredScopes), installation = createShopifyRuntimeRepositories(database).installation;
  function capture(verified, signal) {
    const nativeAdmin = verified?.context?.admin, nativeScopes = verified?.context?.scopes, nativeRequest = nativeScopes?.request;
    if (typeof nativeAdmin?.graphql !== "function") fail("VERIFIED_CONTEXT_REQUIRED");
    const adminRead = nativeAdmin.graphql.bind(nativeAdmin);
    const owner = Object.freeze({...verified?.installationAuthority});
    const identity = {session: Object.freeze({...verified?.identity?.session}), shop: Object.freeze({...verified?.identity?.shop})};
    const context = {admin: {async graphql(query, options) {
      if (signal.aborted) fail("ABORTED");
      return adminRead(query, {...options, tries: 1, signal});
    }}};
    return {verified: {installationAuthority: owner, identity, context},
      nativeRequest: typeof nativeRequest === "function" ? nativeRequest.bind(nativeScopes) : null,
      nativeRevoke: typeof nativeScopes?.revoke === "function" ? nativeScopes.revoke.bind(nativeScopes) : null,
      nativeQuery: typeof nativeScopes?.query === "function" ? nativeScopes.query.bind(nativeScopes) : null};
  }
  async function run(verified, signal, operation) {
    return runIdentityReadDeadline({signal, timeoutMs: maxElapsedMs, run: async childSignal => {
      const captured = capture(verified, childSignal), initialTime = now();
      if (!(initialTime instanceof Date) || !Number.isFinite(initialTime.valueOf())) fail("TIME_INVALID");
      const started = initialTime.valueOf();
      function check() {
        const time = now();
        if (childSignal.aborted) fail("ABORTED");
        if (!(time instanceof Date) || !Number.isFinite(started) || !Number.isFinite(time.valueOf())
          || time.valueOf() < started || time.valueOf() - started > maxElapsedMs) fail("OBSERVATION_STALE");
      }
      async function read() {
        check();
        const result = await inspectShopifyIdentityPermissionScopes({verified: captured.verified, database, includeOrders: true, now});
        check(); return result;
      }
      async function current(context) {
        check();
        let active;
        try {active = await installation.resolveActive({shopId: context.shopId, shopDomain: context.shopDomain});}
        catch {fail("INSTALLATION_READ_FAILED");}
        check();
        if (active.status !== "active" || active.workspaceId !== context.workspaceId
          || active.installGeneration !== context.installGeneration) fail("INSTALLATION_CHANGED");
      }
      return operation({captured, read, current, check});
    }});
  }
  function project(result, outcome, nativeRequestInvoked = false) {
    const products = assessIdentityPermissionScopes({context: result.context, evidence: result.evidence, now});
    const base = products.scopeStatus === "observed_sufficient" ? "permission_ready"
      : products.scopeStatus === "observed_missing" ? "resume_setup" : "unknown";
    const orders = products.scopeStatus === "unknown" || result.assessment.scopeStatus === "unknown" ? "unknown"
      : base !== "permission_ready" ? "blocked_by_products"
      : result.assessment.scopeStatus === "observed_sufficient" ? "permission_ready" : "not_connected";
    return Object.freeze({outcome, nativeRequestInvoked, basePermissionState: base, ordersPermissionState: orders,
      ordersRequiredForBase: false, appInstallationId: result.evidence.appInstallationId,
      observedAt: result.evidence.observedAt, authorizesActivation: false, ordersDataAccessAuthorized: false,
      ordersScopeState: result.evidence.scopes.some(s => s === "read_orders" || s === "write_orders") ? "permission_ready" : "not_connected",
      overlapVerified: false, historyAccessAuthorized: false});
  }
  async function inspect({verified, signal} = {}) {
    return run(verified, signal, async ({read}) => project(await read(), "native_readback"));
  }
  async function request(feature, {verified, action, signal} = {}) {
    if (action === "cancel") return Object.freeze({outcome: "cancelled", nativeRequestInvoked: false, authorizesActivation: false});
    if (action !== "connect") fail("EXPLICIT_CONNECT_REQUIRED");
    if (!requestsEnabled) fail("REQUEST_DISABLED");
    if (!optionalScopesReleased) fail("OPTIONAL_SCOPES_RELEASE_REQUIRED");
    const target = feature === "products" ? "read_products" : "read_orders";
    return run(verified, signal, async ({captured, read, current, check}) => {
      if (!captured.nativeRequest) fail("NATIVE_SCOPE_REQUEST_REQUIRED");
      const before = await read(), state = project(before, "native_readback");
      if (state.basePermissionState === "unknown" || state.ordersPermissionState === "unknown") fail("PERMISSION_OBSERVATION_UNCONFIRMED");
      if (feature === "orders" && state.basePermissionState !== "permission_ready") {
        return project(before, "products_permission_required");
      }
      if (feature === "products" ? state.basePermissionState === "permission_ready" : state.ordersPermissionState === "permission_ready") {
        return project(before, "already_granted");
      }
      // Read deployed optional handles from the authenticated Admin client. A local
      // TOML candidate or a browser's granted-all result cannot substitute for this.
      await current(before.context);
      let response, body;
      try {
        response = await captured.verified.context.admin.graphql(SHOPIFY_OPTIONAL_SCOPES_QUERY, {tries: 1});
        if (response?.ok === false || typeof response?.json !== "function") fail("OPTIONAL_SCOPES_READ_FAILED");
        body = await response.json();
      } catch {fail("OPTIONAL_SCOPES_READ_FAILED");}
      check(); await current(before.context);
      if (!body || body.errors && (!Array.isArray(body.errors) || body.errors.length > 0)
        || body.data?.shop?.id !== before.context.shopId || body.data.shop.myshopifyDomain !== before.context.shopDomain
        || body.data.currentAppInstallation?.id !== before.evidence.appInstallationId) fail("OPTIONAL_SCOPES_RESPONSE_INVALID");
      if (!Array.isArray(body.data.app?.optionalAccessScopes)) fail("OPTIONAL_SCOPES_RESPONSE_INVALID");
      const declared = scopeList(body.data.app.optionalAccessScopes.map(s => s?.handle));
      if (!declared.includes(target)) fail("OPTIONAL_SCOPE_NOT_DEPLOYED");
      await current(before.context);
      try {
        const returned = await captured.nativeRequest([target]);
        check();
        if (returned !== undefined) fail("NATIVE_SCOPE_REQUEST_RESPONSE_INVALID");
      } catch (error) {
        check();
        // Installed AppStore SDK intentionally throws this exact App Bridge
        // response. Do not convert other HTTP/auth responses into a grant prompt.
        if (!(error instanceof Response)) fail("NATIVE_SCOPE_REQUEST_FAILED");
        let targetAddress;
        try {targetAddress = new URL(error.headers.get(REAUTHORIZE));} catch {fail("NATIVE_REDIRECT_INVALID");}
        if (error.status !== 401 || error.body !== null
          || [...error.headers.keys()].some(key => key.toLowerCase() !== REAUTHORIZE.toLowerCase())
          || targetAddress.protocol !== "https:" || targetAddress.hostname !== before.context.shopDomain
          || targetAddress.username || targetAddress.password || targetAddress.port || targetAddress.hash
          || targetAddress.pathname !== "/admin/oauth/install" || targetAddress.searchParams.get("client_id") !== apiKey
          || targetAddress.searchParams.getAll("client_id").length !== 1 || targetAddress.searchParams.getAll("optional_scopes").length !== 1
          || targetAddress.searchParams.get("optional_scopes") !== target || targetAddress.searchParams.getAll("scope").length !== 1
          || !equalScopes(targetAddress.searchParams.get("scope") === "" ? [] : targetAddress.searchParams.get("scope").split(","), required)
          || [...targetAddress.searchParams.keys()].some(key => !["client_id", "scope", "optional_scopes"].includes(key))) fail("NATIVE_REDIRECT_INVALID");
        await current(before.context);
        throw error; // Preserve SDK signalling unchanged; it is not a consent receipt.
      }
      const after = await read();
      if (after.evidence.appInstallationId !== before.evidence.appInstallationId) fail("INSTALLATION_CHANGED");
      return project(after, "native_readback", true);
    });
  }
  async function revoke(feature, {verified, action, signal} = {}) {
    const target = feature === "products" ? "read_products" : "read_orders";
    const write = feature === "products" ? "write_products" : "write_orders";
    const label = feature === "products" ? "PRODUCTS" : "ORDERS";
    const missing = state => feature === "products" ? state.basePermissionState === "resume_setup" : state.ordersScopeState === "not_connected";
    if (action === "cancel") return Object.freeze({outcome: "cancelled", nativeRequestInvoked: false, authorizesActivation: false});
    if (action !== "revoke") fail("EXPLICIT_REVOKE_REQUIRED");
    if (!requestsEnabled || !optionalScopesReleased) fail("REVOKE_DISABLED");
    if (required.includes(target) || required.includes(write)) fail(`${label}_REQUIRED`);
    return run(verified, signal, async ({captured, read, current, check}) => {
      const before = await read();
      const state = project(before, "native_readback");
      if (missing(state)) return state;
      if ((feature === "products" ? state.basePermissionState : state.ordersScopeState) !== "permission_ready") fail("PERMISSION_OBSERVATION_UNCONFIRMED");
      if (before.evidence.scopes.includes(write)) fail(`${label}_WRITE_ACCESS_PRESENT`);
      if (!captured.nativeRevoke || !captured.nativeQuery) fail("NATIVE_SCOPE_REVOKE_REQUIRED");
      await current(before.context);
      let detail;
      try { detail = await captured.nativeQuery(); } catch { fail("REVOKE_CONFIGURATION_READ_FAILED"); }
      check(); await current(before.context);
      const nativeRequired = scopeList(detail?.required), nativeOptional = scopeList(detail?.optional);
      const nativeGranted = scopeList(detail?.granted);
      if (nativeRequired.includes(target) || nativeRequired.includes(write)) fail(`${label}_REQUIRED`);
      if (!nativeOptional.includes(target) || !nativeGranted.includes(target)
        || nativeGranted.includes(write)) fail("REVOKE_CONFIGURATION_INVALID");
      await current(before.context);
      let receipt;
      try { receipt = await captured.nativeRevoke([target]); } catch { fail("NATIVE_SCOPE_REVOKE_FAILED"); }
      check();
      if (!receipt || !equalScopes(receipt.revoked, [target])) fail("NATIVE_SCOPE_REVOKE_RESPONSE_INVALID");
      await current(before.context);
      const after = await read();
      await current(before.context);
      if (after.evidence.appInstallationId !== before.evidence.appInstallationId) fail("INSTALLATION_CHANGED");
      if (!missing(project(after, "native_readback"))) fail("REVOKE_UNCONFIRMED");
      // Each removal preserves every other grant, including the other Shopify permission.
      if (!equalScopes(after.evidence.scopes, before.evidence.scopes.filter(s => s !== target))) fail("REVOKE_GRANTS_CHANGED");
      return project(after, "native_readback");
    });
  }
  return Object.freeze({inspect, afterReturn: inspect,
    revokeProducts: args => revoke("products", args), revokeOrders: args => revoke("orders", args),
    requestProducts: args => request("products", args), requestOrders: args => request("orders", args)});
}
