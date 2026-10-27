import assert from "node:assert/strict";
import test from "node:test";
import {inspectShopifyIdentityPermissionScopes, SHOPIFY_PERMISSION_SCOPES_QUERY} from "../app/lib/shopify/permission-scopes.server.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspace = "22222222-2222-4222-8222-222222222222";
const now = () => new Date("2026-10-27T12:00:00.000Z");
const shopId = "gid://shopify/Shop/1", shopDomain = "example.myshopify.com";
const active = {workspace_id: workspaceId, install_generation: 2, installation_status: "active"};

function harness({grants = ["read_products", "read_orders"], before = active, after = active,
  graphError = false, databaseErrorAt = null, bodyChange = null, clock = now} = {}) {
  const calls = [];
  let resolves = 0;
  const database = {async query(sql, values) {
    calls.push({kind: "resolve", sql, values}); resolves++;
    assert.match(sql, /select \* from shopify\.resolve_active_installation/);
    assert.deepEqual(values, [shopId, shopDomain]);
    if (databaseErrorAt === resolves) throw new Error("SECRET_DATABASE_ERROR");
    const row = resolves === 1 ? before : after;
    return {rows: row === null ? [] : [row]};
  }};
  const verified = {
    installationAuthority: {authority: "shopify_installation_verified", workspaceId, installGeneration: 2, status: "active"},
    identity: {session: {authority: "shopify_id_token_verified", shopDomain},
      shop: {authority: "shopify_admin_verified", shopId, myshopifyDomain: shopDomain}},
    context: {admin: {async graphql(query, options) {
      calls.push({kind: "graphql", query, options});
      if (graphError) throw new Error("SECRET_SDK_ERROR");
      const body = {data: {shop: {id: shopId, myshopifyDomain: shopDomain},
        currentAppInstallation: {id: "gid://shopify/AppInstallation/9", accessScopes: grants.map(handle => ({handle}))}}};
      bodyChange?.(body, verified);
      return {ok: true, json: async () => body};
    }}},
  };
  return {verified, database, calls, run: (features = {}) => inspectShopifyIdentityPermissionScopes({verified, database, now: clock, ...features})};
}
test("scope readback composes native reader and preflight between two active installation checks", async () => {
  const h = harness(); const result = await h.run();
  assert.deepEqual(h.calls.map(c => c.kind), ["resolve", "graphql", "resolve"]);
  assert.equal(h.calls[1].query, SHOPIFY_PERMISSION_SCOPES_QUERY); assert.deepEqual(h.calls[1].options, {tries: 1});
  assert.equal(result.assessment.scopeStatus, "observed_sufficient");
  assert.equal(result.assessment.authorizesActivation, false);
  assert.equal(result.evidence.context.installGeneration, 2);
  assert.equal(result.evidence.context.workspaceId, workspaceId);
  assert.equal(result.evidence.appInstallationId, "gid://shopify/AppInstallation/9");
  assert.ok(Object.isFrozen(result));
  assert.equal("admin" in result, false); assert.equal("verified" in result, false);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});
