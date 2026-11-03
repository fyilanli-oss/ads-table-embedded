import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {handleGoogleMerchantDiscoveryRequest, readGoogleMerchantDiscoveryPlan,
  GOOGLE_MERCHANT_DISCOVERY_HEADER} from "../app/lib/providers/google-merchant-discovery.server.js";
import {GOOGLE_MERCHANT_LINK_QUERY} from "../app/lib/providers/google-merchant-account-link.server.js";
import {googleAcceptanceFixture} from "./fixtures/google-acceptance-fixture.js";

function fixture() {
  const f = googleAcceptanceFixture();
  const {merchantId, merchantQuotaAccountId, merchantBindingEpoch, window, ...plan} = f.plan;
  const environment = {GOOGLE_ADS_DEVELOPER_TOKEN: "SYNTHETIC-DEVELOPER",
    ADSTABLE_GOOGLE_MERCHANT_DISCOVERY_PLAN: JSON.stringify(plan)};
  const state = {auth: 0, admin: 0, vault: 0};
  const options = {environment, database: f.options.database, now: f.options.now, fetchFn: f.options.fetchFn,
    tokenVault: {async loadProviderTokenSet(args) {state.vault++; return f.options.tokenVault.loadProviderTokenSet(args);}},
    authenticateAdmin: async () => {
      state.auth++;
      return {sessionToken: {dest: "https://test.myshopify.com/"}, admin: {graphql(query, options) {
        state.admin++; assert.equal(options.tries, 1);
        return Response.json({data: {shop: {id: plan.shopId, myshopifyDomain: plan.shopDomain}}});
      }}};
    }};
  function request(input = {mode: "google_merchant_links_v1", operationId: plan.operationId}, extra = {}) {
    return new Request("https://example.com/settings/google-live-evidence", {method: "POST",
      headers: {[GOOGLE_MERCHANT_DISCOVERY_HEADER]: "v1", "content-type": "application/json"},
      body: JSON.stringify(input), ...extra});
  }
  return {f, plan, environment, options, state, request,
    setPlan() {environment.ADSTABLE_GOOGLE_MERCHANT_DISCOVERY_PLAN = JSON.stringify(plan);}};
}
async function run(x, request = x.request()) {
  const response = await handleGoogleMerchantDiscoveryRequest({...x.options, request});
  assert.equal(response.headers.get("cache-control"), "no-store");
  return {response, body: await response.json()};
}
function noProvider(x) {assert.equal(x.f.f.httpCalls.length, 0);}
function safeStopped(body) {
  assert.equal(body.status, "stopped"); assert.equal(body.complete, false);
  assert.equal(body.merchant_ids, null); assert.equal(body.has_linked_merchant, null);
  assert.equal(body.product_read_performed, false); assert.equal(body.provider_retry_performed, false);
  assert.doesNotMatch(JSON.stringify(body), /SYNTHETIC|PRIVATE|refresh_token|credentialId|request_id|request-id/);
}

test("authenticated current Reporting Account discovers links without any Merchant/quota/window input", async () => {
  const x = fixture(); let sent;
  x.f.f.hooks.fetch = (url, init) => {
    sent = {url: url.toString(), init};
    return Response.json({results: [{productLink: {resourceName: "customers/123/productLinks/7",
      productLinkId: "7", type: "MERCHANT_CENTER", merchantCenter: {merchantCenterId: "99"}, privateField: "PRIVATE"}}]});
  };
  const {response, body} = await run(x);
  assert.equal(response.status, 200);
  assert.deepEqual(body, {status: "observed", complete: true, has_linked_merchant: true, merchant_ids: ["99"], link_count: 1,
    product_read_performed: false, quota_account_resolved: false, provider_retry_performed: false, authorizes_activation: false});
  assert.equal(sent.url, "https://googleads.googleapis.com/v25/customers/123/googleAds:search");
  assert.deepEqual(JSON.parse(sent.init.body), {query: GOOGLE_MERCHANT_LINK_QUERY});
  assert.equal(sent.init.headers["login-customer-id"], "456");
  assert.equal(sent.init.redirect, "error"); assert.ok(sent.init.signal instanceof AbortSignal);
  assert.equal(x.state.auth, 1); assert.equal(x.state.admin, 1); assert.equal(x.state.vault, 2);
  assert.equal(x.f.f.httpCalls.length, 1);
  assert.equal(x.f.calls.length, 0);
  assert.ok(x.f.f.sqlCalls.every(c => c.sql.includes("integrations.load_provider_identity_authority")));
  assert.equal(x.f.state.admissions, 0); assert.equal(x.f.state.paused, 0);
});

test("complete native empty links are no relationship, never product-zero acceptance", async () => {
  const x = fixture(); x.f.f.hooks.fetch = () => Response.json({});
  const {body} = await run(x);
  assert.equal(body.status, "observed"); assert.equal(body.has_linked_merchant, false);
  assert.deepEqual(body.merchant_ids, []); assert.equal(body.link_count, 0);
  assert.equal(body.product_read_performed, false); assert.equal(body.authorizes_activation, false);
  assert.equal(body.quota_account_resolved, false); assert.ok(!("recordCount" in body));
});

