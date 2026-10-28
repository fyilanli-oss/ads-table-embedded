import {providerClaimPrewriteCases} from "./helpers/provider-claim-prewrite-cases.js";
import {reviewRefreshReferencePrewrite} from "../app/lib/providers/reference-prewrite.server.js";


import test,{after} from "node:test";
import assert from "node:assert/strict";
import {collectGoogleMerchantIdentityEvidence, collectGoogleVerifiedProductCandidateEvidence} from "../app/lib/providers/google-identity-collection.server.js";
import {createGoogleCandidateSourceRuleLoader, verifyGoogleMerchantSourceCandidates} from "../app/lib/providers/google-source-candidates.server.js";
import {readMerchantProductIdentitySnapshot, matchMerchantProductIdentity} from "../app/lib/providers/google-product-identity-reader.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createQuotaManagedFetch, quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createQuotaScopeResolver, quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createRefreshGoogleIdentityReader,createRefreshGoogleCandidateReader} from "../app/lib/refresh/quota-authority-binding.server.js";
import "@shopify/shopify-api/adapters/node";
import {shopifyApi,ApiVersion,LogSeverity,Session} from "@shopify/shopify-api";
import {abstractFetch,setAbstractFetchFunc} from "@shopify/shopify-api/runtime";
import {createShopifyAdminIdentitySdkBridge} from "../app/lib/refresh/shopify-admin-sdk-quota-bridge.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {refreshQuotaWait} from "../app/lib/refresh/quota-work-wait.server.js";
import {candidatePrewriteCases} from "./helpers/candidate-prewrite-cases.js";
import {reviewRefreshCandidatePrewrite} from "../app/lib/providers/candidate-prewrite.server.js";

const workspace = "11111111-1111-4111-8111-111111111111", connection = "22222222-2222-4222-8222-222222222222",
  credential = "33333333-3333-4333-8333-333333333333";
function response(body, status = 200) {return {ok: status === 200, status, headers: {get: () => "request1"}, json: async () => body};}
function product(offerId = "shopify_US_123_456") {
  return {name: `accounts/99/products/en~US~${offerId}`, offerId, contentLanguage: "en", feedLabel: "US", dataSource: "accounts/99/dataSources/7"};
}
function link(id = "7", merchant = "99") {
  return {productLink: {resourceName: `customers/123/productLinks/${id}`, productLinkId: id,
    type: "MERCHANT_CENTER", merchantCenter: {merchantCenterId: merchant}}};
}
function fixture() {
  const calls = [], queries = [], hooks = {}, state = {version: 2, account: "123", manager: "456", status: "connected",
    now: new Date("2026-10-27T15:00:00.000Z"), generation: 3, scopes: [...oauthPermissionScopes("google_ads", "identity_v1")]};
  const verified = {installationAuthority: {authority: "shopify_installation_verified", workspaceId: workspace, installGeneration: 3, status: "active"},
    identity: {session: {authority: "shopify_id_token_verified", shopDomain: "test.myshopify.com"},
      shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"}},
    context: {admin: {graphql() {throw Error("no unproven source format may reach Shopify");}}}};
  const token = {access_token: "secret-access", refresh_token: "secret-refresh", permission_profile: "identity_v1",
    scope: state.scopes.join(" "), scope_verified_at: state.now.toISOString(), expires_in: 3600, expires_at: "2026-10-27T16:00:00.000Z"};
  const database = {async query(sql, params) {
    queries.push({sql, params}); await hooks.query?.(sql);
    if (sql.includes("resolve_active_installation")) return {rows: [{workspace_id: workspace, install_generation: state.generation, installation_status: "active"}]};
    if (sql.includes("load_provider_connection_lifecycle_by_owner")) return {rows: [{connection_id: connection, credential_id: credential,
      lifecycle_status: state.status, connection_version: state.version}]};
    if (sql.includes("load_provider_account_authority")) return {rows: [{connection_id: connection, credential_id: credential,
      reporting_account_id: state.account, granted_scopes: [...state.scopes], accounts: [{id: state.account, kind: "advertiser",
        reporting_eligible: true, login_account_id: state.manager}]}]};
    throw Error("unexpected SQL");
  }};
  const tokenVault = {loadProviderTokenSet: async () => token};
  const fetchFn = async (endpoint, init) => {
    const parsed = new URL(endpoint); calls.push({endpoint, parsed, init});
    const custom = await hooks.fetch?.(parsed, init, calls.length); if (custom) return custom;
    if (parsed.hostname === "googleads.googleapis.com") return response({results: [link()]});
    if (parsed.hostname === "merchantapi.googleapis.com") return response({products: [product()]});
    throw Error("unexpected endpoint");
  };
  const options = {verified, database, tokenVault, merchantId: "99", developerToken: "secret-developer", fetchFn, now: () => state.now};
  return {state, calls, queries, hooks, token, options, run: () => collectGoogleMerchantIdentityEvidence(options)};
}

test("concrete authority loader composes native Ads link, Merchant source and final link with no invented scope", async () => {
  const f = fixture(), r = await f.run();
  assert.equal(f.calls.length, 3); assert.equal(r.native_source.records[0].native_product_id, "shopify_US_123_456");
  assert.equal(r.native_source.scope, undefined); assert.equal(r.installation_id, null); assert.equal(r.canonical_scope_ready, false);
  assert.equal(r.provider_link_verified, true); assert.equal(r.relationship_scope, "observed_direct_Ads_Merchant_relationship_only");
  assert.equal(r.native_source.provider_link_verified, false); assert.equal(r.persistable, false); assert.equal(r.mapping_write_performed, false);
  assert.equal(r.shopify_mapping_state, "not_resolved"); assert.equal(r.source_facts_changed, false);
  assert.equal(r.native_source.records[0].shopify_product_id, undefined); assert.ok(Object.isFrozen(r.native_source.records));
  assert.ok(!/secret-access|secret-refresh|secret-developer|credentialId/.test(JSON.stringify(r)));
  assert.ok(f.queries.every(q => q.sql.startsWith("select *")));
  assert.ok(f.calls.every(c => c.init.redirect === "error"));
  const ads = f.calls.filter(c => c.parsed.hostname === "googleads.googleapis.com");
  assert.equal(ads[0].init.headers["login-customer-id"], "456"); assert.equal(ads[0].init.headers["developer-token"], "secret-developer");
  assert.equal(ads[0].init.body, ads[1].init.body);
  assert.equal(f.calls[1].init.headers.Authorization, "Bearer secret-access");
});
test("full-scope entry point still rejects missing PK before native request", async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(readMerchantProductIdentitySnapshot({authority: {workspace_id: workspace, installation_generation: 3,
    provider_connection_id: connection, platform: "google_ads", platform_account_id: "123", merchant_id: "99", granted_scopes: f.state.scopes},
  accessToken: "token", fetchFn: async () => {calls++;}})); assert.equal(calls, 0);
});
test("source-only snapshot cannot be relabeled as canonical by the old matcher", async () => {
  const r = await fixture().run(); assert.throws(() => matchMerchantProductIdentity(r.native_source,
    {merchantId: "99", feedLabel: "US", itemId: "shopify_US_123_456"}), /CONTEXT_INVALID/);
});
test("native Merchant pagination follows empty intermediate page without changing target", async () => {
  const f = fixture(); f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && !p.searchParams.has("pageToken")
    && response({nextPageToken: "second"});
  const r = await f.run(); assert.equal(r.native_source.pages, 2); assert.equal(f.calls.length, 4);
  assert.equal(f.calls[2].parsed.searchParams.get("pageToken"), "second"); assert.equal(f.calls[2].parsed.pathname, f.calls[1].parsed.pathname);
});
for (const [name, rows] of [["not linked", []], ["other Merchant", [link("7", "100")]], ["ambiguous links", [link(), link("8")]]]) {
  test(`${name}: native relationship must be unique before Merchant read`, async () => {
    const f = fixture(); f.hooks.fetch = () => response({results: rows});
    await assert.rejects(f.run(), /LINK_NOT_CONFIRMED/); assert.equal(f.calls.length, 1);
  });
}
test("native link change after source read discards the source", async () => {
  const f = fixture(); f.hooks.fetch = (p, init, n) => p.hostname === "googleads.googleapis.com" && n > 1 && response({results: [link("8")]});
  await assert.rejects(f.run(), /LINK_CHANGED/); assert.equal(f.calls.length, 3);
});
for (const [name, change] of [["version", s => {s.version++;}], ["selected Ads account", s => {s.account = "789";}],
  ["manager", s => {s.manager = "789";}], ["generation", s => {s.generation++;}], ["disconnect", s => {s.status = "disconnect_pending";}]]) {
  test(`current ${name} change prevents Merchant request`, async () => {
    const f = fixture(); f.hooks.fetch = p => {if (p.hostname === "googleads.googleapis.com") change(f.state);};
    await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
  });
}
test("same credential ID with changed secret rejects collection", async () => {
  const f = fixture(); f.hooks.fetch = p => {if (p.hostname === "merchantapi.googleapis.com") f.token.access_token = "changed";};
  await assert.rejects(f.run()); assert.equal(f.calls.length, 2);
});
for (const change of [f => {f.token.permission_profile = "reporting_v1";}, f => {f.token.expires_at = f.state.now.toISOString();},
  f => {f.state.scopes = [f.state.scopes[0]];}]) test("invalid credential or missing identity grant stops without refresh", async () => {
  const f = fixture(); change(f); await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
});
for (const status of [401, 403, 429, 500]) test(`Merchant ${status} stops before link recheck, no retry`, async () => {
  const f = fixture(); f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && response({error: {message: "secret-native"}}, status);
  await assert.rejects(f.run(), e => e.message === "GOOGLE_IDENTITY_COLLECTION_FAILED"); assert.equal(f.calls.length, 2);
});
test("first transport error is sanitized and never retried", async () => {
  const f = fixture(); f.hooks.fetch = () => {throw Error("secret-credential-payload");};
  await assert.rejects(f.run(), /COLLECTION_FAILED/); assert.equal(f.calls.length, 1);
});
test("source records retain raw product and feed/language/dataSource/local context without parsing", async () => {
  const f = fixture(), raw = product("opaque/native/123"); raw.customAttributes = [{name: "shopify_product_id", value: "unproven"}];
  f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && response({products: [raw]});
  const r = await f.run(); raw.customAttributes[0].value = "changed";
  assert.equal(r.native_source.records[0].source_record.customAttributes[0].value, "unproven");
  assert.equal(r.native_source.records[0].product_context.content_language, "en");
  assert.equal(r.native_source.records[0].product_context.data_source, "accounts/99/dataSources/7");
});
test("cross-Merchant product response cannot become source evidence", async () => {
  const f = fixture(), raw = product(); raw.dataSource = "accounts/100/dataSources/7";
  f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && response({products: [raw]});
  await assert.rejects(f.run()); assert.equal(f.calls.length, 2);
});
test("authentic local quota wait survives shared reader sanitization", async () => {
  const managed = createQuotaManagedFetch({provider: "google_ads", guard: {execute: async () => ({status: "waiting"})},
    resolveOperation: async () => "a".repeat(64), lane: "background", fetchFn: async () => {throw Error("must not send");}});
  let control; try {await managed("https://googleads.googleapis.com/v25/customers/123/googleAds:search", {method: "POST"});} catch (error) {control = error;}
  assert.equal(quotaBoundaryControl(control).status, "waiting");
  const f = fixture(); f.hooks.fetch = p => {if (p.hostname === "merchantapi.googleapis.com") throw control;};
  await assert.rejects(f.run(), e => e === control); assert.equal(f.calls.length, 2);
});
test("abort during Merchant read reaches native request and prevents final link", async () => {
  const f = fixture(), controller = new AbortController(); f.options.signal = controller.signal;
  f.hooks.fetch = (p, init) => {assert.ok(init.signal instanceof AbortSignal); if (p.hostname === "merchantapi.googleapis.com") {controller.abort(); assert.equal(init.signal.aborted, true);}};
  await assert.rejects(f.run(), /ABORTED/); assert.equal(f.calls.length, 2);
});
test("observation window does not become a completed stale snapshot", async () => {
  const f = fixture(); f.hooks.fetch = p => {if (p.hostname === "merchantapi.googleapis.com") f.state.now = new Date(f.state.now.valueOf() + 121000);};
  await assert.rejects(f.run()); assert.equal(f.calls.length, 2);
});
test("invalid target/bounds stop before SQL or provider calls", async () => {
  const f = fixture(); f.options.merchantId = "99/100"; await assert.rejects(f.run(), /INPUT_INVALID/); assert.equal(f.queries.length, 0);
});
test("caller authority callback cannot replace persisted selected account", async () => {
  const f = fixture(); f.options.loadCurrent = () => {throw Error("must not use");}; assert.equal((await f.run()).account_id, "123");
});

