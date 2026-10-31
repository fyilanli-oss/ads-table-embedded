import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";
import {createRequestHandler} from "react-router";
import {boundary} from "@shopify/shopify-app-react-router/server";
import {createPermissionSettings, PERMISSION_SETTINGS_AVAILABILITY} from "../app/lib/shopify/permission-settings.server.js";
import {permissionAuthorizationTarget, permissionResponseMatches} from "../app/lib/ui/permission-settings-response.js";
import {createPermissionExplanationFlow} from "../app/lib/ui/permission-explanation-flow.js";
import {normalizeKlaviyoEstimatedSpend} from "../app/lib/oauth/klaviyo-oauth-runtime.server.js";
import {readPermissionSetupRelease} from "../app/lib/shopify/permission-release.server.js";

const verified = {context: {}, installationAuthority: {workspaceId: "synthetic-workspace", installGeneration: 2}};
const availability = Object.fromEntries(Object.keys(PERMISSION_SETTINGS_AVAILABILITY).map(k => [k, true]));

test("Klaviyo status keeps explicit account confirmation even for one account without beginning OAuth", async () => {
  for (const [accounts, stage] of [
    [[{id: "verified"}], "select_account"],
    [[{id: "one"}, {id: "two"}], "select_account"],
    [[], "select_account"],
  ]) {
    let reads = 0;
    const settings = createPermissionSettings({providerRuntime: () => ({
      inspect: async () => { reads++; return {state: "pending_account_selection", accounts}; },
      oauthBoundary: {begin: () => assert.fail("must not begin")},
    })});
    assert.deepEqual(await settings.status({feature: "klaviyo", verified}), {kind: "status", feature: "klaviyo", stage});
    assert.equal(reads, 1);
  }
});

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
        return {setupResumeAction: "reporting_selected", setupComplete: false, credentialId: "private",
          connectionId: "displayed-connection", connectionVersion: 7, reportingAccountId: "account-1", accounts: []};
      }},
    })});
    assert.deepEqual(await settings.status({feature, verified}), {kind: "status", feature, stage: "reporting_selected"});
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