test("multiple real links project IDs only and do not choose a Merchant or infer a quota owner", async () => {
  const x = fixture(); x.f.f.hooks.fetch = () => Response.json({results: ["99", "98"].map((id, n) => ({productLink: {
    resourceName: `customers/123/productLinks/${n + 1}`, productLinkId: String(n + 1), type: "MERCHANT_CENTER", merchantCenter: {merchantCenterId: id}}}))});
  const {body} = await run(x);
  assert.deepEqual(body.merchant_ids, ["98", "99"]); assert.equal(body.link_count, 2);
  assert.equal(body.quota_account_resolved, false); assert.ok(!("merchantId" in body));
});

for (const kind of ["closed", "expired", "too_long", "extra", "zero", "bad_scope", "bad_developer"]) {
  test("configuration rejects before authentication or provider I/O: " + kind, async () => {
    const x = fixture();
    if (kind === "closed") delete x.environment.ADSTABLE_GOOGLE_MERCHANT_DISCOVERY_PLAN;
    if (kind === "expired") x.plan.expiresAt = new Date(x.options.now() - 1).toISOString();
    if (kind === "too_long") x.plan.expiresAt = new Date(x.options.now() + 900001).toISOString();
    if (kind === "extra") x.plan.merchantId = "99";
    if (kind === "zero") x.plan.accountId = "0";
    if (kind === "bad_scope") x.plan.shopDomain = "other.example.com";
    if (kind === "bad_developer") x.environment.GOOGLE_ADS_DEVELOPER_TOKEN = "bad\ntoken";
    if (kind !== "closed") x.setPlan();
    const {response, body} = await run(x); assert.equal(response.status, 503); safeStopped(body);
    assert.equal(x.state.auth, 0); assert.equal(x.f.f.sqlCalls.length, 0); noProvider(x);
  });
}

for (const kind of ["account", "merchant", "caller", "operation", "mode", "oversize", "malformed", "method", "header", "conflict"]) {
  test("request cannot override server identity or cause fallback: " + kind, async () => {
    const x = fixture(), input = {mode: "google_merchant_links_v1", operationId: x.plan.operationId};
    if (kind === "account") input.accountId = "999";
    if (kind === "merchant") input.merchantId = "99";
    if (kind === "caller") input.verified = x.f.options.verified;
    if (kind === "operation") input.operationId = "wrong";
    if (kind === "mode") input.mode = "reporting_v1";
    let request = x.request(input);
    if (kind === "oversize") request = x.request(input, {body: "x".repeat(1025)});
    if (kind === "malformed") request = x.request(input, {body: "{"});
    if (kind === "method") request = x.request(input, {method: "PUT"});
    if (kind === "header") request.headers.delete(GOOGLE_MERCHANT_DISCOVERY_HEADER);
    if (kind === "conflict") request.headers.set("x-adstable-google-acceptance", "v1");
    const {response, body} = await run(x, request); assert.equal(response.status, 400); safeStopped(body);
    assert.equal(x.state.auth, 0); noProvider(x);
  });
}

for (const kind of ["account", "selection", "version", "credential", "workspace", "generation", "shop", "missing_permission", "expired_token"]) {
  test("current authority is required before the native call: " + kind, async () => {
    const x = fixture();
    if (kind === "account") x.plan.accountId = "999";
    if (kind === "selection") x.plan.selectionId = "72";
    if (kind === "version") x.plan.connectionVersion++;
    if (kind === "credential") x.plan.credentialId = "55555555-5555-4555-8555-555555555555";
    if (kind === "workspace") x.plan.workspaceId = "55555555-5555-4555-8555-555555555555";
    if (kind === "generation") x.plan.installGeneration = "4";
    if (kind === "shop") x.plan.shopId = "gid://shopify/Shop/13";
    if (kind === "missing_permission") x.f.f.token.scope = "https://www.googleapis.com/auth/adwords";
    if (kind === "expired_token") {
      x.f.f.token.expires_at = new Date(x.options.now() - 1).toISOString();
      x.f.f.token.scope_verified_at = new Date(x.options.now() - 3600001).toISOString();
    }
    x.setPlan(); const {body} = await run(x); safeStopped(body); noProvider(x);
    if (kind === "expired_token") assert.equal(body.reason, "credential_refresh_required");
  });
}

test("Shopify authentication failure does not read the vault or call Google", async () => {
  const x = fixture(); x.options.authenticateAdmin = async () => {throw new Response(null, {status: 401});};
  await assert.rejects(run(x), e => e instanceof Response && e.status === 401);
  assert.equal(x.state.vault, 0); noProvider(x);
});

