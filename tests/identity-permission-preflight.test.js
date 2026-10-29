import test from "node:test";
import assert from "node:assert/strict";
import {identityPermissionRequirements as requirements, assessIdentityPermissionScopes as assess,
  GOOGLE_MERCHANT_OAUTH_SCOPE, META_CATALOG_PERMISSION_DEPENDENCIES} from "../app/lib/oauth/identity-permission-preflight.server.js";
import {readShopifyPermissionScopes, SHOPIFY_PERMISSION_SCOPES_QUERY} from "../app/lib/shopify/permission-scopes.server.js";

const now = () => new Date("2026-10-27T12:00:00.000Z");
const uuid = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const sources = {google_ads: "google_oauth_native_scope_response", meta: "meta_token_inspection_native_scopes",
  klaviyo: "klaviyo_oauth_native_scope_response", shopify: "shopify_current_app_installation"};
function context(provider = "google_ads") {
  return {provider, workspaceId: uuid, installGeneration: 1, shopId: "gid://shopify/Shop/1",
    shopDomain: "example.myshopify.com", ...(provider === "shopify" ? {} : {connectionId: uuid, accountId: "123"})};
}
function evidence(provider = "google_ads") {
  return {source: sources[provider], context: context(provider), observedAt: now().toISOString(),
    complete: true, scopes: [...requirements({provider}).scopes]};
}
const check = (value, provider = "google_ads", extra = {}) => assess({context: context(provider), evidence: value, now, ...extra});

test("requirements include existing reporting scopes and the Merchant addition, not an invented readonly content scope", () => {
  assert.deepEqual(requirements({provider: "google_ads"}).scopes,
    ["https://www.googleapis.com/auth/adwords", GOOGLE_MERCHANT_OAUTH_SCOPE]);
  assert.equal(requirements({provider: "google_ads"}).permissionsMayAllowWrites, true);
  assert.equal(requirements({provider: "meta"}).permissionsMayAllowWrites, true);
  assert.equal(requirements({provider: "google_ads"}).usage, "read_only");
});
test("Meta catalog requirements retain ads_read and the documented dependency closure", () => {
  assert.deepEqual(requirements({provider: "meta"}).scopes,
    ["ads_read", "catalog_management", "business_management", "pages_read_engagement", "pages_show_list"]);
  for (const values of Object.values(META_CATALOG_PERMISSION_DEPENDENCIES)) {
    for (const dependency of values) assert.ok(requirements({provider: "meta"}).scopes.includes(dependency));
  }
});
test("Klaviyo identity path does not expand current five OAuth scopes", () => {
  assert.deepEqual(requirements({provider: "klaviyo"}).scopes,
    ["accounts:read", "campaigns:read", "flows:read", "events:read", "metrics:read"]);
});
test("Shopify historical and MarketingEvent access are explicit independent selections", () => {
  assert.deepEqual(requirements({provider: "shopify"}).scopes, ["read_products"]);
  const historical = requirements({provider: "shopify", includeOrders: true, includeOrderHistory: true});
  assert.deepEqual(historical.scopes, ["read_products", "read_orders", "read_all_orders"]);
  assert.ok(historical.additionalChecks.includes("shopify_all_orders_application_approval_and_historical_read"));
  const marketing = requirements({provider: "shopify", includeOrders: true, includeMarketingEvents: true});
  assert.deepEqual(marketing.scopes, ["read_products", "read_orders", "read_marketing_events"]);
  assert.ok(marketing.additionalChecks.includes("shopify_marketing_event_visibility_and_journey_read"));
  assert.ok(!historical.scopes.some(s => s.startsWith("write_") || s === "read_customers"));
});
test("invalid feature/provider inputs cannot silently select a smaller permission set", () => {
  for (const args of [{provider: "google"}, {provider: "shopify", includeOrderHistory: "true"},
    {provider: "shopify", includeMarketingEvents: null}, {provider: "meta", includeOrderHistory: true},
    {provider: "shopify", includeOrders: "true"}, {provider: "shopify", includeOrders: null},
    {provider: "shopify", includeOrderHistory: true}, {provider: "google_ads", includeOrders: true}]) {
    assert.throws(() => requirements(args));
  }
});
for (const provider of Object.keys(sources)) {
  test(`${provider}: absent evidence is unknown, not a verified missing grant`, () => {
    const r = check(null, provider);
    assert.equal(r.scopeStatus, "unknown"); assert.equal(r.missingScopes, null);
  });
  test(`${provider}: scopes alone cannot close app review, asset access or activation`, () => {
    const input = evidence(provider); const before = JSON.stringify(input);
    const r = check(input, provider);
    assert.equal(r.scopeStatus, "observed_sufficient"); assert.deepEqual(r.missingScopes, []);
    assert.equal(r.authorizesActivation, false); assert.ok(r.additionalChecks.length > 0);
    assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.satisfiedBy));
    assert.equal(JSON.stringify(input), before);
  });
  test(`${provider}: an explicitly empty complete grant list is observed missing`, () => {
    const input = evidence(provider); input.scopes = [];
    const r = check(input, provider);
    assert.equal(r.scopeStatus, "observed_missing"); assert.deepEqual(r.missingScopes, requirements({provider}).scopes);
  });
}
test("Google Ads-only authorization cannot be mistaken for Merchant authorization", () => {
  const e = evidence(); e.scopes.pop();
  assert.deepEqual(check(e).missingScopes, [GOOGLE_MERCHANT_OAUTH_SCOPE]);
});
test("a partial Meta grant lists the declined dependencies as missing", () => {
  const e = evidence("meta"); e.scopes = ["ads_read", "catalog_management"];
  assert.deepEqual(check(e, "meta").missingScopes, ["business_management", "pages_read_engagement", "pages_show_list"]);
});
test("read_all_orders does not substitute for read_orders", () => {
  const e = evidence("shopify"); e.scopes = ["read_products", "read_all_orders"];
  assert.deepEqual(check(e, "shopify", {includeOrders: true, includeOrderHistory: true}).missingScopes, ["read_orders"]);
});
test("existing Shopify write grants satisfy their corresponding reads without requesting writes", () => {
  const e = evidence("shopify"); e.scopes = ["write_products", "write_orders", "write_marketing_events"];
  const r = check(e, "shopify", {includeOrders: true, includeMarketingEvents: true});
  assert.equal(r.scopeStatus, "observed_sufficient");
  assert.deepEqual(r.requiredScopes, ["read_products", "read_orders", "read_marketing_events"]);
  assert.deepEqual(r.satisfiedBy.map(x => x.grantedScope), e.scopes);
});
for (const [field, value] of Object.entries({workspaceId: other, installGeneration: 2, connectionId: other,
  accountId: "456", shopId: "gid://shopify/Shop/2", shopDomain: "other.myshopify.com", provider: "meta"})) {
  test(`scope evidence cannot cross ${field}`, () => {
    const e = evidence(); e.context[field] = value;
    const r = check(e); assert.equal(r.scopeStatus, "unknown");
    assert.equal(r.reason, "evidence_context_mismatch"); assert.equal(r.missingScopes, null);
  });
}
test("stale and future grants cannot survive reconnect or be read as current", () => {
  for (const date of ["2026-10-27T11:49:59.999Z", "2026-10-27T12:00:00.001Z"]) {
    const e = evidence(); e.observedAt = date;
    assert.equal(check(e).reason, "stale_or_future_scope_evidence");
  }
  const e = evidence(); e.observedAt = "2026-10-27T11:50:00.000Z";
  assert.equal(check(e).scopeStatus, "observed_sufficient");
});
test("malformed, incomplete, config-derived and missing native scope lists remain unknown", () => {
  for (const patch of [{complete: false}, {source: "requested_scopes"}, {scopes: null},
    {scopes: ["a", "a"]}, {scopes: [" read_orders"]}, {scopes: Array(1)}, {scopes: Array(101).fill("a")},
    {observedAt: "2026-10-27"}, {context: null}]) {
    assert.equal(check({...evidence(), ...patch}).scopeStatus, "unknown");
  }
});
test("outputs only matching required scopes and never echo arbitrary extra credentials/properties", () => {
  const e = evidence(); e.access_token = "SECRET"; e.scopes.push("UNRELATED_SECRET"); e.context.extra = "SECRET";
  const r = check(e);
  assert.equal(r.scopeStatus, "observed_sufficient"); assert.ok(!JSON.stringify(r).includes("SECRET"));
});