test("product-only grant cannot satisfy independently selected order, history and marketing requirements", async () => {
  const h = harness({grants: ["read_products"]});
  const result = await h.run({includeOrderHistory: true, includeMarketingEvents: true});
  assert.equal(result.assessment.scopeStatus, "observed_missing");
  assert.deepEqual(result.assessment.missingScopes, ["read_orders", "read_all_orders", "read_marketing_events"]);
  assert.equal(result.assessment.authorizesActivation, false);
});
test("explicitly empty grant stays observed missing, while write grants satisfy reads without requesting writes", async () => {
  const empty = await harness({grants: []}).run();
  assert.equal(empty.assessment.scopeStatus, "observed_missing");
  assert.deepEqual(empty.assessment.missingScopes, ["read_products", "read_orders"]);
  const existing = await harness({grants: ["write_products", "write_orders"]}).run();
  assert.equal(existing.assessment.scopeStatus, "observed_sufficient");
  assert.deepEqual(existing.assessment.requiredScopes, ["read_products", "read_orders"]);
});
for (const change of [{workspace_id: otherWorkspace}, {install_generation: 3}, {installation_status: "uninstalled"}]) {
  test(`changed installation before read prevents provider work: ${JSON.stringify(change)}`, async () => {
    const h = harness({before: {...active, ...change}});
    await assert.rejects(h.run(), /SHOPIFY_PERMISSION_INSTALLATION_CHANGED/);
    assert.deepEqual(h.calls.map(c => c.kind), ["resolve"]);
  });
  test(`changed installation after read discards scope result: ${JSON.stringify(change)}`, async () => {
    const h = harness({after: {...active, ...change}});
    await assert.rejects(h.run(), /SHOPIFY_PERMISSION_INSTALLATION_CHANGED/);
    assert.deepEqual(h.calls.map(c => c.kind), ["resolve", "graphql", "resolve"]);
  });
}
for (const databaseErrorAt of [1, 2]) {
  test(`installation lookup error is safe and does not retry: lookup ${databaseErrorAt}`, async () => {
    const h = harness({databaseErrorAt});
    await assert.rejects(h.run(), error => error.message === "SHOPIFY_PERMISSION_INSTALLATION_READ_FAILED" && !String(error).includes("SECRET"));
    assert.equal(h.calls.filter(c => c.kind === "resolve").length, databaseErrorAt);
    assert.equal(h.calls.filter(c => c.kind === "graphql").length, databaseErrorAt - 1);
  });
}
test("missing active installation stops before provider work", async () => {
  const h = harness({before: null});
  await assert.rejects(h.run(), /SHOPIFY_PERMISSION_INSTALLATION_READ_FAILED/);
  assert.equal(h.calls.length, 1);
});
test("first SDK error does not re-read, refresh or consult another installation", async () => {
  const h = harness({graphError: true});
  await assert.rejects(h.run(), /SHOPIFY_PERMISSION_SCOPES_READ_FAILED/);
  assert.deepEqual(h.calls.map(c => c.kind), ["resolve", "graphql"]);
});
for (const edit of [v => {v.installationAuthority.status = "uninstalled";},
  v => {v.installationAuthority.authority = "caller_supplied";},
  v => {v.identity.session.authority = "caller_supplied";},
  v => {v.identity.shop.authority = "caller_supplied";},
  v => {v.identity.session.shopDomain = "other.myshopify.com";},
  v => {v.installationAuthority.installGeneration = 0;},
  v => {delete v.context.admin;},
]) {
  test(`invalid verified caller fails before native or DB access: ${edit.toString()}`, async () => {
    const h = harness(); edit(h.verified);
    await assert.rejects(h.run()); assert.equal(h.calls.length, 0);
  });
}
test("invalid feature selection cannot silently fall back to smaller scope set", async () => {
  const h = harness();
  await assert.rejects(h.run({includeOrderHistory: "true"}));
  assert.equal(h.calls.length, 0);
});
test("a different native shop is not current grant evidence even with all requested scopes", async () => {
  const h = harness({bodyChange: body => {body.data.shop.id = "gid://shopify/Shop/2";}});
  await assert.rejects(h.run(), /SHOPIFY_PERMISSION_SHOP_MISMATCH/);
  assert.deepEqual(h.calls.map(c => c.kind), ["resolve", "graphql"]);
});
test("slow native read remains unknown and does not become a fabricated missing grant", async () => {
  let ticks = 0;
  const h = harness({clock: () => new Date(ticks++ ? "2026-10-27T12:11:00.000Z" : "2026-10-27T12:00:00.000Z")});
  const result = await h.run();
  assert.equal(result.assessment.scopeStatus, "unknown");
  assert.equal(result.assessment.missingScopes, null);
  assert.equal(result.assessment.authorizesActivation, false);
});
test("caller mutation during native read cannot move the captured evidence into another workspace", async () => {
  const h = harness({bodyChange: (_body, verified) => {verified.installationAuthority.workspaceId = otherWorkspace;}});
  const result = await h.run();
  assert.equal(result.context.workspaceId, workspaceId);
  assert.equal(result.evidence.context.workspaceId, workspaceId);
});
