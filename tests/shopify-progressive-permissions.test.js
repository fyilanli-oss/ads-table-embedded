import assert from "node:assert/strict";
import test from "node:test";
import {createShopifyProgressivePermissions, SHOPIFY_OPTIONAL_SCOPES_QUERY} from "../app/lib/shopify/progressive-permissions.server.js";
import {SHOPIFY_PERMISSION_SCOPES_QUERY} from "../app/lib/shopify/permission-scopes.server.js";

const apiKey = "a".repeat(32), workspaceId = "11111111-1111-4111-8111-111111111111";
const reauthorize = "X-Shopify-API-Request-Failure-Reauthorize-Url";
function fixture(options = {}) {
  const calls = [], hooks = {}, state = {generation: 2, appId: "gid://shopify/AppInstallation/9",
    grants: options.grants ?? [], optional: ["read_products", "read_orders"], now: new Date("2026-10-29T17:00:00.000Z")};
  const shop = {id: "gid://shopify/Shop/1", myshopifyDomain: "example.myshopify.com"};
  const database = {async query(sql, params) {
    calls.push({kind: "sql"}); hooks.sql?.(calls.filter(c => c.kind === "sql").length);
    assert.match(sql, /resolve_active_installation/); assert.deepEqual(params, [shop.id, shop.myshopifyDomain]);
    return {rows: [{workspace_id: workspaceId, install_generation: state.generation, installation_status: "active"}]};
  }};
  function redirect(scope) {
    return new Response(null, {status: 401, headers: {[reauthorize]:
      `https://example.myshopify.com/admin/oauth/install?client_id=${apiKey}&scope=&optional_scopes=${scope}`}});
  }
  const verified = {installationAuthority: {authority: "shopify_installation_verified", workspaceId, installGeneration: 2, status: "active"},
    identity: {session: {authority: "shopify_id_token_verified", shopDomain: shop.myshopifyDomain},
      shop: {authority: "shopify_admin_verified", shopId: shop.id, myshopifyDomain: shop.myshopifyDomain}},
    context: {admin: {async graphql(query, controls) {
      calls.push({kind: "graphql", query, controls});
      assert.equal(controls.tries, 1); assert.ok(controls.signal instanceof AbortSignal);
      assert.ok([SHOPIFY_PERMISSION_SCOPES_QUERY, SHOPIFY_OPTIONAL_SCOPES_QUERY].includes(query));
      const custom = await hooks.graphql?.(query); if (custom) return custom;
      return new Response(JSON.stringify({data: {shop,
        currentAppInstallation: {id: state.appId, accessScopes: state.grants.map(handle => ({handle}))},
        app: {optionalAccessScopes: state.optional.map(handle => ({handle}))}}}));
    }}, scopes: {async query() {
      calls.push({kind: "nativeQuery"});
      if (hooks.nativeQuery) return hooks.nativeQuery();
      return {required: [], optional: state.optional, granted: state.grants};
    }, async revoke(scopes) {
      calls.push({kind: "revoke", scopes});
      if (hooks.revoke) return hooks.revoke(scopes);
      state.grants = state.grants.filter(s => !scopes.includes(s));
      return {revoked: [...scopes]};
    }, async request(scopes) {
      calls.push({kind: "request", scopes});
      if (hooks.request) return hooks.request(scopes);
      const result = redirect(scopes.join(",")); state.redirect = result; throw result;
    }}},
  };
  const setup = createShopifyProgressivePermissions({database, apiKey, now: () => state.now,
    requestsEnabled: options.enabled ?? true, optionalScopesReleased: options.released ?? true, maxElapsedMs: options.timeout ?? 120000});
  const input = {verified, action: "connect"};
  return {setup, input, calls, hooks, state, verified, redirect,
    inspect: fields => setup.inspect({...input, ...fields}),
    products: fields => setup.requestProducts({...input, ...fields}),
    orders: fields => setup.requestOrders({...input, ...fields})};
}
test("readback separates required Products from optional Orders without data-reading authority", async () => {
  const f = fixture({grants: ["read_products"]}), result = await f.inspect();
  assert.equal(result.basePermissionState, "permission_ready"); assert.equal(result.ordersPermissionState, "not_connected");
  assert.equal(result.ordersRequiredForBase, false); assert.equal(result.authorizesActivation, false);
  assert.equal(result.ordersDataAccessAuthorized, false); assert.equal(result.historyAccessAuthorized, false);
  assert.equal(result.overlapVerified, false); assert.equal(result.nativeRequestInvoked, false);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(f.calls.map(c => c.kind), ["sql", "graphql", "sql"]);
});
for (const [grants, base, orders] of [[[], "resume_setup", "blocked_by_products"],
  [["read_orders"], "resume_setup", "blocked_by_products"],
  [["read_products", "read_orders"], "permission_ready", "permission_ready"],
  [["write_products", "write_orders"], "permission_ready", "permission_ready"]]) {
  test(`native granted scope combination ${grants.join(",") || "empty"}`, async () => {
    const result = await fixture({grants}).inspect();
    assert.equal(result.basePermissionState, base); assert.equal(result.ordersPermissionState, orders);
    assert.equal(result.authorizesActivation, false);
  });
}
for (const feature of ["products", "orders"]) {
  const scope = feature === "products" ? "read_products" : "read_orders";
  const baseline = feature === "products" ? [] : ["read_products"];
  test(`${feature}: native SDK gets only its fixed read scope; exact SDK redirect is preserved`, async () => {
    const f = fixture({grants: baseline});
    await assert.rejects(f[feature]({scopes: ["write_orders", "read_all_orders"], includeOrderHistory: true}), error => error === f.state.redirect);
    assert.deepEqual(f.calls.filter(c => c.kind === "request").map(c => c.scopes), [[scope]]);
    assert.equal(f.calls.filter(c => c.query === SHOPIFY_OPTIONAL_SCOPES_QUERY).length, 1);
  });
  test(`${feature}: explicit Connect and both server gates are mandatory`, async () => {
    for (const options of [{enabled: false}, {released: false}]) {
      const f = fixture({...options, grants: baseline});
      await assert.rejects(f[feature]({requestsEnabled: true, optionalScopesReleased: true}));
      assert.deepEqual(f.calls, []);
    }
    for (const action of [undefined, "inspect", "grant", true]) {
      const f = fixture({grants: baseline}); await assert.rejects(f[feature]({action}), /EXPLICIT_CONNECT_REQUIRED/);
      assert.deepEqual(f.calls, []);
    }
  });
  test(`${feature}: Cancel performs no native request/read/write even with gates closed`, async () => {
    const f = fixture({enabled: false, released: false, grants: baseline});
    assert.equal((await f[feature]({action: "cancel"})).outcome, "cancelled"); assert.deepEqual(f.calls, []);
  });
  test(`${feature}: already granted does not re-prompt or inspect optional configuration`, async () => {
    const f = fixture({grants: ["read_products", "read_orders"]});
    assert.equal((await f[feature]()).outcome, "already_granted");
    assert.deepEqual(f.calls.map(c => c.kind), ["sql", "graphql", "sql"]);
  });
  for (const native of [[], ["write_products", "write_orders"]]) {
    test(`${feature}: missing exact deployed optional handle blocks request (${native.join(",")})`, async () => {
      const f = fixture({grants: baseline}); f.state.optional = native;
      await assert.rejects(f[feature](), /OPTIONAL_SCOPE_NOT_DEPLOYED/);
      assert.equal(f.calls.filter(c => c.kind === "request").length, 0);
    });
  }
  test(`${feature}: SDK void result is followed by fresh native readback, never trusted as consent`, async () => {
    const f = fixture({grants: baseline}); f.hooks.request = () => {f.state.grants = ["read_products", "read_orders"];};
    const result = await f[feature](); assert.equal(result.outcome, "native_readback");
    assert.equal(result.ordersPermissionState, "permission_ready"); assert.equal(result.nativeRequestInvoked, true);
    assert.equal(result.authorizesActivation, false);
    assert.equal(f.calls.filter(c => c.query === SHOPIFY_PERMISSION_SCOPES_QUERY).length, 2);
  });
  test(`${feature}: first SDK error is safe and not retried`, async () => {
    const f = fixture({grants: baseline}); f.hooks.request = () => {throw Error("SECRET_PROVIDER_ERROR");};
    await assert.rejects(f[feature](), error => error.message === "SHOPIFY_SETUP_NATIVE_SCOPE_REQUEST_FAILED");
    assert.equal(f.calls.filter(c => c.kind === "request").length, 1);
  });
}
test("Orders request waits for Products, without bundling or prompting for Products", async () => {
  const f = fixture(); const result = await f.orders();
  assert.equal(result.outcome, "products_permission_required"); assert.equal(result.basePermissionState, "resume_setup");
  assert.equal(f.calls.filter(c => c.kind === "request").length, 0);
});
test("declined or cancelled Orders return keeps the independently granted Products ready", async () => {
  const f = fixture({grants: ["read_products"]});
  const result = await f.setup.afterReturn({...f.input, result: "granted-all", scopes: ["read_orders"], includeOrderHistory: true});
  assert.equal(result.basePermissionState, "permission_ready"); assert.equal(result.ordersPermissionState, "not_connected");
  assert.equal(f.calls.filter(c => c.kind === "request").length, 0);
});
test("revoked Products or Orders are observed on return, not read from cached browser state", async () => {
  const f = fixture({grants: ["read_products", "read_orders"]}); await f.inspect(); f.state.grants = ["read_products"];
  assert.equal((await f.setup.afterReturn(f.input)).ordersPermissionState, "not_connected");
  f.state.grants = []; assert.equal((await f.setup.afterReturn(f.input)).basePermissionState, "resume_setup");
});
test("SDK returning void without any new grant cannot manufacture a permission", async () => {
  const f = fixture({grants: ["read_products"]}); f.hooks.request = () => {};
  const result = await f.orders(); assert.equal(result.ordersPermissionState, "not_connected");
  assert.equal(result.basePermissionState, "permission_ready"); assert.equal(result.authorizesActivation, false);
});
for (const mode of ["optional_error", "optional_id", "optional_shop", "duplicate", "malformed"]) {
  test(`invalid optional configuration observation: ${mode}`, async () => {
    const f = fixture();
    f.hooks.graphql = query => {
      if (query !== SHOPIFY_OPTIONAL_SCOPES_QUERY) return;
      if (mode === "optional_error") throw Error("SECRET_TRANSPORT");
      return new Response(JSON.stringify({data: {shop: {id: "gid://shopify/Shop/1", myshopifyDomain: mode === "optional_shop" ? "other.myshopify.com" : "example.myshopify.com"},
        currentAppInstallation: {id: mode === "optional_id" ? "gid://shopify/AppInstallation/10" : f.state.appId},
        app: {optionalAccessScopes: mode === "malformed" ? {} : [{handle: "read_products"}, {handle: mode === "duplicate" ? "read_products" : "read_orders"}]}}}));
    };
    await assert.rejects(f.products(), error => !error.message.includes("SECRET"));
    assert.equal(f.calls.filter(c => c.kind === "request").length, 0);
  });
}
for (const mode of ["foreign_shop", "wrong_client", "broad_scope", "bad_status", "extra_parameter", "plain_auth_error", "response_body", "response_cookie"]) {
  test(`nonmatching SDK response is never forwarded: ${mode}`, async () => {
    const f = fixture();
    f.hooks.request = () => {
      const original = f.redirect("read_products"); const address = new URL(original.headers.get(reauthorize));
      if (mode === "foreign_shop") address.hostname = "other.myshopify.com";
      if (mode === "wrong_client") address.searchParams.set("client_id", "b".repeat(32));
      if (mode === "broad_scope") address.searchParams.set("optional_scopes", "read_products,read_orders");
      if (mode === "extra_parameter") address.searchParams.set("arbitrary", "value");
      throw new Response(mode === "response_body" ? "SECRET_PROVIDER_BODY" : null, {status: mode === "bad_status" ? 302 : 401,
        headers: mode === "plain_auth_error" ? {} : {[reauthorize]: address.toString(), ...(mode === "response_cookie" ? {"set-cookie": "secret-cookie"} : {})}});
    };
    await assert.rejects(f.products(), /NATIVE_REDIRECT_INVALID/);
    assert.equal(f.calls.filter(c => c.kind === "request").length, 1);
  });
}
test("installation changes during native optional read or SDK signal discard the request outcome", async () => {
  for (const phase of ["optional", "sdk"]) {
    const f = fixture();
    if (phase === "optional") f.hooks.graphql = query => {if (query === SHOPIFY_OPTIONAL_SCOPES_QUERY) f.state.generation = 3;};
    else f.hooks.request = () => {f.state.generation = 3; throw f.redirect("read_products");};
    await assert.rejects(f.products()); assert.equal(f.calls.filter(c => c.kind === "request").length, phase === "sdk" ? 1 : 0);
  }
});
test("native AppInstallation change after SDK void is rejected even if workspace generation did not change", async () => {
  const f = fixture(); f.hooks.request = () => {f.state.appId = "gid://shopify/AppInstallation/10"; f.state.grants = ["read_products"];};
  await assert.rejects(f.products(), /INSTALLATION_CHANGED/);
});
test("request captures verified owner, Admin and native scope methods before its first await", async () => {
  const f = fixture(); f.hooks.sql = count => {
    if (count !== 1) return;
    f.verified.installationAuthority.installGeneration = 999;
    f.verified.context.scopes.request = () => {throw Error("CALLER_RETARGET");};
    f.verified.context.admin.graphql = () => {throw Error("CALLER_RETARGET");};
  };
  await assert.rejects(f.products(), error => error === f.state.redirect);
  assert.equal(f.calls.filter(c => c.kind === "request").length, 1);
});
test("abort and total deadline cannot cause a late scope request", async () => {
  const aborted = fixture(), stopped = new AbortController(); stopped.abort();
  await assert.rejects(aborted.products({signal: stopped.signal})); assert.equal(aborted.calls.length, 0);
  const f = fixture({timeout: 20}); f.hooks.graphql = (query) => new Promise(() => {});
  await assert.rejects(f.products(), /DEADLINE_EXCEEDED/);
  assert.equal(f.calls.filter(c => c.kind === "request").length, 0);
});
test("active installation read failure during optional validation is safe and not retried", async () => {
  const f = fixture(); f.hooks.sql = count => {if (count === 3) throw Error("SECRET_DATABASE");};
  await assert.rejects(f.products(), error => error.message === "SHOPIFY_SETUP_INSTALLATION_READ_FAILED");
  assert.equal(f.calls.filter(c => c.kind === "request").length, 0);
  assert.equal(f.calls.filter(c => c.kind === "sql").length, 3);
});

