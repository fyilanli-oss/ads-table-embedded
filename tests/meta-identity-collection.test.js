import test from "node:test";
import assert from "node:assert/strict";
import {collectMetaNativeIdentityEvidence, collectMetaVerifiedProductCandidateEvidence, collectMetaReportProductCandidateEvidence} from "../app/lib/providers/meta-identity-collection.server.js";
import {createMetaCandidateSourceRuleLoader, verifyMetaCatalogSourceCandidates} from "../app/lib/providers/meta-source-candidates.server.js";
import {createMetaReportIdentityRuleLoader} from "../app/lib/providers/meta-report-candidates.server.js";
import {META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS} from "../app/lib/providers/meta-reporting.server.js";
import {readMetaCatalogIdentitySnapshot, matchMetaCatalogProductIdentity} from "../app/lib/providers/meta-catalog-identity-reader.server.js";
import {readMetaAdCatalogReference} from "../app/lib/providers/meta-adset-catalog-reference.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createQuotaManagedFetch, quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";

const workspace = "11111111-1111-4111-8111-111111111111", connection = "22222222-2222-4222-8222-222222222222",
  credential = "33333333-3333-4333-8333-333333333333";
function response(body, status = 200) {return {ok: status === 200, status, headers: {get: () => null}, json: async () => body};}
function fixture() {
  const calls = [], queries = [], hooks = {}, scopes = [...oauthPermissionScopes("meta", "identity_v1")];
  const state = {version: 2, account: "act_123", generation: 3, status: "connected", scopes,
    now: new Date("2026-10-27T15:00:00.000Z")};
  const verified = {installationAuthority: {authority: "shopify_installation_verified", workspaceId: workspace, installGeneration: 3, status: "active"},
    identity: {session: {authority: "shopify_id_token_verified", shopDomain: "test.myshopify.com"},
      shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"}},
    context: {admin: {graphql() {throw Error("native collection must not query Shopify");}}}};
  const token = {access_token: "secret-access", permission_profile: "identity_v1", scopes: [...scopes],
    expires_at: "2026-10-27T16:00:00.000Z", scope_verified_at: state.now.toISOString()};
  const native = {
    debug_token: {data: {app_id: "123", is_valid: true, scopes: [...scopes], expires_at: state.now.valueOf() / 1000 + 3600,
      data_access_expires_at: state.now.valueOf() / 1000 + 7200}},
    "66": {id: "66", account_id: "123", adset_id: "77", campaign_id: "55", creative: {id: "99"}},
    "77": {id: "77", account_id: "123", campaign_id: "55", promoted_object: {product_set_id: "88"}},
    "88": {id: "88", product_catalog: {id: "456"}},
    "99": {id: "99", account_id: "123", product_set_id: "88"},
    products: {data: [{id: "900", retailer_id: "shopify_US_10_20", product_catalog: {id: "456"}, product_feed: {id: "100"}}]}
  };
  const database = {async query(sql, params) {
    queries.push({sql, params}); await hooks.query?.(sql);
    if (sql.includes("resolve_active_installation")) return {rows: [{workspace_id: workspace, install_generation: state.generation, installation_status: "active"}]};
    if (sql.includes("load_provider_connection_lifecycle_by_owner")) return {rows: [{connection_id: connection, credential_id: credential,
      lifecycle_status: state.status, connection_version: state.version}]};
    if (sql.includes("load_provider_account_authority")) return {rows: [{connection_id: connection, credential_id: credential,
      reporting_account_id: state.account, granted_scopes: [...state.scopes], accounts: [{id: state.account, kind: "advertiser",
        reporting_eligible: true, login_account_id: null}]}]};
    throw Error("unexpected SQL");
  }};
  const fetchFn = async (endpoint, init) => {
    const parsed = new URL(endpoint); calls.push({parsed, init});
    const custom = await hooks.fetch?.(parsed, init, calls.length); if (custom) return custom;
    assert.equal(parsed.hostname, "graph.facebook.com");
    const key = parsed.pathname.split("/").at(-1); assert.ok(native[key], `unexpected ${key}`);
    return response(structuredClone(native[key]));
  };
  const options = {verified, database, tokenVault: {loadProviderTokenSet: async () => token},
    config: {appId: "123", appSecret: "secret-app", graphVersion: "v26.0"},
    adId: "66", adSetId: "77", campaignId: "55", catalogId: "456", fetchFn, now: () => state.now};
  return {options, state, native, token, hooks, calls, queries, run: () => collectMetaNativeIdentityEvidence(options)};
}

test("concrete SQL/vault loader composes actual token, Ad/creative/catalog observations with no invented canonical scope", async () => {
  const f = fixture(), r = await f.run();
  assert.equal(f.calls.length, 10); assert.equal(r.provider_link_verified, true);
  assert.equal(r.native_source.records[0].retailer_id, "shopify_US_10_20");
  assert.equal(r.native_source.scope, undefined); assert.equal(r.link_evidence.before.scope, undefined);
  assert.equal(r.installation_id, null); assert.equal(r.canonical_scope_ready, false);
  assert.equal(r.proves_product_delivery_or_Insights_namespace, false); assert.equal(r.persistable, false);
  assert.equal(r.authorizes_activation, false); assert.equal(r.mapping_write_performed, false);
  assert.equal(r.native_source.records[0].shopify_product_id, undefined); assert.ok(Object.isFrozen(r.native_source.records));
  assert.ok(!/secret-access|secret-app|credentialId/.test(JSON.stringify(r)));
  assert.ok(f.queries.every(q => q.sql.startsWith("select *")));
  assert.ok(f.calls.every(c => c.init.redirect === "error"));
  assert.equal(f.calls[0].parsed.pathname, "/v26.0/debug_token");
  assert.equal(f.calls[0].init.headers.authorization, "Bearer 123|secret-app");
  assert.ok(f.calls.slice(1).every(c => c.parsed.searchParams.has("appsecret_proof")));
  assert.throws(() => matchMetaCatalogProductIdentity(r.native_source, {catalogId: "456", namespace: "retailer_id", productId: "shopify_US_10_20"}), /CONTEXT_INVALID/);
});
test("canonical entry points still require installation PK before network", async () => {
  const f = fixture(); let calls = 0;
  for (const reader of [readMetaCatalogIdentitySnapshot, readMetaAdCatalogReference]) {
    await assert.rejects(reader({authority: {workspace_id: workspace, installation_generation: 3, provider_connection_id: connection,
      platform: "meta", platform_account_id: "act_123", catalog_id: "456", granted_scopes: f.state.scopes},
    accessToken: "token", fetchFn: async () => {calls++;}}));
  }
  assert.equal(calls, 0);
});
for (const [name, change] of [["app", d => {d.app_id = "124";}], ["validity", d => {d.is_valid = false;}],
  ["native grants", d => {d.scopes.pop();}], ["native expiry", d => {d.expires_at = 1;}],
  ["malformed expiry", d => {d.expires_at = "invalid";}]]) test(`invalid ${name} stops before Ad request; stored grants cannot pad actual grants`, async () => {
  const f = fixture(); change(f.native.debug_token.data); await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
});
for (const [name, change] of [["Ad account", n => {n["66"].account_id = "124";}],
  ["Ad parent", n => {n["66"].adset_id = "78";}], ["campaign", n => {n["77"].campaign_id = "56";}],
  ["creative account", n => {n["99"].account_id = "124";}], ["catalog", n => {n["88"].product_catalog.id = "457";}],
  ["product catalog", n => {n.products.data[0].product_catalog.id = "457";}],
  ["missing relationship", n => {delete n["77"].promoted_object; delete n["99"].product_set_id;}]]) test(`native ${name} mismatch never produces completed evidence`, async () => {
  const f = fixture(); change(f.native); await assert.rejects(f.run()); assert.ok(f.calls.length < 10);
});
for (const [name, change] of [["version", f => {f.state.version++;}], ["selected account", f => {f.state.account = "act_124";}],
  ["generation", f => {f.state.generation++;}], ["disconnect", f => {f.state.status = "disconnect_pending";}],
  ["token secret", f => {f.token.access_token = "changed";}], ["stored grant", f => {f.state.scopes.pop();}]]) test(`${name} change during native JSON prevents another request`, async () => {
  const f = fixture(); f.hooks.fetch = () => {change(f);}; await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
});
test("before/after creative reference change discards all collected products", async () => {
  const f = fixture(); f.hooks.fetch = (p, init, n) => {
    if (n > 6 && p.pathname.endsWith("/99")) return response({id: "99", account_id: "123", product_set_id: null});
  };
  await assert.rejects(f.run(), /REFERENCE_CHANGED/); assert.equal(f.calls.length, 10);
});
test("catalog pagination crosses empty intermediate page and preserves exact catalog", async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname.endsWith("/products") && !p.searchParams.has("after")
    && response({data: [], paging: {cursors: {after: "next"}, next: "https://graph.facebook.com/v26.0/456/products?after=next"}});
  const r = await f.run(); assert.equal(r.native_source.pages, 2); assert.equal(f.calls.length, 11);
  assert.equal(f.calls[6].parsed.searchParams.get("after"), "next");
});
for (const status of [401, 403, 429, 500]) test(`native HTTP ${status} stops first time without retry`, async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname.endsWith("/products") && response({error: {message: "secret-native"}}, status);
  await assert.rejects(f.run(), e => e.message === "META_IDENTITY_COLLECTION_FAILED"); assert.equal(f.calls.length, 6);
});
test("expiry reached after product JSON prevents final native observation", async () => {
  const f = fixture(); f.native.debug_token.data.expires_at = f.state.now.valueOf() / 1000 + 60;
  f.hooks.fetch = p => {if (p.pathname.endsWith("/products")) f.state.now = new Date("2026-10-27T15:01:00Z");};
  await assert.rejects(f.run(), /META_IDENTITY_COLLECTION_FAILED/); assert.equal(f.calls.length, 6);
});
test("abort and observation deadline stop before another native call", async () => {
  for (const mode of ["abort", "deadline"]) {
    const f = fixture(), controller = new AbortController(); f.options.signal = controller.signal;
    f.hooks.fetch = () => {if (mode === "abort") controller.abort(); else f.state.now = new Date(f.state.now.valueOf() + 120001);};
    await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
  }
});
test("authentic quota waiting control survives lower reader sanitizers unchanged", async () => {
  let control;
  const managed = createQuotaManagedFetch({provider: "meta", guard: {execute: async () => ({status: "waiting"})},
    resolveOperation: async () => "a".repeat(64), lane: "background", fetchFn: async () => {throw Error("must not send");}});
  try {await managed("https://graph.facebook.com/v26.0/debug_token");} catch (e) {control = e;}
  assert.equal(quotaBoundaryControl(control).status, "waiting");
  const f = fixture(); f.hooks.fetch = p => {if (p.pathname.endsWith("/products")) throw control;};
  await assert.rejects(f.run(), e => e === control); assert.equal(f.calls.length, 6);
});
test("invalid config, targets and stored reporting-only credential fail before native request", async () => {
  for (const change of [f => {f.options.config.graphVersion = "v19.0";}, f => {f.options.adId = "66/evil";},
    f => {f.token.permission_profile = "reporting_v1";}]) {
    const f = fixture(); change(f); await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
  }
});