function response() {
  return {data: {shop: {id: "gid://shopify/Shop/1", myshopifyDomain: "example.myshopify.com"},
    currentAppInstallation: {id: "gid://shopify/AppInstallation/9", accessScopes: [{handle: "read_products"}]}}};
}
async function read(body, extra = {}) {
  let calls = 0;
  const result = await readShopifyPermissionScopes({context: context("shopify"), now,
    admin: {async graphql(query, options) {calls++; assert.equal(query, SHOPIFY_PERMISSION_SCOPES_QUERY);
      assert.deepEqual(options, {tries: 1});
      return {ok: true, async json() {return body;}};}}, ...extra});
  assert.equal(calls, 1); return result;
}
test("Shopify reads current grants and shop identity once; a valid empty grant list is preserved", async () => {
  const body = response(); body.data.currentAppInstallation.accessScopes = [];
  const r = await read(body);
  assert.deepEqual(r.scopes, []); assert.ok(Object.isFrozen(r.scopes));
  assert.equal(r.appInstallationId, "gid://shopify/AppInstallation/9");
  assert.equal(check(r, "shopify").scopeStatus, "observed_missing");
});
test("Shopify grant reader composes with the preflight without treating product-only grant as order access", async () => {
  const r = await read(response());
  assert.equal(check(r, "shopify").scopeStatus, "observed_sufficient");
  assert.deepEqual(check(r, "shopify", {includeOrders: true, includeMarketingEvents: true}).missingScopes, ["read_orders", "read_marketing_events"]);
  assert.equal(check(r, "shopify", {includeOrders: true, includeOrderHistory: true}).scopeStatus, "observed_missing");
});