test("Products revoke changes only optional product scope and verifies actual same-installation readback", async () => {
  const f = fixture({grants: ["read_products", "read_orders"]});
  const result = await f.setup.revokeProducts({...f.input, action: "revoke"});
  assert.equal(result.basePermissionState, "resume_setup");
  assert.equal(result.authorizesActivation, false);
  assert.deepEqual(f.state.grants, ["read_orders"]);
  assert.deepEqual(f.calls.filter(c => c.kind === "revoke").map(c => c.scopes), [["read_products"]]);
  assert.equal(f.calls.filter(c => c.kind === "graphql" && c.query === SHOPIFY_PERMISSION_SCOPES_QUERY).length, 2);
  assert.equal(f.calls.filter(c => c.kind === "request").length, 0);
});

test("Products revoke cancel, missing grant and closed gate never invoke mutation", async () => {
  const canceled = fixture({grants: ["read_products"]});
  assert.equal((await canceled.setup.revokeProducts({...canceled.input, action: "cancel"})).outcome, "cancelled");
  assert.equal(canceled.calls.length, 0);
  for (const f of [fixture(), fixture({enabled: false, grants: ["read_products"]}), fixture({released: false, grants: ["read_products"]})]) {
    try {await f.setup.revokeProducts({...f.input, action: "revoke"});} catch {}
    assert.equal(f.calls.filter(c => c.kind === "revoke").length, 0);
  }
  await assert.rejects(canceled.setup.revokeProducts(canceled.input), /EXPLICIT_REVOKE_REQUIRED/);
});

