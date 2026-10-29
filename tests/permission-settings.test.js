import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";
import {createPermissionSettings, PERMISSION_SETTINGS_AVAILABILITY} from "../app/lib/shopify/permission-settings.server.js";
import {permissionAuthorizationTarget, permissionResponseMatches} from "../app/lib/ui/permission-settings-response.js";
import {createPermissionExplanationFlow} from "../app/lib/ui/permission-explanation-flow.js";

const verified = {context: {}, installationAuthority: {workspaceId: "synthetic-workspace", installGeneration: 2}};
const availability = Object.fromEntries(Object.keys(PERMISSION_SETTINGS_AVAILABILITY).map(k => [k, true]));

for (const feature of ["shopify_products", "shopify_orders", "google_ads", "meta"]) {
  test(`${feature}: deployed closed gate prevents every runtime read and request`, async () => {
    const settings = createPermissionSettings({shopify: new Proxy({}, {get: () => assert.fail()}),
      providerRuntime: () => assert.fail()});
    assert.deepEqual(await settings.connect({feature, verified, action: "connect"}), {kind: "unavailable", feature});
    assert.deepEqual(await settings.status({feature, verified}), {kind: "unavailable", feature});
  });
}

for (const feature of ["google_ads", "meta"]) {
  test(`${feature}: fixed entry selects combined identity profile and never reporting-only begin`, async () => {
    const calls = [];
    const settings = createPermissionSettings({availability, providerRuntime: id => {
      assert.equal(id, feature);
      return {oauthBoundary: {begin: () => assert.fail()}, beginCombinedSetup: async args => {
        calls.push(args); return {permissionProfile: "identity_v1", authorizationUrl: "synthetic-auth-target", access_token: "discard"};
      }};
    }});
    assert.deepEqual(await settings.connect({feature, verified, action: "connect"}),
      {kind: "authorization", feature, authorizationUrl: "synthetic-auth-target"});
    assert.deepEqual(calls, [{installationAuthority: verified.installationAuthority}]);
  });

  test(`${feature}: status projects the runtime stage without exposing tokens or performing another begin`, async () => {
    let calls = 0;
    const settings = createPermissionSettings({availability, providerRuntime: () => ({
      beginCombinedSetup: () => assert.fail(), combinedSetup: {inspect: async args => {
        calls++; assert.equal(args.installationAuthority, verified.installationAuthority);
        return {setupResumeAction: "verify_assets", setupComplete: false, credentialId: "private"};
      }},
    })});
    assert.deepEqual(await settings.status({feature, verified}), {kind: "status", feature, stage: "verify_assets"});
    assert.equal(calls, 1);
  });
}

test("Shopify fixed Products/Orders methods preserve authenticated context and independent state", async () => {
  const calls = [];
  const settings = createPermissionSettings({availability, providerRuntime: () => assert.fail(), shopify: {
    requestProducts: async args => { calls.push(["products", args]); return {basePermissionState: "permission_ready", ordersPermissionState: "unknown"}; },
    requestOrders: async args => { calls.push(["orders", args]); return {basePermissionState: "permission_ready", ordersPermissionState: "not_connected"}; },
    afterReturn: async () => ({basePermissionState: "unknown", ordersPermissionState: "unknown"}),
  }});
  assert.deepEqual(await settings.connect({feature: "shopify_products", verified, action: "connect"}),
    {kind: "status", feature: "shopify_products", stage: "review_setup"});
  assert.deepEqual(await settings.connect({feature: "shopify_orders", verified, action: "connect"}),
    {kind: "status", feature: "shopify_orders", stage: "request_permissions"});
  assert.deepEqual(calls, [["products", {verified, action: "connect"}], ["orders", {verified, action: "connect"}]]);
  assert.deepEqual(await settings.status({feature: "shopify_products", verified}), {kind: "unknown", feature: "shopify_products"});
});

test("Orders resume returns to Products first when base access is missing", async () => {
  const settings = createPermissionSettings({availability, shopify: {
    afterReturn: async () => ({basePermissionState: "resume_setup", ordersPermissionState: "blocked_by_products"}),
  }});
  assert.deepEqual(await settings.status({feature: "shopify_orders", verified}),
    {kind: "status", feature: "shopify_orders", stage: "products_required"});
});

test("Klaviyo keeps the existing five scopes and treats pending account/cost setup as Resume, never another begin", async () => {
  const calls = [];
  const runtime = {
    config: {clientId: "synthetic-client", redirectUri: "https://embedded.adstable.app/auth/klaviyo/callback"},
    oauthBoundary: {begin: async args => { calls.push(args); return {state: "synthetic-state", pkceChallenge: "p".repeat(43)}; }},
    inspect: async () => ({state: "pending_account_selection", accounts: [{id: "private-account"}]}),
  };
  const settings = createPermissionSettings({providerRuntime: () => runtime});
  const result = await settings.connect({feature: "klaviyo", verified, action: "connect"});
  const target = new URL(result.authorizationUrl);
  assert.equal(target.searchParams.get("scope"), "accounts:read campaigns:read flows:read events:read metrics:read");
  assert.deepEqual(calls, [{installationAuthority: verified.installationAuthority, provider: "klaviyo"}]);
  assert.deepEqual(await settings.status({feature: "klaviyo", verified}), {kind: "status", feature: "klaviyo", stage: "select_account"});
  assert.equal(calls.length, 1);
});

test("invalid feature, absent authority and cancel are rejected without creating a provider", async () => {
  const settings = createPermissionSettings({providerRuntime: () => assert.fail()});
  await assert.rejects(settings.connect({feature: "unknown", verified, action: "connect"}));
  await assert.rejects(settings.connect({feature: "klaviyo", verified: {}, action: "connect"}));
  await assert.rejects(settings.connect({feature: "klaviyo", verified, action: "cancel"}));
});