test("one product-only observation passes base scope checks but cannot authorize Orders", () => {
  const e = evidence("shopify");
  const before = JSON.stringify(e);
  const base = check(e, "shopify");
  const orders = check(e, "shopify", {includeOrders: true});
  assert.equal(base.scopeStatus, "observed_sufficient");
  assert.deepEqual(base.requiredScopes, ["read_products"]);
  assert.deepEqual(base.additionalChecks, ["shopify_product_read"]);
  assert.equal(orders.scopeStatus, "observed_missing");
  assert.deepEqual(orders.missingScopes, ["read_orders"]);
  assert.ok(orders.additionalChecks.includes("shopify_protected_customer_data_access"));
  assert.equal(base.authorizesActivation, false);
  assert.equal(orders.authorizesActivation, false);
  assert.equal(JSON.stringify(e), before);
});

test("revoking Orders leaves product scope sufficient while explicit Orders checks become missing", () => {
  const e = evidence("shopify"); e.scopes.push("read_orders");
  assert.equal(check(e, "shopify", {includeOrders: true}).scopeStatus, "observed_sufficient");
  e.scopes = ["read_products"];
  assert.equal(check(e, "shopify").scopeStatus, "observed_sufficient");
  assert.deepEqual(check(e, "shopify", {includeOrders: true}).missingScopes, ["read_orders"]);
  e.scopes = ["read_orders", "read_all_orders"];
  assert.deepEqual(check(e, "shopify").missingScopes, ["read_products"]);
  e.observedAt = "2026-10-27T11:00:00.000Z";
  assert.equal(check(e, "shopify").scopeStatus, "unknown");
  assert.equal(check(e, "shopify", {includeOrders: true}).scopeStatus, "unknown");
});
test("Shopify cannot substitute another shop’s granted permissions", async () => {
  for (const [key, value] of [["id", "gid://shopify/Shop/2"], ["myshopifyDomain", "other.myshopify.com"]]) {
    const b = response(); b.data.shop[key] = value;
    await assert.rejects(read(b), /SHOPIFY_PERMISSION_SHOP_MISMATCH/);
  }
});
test("Shopify partial GraphQL data with errors, missing scopes, invalid handles and duplicate scopes are not absence proof", async () => {
  const variants = [null, {}, {errors: [{message: "SECRET"}], ...response()}];
  for (const change of [b => {b.data.currentAppInstallation = null;},
    b => {delete b.data.currentAppInstallation.accessScopes;},
    b => {b.data.currentAppInstallation.id = "9";},
    b => {b.data.currentAppInstallation.accessScopes = [{handle: "a"}, {handle: "a"}];},
    b => {b.data.currentAppInstallation.accessScopes = [{handle: "read_orders SECRET"}];},
    b => {b.data.currentAppInstallation.accessScopes = Array(1);}]) {
    const b = response(); change(b); variants.push(b);
  }
  for (const b of variants) await assert.rejects(read(b), error => /SHOPIFY_PERMISSION_/.test(error.message) && !error.message.includes("SECRET"));
});
test("first transport, HTTP, JSON or SDK error stops at one Shopify call without retry or token renewal", async () => {
  for (const mode of ["throw", "http", "json"]) {
    let calls = 0;
    await assert.rejects(readShopifyPermissionScopes({context: context("shopify"), now,
      admin: {async graphql() {calls++; if (mode === "throw") throw new Error("SECRET");
        return {ok: mode !== "http", async json() {throw new Error("SECRET");}};}}}),
    {message: "SHOPIFY_PERMISSION_SCOPES_READ_FAILED"});
    assert.equal(calls, 1);
  }
});
test("Shopify HTTP failure retains its safe status but never its body or transport secrets", async () => {
  await assert.rejects(readShopifyPermissionScopes({context: context("shopify"), now,
    admin: {async graphql() {return {ok: false, status: 403, async json() {throw new Error("SECRET");}};}}}),
  error => error.code === "SHOPIFY_PERMISSION_SCOPES_READ_FAILED" && error.details.status === 403
    && !JSON.stringify(error).includes("SECRET"));
});
test("slow Shopify read remains aged from request start and invalid clock/context never invokes a read", async () => {
  let ticks = 0;
  const e = await read(response(), {now: () => new Date(ticks++ ? "2026-10-27T12:11:00.000Z" : "2026-10-27T12:00:00.000Z")});
  assert.equal(check(e, "shopify", {now: () => new Date("2026-10-27T12:11:00.000Z")}).scopeStatus, "unknown");
  let calls = 0; const admin = {async graphql() {calls++; throw new Error();}};
  await assert.rejects(readShopifyPermissionScopes({context: {...context("shopify"), installGeneration: 0}, admin, now}));
  await assert.rejects(readShopifyPermissionScopes({context: context("shopify"), admin, now: () => new Date("invalid")}));
  assert.equal(calls, 0);
});