function rule() {
  return {state: "verified_source_rule", source_reference: "synthetic-reviewed-native-source-proof",
    scope: {workspace_id: workspace, installation_generation: 3, provider_connection_id: connection, platform: "meta", platform_account_id: "act_123"},
    product_context: {catalog_id: "456", product_feed_id: "100"}, shop_id: "gid://shopify/Shop/12",
    format: "shopify_market_product_variant", market: "US"};
}
function candidateFixture() {
  const f = fixture(), shopCalls = [], shopHooks = {};
  f.options.sourceRules = [rule()];
  f.options.verified.context.admin.graphql = async (query, options) => {
    shopCalls.push({query, options}); const custom = await shopHooks.graphql?.(query, options); if (custom) return custom;
    const p = options.variables.productId?.split("/").at(-1) ?? "10", v = options.variables.variantId?.split("/").at(-1);
    return response({data: {shop: {id: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"},
      ...(options.variables.productId ? {product: {id: `gid://shopify/Product/${p}`, legacyResourceId: p}} : {}),
      ...(v ? {productVariant: {id: `gid://shopify/ProductVariant/${v}`, legacyResourceId: v,
        product: {id: `gid://shopify/Product/${p}`, legacyResourceId: p}}} : {})}});
  };
  return {...f, shopCalls, shopHooks, run: () => collectMetaVerifiedProductCandidateEvidence(f.options)};
}
function candidateOptions(f, source, sourceRules = createMetaCandidateSourceRuleLoader({rules: [rule()]})) {
  return {source, ownerScope: rule().scope, context: {shop: f.options.verified.identity.shop,
    installation: f.options.verified.installationAuthority, admin: f.options.verified.context.admin}, sourceRules};
}
test("candidate: empty default registry never parses retailer IDs or calls Shopify", async () => {
  const f = candidateFixture(); delete f.options.sourceRules;
  const r = await f.run(); assert.equal(f.shopCalls.length, 0); assert.equal(r.product_identity_candidates.candidates.length, 0);
  assert.equal(r.product_identity_candidates.rows[0].product_identity_verification.reason, "verified_source_rule_required");
});
test("candidate: exact reviewed retailer rule and same-shop variant parent compose local evidence only", async () => {
  const f = candidateFixture(), r = await f.run(), c = r.product_identity_candidates;
  assert.equal(f.calls.length, 10); assert.equal(f.shopCalls.length, 1); assert.equal(f.shopCalls[0].options.tries, 1);
  assert.deepEqual(f.shopCalls[0].options.variables, {productId: "gid://shopify/Product/10", variantId: "gid://shopify/ProductVariant/20"});
  assert.equal(c.candidates[0].catalog_product_id, "900"); assert.equal(c.candidates[0].retailer_id, "shopify_US_10_20");
  assert.equal(c.candidates[0].shopify_product_id, "gid://shopify/Product/10");
  assert.equal(c.candidates[0].candidate_evidence.source_id_field, "retailer_id");
  assert.equal(c.rows[0].standardized_product_id, null); assert.equal(c.mappings, undefined);
  assert.equal(c.proves_Insights_identity_namespace, false); assert.equal(c.provider_link_verified, false);
  assert.equal(r.provider_link_verified, true); assert.equal(r.proves_product_delivery_or_Insights_namespace, false);
  assert.equal(r.canonical_scope_ready, false); assert.equal(r.installation_id, null); assert.equal(r.persistable, false);
  assert.ok(Object.isFrozen(c.candidates[0].candidate_evidence));
});
for (const [name, mutate] of [["workspace", r => {r.scope.workspace_id = credential;}],
  ["generation", r => {r.scope.installation_generation++;}], ["connection", r => {r.scope.provider_connection_id = credential;}],
  ["provider", r => {r.scope.platform = "google_ads";}], ["account", r => {r.scope.platform_account_id = "act_124";}],
  ["catalog", r => {r.product_context.catalog_id = "457";}], ["feed", r => {r.product_context.product_feed_id = "101";}],
  ["shop", r => {r.shop_id = "gid://shopify/Shop/99";}], ["feed presence", r => {delete r.product_context.product_feed_id;}]]) {
  test(`candidate: ${name} rule cannot match another native context`, async () => {
    const f = candidateFixture(); mutate(f.options.sourceRules[0]);
    if (name === "provider") await assert.rejects(f.run(), /SCOPE_INVALID/);
    else assert.equal((await f.run()).product_identity_candidates.candidates.length, 0);
    assert.equal(f.shopCalls.length, 0);
  });
}
test("candidate: only retailer ID is parsed, never Meta internal ID or product group", async () => {
  const f = candidateFixture(); f.native.products.data[0].id = "10"; f.native.products.data[0].retailer_id = "opaque-id";
  f.native.products.data[0].retailer_product_group_id = "shopify_US_10_20";
  const r = await f.run(); assert.equal(f.shopCalls.length, 0);
  assert.equal(r.product_identity_candidates.rows[0].product_identity_verification.reason, "retailer_id_does_not_match_verified_rule");
});
test("candidate: market mismatch and variant zero do not authorize extraction", async () => {
  for (const id of ["shopify_CA_10_20", "shopify_US_10_0"]) {
    const f = candidateFixture(); f.native.products.data[0].retailer_id = id;
    assert.equal((await f.run()).product_identity_candidates.candidates.length, 0); assert.equal(f.shopCalls.length, 0);
  }
});
test("candidate: conflicting or malformed server rules stop before any native read", async () => {
  for (const kind of ["duplicate", "evidence", "state"]) {
    const f = candidateFixture();
    if (kind === "duplicate") f.options.sourceRules.push(rule());
    else if (kind === "evidence") f.options.sourceRules[0].source_reference = "";
    else f.options.sourceRules[0].state = "proposed";
    await assert.rejects(f.run(), /RULE_/); assert.equal(f.calls.length, 0); assert.equal(f.shopCalls.length, 0);
  }
});
test("candidate: rules and authenticated Admin are captured before the first await", async () => {
  const f = candidateFixture(); f.hooks.fetch = () => {
    f.options.sourceRules[0].market = "CA";
    f.options.verified.context.admin.graphql = () => {throw Error("retargeted");};
  };
  assert.equal((await f.run()).product_identity_candidates.candidates.length, 1); assert.equal(f.shopCalls.length, 1);
});
test("candidate: separate public modes ignore caller mode overrides", async () => {
  const f = candidateFixture(); f.options.withShopify = true;
  assert.equal((await collectMetaNativeIdentityEvidence(f.options)).product_identity_candidates, undefined); assert.equal(f.shopCalls.length, 0);
  const g = candidateFixture(); g.options.withShopify = false;
  assert.equal((await g.run()).product_identity_candidates.candidates.length, 1);
});
test("candidate: first Admin failure stops before final native reference with no retry", async () => {
  const f = candidateFixture(); f.shopHooks.graphql = () => {throw Error("secret-native-admin");};
  await assert.rejects(f.run(), e => e.message === "META_IDENTITY_COLLECTION_FAILED");
  assert.equal(f.calls.length, 6); assert.equal(f.shopCalls.length, 1);
});
for (const [name, change] of [["connection", f => {f.state.version++;}], ["account", f => {f.state.account = "act_124";}],
  ["credential", f => {f.token.access_token = "changed";}]]) test(`candidate: ${name} change during Admin rejects completed candidates`, async () => {
  const f = candidateFixture(); f.shopHooks.graphql = () => {change(f);};
  await assert.rejects(f.run()); assert.equal(f.calls.length, 6); assert.equal(f.shopCalls.length, 1);
});
test("candidate: final creative reference change rejects already checked Shopify candidates", async () => {
  const f = candidateFixture(); f.hooks.fetch = (p, init, n) => n > 6 && p.pathname.endsWith("/99")
    && response({id: "99", account_id: "123", product_set_id: null});
  await assert.rejects(f.run(), /REFERENCE_CHANGED/); assert.equal(f.shopCalls.length, 1);
});
test("candidate: missing products and conflicting variant parents remain different states", async () => {
  for (const wrongParent of [false, true]) {
    const f = candidateFixture(); f.shopHooks.graphql = () => response({data: {shop: {id: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"},
      product: wrongParent ? {id: "gid://shopify/Product/10", legacyResourceId: "10"} : null,
      productVariant: wrongParent ? {id: "gid://shopify/ProductVariant/20", legacyResourceId: "20",
        product: {id: "gid://shopify/Product/11", legacyResourceId: "11"}} : null}});
    const r = await f.run(); assert.equal(r.product_identity_candidates.rows[0].product_identity_verification.state, wrongParent ? "conflicting" : "unresolved");
    assert.equal(r.product_identity_candidates.candidates.length, 0);
  }
});
test("candidate: explicit product-only and variant-only rules reuse existing verification", async () => {
  for (const format of ["shopify_product_id", "shopify_variant_id"]) {
    const f = candidateFixture(); f.options.sourceRules[0].format = format; delete f.options.sourceRules[0].market;
    f.native.products.data[0].retailer_id = "10";
    const r = await f.run(); assert.equal(r.product_identity_candidates.candidates[0].shopify_product_id, "gid://shopify/Product/10");
    assert.equal(f.shopCalls[0].options.variables[format === "shopify_product_id" ? "variantId" : "productId"], undefined);
  }
});
test("candidate: same Shopify pair queried once while different feed records keep separate evidence", async () => {
  const f = candidateFixture(), other = rule(); other.product_context.product_feed_id = "101"; other.source_reference = "second-feed-proof";
  f.options.sourceRules.push(other); const p = structuredClone(f.native.products.data[0]); p.id = "901"; p.product_feed.id = "101";
  f.native.products.data.push(p);
  const c = (await f.run()).product_identity_candidates; assert.equal(f.shopCalls.length, 1); assert.equal(c.candidates.length, 2);
  assert.notEqual(c.candidates[0].candidate_evidence.source_record_key, c.candidates[1].candidate_evidence.source_record_key);
});
test("candidate: absent feed matches only an explicit no-feed rule", async () => {
  const f = candidateFixture(); delete f.native.products.data[0].product_feed; delete f.options.sourceRules[0].product_context.product_feed_id;
  assert.equal((await f.run()).product_identity_candidates.candidates.length, 1);
});
test("candidate: arbitrary rule callback cannot replace factory-backed registry", async () => {
  const f = candidateFixture(), source = (await collectMetaNativeIdentityEvidence(f.options)).native_source;
  await assert.rejects(verifyMetaCatalogSourceCandidates(candidateOptions(f, source, {load: () => rule()})), /INPUT_INVALID/);
  const loader = createMetaCandidateSourceRuleLoader({rules: [rule()]});
  assert.throws(() => loader.load({...rule(), scope: {...rule().scope, installation_id: "99"}}), /SCOPE_INVALID/);
});
test("candidate: all raw record projections checked before first Admin read", async () => {
  const f = candidateFixture(), source = structuredClone((await collectMetaNativeIdentityEvidence(f.options)).native_source);
  for (const mutate of [r => {r.retailer_id = "other";}, r => {r.catalog_product_id = "901";},
    r => {r.product_context.product_feed_id = "101";}, r => {r.product_context.catalog_id = "457";},
    r => {delete r.source_record.product_feed;}, r => {r.key = "bad-key";}]) {
    const input = structuredClone(source); mutate(input.records[0]);
    await assert.rejects(verifyMetaCatalogSourceCandidates(candidateOptions(f, input)), /SOURCE_INVALID/);
  }
  const duplicate = structuredClone(source); duplicate.records.push(duplicate.records[0]);
  await assert.rejects(verifyMetaCatalogSourceCandidates(candidateOptions(f, duplicate)), /SOURCE_INVALID/);
  assert.equal(f.shopCalls.length, 0);
});
test("candidate: Admin abort and actual native permission expiry stop before final reference", async () => {
  for (const mode of ["abort", "expiry"]) {
    const f = candidateFixture(), controller = new AbortController(); f.options.signal = controller.signal;
    f.native.debug_token.data.expires_at = f.state.now.valueOf() / 1000 + 60;
    f.shopHooks.graphql = (q, o) => {assert.equal(o.signal, controller.signal);
      if (mode === "abort") controller.abort(); else f.state.now = new Date("2026-10-27T15:01:00Z");};
    await assert.rejects(f.run()); assert.equal(f.calls.length, 6); assert.equal(f.shopCalls.length, 1);
  }
});
test("candidate: authentic quota control survives Admin verifier sanitization", async () => {
  const managed = createQuotaManagedFetch({provider: "meta", guard: {execute: async () => ({status: "waiting"})},
    resolveOperation: async () => "a".repeat(64), lane: "background", fetchFn: async () => {throw Error("must not send");}});
  let control; try {await managed("https://graph.facebook.com/v26.0/debug_token");} catch (e) {control = e;}
  assert.equal(quotaBoundaryControl(control).status, "waiting");
  const f = candidateFixture(); f.shopHooks.graphql = () => {throw control;};
  await assert.rejects(f.run(), e => e === control); assert.equal(f.calls.length, 6);
});
test("candidate: cancelled empty collection is not returned as accepted", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(verifyMetaCatalogSourceCandidates({...candidateOptions(f,
    {complete: true, context: {catalog_id: "456", graph_version: "v26.0"}, records: []}), signal: controller.signal}), /ABORTED/);
});

function reportRule(namespace = "retailer_id") {
  return {state: "verified_report_identity_rule", scope: rule().scope,
    target: {ad_id: "66", adset_id: "77", campaign_id: "55", catalog_id: "456"},
    report_context: {source_family: "ad_product_breakdown_daily_insights", graph_version: "v26.0"},
    identity_namespace: namespace, source_reference: "synthetic-reviewed-report-namespace-proof"};
}
function reportFixture() {
  const f = candidateFixture(); f.options.dateWindow = {start: "2026-10-01", end: "2026-10-01"};
  f.options.reportIdentityRules = [reportRule()];
  f.native.insights = {data: [{account_id: "123", ad_id: "66", adset_id: "77", campaign_id: "55", product_id: "shopify_US_10_20",
    date_start: "2026-10-01", date_stop: "2026-10-01", impressions: "20", clicks: "3", spend: "7.89",
    converted_product_quantity: [{action_type: "purchase", value: "4"}], converted_product_value: [{action_type: "purchase", value: "120"}],
    converted_promoted_product_quantity: [{action_type: "purchase", value: "1"}], converted_promoted_product_value: [{action_type: "purchase", value: "30"}]}]};
  return {...f, run: () => collectMetaReportProductCandidateEvidence(f.options)};
}
test("report bridge: existing complete product query and raw metrics remain unchanged; exact rule adds only local reference", async () => {
  const f = reportFixture(), r = await f.run(), report = r.native_product_report, link = r.product_report_candidate_links.links[0];
  assert.equal(f.calls.length, 11); const call = f.calls[6];
  assert.equal(call.parsed.pathname, "/v26.0/act_123/insights");
  assert.equal(call.parsed.searchParams.get("fields"), META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS.join(","));
  assert.equal(call.parsed.searchParams.get("product_id_limit"), "100");
  assert.equal(call.parsed.searchParams.get("breakdowns"), "product_id"); assert.equal(call.parsed.searchParams.has("filtering"), false);
  assert.deepEqual(report.rows, f.native.insights.data); assert.equal(report.metrics_interpreted, false);
  assert.deepEqual(report.page_evidence[0].evidence.requested_fields, META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS);
  assert.equal(report.exhaustive_product_coverage_proven, false); assert.equal(report.pagination_complete, true);
  assert.equal(link.state, "catalog_candidate_reference"); assert.equal(link.candidate_index, 0);
  assert.equal(link.source_record_key, r.native_source.records[0].key); assert.equal(link.standardized_product_id, null);
  assert.equal(r.product_report_candidate_links.sales_role_assigned, false); assert.equal(r.persistable, false);
  assert.equal(r.proves_product_delivery_or_Insights_namespace, false); assert.equal(r.installation_id, null);
  assert.ok(Object.isFrozen(report.rows[0].converted_product_quantity));
});
test("report bridge: empty default namespace registry never infers equality from matching retailer ID", async () => {
  const f = reportFixture(); delete f.options.reportIdentityRules; const r = await f.run();
  assert.equal(r.product_identity_candidates.candidates.length, 1);
  assert.equal(r.product_report_candidate_links.links[0].reason, "verified_report_identity_rule_required");
  assert.equal(r.product_report_candidate_links.links[0].candidate_index, null);
});
test("report bridge: verified namespace without source rule cannot create Shopify candidate", async () => {
  const f = reportFixture(); delete f.options.sourceRules; const r = await f.run();
  assert.equal(f.shopCalls.length, 0); assert.equal(r.product_report_candidate_links.links[0].reason, "verified_source_rule_required");
  assert.equal(r.product_report_candidate_links.links[0].candidate_index, null);
});
test("report bridge: internal catalog namespace is explicit and never falls back to retailer namespace", async () => {
  const f = reportFixture(); f.options.reportIdentityRules = [reportRule("catalog_product_id")];
  assert.equal((await f.run()).product_report_candidate_links.links[0].reason, "native_catalog_record_not_observed");
  const g = reportFixture(); g.options.reportIdentityRules = [reportRule("catalog_product_id")]; g.native.insights.data[0].product_id = "900";
  assert.equal((await g.run()).product_report_candidate_links.links[0].state, "catalog_candidate_reference");
});
test("report bridge: duplicate retailer IDs across feeds remain ambiguous despite verified Shopify candidates", async () => {
  const f = reportFixture(), p = structuredClone(f.native.products.data[0]), other = rule();
  p.id = "901"; p.product_feed.id = "101"; other.product_context.product_feed_id = "101";
  f.native.products.data.push(p); f.options.sourceRules.push(other); const r = await f.run();
  assert.equal(r.product_identity_candidates.candidates.length, 2); assert.equal(f.shopCalls.length, 1);
  assert.equal(r.product_report_candidate_links.links[0].state, "ambiguous");
  assert.equal(r.product_report_candidate_links.links[0].candidate_index, null);
});
for (const [name, change] of [["account", r => {r.scope.platform_account_id = "act_124";}],
  ["generation", r => {r.scope.installation_generation++;}], ["connection", r => {r.scope.provider_connection_id = credential;}],
  ["catalog", r => {r.target.catalog_id = "457";}], ["Ad", r => {r.target.ad_id = "67";}],
  ["AdSet", r => {r.target.adset_id = "78";}], ["campaign", r => {r.target.campaign_id = "56";}]]) test(`report bridge: ${name} rule cannot leak across context`, async () => {
  const f = reportFixture(); change(f.options.reportIdentityRules[0]);
  assert.equal((await f.run()).product_report_candidate_links.links[0].reason, "verified_report_identity_rule_required");
});
test("report bridge: malformed or duplicate rules and invalid window stop before native reads", async () => {
  for (const change of [f => {f.options.reportIdentityRules.push(reportRule());}, f => {f.options.reportIdentityRules[0].source_reference = "";},
    f => {f.options.reportIdentityRules[0].report_context.graph_version = "v19.0";},
    f => {f.options.dateWindow.start = "2026-02-30";}, f => {f.options.maxReportRows = 0;}]) {
    const f = reportFixture(); change(f); await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
  }
  assert.throws(() => createMetaReportIdentityRuleLoader({rules: [{...reportRule(), identity_namespace: "auto"}]}), /RULE_INVALID/);
});
test("report bridge: namespace registry and report window detached before first await", async () => {
  const f = reportFixture(); f.hooks.fetch = () => {
    f.options.reportIdentityRules[0].identity_namespace = "catalog_product_id"; f.options.dateWindow.start = "2026-10-02";
  };
  const r = await f.run(); assert.equal(r.product_report_candidate_links.links[0].state, "catalog_candidate_reference");
  assert.equal(r.native_product_report.date_window.start, "2026-10-01");
});
test("report bridge: previous two entries cannot enable report reads with caller flags", async () => {
  for (const read of [collectMetaNativeIdentityEvidence, collectMetaVerifiedProductCandidateEvidence]) {
    const f = reportFixture(); f.options.withReport = true; const r = await read(f.options);
    assert.equal(r.native_product_report, undefined); assert.equal(f.calls.length, 10);
  }
  const f = reportFixture(); f.options.withReport = false; f.options.withShopify = false;
  assert.equal((await f.run()).product_report_candidate_links.links[0].state, "catalog_candidate_reference");
});
test("report bridge: other account Ads remain raw and explicitly outside observed target catalog", async () => {
  const f = reportFixture(), other = structuredClone(f.native.insights.data[0]); other.ad_id = "67";
  f.native.insights.data.push(other); const r = await f.run(); assert.equal(r.native_product_report.rows.length, 2);
  assert.equal(r.product_report_candidate_links.links[1].reason, "outside_selected_Ad_catalog_observation");
  assert.equal(r.product_report_candidate_links.links[1].identity_namespace, null);
});
for (const [name, change] of [["foreign account", r => {r.account_id = "124";}], ["daily date", r => {r.date_stop = "2026-10-02";}],
  ["outside window", r => {r.date_start = "2026-10-02"; r.date_stop = r.date_start;}],
  ["parent", r => {r.adset_id = "78";}], ["campaign", r => {r.campaign_id = "56";}]]) test(`report bridge: native ${name} conflict rejects whole collection`, async () => {
  const f = reportFixture(); change(f.native.insights.data[0]); await assert.rejects(f.run()); assert.equal(f.calls.length, 7);
});
test("report bridge: duplicate rows, repeated cursor, page and row bounds reject without partial results", async () => {
  for (const mode of ["duplicate", "cursor", "pages", "rows"]) {
    const f = reportFixture();
    if (mode === "duplicate") f.native.insights.data.push(f.native.insights.data[0]);
    else if (mode === "rows") {f.options.maxReportRows = 1; f.native.insights.data.push({...f.native.insights.data[0], product_id: "other"});}
    else {f.native.insights.paging = {next: "opaque-continuation", cursors: {after: "next"}};
      if (mode === "pages") f.options.maxReportPages = 1;
      else f.hooks.fetch = p => p.pathname.endsWith("/insights") && p.searchParams.has("after")
        && response({data: [], paging: f.native.insights.paging});}
    await assert.rejects(f.run()); assert.ok(f.calls.length <= 8);
  }
});
test("report bridge: empty intermediate page follows original endpoint and keeps product query intact", async () => {
  const f = reportFixture(); f.hooks.fetch = p => p.pathname.endsWith("/insights") && !p.searchParams.has("after")
    && response({data: [], paging: {next: "opaque-continuation", cursors: {after: "next"}}});
  const r = await f.run(); assert.equal(r.native_product_report.pages, 2); assert.equal(f.calls.length, 12);
  assert.equal(f.calls[7].parsed.pathname, f.calls[6].parsed.pathname); assert.equal(f.calls[7].parsed.searchParams.get("after"), "next");
});
for (const status of [200, 401, 403, 429, 500]) test(`report bridge: ${status} error payload stops first time`, async () => {
  const f = reportFixture(); f.hooks.fetch = p => p.pathname.endsWith("/insights")
    && response({error: {message: "secret-native"}, data: []}, status);
  await assert.rejects(f.run(), e => e.message === "META_IDENTITY_COLLECTION_FAILED"); assert.equal(f.calls.length, 7);
});
test("report bridge: authority change in report JSON prevents final Ad observation", async () => {
  const f = reportFixture(); f.hooks.fetch = p => {if (p.pathname.endsWith("/insights")) f.state.version++;};
  await assert.rejects(f.run()); assert.equal(f.calls.length, 7);
});
test("report bridge: final Ad reference change discards attached candidate links", async () => {
  const f = reportFixture(); f.hooks.fetch = (p, init, n) => n > 7 && p.pathname.endsWith("/99")
    && response({id: "99", account_id: "123", product_set_id: null});
  await assert.rejects(f.run(), /REFERENCE_CHANGED/); assert.equal(f.calls.length, 11);
});
test("report bridge: authentic quota waiting control, abort and expiry stop report collection", async () => {
  const managed = createQuotaManagedFetch({provider: "meta", guard: {execute: async () => ({status: "waiting"})},
    resolveOperation: async () => "a".repeat(64), lane: "background", fetchFn: async () => {throw Error("must not send");}});
  let control; try {await managed("https://graph.facebook.com/v26.0/act_123/insights");} catch (e) {control = e;}
  for (const mode of ["quota", "abort", "expiry"]) {
    const f = reportFixture(), controller = new AbortController(); f.options.signal = controller.signal;
    f.native.debug_token.data.expires_at = f.state.now.valueOf() / 1000 + 60;
    f.hooks.fetch = p => {if (p.pathname.endsWith("/insights")) {
      if (mode === "quota") throw control; else if (mode === "abort") controller.abort(); else f.state.now = new Date("2026-10-27T15:01:00Z");
    }};
    await assert.rejects(f.run(), e => mode !== "quota" || e === control); assert.equal(f.calls.length, 7);
  }
});