test("permission/read errors propagate once with no alternate begin or retry", async () => {
  let calls = 0;
  const settings = createPermissionSettings({availability, providerRuntime: () => ({
    beginCombinedSetup: () => { calls++; throw new Error("native-failure"); },
  })});
  await assert.rejects(settings.connect({feature: "meta", verified, action: "connect"}), /native-failure/);
  assert.equal(calls, 1);
});

test("checking another feature cannot release an unknown pending Connect", async () => {
  const flow = createPermissionExplanationFlow({canRequest: () => true, request: () => { throw new Error(); }});
  const {session} = flow.open("klaviyo");
  flow.connect(session, () => {});
  await flow.afterHide(session);
  assert.equal(flow.statusObserved(session, "shopify_products"), false);
  assert.equal(flow.open("klaviyo"), null);
  assert.equal(flow.statusObserved(session, "klaviyo"), true);
  assert.ok(flow.open("klaviyo"));
});

test("native targets are provider-bound and stale/mismatched transport replies are rejected", () => {
  const pending = {requestId: "session-1", feature: "klaviyo"};
  const valid = {kind: "authorization", feature: "klaviyo", requestId: "session-1",
    authorizationUrl: "https://www.klaviyo.com/oauth/authorize?state=synthetic"};
  assert.equal(permissionResponseMatches(valid, pending), true);
  for (const invalid of [{...valid, requestId: "session-0"}, {...valid, feature: "meta"},
    {...valid, authorizationUrl: "https://evil.example/oauth/authorize"}, {...valid, kind: "connected"}]) {
    assert.equal(permissionResponseMatches(invalid, pending), false);
  }
  assert.equal(permissionAuthorizationTarget("meta", valid.authorizationUrl), null);
  assert.equal(permissionAuthorizationTarget("klaviyo", "https://secret@www.klaviyo.com/oauth/authorize"), null);
});

function loadRoute({authenticate = async () => verified, providerRuntime = () => assert.fail()} = {}) {
  const sourceLocation = new URL("../app/routes/_admin.settings.tsx", import.meta.url);
  const require = createRequire(sourceLocation);
  const source = readFileSync(sourceLocation, "utf8");
  const output = ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  const imported = id => {
    if (id === "../shopify.server") return {authenticate: {admin: authenticate}, database: {}, providerTokenVault: {}, permissionSetup: {}};
    if (id === "../components/use-permission-settings") return {usePermissionSettings: () => assert.fail()};
    if (id.endsWith("/shopify-route-authority.server.js")) return {resolveShopifyRouteAuthority: async ({request, authenticateAdmin}) => authenticateAdmin(request)};
    if (id.endsWith("/google-oauth-runtime.server.js")) return {createGoogleOAuthRuntime: providerRuntime};
    if (id.endsWith("/meta-oauth-runtime.server.js")) return {createMetaOAuthRuntime: providerRuntime};
    if (id.endsWith("/klaviyo-oauth-runtime.server.js")) return {createKlaviyoOAuthRuntime: providerRuntime};
    return require(id);
  };
  new Function("require", "exports", output)(imported, exports);
  return exports;
}
const formRequest = (fields) => new Request("https://embedded.adstable.app/settings", {
  method: "POST", body: new URLSearchParams(fields),
});
const requestId = "00000000-0000-4000-8000-000000000001";

test("actual Settings action authenticates before reading form or constructing provider runtimes", async () => {
  let formRead = false;
  const route = loadRoute({authenticate: async () => { throw new Error("unauthorized"); }});
  await assert.rejects(route.action({request: {formData: async () => { formRead = true; }}}), /unauthorized/);
  assert.equal(formRead, false);
});

test("actual Settings action cannot be forced to open a closed server gate through form flags", async () => {
  const route = loadRoute();
  const reply = await route.action({request: formRequest({intent: "permission_connect", feature: "google_ads", requestId,
    identityAuthorizationEnabled: "true", permissionProfile: "reporting_v1"})});
  assert.deepEqual(reply, {kind: "unavailable", feature: "google_ads", requestId});
});

test("actual Settings action rejects an invalid feature and preserves authentication Responses", async () => {
  const route = loadRoute();
  const reply = await route.action({request: formRequest({intent: "permission_connect", feature: "__proto__", requestId})});
  assert.equal(reply.status, 400);
  const native = new Response(null, {status: 401, headers: {"X-Native-Test": "preserved"}});
  const blocked = loadRoute({authenticate: () => { throw native; }});
  await assert.rejects(blocked.action({request: formRequest({})}), error => error === native);
});

test("actual Settings action returns unknown without raw errors and never retries a failed Klaviyo begin", async () => {
  let attempts = 0;
  const route = loadRoute({providerRuntime: () => ({oauthBoundary: {begin: async () => {
    attempts++; throw new Error("private-error-body");
  }}})});
  assert.deepEqual(await route.action({request: formRequest({intent: "permission_connect", feature: "klaviyo", requestId})}),
    {kind: "unknown", feature: "klaviyo", requestId});
  assert.equal(attempts, 1);
});

test("permission actions do not implicitly rerun existing provider loaders", () => {
  const route = loadRoute();
  for (const intent of ["permission_connect", "permission_status"]) {
    assert.equal(route.shouldRevalidate({formData: new URLSearchParams({intent}), defaultShouldRevalidate: true}), false);
  }
  assert.equal(route.shouldRevalidate({formData: new URLSearchParams({intent: "select"}), defaultShouldRevalidate: true}), true);
});