function loadRoute({authenticate = async () => verified, providerRuntime = () => assert.fail(), release, shopify = {}} = {}) {
  const sourceLocation = new URL("../app/routes/_admin.settings.tsx", import.meta.url);
  const require = createRequire(sourceLocation);
  const source = readFileSync(sourceLocation, "utf8");
  const output = ts.transpileModule(source, {compilerOptions: {jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  const imported = id => {
    if (id === "../shopify.server") return {authenticate: {admin: authenticate}, database: {}, providerTokenVault: {}, permissionSetup: shopify, permissionRelease: release};
    if (id === "../components/use-permission-settings") return {usePermissionSettings: () => assert.fail()};
    if (id === "../components/product-access-removal") return {ProductAccessRemoval: () => assert.fail()};
    if (id.endsWith("/shopify-route-authority.server.js")) return {resolveShopifyRouteAuthority: async ({request, authenticateAdmin}) => authenticateAdmin(request)};
    if (id.endsWith("/google-oauth-runtime.server.js")) return {createGoogleOAuthRuntime: providerRuntime};
    if (id.endsWith("/meta-oauth-runtime.server.js")) return {createMetaOAuthRuntime: providerRuntime};
    if (id.endsWith("/klaviyo-oauth-runtime.server.js")) return {createKlaviyoOAuthRuntime: providerRuntime, normalizeKlaviyoEstimatedSpend};
    return require(id);
  };
  new Function("require", "exports", output)(imported, exports);
  return exports;
}
const formRequest = (fields) => new Request("https://embedded.adstable.app/settings", {
  method: "POST", body: new URLSearchParams(fields),
});
const requestId = "00000000-0000-4000-8000-000000000001";

test("actual Settings action passes the server release into the native combined runtime exactly once", async () => {
  for (const [feature, key, authorizationUrl] of [
    ["google_ads", "ADSTABLE_GOOGLE_IDENTITY_OAUTH_ENABLED", "https://accounts.google.com/o/oauth2/v2/auth"],
    ["meta", "ADSTABLE_META_IDENTITY_OAUTH_ENABLED", "https://www.facebook.com/v26.0/dialog/oauth"],
  ]) {
    let starts = 0; const options = [];
    const route = loadRoute({release: readPermissionSetupRelease({[key]: "true"}), providerRuntime: input => {
      options.push(input);
      return {beginCombinedSetup: async () => { starts++; return {permissionProfile: "identity_v1", authorizationUrl}; }};
    }});
    const result = await route.action({request: formRequest({intent: "permission_connect", feature, requestId})});
    assert.deepEqual(result, {kind: "authorization", feature, authorizationUrl, requestId});
    assert.equal(starts, 1); assert.equal(options.length, 1);
    assert.equal(options[0].identityAuthorizationEnabled, true);
  }
});

test("actual Settings action authenticates before reading form or constructing provider runtimes", async () => {
  let formRead = false;
  const route = loadRoute({authenticate: async () => { throw new Error("unauthorized"); }});
  await assert.rejects(route.action({request: {formData: async () => { formRead = true; }}}), /unauthorized/);
  assert.equal(formRead, false);
});

test("actual Settings action cannot be forced to open a closed server gate through form flags", async () => {
  const route = loadRoute();
  for (const intent of ["permission_connect"]) {
    const reply = await route.action({request: formRequest({intent, feature: "google_ads", requestId,
      identityAuthorizationEnabled: "true", permissionProfile: "reporting_v1"})});
    assert.deepEqual(reply, {kind: "unavailable", feature: "google_ads", requestId});
  }
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
  for (const intent of ["permission_connect", "permission_status", "permission_revoke_products", "permission_select_accounts", "permission_select_reporting"]) {
    assert.equal(route.shouldRevalidate({formData: new URLSearchParams({intent}), defaultShouldRevalidate: true}), false);
  }
  assert.equal(route.shouldRevalidate({formData: new URLSearchParams({intent: "select"}), defaultShouldRevalidate: true}), true);
  for (const code of ["KLAVIYO_ESTIMATED_SPEND_INVALID", "KLAVIYO_SETUP_FAILED"]) {
    assert.equal(route.shouldRevalidate({formData: new URLSearchParams({intent: "complete_klaviyo"}),
      actionResult: {ok: false, provider: "klaviyo", code}, defaultShouldRevalidate: true}), false);
  }
});

test("actual Settings loader keeps pending broader grants in bound account selection", async () => {
  const route = loadRoute({providerRuntime: () => ({inspect: async () => ({state: "pending_account_selection",
    pending: {scopes: ["catalog_management", "https://www.googleapis.com/auth/content"]},
    accounts: [{id: "123", name: "Shop", currency: "USD", timezone: "UTC"}],
  })})});
  const result = await route.loader({request: new Request("https://embedded.adstable.app/settings")});
  assert.equal(result.view, "combined");
  assert.equal(result.meta.view, "combined");
  assert.equal(result.permissionAvailability.google_ads, false);
  assert.equal(result.permissionAvailability.meta, false);
});

test("removed catalog actions reject before constructing any provider runtime", async () => {
  let calls = 0;
  const route = loadRoute({providerRuntime: () => {calls++; assert.fail("Removed action must do no I/O");}});
  for (const intent of ["permission_discover_assets", "permission_verify_assets"]) {
    const reply = await route.action({request: formRequest({intent, feature: "meta", requestId,
      merchantId: "99", businessId: "88", catalogId: "77"})});
    assert.equal(reply.status, 400);
  }
  assert.equal(calls, 0);
});

test("single and multiple connected accounts return to the existing reporting view without catalog work", async () => {
  for (const count of [1, 3]) {
    let reads = 0;
    const accounts = Array.from({length: count}, (_, i) => ({id: String(123 + i), name: `Shop ${i}`,
      currency: "USD", timezone: "UTC"}));
    const route = loadRoute({providerRuntime: () => ({inspect: async () => {
      reads++;
      return {state: "connected", connection: {reportingAccountId: accounts[0].id, accounts,
        grantedScopes: ["catalog_management", "https://www.googleapis.com/auth/content"]}};
    }})});
    const result = await route.loader({request: new Request("https://embedded.adstable.app/settings")});
    assert.equal(result.view, "connected");
    assert.equal(result.meta.view, "connected");
    assert.equal(result.reportingAccountId, accounts[0].id);
    assert.equal(result.meta.reportingAccountId, accounts[0].id);
    assert.equal(result.accounts.length, count);
    assert.equal(reads, 3); // Existing Google/Meta/Klaviyo inspect only; no asset reader exists in fixture.
  }
});

// Use the real production Router Single Fetch pipeline, not only boundary.headers
// in isolation: a leaf action error has its own header aggregation in .data requests.
function settingsHttpHandler(route) {
  return createRequestHandler({
    entry: {module: {default: () => assert.fail("data request must not render a document"),
      handleError: () => assert.fail("unexpected Router server error")}},
    routes: {
      root: {id: "root", path: "", module: {default: () => null}},
      "routes/_admin": {id: "routes/_admin", parentId: "root", module: {
        default: () => null, ErrorBoundary: () => null, headers: boundary.headers,
      }},
      "routes/_admin.settings": {id: "routes/_admin.settings", parentId: "routes/_admin",
        path: "settings", module: {...route, loader: () => null}},
    },
    assets: {version: "synthetic", routes: {}, entry: {module: "synthetic", imports: []}},
    publicPath: "/", assetsBuildDirectory: "synthetic", basename: "/", future: {},
    ssr: true, isSpaMode: false, prerender: [],
    routeDiscovery: {mode: "initial", manifestPath: "/__manifest"},
  }, "production");
}
const reauthorizeHeader = "X-Shopify-API-Request-Failure-Reauthorize-Url";
const shopifyRelease = readPermissionSetupRelease({ADSTABLE_SHOPIFY_PERMISSION_REQUESTS_ENABLED: "true",
  ADSTABLE_SHOPIFY_OPTIONAL_SCOPES_RELEASED: "true"});
const settingsDataRequest = feature => new Request("https://embedded.adstable.app/settings.data", {
  method: "POST", body: new URLSearchParams({intent: "permission_connect", feature, requestId}),
});

test("real Settings .data response preserves the SDK permission redirect for Products and Orders", async () => {
  for (const [feature, method, scope] of [["shopify_products", "requestProducts", "read_products"],
    ["shopify_orders", "requestOrders", "read_orders"]]) {
    let calls = 0;
    const address = `https://example.myshopify.com/admin/oauth/install?client_id=synthetic&scope=&optional_scopes=${scope}`;
    const route = loadRoute({release: shopifyRelease, shopify: {[method]: async () => {
      calls++; throw new Response(null, {status: 401, headers: {[reauthorizeHeader]: address}});
    }}});
    const response = await settingsHttpHandler(route)(settingsDataRequest(feature));
    assert.equal(calls, 1);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get(reauthorizeHeader), address,
      "the leaf Settings .data response must deliver the SDK redirect to App Bridge");
    assert.match(response.headers.get("content-type"), /text\/x-script/);
    await response.text();
  }
});

test("Settings .data never invents a redirect or permission success for ordinary auth failures", async () => {
  for (const status of [401, 403]) {
    const route = loadRoute({authenticate: async () => {throw new Response(null, {status});}});
    const response = await settingsHttpHandler(route)(settingsDataRequest("shopify_products"));
    assert.equal(response.status, status);
    assert.equal(response.headers.get(reauthorizeHeader), null);
    await response.text();
  }
});

test("Settings .data keeps normal permission status as data without redirecting or re-requesting", async () => {
  let calls = 0;
  const route = loadRoute({release: shopifyRelease, shopify: {requestProducts: async () => {
    calls++; return {basePermissionState: "permission_ready", ordersPermissionState: "not_connected"};
  }}});
  const response = await settingsHttpHandler(route)(settingsDataRequest("shopify_products"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get(reauthorizeHeader), null);
  assert.equal(calls, 1);
  const body = await response.text();
  assert.ok(body.includes("review_setup"));
});

test("actual Settings loader reads fresh Products permission once without starting OAuth", async () => {
  for (const [nativeState, expected] of [["permission_ready", "ready"], ["resume_setup", "missing"], ["failure", "unknown"]]) {
    let reads = 0;
    const owner = {...verified, identity: {shop: {shopId: "gid://shopify/Shop/123"}}};
    const route = loadRoute({release: shopifyRelease, authenticate: async () => owner,
      providerRuntime: () => ({inspect: async () => ({state: "disconnected"})}),
      shopify: {afterReturn: async ({verified: current}) => {
        assert.equal(current, owner); reads++;
        if (nativeState === "failure") throw new Error("private detail");
        return {basePermissionState: nativeState};
      }, requestProducts: () => assert.fail("loader must never request consent")},
    });
    const reply = await route.loader({request: new Request("https://embedded.adstable.app/settings")});
    assert.equal(reply.shopifyProductAccess, expected);
    assert.equal(reply.shopifyPermissionOwner, "gid://shopify/Shop/123");
    assert.equal(reads, 1);
  }
});

test("actual Settings Products removal uses only authenticated fixed runtime and sanitizes failure", async () => {
  for (const failure of [false, true]) {
    let mutations = 0;
    const route = loadRoute({release: shopifyRelease, shopify: {revokeProducts: async args => {
      mutations++; assert.equal(args.verified, verified); assert.equal(args.action, "revoke");
      if (failure) throw Error("SECRET_TOKEN");
      return {basePermissionState: "resume_setup"};
    }}});
    const reply = await route.action({request: formRequest({intent: "permission_revoke_products", feature: "shopify_products", requestId, scopes: "read_orders"})});
    assert.deepEqual(reply, failure ? {kind: "unknown", feature: "shopify_products", requestId}
      : {kind: "status", feature: "shopify_products", stage: "request_permissions", requestId});
    assert.equal(mutations, 1);
    const wrong = await route.action({request: formRequest({intent: "permission_revoke_products", feature: "shopify_orders", requestId})});
    assert.equal(wrong.kind, "unknown"); assert.equal(mutations, 1);
  }
  const closed = loadRoute({shopify: {revokeProducts: () => assert.fail()}});
  assert.equal((await closed.action({request: formRequest({intent: "permission_revoke_products", feature: "shopify_products", requestId})})).kind, "unavailable");
});