function rule() {
  return {state: "verified_source_rule", source_reference: "synthetic-reviewed-native-source-proof",
    scope: {workspace_id: workspace, installation_generation: 3, provider_connection_id: connection, platform: "google_ads", platform_account_id: "123"},
    product_context: {merchant_id: "99", feed_label: "US", content_language: "en", data_source: "accounts/99/dataSources/7", legacy_local: false},
    shop_id: "gid://shopify/Shop/12", format: "shopify_market_product_variant", market: "US"};
}
function candidateFixture() {
  const f = fixture(), shopCalls = [], shopHooks = {};
  f.options.sourceRules = [rule()];
  f.options.verified.context.admin.graphql = async (query, options) => {
    shopCalls.push({query, options}); const custom = await shopHooks.graphql?.(query, options); if (custom) return custom;
    const p = options.variables.productId?.split("/").at(-1) ?? "123", v = options.variables.variantId?.split("/").at(-1);
    return response({data: {shop: {id: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"},
      ...(options.variables.productId ? {product: {id: `gid://shopify/Product/${p}`, legacyResourceId: p}} : {}),
      ...(v ? {productVariant: {id: `gid://shopify/ProductVariant/${v}`, legacyResourceId: v,
        product: {id: `gid://shopify/Product/${p}`, legacyResourceId: p}}} : {})}});
  };
  return {...f, shopCalls, shopHooks, run: () => collectGoogleVerifiedProductCandidateEvidence(f.options)};
}
test("candidate composition: empty default registry keeps Shopify-looking offer opaque and unresolved", async () => {
  const f = candidateFixture(); delete f.options.sourceRules;
  const r = await f.run(); assert.equal(f.shopCalls.length, 0); assert.equal(r.product_identity_candidates.candidates.length, 0);
  assert.equal(r.product_identity_candidates.rows[0].product_identity_verification.reason, "verified_source_rule_required");
});
test("candidate composition: exact reviewed rule and same-shop parent produce only local candidate evidence", async () => {
  const f = candidateFixture(), r = await f.run(), candidates = r.product_identity_candidates;
  assert.equal(f.shopCalls.length, 1); assert.equal(f.shopCalls[0].options.tries, 1);
  assert.deepEqual(f.shopCalls[0].options.variables, {productId: "gid://shopify/Product/123", variantId: "gid://shopify/ProductVariant/456"});
  assert.equal(candidates.candidates[0].shopify_product_id, "gid://shopify/Product/123");
  assert.equal(candidates.candidates[0].candidate_evidence.source_rule.source_reference, rule().source_reference);
  assert.equal(candidates.rows[0].standardized_product_id, null); assert.equal(candidates.mappings, undefined);
  assert.equal(r.installation_id, null); assert.equal(r.canonical_scope_ready, false); assert.equal(candidates.provider_link_verified, false);
  assert.equal(r.provider_link_verified, true); assert.equal(r.persistable, false); assert.equal(r.mapping_write_performed, false);
});
for (const [name, mutate] of [
  ["workspace", r => {r.scope.workspace_id = credential;}], ["generation", r => {r.scope.installation_generation++;}],
  ["connection", r => {r.scope.provider_connection_id = credential;}], ["Ads account", r => {r.scope.platform_account_id = "789";}],
  ["Merchant", r => {r.product_context.merchant_id = "100"; r.product_context.data_source = "accounts/100/dataSources/7";}],
  ["feed", r => {r.product_context.feed_label = "CA";}], ["language", r => {r.product_context.content_language = "fr";}],
  ["dataSource", r => {r.product_context.data_source = "accounts/99/dataSources/8";}], ["local", r => {r.product_context.legacy_local = true;}],
  ["shop", r => {r.shop_id = "gid://shopify/Shop/99";}],
]) test(`candidate composition: ${name} rule cannot bleed into current source`, async () => {
  const f = candidateFixture(); mutate(f.options.sourceRules[0]); const r = await f.run();
  assert.equal(f.shopCalls.length, 0); assert.equal(r.product_identity_candidates.candidates.length, 0);
});
test("candidate composition: wrong market pattern does not parse despite same context", async () => {
  const f = candidateFixture(); f.options.sourceRules[0].market = "CA";
  const r = await f.run(); assert.equal(f.shopCalls.length, 0);
  assert.equal(r.product_identity_candidates.rows[0].product_identity_verification.reason, "native_id_does_not_match_verified_rule");
});
test("candidate composition: conflicting rules reject before native calls", async () => {
  const f = candidateFixture(); f.options.sourceRules.push({...rule(), source_reference: "other-proof"});
  await assert.rejects(f.run(), /RULE_CONFLICT/); assert.equal(f.calls.length, 0); assert.equal(f.shopCalls.length, 0);
});
test("candidate composition: malformed evidence is not a verified rule", async () => {
  const f = candidateFixture(); f.options.sourceRules[0].source_reference = "";
  await assert.rejects(f.run(), /RULE_INVALID/); assert.equal(f.calls.length, 0);
});
test("candidate composition: registry detaches rules before first asynchronous native read", async () => {
  const f = candidateFixture(); f.hooks.fetch = () => {f.options.sourceRules[0].market = "CA";};
  assert.equal((await f.run()).product_identity_candidates.candidates.length, 1);
});
test("candidate composition: native-only entry cannot enable parsing through caller flags", async () => {
  const f = candidateFixture(); f.options.withShopify = true;
  const r = await collectGoogleMerchantIdentityEvidence(f.options); assert.equal(f.shopCalls.length, 0); assert.equal(r.product_identity_candidates, undefined);
});
test("candidate composition: candidate entry cannot disable Admin via caller flags", async () => {
  const f = candidateFixture(); f.options.withShopify = false;
  assert.equal((await f.run()).product_identity_candidates.candidates.length, 1); assert.equal(f.shopCalls.length, 1);
});
test("candidate composition: first Admin error stops before final Ads link with no partial candidates", async () => {
  const f = candidateFixture(); f.shopHooks.graphql = () => {throw Error("secret-admin-payload");};
  await assert.rejects(f.run(), e => e.message === "GOOGLE_IDENTITY_COLLECTION_FAILED"); assert.equal(f.calls.length, 2); assert.equal(f.shopCalls.length, 1);
});
test("candidate composition: active authority change during Admin JSON rejects collection", async () => {
  const f = candidateFixture(); f.shopHooks.graphql = () => {f.state.version++;};
  await assert.rejects(f.run(), /COLLECTION_FAILED/); assert.equal(f.calls.length, 2);
});
test("candidate composition: unresolved native product and wrong parent are separate results", async () => {
  for (const wrongParent of [false, true]) {
    const f = candidateFixture(); f.shopHooks.graphql = () => response({data: {shop: {id: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"},
      product: wrongParent ? {id: "gid://shopify/Product/123", legacyResourceId: "123"} : null,
      productVariant: wrongParent ? {id: "gid://shopify/ProductVariant/456", legacyResourceId: "456", product: {id: "gid://shopify/Product/789", legacyResourceId: "789"}} : null}});
    const r = await f.run(); assert.equal(r.product_identity_candidates.rows[0].product_identity_verification.state, wrongParent ? "conflicting" : "unresolved");
    assert.equal(r.product_identity_candidates.candidates.length, 0);
  }
});
test("candidate composition: explicit product-only and variant-only rules share native Shopify verification", async () => {
  for (const format of ["shopify_product_id", "shopify_variant_id"]) {
    const f = candidateFixture(); f.options.sourceRules[0].format = format; delete f.options.sourceRules[0].market;
    f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && response({products: [product("123")]});
    const r = await f.run(); assert.equal(r.product_identity_candidates.candidates[0].shopify_product_id, "gid://shopify/Product/123");
    assert.equal(f.shopCalls[0].options.variables[format === "shopify_product_id" ? "variantId" : "productId"], undefined);
  }
});
test("candidate composition: final Ads link change invalidates successful Shopify candidates", async () => {
  const f = candidateFixture(); f.hooks.fetch = (p, init, n) => p.hostname === "googleads.googleapis.com" && n > 1 && response({results: [link("8")]});
  await assert.rejects(f.run(), /LINK_CHANGED/); assert.equal(f.shopCalls.length, 1);
});
test("candidate composition: Admin abort reaches request and stops final link", async () => {
  const f = candidateFixture(), control = new AbortController(); f.options.signal = control.signal;
  f.shopHooks.graphql = (query, options) => {assert.ok(options.signal instanceof AbortSignal); control.abort(); assert.equal(options.signal.aborted, true);};
  await assert.rejects(f.run(), /ABORTED/); assert.equal(f.calls.length, 2);
});
test("candidate composition: forged rule loader object is not accepted by candidate API", async () => {
  const f = fixture(), source = (await f.run()).native_source;
  await assert.rejects(verifyGoogleMerchantSourceCandidates({source, ownerScope: rule().scope,
    context: {shop: f.options.verified.identity.shop, installation: f.options.verified.installationAuthority,
      admin: f.options.verified.context.admin}, sourceRules: {load: () => rule()}}), /INPUT_INVALID/);
});
test("candidate composition: reviewed loader cannot match a full-PK or broader scope by accident", () => {
  const loader = createGoogleCandidateSourceRuleLoader({rules: [rule()]});
  assert.throws(() => loader.load({...rule(), scope: {...rule().scope, installation_id: "99"}}), /SCOPE_INVALID/);
});
test("candidate composition: multiple native contexts retain distinct evidence while same Shopify pair queries once", async () => {
  const f = candidateFixture(), other = rule(); other.product_context.content_language = "fr"; other.source_reference = "other-language-proof";
  f.options.sourceRules.push(other);
  const raw = product(); raw.contentLanguage = "fr"; raw.name = "accounts/99/products/fr~US~shopify_US_123_456";
  f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && response({products: [product(), raw]});
  const r = await f.run(); assert.equal(f.shopCalls.length, 1); assert.equal(r.product_identity_candidates.candidates.length, 2);
  assert.notEqual(r.product_identity_candidates.candidates[0].candidate_evidence.source_record_key, r.product_identity_candidates.candidates[1].candidate_evidence.source_record_key);
});
test("candidate composition: authentic local quota wait from Admin is preserved exactly", async () => {
  const managed = createQuotaManagedFetch({provider: "google_ads", guard: {execute: async () => ({status: "waiting"})},
    resolveOperation: async () => "a".repeat(64), lane: "background", fetchFn: async () => {throw Error("must not send");}});
  let control; try {await managed("https://googleads.googleapis.com/v25/customers/123/googleAds:search", {method: "POST"});} catch (e) {control = e;}
  const f = candidateFixture(); f.shopHooks.graphql = () => {throw control;};
  await assert.rejects(f.run(), e => e === control); assert.equal(f.calls.length, 2);
});
test("candidate composition: unverified rule state cannot authorize extraction", () => {
  const input = rule(); input.state = "proposed";
  assert.throws(() => createGoogleCandidateSourceRuleLoader({rules: [input]}), /RULE_INVALID/);
});
test("candidate composition: tampered source projection rejected before first Admin call", async () => {
  const f = fixture(), source = structuredClone((await f.run()).native_source); source.records[0].source_record.offerId = "different";
  await assert.rejects(verifyGoogleMerchantSourceCandidates({source, ownerScope: rule().scope,
    context: {shop: f.options.verified.identity.shop, installation: f.options.verified.installationAuthority,
      admin: f.options.verified.context.admin}, sourceRules: createGoogleCandidateSourceRuleLoader({rules: [rule()]})}), /SOURCE_INVALID/);
});
test("candidate composition: cancelled empty source is not returned as accepted", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(verifyGoogleMerchantSourceCandidates({source: {complete: true, context: {merchant_id: "99"}, records: []},
    ownerScope: rule().scope, context: {shop: f.options.verified.identity.shop, installation: f.options.verified.installationAuthority},
    sourceRules: createGoogleCandidateSourceRuleLoader(), signal: controller.signal}), /ABORTED/);
});

test("deadline: stalled native fetch and stalled native body reject and abort transport", async () => {
  for (const mode of ["fetch", "body"]) {
    const f = fixture(); let signal; f.options.maxElapsedMs = 30;
    f.hooks.fetch = (p, init) => {signal = init.signal;
      return mode === "fetch" ? new Promise(() => {}) : {...response({}), json: () => new Promise(() => {})};};
    await assert.rejects(f.run(), /IDENTITY_READ_DEADLINE_EXCEEDED/); assert.equal(signal.aborted, true); assert.equal(f.calls.length, 1);
  }
});
test("deadline: blocked SQL authority cannot send a later provider request after timeout", async () => {
  const f = fixture(); f.options.maxElapsedMs = 20; let resume;
  f.hooks.query = () => new Promise(resolve => {resume = resolve;});
  await assert.rejects(f.run(), /DEADLINE_EXCEEDED/); assert.equal(f.calls.length, 0);
  delete f.hooks.query; resume(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 1);
});
test("deadline: stalled Shopify Admin and JSON stop before final native link", async () => {
  for (const mode of ["request", "body"]) {
    const f = candidateFixture(); let signal; f.options.maxElapsedMs = 100;
    f.shopHooks.graphql = (q, o) => {signal = o.signal; return mode === "request" ? new Promise(() => {}) : {...response({}), json: () => new Promise(() => {})};};
    await assert.rejects(f.run(), /DEADLINE_EXCEEDED/); assert.equal(signal.aborted, true); assert.equal(f.calls.length, 2);
  }
});
test("deadline: pre-aborted caller makes no SQL, vault or provider request", async () => {
  const f = fixture(), caller = new AbortController(); caller.abort(); f.options.signal = caller.signal;
  await assert.rejects(f.run(), /IDENTITY_READ_ABORTED/); assert.equal(f.queries.length, 0); assert.equal(f.calls.length, 0);
});

function quotaFixture() {
  const f = fixture(), native = f.options.fetchFn, metadata = [], reservations = [], settles = [], stops = [], lookups = [], q = {};
  const c = {provider: "google_ads", clientScopeKey: "a".repeat(64), connectionScopeKey: "b".repeat(64), connectionEpoch: 1,
    accountId: "123", organizationId: null, apiVersion: "v25",
    merchant: {targetAccountId: "99", quotaAccountId: "98", apiVersion: "products/v1", bindingEpoch: 1}};
  const configured = new Set([quotaRouteIdentity(c, {provider: "google_ads", family: "reporting_query", accountId: "123", organizationId: null, version: "v25", includes: []}).routeKey,
    quotaRouteIdentity(c, {provider: "google_ads", family: "merchant_products", accountId: "99", organizationId: null, version: "products/v1", includes: []}).routeKey]);
  const store = {resolveRoute: async x => {lookups.push(x); return configured.has(x.routeKey) && x.routeKey !== q.missingKey ? x.routeKey : null;},
    reserve: async x => {reservations.push(x); if (q.waitAt === reservations.length) return {status: "waiting"};
      const r = {...x, status: "reserved", dispatchBeforeMs: Date.now() + 10000, dispatchBudgetMs: 10000}; q.reserved?.(); return r;},
    settle: async x => {settles.push(x); return true;}, stop: async x => {stops.push(x); return true;}};
  const resolve = createQuotaScopeResolver({loadContext: async () => c, store});
  f.options.fetchFn = createQuotaManagedFetch({provider: "google_ads", lane: "background", guard: createSharedQuotaGuard({store, now: Date.now}),
    resolveOperation: async d => {metadata.push(d); return resolve(d);}, isDispatchCurrent: async (d, k) => await resolve(d) === k,
    fetchFn: async (...args) => {const r = await native(...args); return new Response(JSON.stringify(await r.json()), {status: r.status, headers: {"content-type": "application/json"}});}});
  return {...f, c, q, metadata, reservations, settles, stops, lookups};
}
test("Merchant quota integration: native Ads link/Merchant/link debits correct separate routes per HTTP", async () => {
  const f = quotaFixture(); const r = await f.run(); assert.equal(r.persistable, false);
  assert.equal(f.calls.length, 3); assert.equal(f.reservations.length, 3); assert.equal(f.settles.length, 3);
  assert.deepEqual(f.metadata.map(d => [d.family, d.accountId, d.version]),
    [["reporting_query", "123", "v25"], ["merchant_products", "99", "products/v1"], ["reporting_query", "123", "v25"]]);
  assert.equal(f.reservations[0].operationKey, f.reservations[2].operationKey);
  assert.notEqual(f.reservations[0].operationKey, f.reservations[1].operationKey);
  assert.ok(f.lookups.every(x => Object.keys(x).sort().join(",") === "connectionScopeKey,provider,routeKey"));
  assert.doesNotMatch(JSON.stringify([f.metadata, f.lookups, f.reservations]), /secret-access|secret-developer|SELECT|shopify_US|pageToken/);
});
test("Merchant quota integration: empty intermediate page makes another quota reservation", async () => {
  const f = quotaFixture(); f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && !p.searchParams.has("pageToken") && response({nextPageToken: "next"});
  assert.equal((await f.run()).native_source.pages, 2); assert.equal(f.reservations.length, 4); assert.equal(f.calls.length, 4);
});
test("Merchant quota integration: missing binding or target mismatch stops before Merchant HTTP", async () => {
  for (const change of [c => {delete c.merchant;}, c => {c.merchant.targetAccountId = "100";}]) {
    const f = quotaFixture(); change(f.c);
    await assert.rejects(f.run(), e => quotaBoundaryControl(e)?.status === "not_configured");
    assert.equal(f.calls.length, 1); assert.equal(f.metadata[0].family, "reporting_query");
  }
});
test("Merchant quota integration: wait before Merchant preserves previous Ads attempt without retry", async () => {
  const f = quotaFixture(); f.q.waitAt = 2;
  await assert.rejects(f.run(), e => quotaBoundaryControl(e)?.status === "waiting" && quotaBoundaryControl(e).priorBoundaryAttempts === 1);
  assert.equal(f.calls.length, 1); assert.equal(f.stops.length, 0);
});
test("Merchant quota integration: quota pool or binding epoch drift after reserve settles without Merchant send", async () => {
  for (const change of [c => {c.merchant.quotaAccountId = "97";}, c => {c.merchant.bindingEpoch++;}]) {
    const f = quotaFixture(); f.q.reserved = () => {if (f.reservations.length === 2) change(f.c);};
    await assert.rejects(f.run(), e => quotaBoundaryControl(e)?.status === "not_sent");
    assert.equal(f.calls.length, 1); assert.equal(f.reservations.length, 2); assert.equal(f.settles.length, 2);
  }
});
test("Merchant quota integration: missing owner profile does not fall back to Ads operation", async () => {
  const f = quotaFixture(); f.q.missingKey = quotaRouteIdentity(f.c,
    {provider: "google_ads", family: "merchant_products", accountId: "99", organizationId: null, version: "products/v1", includes: []}).routeKey;
  await assert.rejects(f.run(), e => quotaBoundaryControl(e)?.status === "not_configured"); assert.equal(f.calls.length, 1); assert.equal(f.reservations.length, 1);
});
test("Merchant quota integration: first Merchant provider rejection records stop with no Ads quota signal", async () => {
  const f = quotaFixture(); f.hooks.fetch = p => p.hostname === "merchantapi.googleapis.com" && response({error: {code: 429, status: "RESOURCE_EXHAUSTED", message: "SECRET"}}, 429);
  await assert.rejects(f.run()); assert.equal(f.calls.length, 2); assert.equal(f.stops.length, 1);
  assert.equal(f.stops[0].quotaSignal, null); assert.equal(f.stops[0].quotaObservation, undefined); assert.doesNotMatch(JSON.stringify(f.stops), /SECRET/);
});

function boundFixture() {
  const f=fixture(),native=f.options.fetchFn,q={},loads=[],reservations=[],settles=[],stops=[],lookups=[];
  const c={provider:"google_ads",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:1,
    accountId:"123",organizationId:null,apiVersion:"v25",
    merchant:{targetAccountId:"99",quotaAccountId:"98",apiVersion:"products/v1",bindingEpoch:1}};
  const keys=new Map([["reporting_query","123","v25"],["merchant_products","99","products/v1"]]
    .map(([family,accountId,version])=>[family,quotaRouteIdentity(c,{provider:"google_ads",family,accountId,organizationId:null,version,includes:[]}).routeKey]));
  const config={verified:f.options.verified,database:f.options.database,tokenVault:f.options.tokenVault,
    merchantId:"99",developerToken:"secret-developer",readNow:()=>f.state.now,now:Date.now,
    claim:{workspaceId:workspace,installGeneration:"3",provider:"google_ads",accountId:"123",id:"job1",fence:2},
    window:{from:"2026-10-01",to:"2026-10-01"},entitlementReceipt:{observedAt:f.state.now.toISOString()},
    workStore:{loadQuotaContext:async input=>{loads.push(input);await q.load?.();
      if(q.lost||f.state.version!==2||f.state.account!=="123")return null;return c;}},
    quotaStore:{resolveRoute:async x=>{lookups.push(x);return [...keys.values()].includes(x.routeKey)&&x.routeKey!==keys.get(q.missingFamily)?x.routeKey:null;},
      reserve:async x=>{reservations.push(x);if(reservations.length===q.waitAt)return {status:"waiting"};
        const permit={...x,status:"reserved",dispatchBeforeMs:Date.now()+10000,dispatchBudgetMs:10000};q.reserved?.();return permit;},
      settle:async x=>{settles.push(x);return true;},stop:async x=>{stops.push(x);return true;}},
    fetchFn:async(...args)=>{const r=await native(...args);return new Response(JSON.stringify(await r.json()),
      {status:r.status,headers:{"content-type":"application/json"}});}};
  return {...f,config,c,q,loads,reservations,settles,stops,lookups,create:()=>createRefreshGoogleIdentityReader(config)};
}

test("bound Google: native Ads/Merchant/link chain binds fenced work and separate quota routes",async()=>{
  const f=boundFixture(),r=await f.create().readEvidence();
  assert.equal(f.calls.length,3);assert.equal(f.reservations.length,3);assert.equal(f.settles.length,3);assert.equal(f.loads.length,6);
  assert.equal(f.reservations[0].operationKey,f.reservations[2].operationKey);assert.notEqual(f.reservations[0].operationKey,f.reservations[1].operationKey);
  assert.ok(f.loads.every(x=>x.provider==="google_ads"&&x.claim.id==="job1"&&x.claim.fence===2&&x.claim.accountId==="123"
    &&x.window.from==="2026-10-01"&&x.entitlementReceipt.observedAt===f.state.now.toISOString()));
  assert.equal(f.c.merchant.quotaAccountId,"98");assert.equal(r.installation_id,null);assert.equal(r.persistable,false);
  assert.equal(r.shopify_mapping_state,"not_resolved");assert.equal(r.native_source.records[0].shopify_product_id,undefined);
  assert.equal(f.calls[0].init.headers.get("login-customer-id"),"456");assert.equal(f.calls[0].init.headers.get("developer-token"),"secret-developer");
  assert.doesNotMatch(JSON.stringify([f.loads,f.lookups,f.reservations,f.stops]),/secret-access|secret-refresh|secret-developer|SELECT|shopify_US|pageToken/);
});
test("bound Google: owner job target and developer token are captured before read",async()=>{
  const f=boundFixture(),reader=f.create();f.config.claim.accountId="789";f.config.claim.fence=99;f.config.window.from="2026-10-02";
  f.config.entitlementReceipt.observedAt="2000-01-01T00:00:00Z";f.config.verified.identity.shop.shopId="gid://shopify/Shop/99";
  f.config.merchantId="100";f.config.developerToken="changed";
  const r=await reader.readEvidence();assert.equal(r.shop.shopId,"gid://shopify/Shop/12");assert.equal(f.calls.length,3);
  assert.equal(f.calls[1].parsed.pathname,"/products/v1/accounts/99/products");assert.equal(f.calls[0].init.headers.get("developer-token"),"secret-developer");
  assert.ok(f.loads.every(x=>x.claim.accountId==="123"&&x.claim.fence===2&&x.window.from==="2026-10-01"));
});
for(const [name,change] of [["provider",f=>{f.config.claim.provider="meta";}],["workspace",f=>{f.config.claim.workspaceId=connection;}],
  ["generation",f=>{f.config.claim.installGeneration="4";}],["missing fence",f=>{delete f.config.claim.fence;}],
  ["multi-day window",f=>{f.config.window.to="2026-10-02";}],["invalid day",f=>{f.config.window.from="2026-02-30";f.config.window.to=f.config.window.from;}],
  ["missing receipt",f=>{delete f.config.entitlementReceipt;}],["inactive owner",f=>{f.config.verified.installationAuthority.status="inactive";}],
  ["invalid Merchant ID",f=>{f.config.merchantId="099";}],["overflow Merchant ID",f=>{f.config.merchantId="9223372036854775808";}],
  ["Shopify mode",f=>{f.config.mode="shopify";}],["source rules",f=>{f.config.sourceRules=[];}],
  ["caller Merchant quota binding",f=>{f.config.merchant={...f.c.merchant};}],
  ["caller quota account",f=>{f.config.quotaAccountId="98";}],["arbitrary resolver",f=>{f.config.resolveOperation=()=>"a".repeat(64);}],
  ["arbitrary guard",f=>{f.config.guard={};}],["arbitrary context loader",f=>{f.config.loadContext=()=>f.c;}],
  ["legacy callback",f=>{f.config.authorizeRead=()=>true;}],
])test(`bound Google: ${name} rejected before SQL or HTTP`,()=>{
  const f=boundFixture();change(f);assert.throws(f.create);assert.equal(f.queries.length,0);assert.equal(f.calls.length,0);
});
test("bound Google: overrides and concurrent or completed replay are forbidden",async()=>{
  const f=boundFixture(),reader=f.create();await assert.rejects(reader.readEvidence({merchantId:"100"}),/OVERRIDE_FORBIDDEN/);
  const pending=reader.readEvidence();await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);await pending;
  await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);assert.equal(f.calls.length,3);
});
for(const [name,change] of [["lost work or entitlement",f=>{f.q.lost=true;}],["wrong Ads account",f=>{f.c.accountId="789";}],
  ["wrong Ads version",f=>{f.c.apiVersion="v24";}],["missing Merchant inventory",f=>{delete f.c.merchant;}],
  ["wrong Merchant target",f=>{f.c.merchant.targetAccountId="100";}],["missing quota pool",f=>{delete f.c.merchant.quotaAccountId;}],
  ["wrong Merchant version",f=>{f.c.merchant.apiVersion="v1beta";}],["missing binding epoch",f=>{delete f.c.merchant.bindingEpoch;}],
  ["missing Ads profile",f=>{f.q.missingFamily="reporting_query";}],
])test(`bound Google: ${name} prevents even initial Ads HTTP`,async()=>{
  const f=boundFixture();change(f);await assert.rejects(f.create().readEvidence());assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});
