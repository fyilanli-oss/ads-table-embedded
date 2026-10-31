import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {readPermissionSetupRelease} from "../app/lib/shopify/permission-release.server.js";
import {createPermissionSettings} from "../app/lib/shopify/permission-settings.server.js";

const verified = {context: {}, installationAuthority: {workspaceId: "synthetic", installGeneration: 1}};
test("no release, malformed values or browser-like aliases cannot enable new authorization", async () => {
  for (const input of [{}, {google_ads: true, meta: true},
    {ADSTABLE_GOOGLE_IDENTITY_OAUTH_ENABLED: "TRUE", ADSTABLE_META_IDENTITY_OAUTH_ENABLED: "1"}]) {
    const release = readPermissionSetupRelease(input);
    assert.deepEqual(release.availability, {google_ads: false, meta: false, shopify_products: false, shopify_orders: false, klaviyo: true});
    const settings = createPermissionSettings({availability: release.availability,
      providerRuntime: () => assert.fail("no runtime"), shopify: {requestProducts: () => assert.fail("no native request")}});
    for (const feature of ["google_ads", "meta", "shopify_products", "shopify_orders"]) {
      assert.deepEqual(await settings.connect({feature, verified, action: "connect"}), {kind: "unavailable", feature});
      assert.ok(release.unavailableReasons[feature]);
    }
  }
});
test("server release controls each provider independently and is captured immutably", () => {
  const env = {ADSTABLE_GOOGLE_IDENTITY_OAUTH_ENABLED: "true"};
  const release = readPermissionSetupRelease(env);
  env.ADSTABLE_META_IDENTITY_OAUTH_ENABLED = "true";
  assert.equal(release.availability.google_ads, true);
  assert.equal(release.availability.meta, false);
  assert.equal(release.unavailableReasons.google_ads, undefined);
  assert.ok(Object.isFrozen(release.availability));
});
test("Shopify needs both request release and confirmed optional-scope release; Orders stays explicit", async () => {
  for (const env of [{ADSTABLE_SHOPIFY_PERMISSION_REQUESTS_ENABLED: "true"}, {ADSTABLE_SHOPIFY_OPTIONAL_SCOPES_RELEASED: "true"}]) {
    assert.equal(readPermissionSetupRelease(env).availability.shopify_products, false);
  }
  const release = readPermissionSetupRelease({ADSTABLE_SHOPIFY_PERMISSION_REQUESTS_ENABLED: "true", ADSTABLE_SHOPIFY_OPTIONAL_SCOPES_RELEASED: "true"});
  const calls = [];
  const result = {basePermissionState: "permission_ready", ordersPermissionState: "not_connected"};
  const settings = createPermissionSettings({availability: release.availability, shopify: {
    requestProducts: async () => {calls.push("products"); return result;},
    requestOrders: async () => {calls.push("orders"); return result;},
  }});
  assert.equal((await settings.connect({feature: "shopify_products", verified, action: "connect"})).stage, "review_setup");
  assert.deepEqual(calls, ["products"]);
  assert.equal((await settings.connect({feature: "shopify_orders", verified, action: "connect"})).stage, "request_permissions");
  assert.deepEqual(calls, ["products", "orders"]);
});
test("Settings and both callbacks consume the same server-owned provider release; no selector or grant is added", () => {
  for (const [path, provider] of [["app/routes/auth.google-ads.callback.ts", "google_ads"], ["app/routes/auth.meta.callback.ts", "meta"]]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes(`identityAuthorizationEnabled: permissionRelease?.availability.${provider} === true`));
  }
  const source = readFileSync("app/routes/_admin.settings.tsx", "utf8");
  for (const provider of ["google_ads", "meta"]) assert.ok(source.includes(`identityAuthorizationEnabled: permissionRelease?.availability.${provider} === true`));
  assert.match(source, /availability: permissionRelease\?\.availability \?\? PERMISSION_SETTINGS_AVAILABILITY/);
  const native = readFileSync("app/lib/shopify/progressive-permissions.server.js", "utf8");
  assert.match(native, /OPTIONAL_SCOPE_NOT_DEPLOYED/);
  assert.match(native, /feature === "orders" && state.basePermissionState !== "permission_ready"/);
});