for (const kind of ["permission", "network", "pagination", "wrong_customer", "duplicate", "shape", "unknown_shape", "total_mismatch", "total_overflow", "oversize", "rows", "drift"]) {
  test("native error, partial or stale response is never an empty observation: " + kind, async () => {
    const x = fixture();
    x.f.f.hooks.fetch = () => {
      if (kind === "permission") return Response.json({error: {status: "PERMISSION_DENIED", message: "PRIVATE",
        details: [{errors: [{errorCode: {authorizationError: "CUSTOMER_NOT_ENABLED"}}]}]}}, {status: 403});
      if (kind === "network") throw Error("PRIVATE token SYNTHETIC-ACCESS");
      if (kind === "pagination") return Response.json({results: [], nextPageToken: "PRIVATE-CURSOR"});
      if (kind === "shape") return Response.json({results: null});
      if (kind === "unknown_shape") return Response.json({unrelated: "PRIVATE"});
      if (kind === "total_mismatch") return Response.json({results: [], totalResultsCount: "9"});
      if (kind === "total_overflow") return Response.json({results: [], totalResultsCount: "9007199254740993"});
      if (kind === "oversize") return new Response("x".repeat(1048577));
      if (kind === "rows") return Response.json({results: Array.from({length: 1001}, (_, n) => ({productLink: {
        resourceName: `customers/123/productLinks/${n + 1}`, productLinkId: String(n + 1), type: "MERCHANT_CENTER", merchantCenter: {merchantCenterId: "99"}}}))});
      if (kind === "drift") {x.f.f.state.version++; return Response.json({});}
      const link = {productLink: {resourceName: "customers/999/productLinks/1", productLinkId: "1", type: "MERCHANT_CENTER", merchantCenter: {merchantCenterId: "99"}}};
      if (kind === "duplicate") {link.productLink.resourceName = "customers/123/productLinks/1"; return Response.json({results: [link, link]});}
      return Response.json({results: [link]});
    };
    const {body} = await run(x); safeStopped(body); assert.equal(x.f.f.httpCalls.length, 1);
    if (kind === "permission") {
      assert.equal(body.reason, "provider_error"); assert.equal(body.provider_error.http_status, 403);
      assert.equal(body.provider_error.provider_error_code, "CUSTOMER_NOT_ENABLED");
    }
    if (kind === "drift") assert.equal(body.reason, "authority_changed");
  });
}

test("request abort during native HTTP stops without late publication, fallback or another Google call", async () => {
  const x = fixture(), controller = new AbortController(); let resolve;
  x.f.f.hooks.fetch = () => {controller.abort(); return new Promise(r => {resolve = r;});};
  const {body} = await run(x, x.request(undefined, {signal: controller.signal})); safeStopped(body);
  resolve(Response.json({})); await new Promise(r => setImmediate(r));
  assert.equal(x.f.f.httpCalls.length, 1); assert.equal(x.state.vault, 1);
});

test("abort while vault is pending prevents a late credential from reaching Google", async () => {
  const x = fixture(), controller = new AbortController(); let resolve;
  x.options.tokenVault = {loadProviderTokenSet() {controller.abort(); return new Promise(r => {resolve = r;});}};
  const {body} = await run(x, x.request(undefined, {signal: controller.signal})); safeStopped(body);
  resolve(x.f.f.token); await new Promise(r => setImmediate(r)); noProvider(x);
});

test("late authentication after abort cannot start a Shopify identity request", async () => {
  const x = fixture(), controller = new AbortController(); let resolve;
  const authenticate = x.options.authenticateAdmin;
  x.options.authenticateAdmin = () => {controller.abort(); return new Promise(r => {resolve = r;});};
  safeStopped((await run(x, x.request(undefined, {signal: controller.signal}))).body);
  resolve(await authenticate()); await new Promise(r => setImmediate(r));
  assert.equal(x.state.admin, 0); assert.equal(x.state.vault, 0); noProvider(x);
});

test("server plan is captured before authentication and rechecked for expiry before Google", async () => {
  const x = fixture(), authenticate = x.options.authenticateAdmin;
  x.options.authenticateAdmin = async req => {x.plan.accountId = "999"; x.setPlan(); return authenticate(req);};
  assert.equal((await run(x)).body.status, "observed");
  const y = fixture(), original = y.options.authenticateAdmin;
  // The captured clock function itself remains private, so advance its returned time.
  let time = y.f.options.now(); y.options.now = () => time;
  y.options.authenticateAdmin = async req => {time = Date.parse(y.plan.expiresAt) + 1; return original(req);};
  safeStopped((await run(y)).body); noProvider(y);
});

test("existing route dispatches discovery before legacy reporting and rejects cross-mode headers", () => {
  const source = fs.readFileSync(new URL("../app/routes/settings.google-live-evidence.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("request.headers.has(GOOGLE_MERCHANT_DISCOVERY_HEADER)") < source.indexOf("request.headers.has(GOOGLE_ACCEPTANCE_HEADER)"));
  assert.match(source, /handleGoogleMerchantDiscoveryRequest\(\{request, authenticateAdmin: authenticate.admin,\s+database, tokenVault: providerTokenVault\}\)/);
  assert.equal(readGoogleMerchantDiscoveryPlan({}), null);
});