test("bound Google: reservation-time Ads or Merchant authority drift settles without HTTP",async()=>{
  for(const change of [f=>{f.state.version++;},f=>{f.c.accountId="789";},f=>{f.c.connectionEpoch++;},f=>{f.q.lost=true;},
    f=>{f.c.merchant.targetAccountId="100";},f=>{f.c.merchant.quotaAccountId="97";},f=>{f.c.merchant.bindingEpoch++;}]){
    const f=boundFixture();f.q.reserved=()=>change(f);
    await assert.rejects(f.create().readEvidence(),e=>quotaBoundaryControl(e)?.status==="not_sent");
    assert.equal(f.calls.length,0);assert.equal(f.reservations.length,1);assert.equal(f.settles.length,1);assert.equal(f.stops.length,0);
  }
});
test("bound Google: missing Merchant profile keeps prior Ads attempt without fallback or replay",async()=>{
  const f=boundFixture();f.q.missingFamily="merchant_products";const reader=f.create();
  await assert.rejects(reader.readEvidence(),e=>quotaBoundaryControl(e)?.status==="not_configured");assert.equal(f.calls.length,1);
  await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);assert.equal(f.reservations.length,1);
});
test("bound Google: first quota wait can become existing work wait but cannot replay",async()=>{
  const f=boundFixture();f.q.waitAt=1;const reader=f.create();let error;try{await reader.readEvidence();}catch(e){error=e;}
  assert.equal(refreshQuotaWait(error,"provider_page",f.config.claim)?.status,"quota_waiting");assert.equal(f.calls.length,0);
  await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
});
test("bound Google: Merchant wait retains preceding Ads attempt and cannot restart whole job",async()=>{
  const f=boundFixture();f.q.waitAt=2;let error;try{await f.create().readEvidence();}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error)?.priorBoundaryAttempts,1);assert.equal(f.calls.length,1);
  assert.equal(refreshQuotaWait(error,"provider_page",f.config.claim),null);
});
test("bound Google: each Merchant and Ads continuation requires its own reservation",async()=>{
  const f=boundFixture();f.hooks.fetch=(p,init)=>{
    if(p.hostname==="merchantapi.googleapis.com"&&!p.searchParams.has("pageToken"))return response({nextPageToken:"next"});
    if(p.hostname==="googleads.googleapis.com"&&!JSON.parse(init.body).pageToken)return response({results:[],nextPageToken:"ads-next"});
  };
  assert.equal((await f.create().readEvidence()).native_source.pages,2);assert.equal(f.calls.length,6);assert.equal(f.reservations.length,6);
});
test("bound Google: first Merchant error is one stop with no Ads signal or final Ads read",async()=>{
  const f=boundFixture();f.hooks.fetch=p=>p.hostname==="merchantapi.googleapis.com"&&response({error:{code:429,status:"RESOURCE_EXHAUSTED",message:"SECRET-NATIVE"}},429);
  const reader=f.create();await assert.rejects(reader.readEvidence());assert.equal(f.calls.length,2);assert.equal(f.stops.length,1);
  assert.equal(f.stops[0].quotaSignal,null);assert.equal(f.stops[0].quotaObservation,undefined);
  assert.doesNotMatch(JSON.stringify(f.stops),/SECRET-NATIVE|secret-access|secret-developer/);await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
});
test("bound Google: native Ads-Merchant mismatch stops after first Ads read",async()=>{
  const f=boundFixture();f.hooks.fetch=()=>response({results:[link("7","100")]});await assert.rejects(f.create().readEvidence(),/LINK_NOT_CONFIRMED/);
  assert.equal(f.calls.length,1);assert.equal(f.reservations.length,1);
});
test("bound Google: deadline during context lookup cannot reserve or dispatch after late return",async()=>{
  const f=boundFixture();f.config.maxElapsedMs=40;let release;f.q.load=()=>new Promise(resolve=>{release=resolve;});
  await assert.rejects(f.create().readEvidence(),/DEADLINE_EXCEEDED/);delete f.q.load;release();await new Promise(r=>setTimeout(r,0));
  assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);assert.equal(f.stops.length,0);
});
test("bound Google: pre-abort cannot read runtime or quota SQL",async()=>{
  const f=boundFixture(),controller=new AbortController();controller.abort();f.config.signal=controller.signal;
  await assert.rejects(f.create().readEvidence(),/IDENTITY_READ_ABORTED/);assert.equal(f.queries.length,0);assert.equal(f.loads.length,0);
});