for (const mode of ["required", "write", "optional_missing", "native_query_error", "foreign_shop", "changed_generation"]) {
  test(`Products revoke preflight blocks ${mode} before mutation`, async () => {
    const f = fixture({grants: ["read_products", ...(mode === "write" ? ["write_products"] : [])]});
    if (mode === "required") f.hooks.nativeQuery = () => ({required: ["read_products"], optional: f.state.optional, granted: f.state.grants});
    if (mode === "optional_missing") f.state.optional = [];
    if (mode === "native_query_error") f.hooks.nativeQuery = () => {throw Error("SECRET");};
    if (mode === "foreign_shop") f.verified.identity.session.shopDomain = "foreign.myshopify.com";
    if (mode === "changed_generation") f.hooks.nativeQuery = () => {f.state.generation = 3; return {required: [], optional: f.state.optional, granted: f.state.grants};};
    await assert.rejects(f.setup.revokeProducts({...f.input, action: "revoke"}));
    assert.equal(f.calls.filter(c => c.kind === "revoke").length, 0);
  });
}

for (const mode of ["native_error", "bad_receipt", "still_granted", "readback_error", "changed_installation", "changed_grants"]) {
  test(`Products revoke ${mode} stays unconfirmed and never retries`, async () => {
    const f = fixture({grants: ["read_products", "read_orders"]});
    f.hooks.revoke = () => {
      if (mode === "native_error") throw Error("SECRET_PROVIDER_ERROR");
      f.state.grants = mode === "still_granted" ? f.state.grants : mode === "changed_grants" ? [] : ["read_orders"];
      if (mode === "changed_installation") f.state.appId = "gid://shopify/AppInstallation/10";
      if (mode === "readback_error") f.hooks.graphql = () => {throw Error("SECRET_READBACK_ERROR");};
      return {revoked: mode === "bad_receipt" ? ["read_orders"] : ["read_products"]};
    };
    await assert.rejects(f.setup.revokeProducts({...f.input, action: "revoke"}), error => !error.message.includes("SECRET"));
    assert.equal(f.calls.filter(c => c.kind === "revoke").length, 1);
    assert.equal(f.calls.filter(c => c.kind === "request").length, 0);
  });
}

