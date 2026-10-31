import assert from "node:assert/strict";
import test from "node:test";
import {createShopifyProgressivePermissions, SHOPIFY_OPTIONAL_SCOPES_QUERY} from "../app/lib/shopify/progressive-permissions.server.js";
import {SHOPIFY_PERMISSION_SCOPES_QUERY} from "../app/lib/shopify/permission-scopes.server.js";

const apiKey = "a".repeat(32), workspaceId = "11111111-1111-4111-8111-111111111111";
function fixture(options = {}) {
  const calls = [], hooks = {}, state = {generation: 2, appId: "gid://shopify/AppInstallation/9",
    grants: options.grants ?? [], optional: ["read_products", "read_orders"], now: new Date("2026-10-29T17:00:00.000Z")};
  const shop = {id: "gid://shopify/Shop/1", myshopifyDomain: "example.myshopify.com"};
  const database = {async query(sql, params) {
    calls.push({kind: "sql"}); hooks.sql?.(calls.filter(c => c.kind === "sql").length);
    assert.match(sql, /resolve_active_installation/); assert.deepEqual(params, [shop.id, shop.myshopifyDomain]);
    return {rows: [{workspace_id: workspaceId, install_generation: state.generation, installation_status: "active"}]};
  }};
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
      assert.fail("server scope preparation must not request consent");
    }}},
  };
  const setup = createShopifyProgressivePermissions({database, apiKey, now: () => state.now,
    requestsEnabled: options.enabled ?? true, optionalScopesReleased: options.released ?? true, maxElapsedMs: options.timeout ?? 120000});
  const input = {verified, action: "connect"};
  return {setup, input, calls, hooks, state, verified,
    inspect: fields => setup.inspect({...input, ...fields}),
    products: fields => setup.prepareProducts({...input, ...fields}),
    orders: fields => setup.prepareOrders({...input, ...fields})};
}
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

for(const [feature,scope,grants] of [["products","read_products",[]],["orders","read_orders",["read_products"]]]){
  test(`${feature} preparation binds exactly one deployed optional scope without consent or redirect`,async()=>{
    const f=fixture({grants});const result=await f[feature]({scope:"write_products",scopes:["read_all_orders"]});
    assert.deepEqual(result,{outcome:"scope_request_prepared",scope,binding:{shopId:"gid://shopify/Shop/1",appInstallationId:f.state.appId,installGeneration:2},authorizesActivation:false});
    assert.deepEqual(f.state.grants,grants);assert.equal(f.calls.filter(c=>c.kind==="request"||c.kind==="revoke").length,0);
  });
  test(`${feature} cancel/closed gates never read or request a scope`,async()=>{
    const f=fixture({grants});assert.equal((await f[feature]({action:"cancel"})).outcome,"cancelled");assert.equal(f.calls.length,0);
    for(const options of [{enabled:false},{released:false}]){
      const f=fixture({...options,grants});await assert.rejects(f[feature]());assert.equal(f.calls.length,0);
    }
  });
}

test("already granted scopes skip optional preparation, while Orders never prompts for Products",async()=>{
  const f=fixture({grants:["read_products","read_orders"]});
  assert.equal((await f.products()).outcome,"already_granted");assert.equal((await f.orders()).outcome,"already_granted");
  assert.equal(f.calls.filter(c=>c.kind==="request"||c.query===SHOPIFY_OPTIONAL_SCOPES_QUERY).length,0);
  const missing=fixture();assert.equal((await missing.orders()).outcome,"products_permission_required");
  assert.equal(missing.calls.filter(c=>c.kind==="request").length,0);
});

for(const mode of ["not_deployed","optional_error","wrong_shop","wrong_install","duplicate","malformed","changed_generation"]){
  test(`scope preparation rejects ${mode} without a consent route fallback`,async()=>{
    const f=fixture();if(mode==="not_deployed")f.state.optional=["read_orders"];
    f.hooks.graphql=query=>{
      if(query!==SHOPIFY_OPTIONAL_SCOPES_QUERY)return;
      if(mode==="optional_error")throw Error("SECRET");
      if(mode==="changed_generation")f.state.generation=3;
      if(["wrong_shop","wrong_install","duplicate","malformed"].includes(mode))return new Response(JSON.stringify({data:{shop:{id:"gid://shopify/Shop/1",myshopifyDomain:mode==="wrong_shop"?"foreign.myshopify.com":"example.myshopify.com"},currentAppInstallation:{id:mode==="wrong_install"?"gid://shopify/AppInstallation/10":f.state.appId},app:{optionalAccessScopes:mode==="malformed"?{}:[{handle:"read_products"},{handle:mode==="duplicate"?"read_products":"read_orders"}]}}}));
    };
    await assert.rejects(f.products(),e=>!e.message.includes("SECRET"));assert.equal(f.calls.filter(c=>c.kind==="request").length,0);
  });
}

test("preparation captures its verified owner/read client and total deadline cannot yield late consent",async()=>{
  const f=fixture();f.hooks.sql=count=>{if(count===1){f.verified.installationAuthority.installGeneration=999;f.verified.context.admin.graphql=()=>assert.fail();}};
  const prepared=await f.products();assert.equal(prepared.binding.installGeneration,2);
  const stalled=fixture({timeout:20});stalled.hooks.graphql=()=>new Promise(()=>{});
  await assert.rejects(stalled.products(),/DEADLINE_EXCEEDED/);assert.equal(stalled.calls.filter(c=>c.kind==="request").length,0);
});