const originalSdkFetch=abstractFetch;after(()=>setAbstractFetchFunc(originalSdkFetch));
const sdkRoot=import.meta.resolve("@shopify/shopify-app-react-router/server");
const {graphqlClientFactory}=await import(new URL("./clients/admin/graphql.mjs",sdkRoot));
const {handleClientErrorFactory}=await import(new URL("./authenticate/admin/helpers/handle-client-error.mjs",sdkRoot));
const sdkApi=shopifyApi({apiKey:"a".repeat(32),apiSecretKey:"b".repeat(32),hostName:"example.com",apiVersion:ApiVersion.October26,
  isEmbeddedApp:true,logger:{level:LogSeverity.Error,log:()=>{}}});
function candidateBoundFixture(){
  const f=boundFixture(),adminCalls=[],adminLoads=[],feedback=[],auth=[];
  f.config.sourceRules=[rule()];const bridge=createShopifyAdminIdentitySdkBridge();setAbstractFetchFunc(bridge.fetch);f.config.sdkBridge=bridge;
  const session=new Session({id:"offline_test.myshopify.com",shop:"test.myshopify.com",state:"synthetic",isOnline:false,accessToken:"SECRET-ADMIN",scope:"read_products"});
  f.config.verified.context.admin={graphql:graphqlClientFactory({params:{api:sdkApi,logger:{debug:()=>{}}},session,
    handleClientError:handleClientErrorFactory({request:new Request("https://example.com"),onError:async x=>auth.push(x)})})};
  const adminContext={provider:"shopify_admin",clientScopeKey:"c".repeat(64),connectionScopeKey:"d".repeat(64),connectionEpoch:3,
    accountId:"test.myshopify.com",organizationId:null,apiVersion:"2026-10"};f.q.adminContext=adminContext;
  const keys=["identity_product","identity_variant","identity_product_variant"].map(family=>quotaRouteIdentity(adminContext,
    {provider:"shopify_admin",family,accountId:adminContext.accountId,organizationId:null,version:"2026-10",includes:[]}).routeKey);
  const load=f.config.workStore.loadQuotaContext,resolve=f.config.quotaStore.resolveRoute,reserve=f.config.quotaStore.reserve,native=f.config.fetchFn;
  f.config.workStore={loadQuotaContext:async x=>{if(x.provider!=="shopify_admin")return load(x);
    adminLoads.push(x);await f.q.adminLoading?.();return f.q.adminMissing?null:f.q.adminContext;}};
  f.config.quotaStore.resolveRoute=async x=>keys.includes(x.routeKey)?f.q.missingAdminProfile?null:x.routeKey:resolve(x);
  f.config.quotaStore.reserve=async x=>{const r=await reserve(x);return r.status==="reserved"?
    {...r,...f.q.noBudget?{}:{costBudget:{unit:"shopify_admin_query_points",reservedRequestedCost:10}}}:r;};
  f.config.quotaStore.recordFeedback=async x=>{feedback.push(x);return true;};
  f.config.fetchFn=async(endpoint,init)=>{
    if(new URL(endpoint).hostname!=="test.myshopify.com")return native(endpoint,init);
    adminCalls.push({endpoint,init});const payload={data:{shop:{id:"gid://shopify/Shop/12",myshopifyDomain:"test.myshopify.com"},
      product:{id:"gid://shopify/Product/123",legacyResourceId:"123"},productVariant:{id:"gid://shopify/ProductVariant/456",legacyResourceId:"456",
        product:{id:"gid://shopify/Product/123",legacyResourceId:"123"}}},extensions:{cost:{requestedQueryCost:8,actualQueryCost:5,
          throttleStatus:{maximumAvailable:1000,currentlyAvailable:995,restoreRate:50}}}};
    await f.q.adminNative?.(payload,init);if(f.q.adminThrow)throw Error("SECRET-NATIVE");return Response.json(payload,{status:f.q.adminStatus??200});
  };
  return {...f,adminCalls,adminLoads,feedback,auth,create:()=>createRefreshGoogleCandidateReader(f.config)};
}
test("bound Google candidate: Ads Merchant and genuine SDK Admin share fenced job but separate quota keys",async()=>{
  const f=candidateBoundFixture(),r=await f.create().readEvidence();assert.equal(f.calls.length,3);assert.equal(f.adminCalls.length,1);
  assert.equal(f.reservations.length,4);assert.equal(f.settles.length,4);assert.equal(new Set(f.reservations.map(x=>x.operationKey)).size,3);
  assert.equal(f.feedback.filter(x=>x.feedback.kind==="shopify_admin_cost_observed").length,1);assert.equal(f.auth.length,0);
  assert.ok(f.adminLoads.every(x=>x.claim.provider==="google_ads"&&x.claim.accountId==="123"&&x.claim.id==="job1"&&x.claim.fence===2&&x.window.from==="2026-10-01"));
  assert.equal(r.product_identity_candidates.candidates[0].shopify_product_id,"gid://shopify/Product/123");
  assert.equal(r.product_identity_candidates.provider_link_verified,false);assert.equal(r.provider_link_verified,true);
  assert.equal(r.relationship_scope,"observed_direct_Ads_Merchant_relationship_only");
  for(const k of ["persistable","canonical_scope_ready","authorizes_activation","mapping_write_performed","source_facts_changed"])assert.equal(r[k],false);
  assert.equal(r.installation_id,null);assert.equal(f.c.merchant.quotaAccountId,"98");
  assert.doesNotMatch(JSON.stringify([f.loads,f.adminLoads,f.reservations,f.feedback,r]),/SECRET|secret-access|secret-developer|secret-refresh/);
});
test("bound Google candidate: default registry remains empty without parsing Shopify-looking offers",async()=>{
  const f=candidateBoundFixture();delete f.config.sourceRules;const r=await f.create().readEvidence();
  assert.equal(f.adminCalls.length,0);assert.equal(f.calls.length,3);assert.equal(r.product_identity_candidates.candidates.length,0);
  assert.equal(r.product_identity_candidates.rows[0].product_identity_verification.reason,"verified_source_rule_required");
});
test("bound Google candidate: constructor captures rule, SDK function and original job before caller mutation",async()=>{
  const f=candidateBoundFixture(),reader=f.create();f.config.sourceRules[0].market="CA";f.config.claim.fence=99;f.config.claim.accountId="999";
  f.config.merchantId="100";f.config.window.from="2026-10-02";f.config.verified.context.admin.graphql=()=>{throw Error("replacement");};
  const r=await reader.readEvidence();assert.equal(r.product_identity_candidates.candidates.length,1);
  assert.ok(f.adminLoads.every(x=>x.claim.fence===2&&x.claim.accountId==="123"&&x.window.from==="2026-10-01"));
});
for(const [name,change] of [["missing bridge",f=>{delete f.config.sdkBridge;}],["fake bridge",f=>{f.config.sdkBridge={wrap:x=>x.admin};}],
  ["mode override",f=>{f.config.mode="native";}],["scope override",f=>{f.config.scopes=[];}],["ledger override",f=>{f.config.readExecution={};}],
  ["context override",f=>{f.config.loadContext=()=>({});}],["guard override",f=>{f.config.guard={};}],
  ["wrong session",f=>{f.config.verified.identity.session.shopDomain="other.myshopify.com";}],
  ["forged rule loader",f=>{f.config.sourceRules={load:()=>rule()};}],["conflicting rules",f=>{f.config.sourceRules.push(rule());}],
  ["unverified rule",f=>{f.config.sourceRules[0].state="unverified";}]])test(`bound Google candidate: ${name} stops before SQL and HTTP`,()=>{
  const f=candidateBoundFixture();change(f);assert.throws(f.create);assert.equal(f.queries.length+f.calls.length+f.adminCalls.length,0);
});
for(const [name,change] of [["feed",r=>{r.product_context.feed_label="CA";}],["language",r=>{r.product_context.content_language="fr";}],
  ["merchant",r=>{r.product_context.merchant_id="100";r.product_context.data_source="accounts/100/dataSources/7";}],
  ["datasource",r=>{r.product_context.data_source="accounts/99/dataSources/8";}],["account",r=>{r.scope.platform_account_id="789";}],
  ["shop",r=>{r.shop_id="gid://shopify/Shop/13";}]])test(`bound Google candidate: ${name} mismatch never derives a Shopify candidate`,async()=>{
  const f=candidateBoundFixture();change(f.config.sourceRules[0]);const r=await f.create().readEvidence();
  assert.equal(f.adminCalls.length,0);assert.equal(r.product_identity_candidates.candidates.length,0);
});
for(const kind of ["adminMissing","missingAdminProfile","noBudget"])test(`bound Google candidate: ${kind} stops before Admin HTTP and final Ads link`,async()=>{
  const f=candidateBoundFixture();f.q[kind]=true;await assert.rejects(f.create().readEvidence());assert.equal(f.adminCalls.length,0);assert.equal(f.calls.length,2);
});
for(const [waitAt,prior,providerCalls,adminCalls] of [[1,0,0,0],[2,1,1,0],[3,2,2,0],[4,3,2,1]])
test(`bound Google candidate: wait ${waitAt} retains exact shared prefix ${prior}`,async()=>{
  const f=candidateBoundFixture();f.q.waitAt=waitAt;let error;try{await f.create().readEvidence();}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error).priorBoundaryAttempts,prior);assert.equal(f.calls.length,providerCalls);assert.equal(f.adminCalls.length,adminCalls);
  if(prior>0)assert.equal(refreshQuotaWait(error,"provider_page",f.config.claim),null);
});
for(const status of [401,403,429,500])test(`bound Google candidate: Admin ${status} stops once without recovery`,async()=>{
  const f=candidateBoundFixture();f.q.adminStatus=status;const reader=f.create();await assert.rejects(reader.readEvidence());
  assert.equal(f.calls.length,2);assert.equal(f.adminCalls.length,1);assert.equal(f.auth.length,0);assert.equal(f.stops.length,1);
  await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
});
test("bound Google candidate: Admin cost above receipt cannot be verified",async()=>{
  const f=candidateBoundFixture();f.q.adminNative=p=>{p.extensions.cost.requestedQueryCost=11;};await assert.rejects(f.create().readEvidence());
  assert.equal(f.adminCalls.length,1);assert.equal(f.calls.length,2);
});
test("bound Google candidate: native link change discards already checked Shopify candidate",async()=>{
  const f=candidateBoundFixture();f.hooks.fetch=(p,init,n)=>p.hostname==="googleads.googleapis.com"&&n>1&&response({results:[link("8")]});
  await assert.rejects(f.create().readEvidence(),/LINK_CHANGED/);assert.equal(f.adminCalls.length,1);
});
test("bound Google candidate: Merchant binding drift before Admin cannot complete collection",async()=>{
  const f=candidateBoundFixture();f.q.adminNative=()=>{f.c.merchant.bindingEpoch++;};
  await assert.rejects(f.create().readEvidence());assert.equal(f.adminCalls.length,1);assert.equal(f.calls.length,2);
});
test("bound Google candidate: Admin context drift before dispatch sends no Admin HTTP",async()=>{
  const f=candidateBoundFixture();f.q.reserved=()=>{if(f.reservations.length===3)f.q.adminContext.connectionEpoch++;};
  await assert.rejects(f.create().readEvidence());assert.equal(f.adminCalls.length,0);assert.equal(f.calls.length,2);
});
test("bound Google candidate: wrong variant parent stays conflicting without mapping",async()=>{
  const f=candidateBoundFixture();f.q.adminNative=p=>{p.data.productVariant.product={id:"gid://shopify/Product/999",legacyResourceId:"999"};};
  const r=await f.create().readEvidence();assert.equal(r.product_identity_candidates.candidates.length,0);
  assert.equal(r.product_identity_candidates.rows[0].product_identity_verification.state,"conflicting");
});
test("bound Google candidate: actual work repository with missing Admin SQL result stops before HTTP",async()=>{
  const f=candidateBoundFixture();let sql=0;const real=createRefreshWorkRepository({query:async()=>{sql++;return {rows:[]};}}),load=f.config.workStore.loadQuotaContext;
  f.config.workStore.loadQuotaContext=x=>x.provider==="shopify_admin"?real.loadQuotaContext(x):load(x);
  await assert.rejects(f.create().readEvidence());assert.equal(sql,1);assert.equal(f.adminCalls.length,0);assert.equal(f.calls.length,2);
});
test("bound Google candidate: total deadline closes pending Admin lookup against late dispatch",async()=>{
  const f=candidateBoundFixture();f.config.maxElapsedMs=500;let release;
  f.q.adminLoading=()=>new Promise(r=>{release=r;});await assert.rejects(f.create().readEvidence(),/DEADLINE_EXCEEDED/);
  delete f.q.adminLoading;release();await new Promise(r=>setTimeout(r,10));assert.equal(f.adminCalls.length,0);assert.equal(f.calls.length,2);
});
test("bound Google candidate: deadline during sent Admin ignores late result and final Ads link",async()=>{
  const f=candidateBoundFixture();f.config.maxElapsedMs=500;let release;
  f.q.adminNative=()=>new Promise(r=>{release=r;});await assert.rejects(f.create().readEvidence(),/DEADLINE_EXCEEDED/);
  assert.equal(f.adminCalls.length,1);release();await new Promise(r=>setTimeout(r,10));assert.equal(f.calls.length,2);assert.equal(f.adminCalls[0].init.signal.aborted,true);
});
test("bound Google candidate: missing SDK hook cannot send unguarded Admin HTTP",async()=>{
  const f=candidateBoundFixture();setAbstractFetchFunc(originalSdkFetch);await assert.rejects(f.create().readEvidence());assert.equal(f.adminCalls.length,0);assert.equal(f.calls.length,2);
});
test("bound Google candidate: partial GraphQL data cannot produce candidate",async()=>{
  const f=candidateBoundFixture();f.q.adminNative=p=>{p.errors=[{message:"SECRET"}];};
  await assert.rejects(f.create().readEvidence(),e=>!/SECRET/.test(e.message));assert.equal(f.calls.length,2);assert.equal(f.adminCalls.length,1);
});
test("bound Google candidate: every Merchant page debits before one deduplicated Shopify check",async()=>{
  const f=candidateBoundFixture();f.hooks.fetch=p=>p.hostname==="merchantapi.googleapis.com"&&!p.searchParams.has("pageToken")&&response({nextPageToken:"second"});
  const r=await f.create().readEvidence();assert.equal(r.product_identity_candidates.candidates.length,1);assert.equal(f.calls.length,4);assert.equal(f.adminCalls.length,1);assert.equal(f.reservations.length,5);
});
const candidatePrewriteOwner=()=>({provider:"google_ads",workspaceId:workspace,installGeneration:3,shopId:"gid://shopify/Shop/12",shopDomain:"test.myshopify.com",
  connectionId:connection,connectionVersion:2,accountId:"123"});