test("Orders revoke preserves Products and all other scopes, even when Products is already missing", async () => {
  for (const grants of [["read_products", "read_orders", "read_all_orders"], ["read_orders"]]) {
    const f = fixture({grants});
    const result = await f.setup.revokeOrders({...f.input, action: "revoke"});
    assert.equal(result.ordersScopeState, "not_connected");
    assert.equal(result.authorizesActivation, false);
    assert.deepEqual(f.state.grants, grants.filter(s => s !== "read_orders"));
    assert.deepEqual(f.calls.filter(c => c.kind === "revoke").map(c => c.scopes), [["read_orders"]]);
    assert.equal(f.calls.filter(c => c.kind === "request").length, 0);
  }
});

test("Orders grant remains visible independently of the Products data-reading prerequisite", async () => {
  const result = await fixture({grants: ["read_orders"]}).inspect();
  assert.equal(result.ordersScopeState, "permission_ready");
  assert.equal(result.ordersPermissionState, "blocked_by_products");
  assert.equal(result.ordersDataAccessAuthorized, false);
});

for (const mode of ["cancel", "disabled", "required", "write", "query_error", "changed_owner", "missing"]) {
  test(`Orders revoke ${mode} never mutates scopes`, async () => {
    const f = fixture({grants: mode === "missing" ? ["read_products"] : ["read_products", "read_orders", ...(mode === "write" ? ["write_orders"] : [])], enabled: mode !== "disabled"});
    if (mode === "required") f.hooks.nativeQuery = () => ({required: ["read_orders"], optional: f.state.optional, granted: f.state.grants});
    if (mode === "query_error") f.hooks.nativeQuery = () => {throw Error("SECRET");};
    if (mode === "changed_owner") f.hooks.nativeQuery = () => {f.state.generation = 3; return {required: [], optional: f.state.optional, granted: f.state.grants};};
    try {await f.setup.revokeOrders({...f.input, action: mode === "cancel" ? "cancel" : "revoke"});} catch {}
    assert.equal(f.calls.filter(c => c.kind === "revoke").length, 0);
  });
}

for (const mode of ["native_error", "bad_receipt", "still_granted", "products_changed", "new_install", "readback_error"]) {
  test(`Orders revoke ${mode} never reports verified removal or retries`, async () => {
    const f = fixture({grants: ["read_products", "read_orders"]});
    f.hooks.revoke = () => {
      if (mode === "native_error") throw Error("SECRET");
      f.state.grants = mode === "still_granted" ? f.state.grants : mode === "products_changed" ? [] : ["read_products"];
      if (mode === "new_install") f.state.appId = "gid://shopify/AppInstallation/10";
      if (mode === "readback_error") f.hooks.graphql = () => {throw Error("SECRET");};
      return {revoked: mode === "bad_receipt" ? ["read_products"] : ["read_orders"]};
    };
    await assert.rejects(f.setup.revokeOrders({...f.input, action: "revoke"}), error => !error.message.includes("SECRET"));
    assert.equal(f.calls.filter(c => c.kind === "revoke").length, 1);
  });
}