candidatePrewriteCases({provider:"google_ads",fixture:candidateBoundFixture,nativeFixture:boundFixture,expected:candidatePrewriteOwner,
  empty:f=>{f.hooks.fetch=p=>p.hostname==="merchantapi.googleapis.com"&&response({products:[]});},
  unresolved:f=>{delete f.config.sourceRules;},
  productOnly:f=>{f.config.sourceRules[0].format="shopify_product_id";delete f.config.sourceRules[0].market;
    f.hooks.fetch=p=>p.hostname==="merchantapi.googleapis.com"&&response({products:[product("123")]});}});
test("Google prewrite: same offer and Shopify pair across languages retain separate source context",async()=>{
  const f=candidateBoundFixture(),other=rule();other.product_context.content_language="fr";other.source_reference="synthetic-fr-proof";f.config.sourceRules.push(other);
  f.hooks.fetch=p=>p.hostname==="merchantapi.googleapis.com"&&response({products:[product(),{...product(),name:"accounts/99/products/fr~US~shopify_US_123_456",contentLanguage:"fr"}]});
  const observation=await f.create().readEvidence(),r=reviewRefreshCandidatePrewrite({expected:candidatePrewriteOwner(),observation});
  assert.equal(r.rows.length,2);assert.equal(r.counts.candidates,2);assert.equal(f.adminCalls.length,1);
  assert.notEqual(r.rows[0].sourceReference.context.content_language,r.rows[1].sourceReference.context.content_language);
});
test("Google prewrite: two variants of the same product remain distinct candidate references",async()=>{
  const f=candidateBoundFixture();f.hooks.fetch=p=>p.hostname==="merchantapi.googleapis.com"&&response({products:[product(),product("shopify_US_123_789")]});
  f.q.adminNative=(p,init)=>{const id=JSON.parse(init.body).variables.variantId;p.data.productVariant.id=id;p.data.productVariant.legacyResourceId=id.split("/").at(-1);};
  const observation=await f.create().readEvidence(),r=reviewRefreshCandidatePrewrite({expected:candidatePrewriteOwner(),observation});
  assert.equal(r.rows.length,2);assert.equal(r.rows[0].candidateShopifyProductId,r.rows[1].candidateShopifyProductId);
  assert.notEqual(r.rows[0].candidateShopifyVariantId,r.rows[1].candidateShopifyVariantId);assert.equal(f.adminCalls.length,2);
});

test("Google reference prewrite: Merchant candidate reader did not collect reports or order claims",async()=>{
  const f=candidateBoundFixture(),observation=await f.create().readEvidence(),r=reviewRefreshReferencePrewrite({expected:candidatePrewriteOwner(),observation});
  assert.equal(r.candidateReview.candidateReferencesChecked,true);assert.equal(r.referenceReview.state,"not_collected_in_this_reader_mode");
  assert.equal(r.referenceLinksReviewed,false);assert.equal(r.referenceReview.observedEmpty,null);assert.equal(r.referenceReview.observed,null);
  assert.deepEqual(r.referenceReview.rows,[]);assert.equal(r.providerClaimState,"not_collected_in_identity_observation");
  assert.equal(r.providerClaimVerified,false);assert.equal(r.exactOverlapVerified,false);assert.equal(r.persistable,false);
});

providerClaimPrewriteCases({provider:"google_ads",fixture:candidateBoundFixture,expected:candidatePrewriteOwner,empty:f=>{f.hooks.fetch=p=>p.hostname==="merchantapi.googleapis.com"&&response({products:[]});}});
