import {providerClaimPrewriteCases} from "./helpers/provider-claim-prewrite-cases.js";
import {reviewRefreshReferencePrewrite} from "../app/lib/providers/reference-prewrite.server.js";
import test,{after} from "node:test";
import assert from "node:assert/strict";
import {collectMetaNativeIdentityEvidence, collectMetaVerifiedProductCandidateEvidence, collectMetaReportProductCandidateEvidence} from "../app/lib/providers/meta-identity-collection.server.js";
import {createMetaCandidateSourceRuleLoader, verifyMetaCatalogSourceCandidates} from "../app/lib/providers/meta-source-candidates.server.js";
import {createMetaReportIdentityRuleLoader} from "../app/lib/providers/meta-report-candidates.server.js";
import {META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS} from "../app/lib/providers/meta-reporting.server.js";
import {readMetaCatalogIdentitySnapshot, matchMetaCatalogProductIdentity} from "../app/lib/providers/meta-catalog-identity-reader.server.js";
import {readMetaAdCatalogReference} from "../app/lib/providers/meta-adset-catalog-reference.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createQuotaManagedFetch, quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createQuotaScopeResolver, quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createRefreshMetaIdentityReader,createRefreshMetaCandidateReader,createRefreshMetaReportCandidateReader} from "../app/lib/refresh/quota-authority-binding.server.js";
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
    if (sql.includes("load_provider_identity_authority")) return {rows: [{
      installation_id: String(state.installationId ?? "42"),workspace_id:workspace,install_generation:state.generation,installation_status:"active",
      shop_id:"gid://shopify/Shop/12",shop_domain:"test.myshopify.com",connection_id:connection,credential_id:credential,connection_version:state.version,lifecycle_status:state.status,
      granted_scopes:[...state.scopes],reporting_account_id:"meta"==="klaviyo"?null:state.account,reporting_selection_epoch:"meta"==="klaviyo"?null:String(state.selectionEpoch ?? "71"),
      accounts:[{id:state.account,kind:"meta"==="klaviyo"?"account":"advertiser",status:"active",reporting_eligible:true,
        login_account_id:"meta"==="google_ads"?state.manager:null}]}]};
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
  assert.equal(r.installation_id, "42"); assert.equal(r.canonical_scope_ready, false);
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
  assert.equal(r.canonical_scope_ready, false); assert.equal(r.installation_id, "42"); assert.equal(r.persistable, false);
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
    f.shopHooks.graphql = (q, o) => {assert.ok(o.signal instanceof AbortSignal);
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
  assert.equal(r.proves_product_delivery_or_Insights_namespace, false); assert.equal(r.installation_id, "42");
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

test("deadline: stalled token fetch or response body rejects with child signal aborted", async () => {
  for (const mode of ["fetch", "body"]) {
    const f = fixture(); f.options.maxElapsedMs = 30; let signal;
    f.hooks.fetch = (p, init) => {signal = init.signal;
      return mode === "fetch" ? new Promise(() => {}) : {...response({}), json: () => new Promise(() => {})};};
    await assert.rejects(f.run(), /IDENTITY_READ_DEADLINE_EXCEEDED/); assert.equal(signal.aborted, true); assert.equal(f.calls.length, 1);
  }
});
test("deadline: stalled Shopify request cannot reach report or final reference", async () => {
  const f = reportFixture(); f.options.maxElapsedMs = 200; let signal;
  f.shopHooks.graphql = (q, o) => {signal = o.signal; return new Promise(() => {});};
  await assert.rejects(f.run(), /DEADLINE_EXCEEDED/); assert.equal(signal.aborted, true); assert.equal(f.calls.length, 6);
});
test("deadline: stalled Insights body returns timeout rather than partial candidates", async () => {
  const f = reportFixture(); f.options.maxElapsedMs = 200;
  f.hooks.fetch = p => p.pathname.endsWith("/insights") && {...response({}), json: () => new Promise(() => {})};
  await assert.rejects(f.run(), /DEADLINE_EXCEEDED/); assert.equal(f.calls.length, 7);
});
test("deadline: already-aborted caller never reads SQL or Meta", async () => {
  const f = fixture(), caller = new AbortController(); caller.abort(); f.options.signal = caller.signal;
  await assert.rejects(f.run(), /IDENTITY_READ_ABORTED/); assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
});

function quotaFixture(withReport = false) {
  const f = withReport ? reportFixture() : fixture(), native = f.options.fetchFn;
  const metadata = [], reservations = [], lookups = [], stops = [], settles = [], q = {};
  const c = {provider: "meta", clientScopeKey: "a".repeat(64), connectionScopeKey: "b".repeat(64),
    connectionEpoch: 1, accountId: "act_123", organizationId: null, apiVersion: "v26.0"};
  const configured = new Set(["token_debug", "identity_ad", "identity_adset", "identity_product_set", "identity_creative", "catalog_products", "product_insights"]
    .map(family => quotaRouteIdentity(c, {provider: "meta", family, accountId: family === "product_insights" ? "act_123" : null,
      organizationId: null, version: "v26.0", includes: []}).routeKey));
  const store = {resolveRoute: async identity => {lookups.push(identity); return q.missing ? null : configured.has(identity.routeKey) ? identity.routeKey : null;},
    reserve: async x => {reservations.push(x); if (q.waitAt === reservations.length) return {status: "waiting"};
      const r = {status: "reserved", ...x, dispatchBeforeMs: Date.now() + 10000, dispatchBudgetMs: 10000}; q.reserved?.(); return r;},
    settle: async x => {settles.push(x); return true;}, stop: async x => {stops.push(x); return true;}};
  const resolve = createQuotaScopeResolver({loadContext: async () => c, store});
  f.options.fetchFn = createQuotaManagedFetch({provider: "meta", lane: "background", guard: createSharedQuotaGuard({store, now: Date.now}),
    resolveOperation: async d => {metadata.push(d); return resolve(d);}, isDispatchCurrent: async (d, key) => await resolve(d) === key,
    fetchFn: async (...args) => {const r = await native(...args); return new Response(JSON.stringify(await r.json()), {status: r.status, headers: {"content-type": "application/json"}});}});
  return {...f, q, c, metadata, reservations, lookups, stops, settles};
}
test("quota integration: native Meta chain reserves and settles once for each actual HTTP read", async () => {
  const f = quotaFixture(); const r = await f.run(); assert.equal(r.persistable, false);
  assert.equal(f.calls.length, 10); assert.equal(f.reservations.length, 10); assert.equal(f.settles.length, 10); assert.equal(f.stops.length, 0);
  assert.deepEqual(f.metadata.map(d => d.family), ["token_debug", "identity_ad", "identity_adset", "identity_product_set", "identity_creative",
    "catalog_products", "identity_ad", "identity_adset", "identity_product_set", "identity_creative"]);
  assert.ok(f.lookups.every(x => Object.keys(x).sort().join(",") === "connectionScopeKey,provider,routeKey"));
  assert.doesNotMatch(JSON.stringify([f.lookups, f.reservations, f.metadata]), /secret-access|secret-app|shopify_US|retailer_id|appsecret_proof/);
});
test("quota integration: report bridge uses the same boundary for product Insights too", async () => {
  const f = quotaFixture(true); await f.run(); assert.equal(f.calls.length, 11); assert.equal(f.reservations.length, 11);
  assert.equal(f.metadata[6].family, "product_insights"); assert.equal(f.metadata[6].accountId, "act_123");
});
test("quota integration: catalog continuation is another metered native read", async () => {
  const f = quotaFixture(); f.hooks.fetch = p => p.pathname.endsWith("/products") && !p.searchParams.has("after")
    && response({data: [], paging: {next: "opaque-continuation", cursors: {after: "next"}}});
  assert.equal((await f.run()).native_source.pages, 2); assert.equal(f.calls.length, 11); assert.equal(f.reservations.length, 11);
  assert.equal(f.metadata.filter(d => d.family === "catalog_products").length, 2);
});
test("quota integration: unconfigured owner profile prevents even token inspection", async () => {
  const f = quotaFixture(); f.q.missing = true;
  await assert.rejects(f.run(), e => quotaBoundaryControl(e)?.status === "not_configured"); assert.equal(f.calls.length, 0); assert.equal(f.reservations.length, 0);
});
test("quota integration: quota wait at catalog preserves five prior reads and never retries", async () => {
  const f = quotaFixture(); f.q.waitAt = 6;
  await assert.rejects(f.run(), e => quotaBoundaryControl(e)?.status === "waiting" && quotaBoundaryControl(e).priorBoundaryAttempts === 5);
  assert.equal(f.calls.length, 5); assert.equal(f.reservations.length, 6); assert.equal(f.stops.length, 0);
});
test("quota integration: context account or epoch drift after reserve settles without dispatch", async () => {
  for (const change of [c => {c.connectionEpoch++;}, c => {c.accountId = "act_124";}]) {
    const f = quotaFixture(); f.q.reserved = () => {change(f.c);};
    await assert.rejects(f.run(), e => quotaBoundaryControl(e)?.status === "not_sent");
    assert.equal(f.calls.length, 0); assert.equal(f.reservations.length, 1); assert.equal(f.settles.length, 1);
  }
});
test("quota integration: first native error records one stop without sensitive body or another request", async () => {
  const f = quotaFixture(); f.hooks.fetch = p => p.pathname.endsWith("/products") && response({error: {message: "SECRET-NATIVE"}}, 403);
  await assert.rejects(f.run()); assert.equal(f.calls.length, 6); assert.equal(f.stops.length, 1);
  assert.doesNotMatch(JSON.stringify(f.stops), /SECRET-NATIVE/);
});

function boundFixture() {
  const f=fixture(),native=f.options.fetchFn,q={},loads=[],reservations=[],settles=[],stops=[];
  const c={provider:"meta",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:1,
    accountId:"act_123",organizationId:null,apiVersion:"v26.0"};
  const keys=new Map(["token_debug","identity_ad","identity_adset","identity_product_set","identity_creative","catalog_products"]
    .map(family=>[family,quotaRouteIdentity(c,{provider:"meta",family,accountId:null,organizationId:null,version:c.apiVersion,includes:[]}).routeKey]));
  const config={verified:f.options.verified,database:f.options.database,tokenVault:f.options.tokenVault,
    config:f.options.config,adId:"66",adSetId:"77",campaignId:"55",catalogId:"456",readNow:()=>f.state.now,now:Date.now,
    claim:{workspaceId:workspace,installGeneration:"3",provider:"meta",accountId:"act_123",id:"job1",fence:2},
    window:{from:"2026-10-01",to:"2026-10-01"},entitlementReceipt:{observedAt:f.state.now.toISOString()},
    workStore:{loadQuotaContext:async input=>{
      loads.push(input); await q.load?.();
      if(q.lost||f.state.version!==2||f.state.account!=="act_123") return null;
      return c;
    }},
    quotaStore:{resolveRoute:async x=>[...keys.values()].includes(x.routeKey)&&x.routeKey!==keys.get(q.missingFamily)?x.routeKey:null,
      reserve:async x=>{reservations.push(x); if(reservations.length===q.waitAt) return {status:"waiting"};
        const permit={...x,status:"reserved",dispatchBeforeMs:Date.now()+10000,dispatchBudgetMs:10000}; q.reserved?.(); return permit;},
      settle:async x=>{settles.push(x);return true;},stop:async x=>{stops.push(x);return true;}},
    fetchFn:async(...args)=>{const r=await native(...args);return new Response(JSON.stringify(await r.json()),
      {status:r.status,headers:{"content-type":"application/json"}});}};
  return {...f,config,c,q,loads,reservations,settles,stops,create:()=>createRefreshMetaIdentityReader(config)};
}

test("bound Meta: concrete native chain meters every read using fenced work and entitlement",async()=>{
  const f=boundFixture(),r=await f.create().readEvidence();
  assert.equal(f.calls.length,10);assert.equal(f.reservations.length,10);assert.equal(f.settles.length,10);assert.equal(f.loads.length,20);
  assert.ok(f.loads.every(x=>x.provider==="meta"&&x.claim.id==="job1"&&x.claim.fence===2&&x.claim.accountId==="act_123"
    &&x.window.from==="2026-10-01"&&x.entitlementReceipt.observedAt===f.state.now.toISOString()));
  assert.equal(r.persistable,false);assert.equal(r.installation_id,"42");assert.equal(r.proves_product_delivery_or_Insights_namespace,false);
  assert.equal(r.native_source.records[0].shopify_product_id,undefined);
  assert.doesNotMatch(JSON.stringify([f.reservations,f.loads,f.stops]),/secret-access|secret-app|shopify_US|retailer_id/);
});
test("bound Meta: target config and owner inputs captured before read cannot be retargeted",async()=>{
  const f=boundFixture(),reader=f.create();
  f.config.claim.accountId="act_124";f.config.claim.fence=99;f.config.window.from="2026-10-02";
  f.config.entitlementReceipt.observedAt="2000-01-01T00:00:00Z";f.config.verified.identity.shop.shopId="gid://shopify/Shop/99";
  f.config.config.appId="999";f.config.config.appSecret="changed";f.config.config.graphVersion="v1.0";
  for(const k of ["adId","adSetId","campaignId","catalogId"]) f.config[k]="999";
  const r=await reader.readEvidence();assert.equal(r.shop.shopId,"gid://shopify/Shop/12");assert.equal(f.calls.length,10);
  assert.equal(f.calls[0].init.headers.get("authorization"),"Bearer 123|secret-app");
  assert.ok(f.loads.every(x=>x.claim.accountId==="act_123"&&x.claim.fence===2&&x.window.from==="2026-10-01"));
});
for(const [name,change] of [["provider",f=>{f.config.claim.provider="klaviyo";}],
  ["workspace",f=>{f.config.claim.workspaceId=connection;}],["generation",f=>{f.config.claim.installGeneration="4";}],
  ["missing fence",f=>{delete f.config.claim.fence;}],["multi-day window",f=>{f.config.window.to="2026-10-02";}],
  ["invalid date",f=>{f.config.window.from="2026-02-30";f.config.window.to=f.config.window.from;}],
  ["missing receipt",f=>{delete f.config.entitlementReceipt;}],["inactive owner",f=>{f.config.verified.installationAuthority.status="inactive";}],
  ["mode override",f=>{f.config.mode="report";}],["candidate rules",f=>{f.config.sourceRules=[];}],
  ["report rules",f=>{f.config.reportIdentityRules=[];}],["arbitrary resolver",f=>{f.config.resolveOperation=()=>"a".repeat(64);}],
  ["arbitrary guard",f=>{f.config.guard={};}],["arbitrary context",f=>{f.config.loadContext=()=>f.c;}],
  ["legacy callback",f=>{f.config.authorizeRead=()=>true;}],
]) test(`bound Meta: ${name} rejected before SQL or HTTP`,()=>{
  const f=boundFixture();change(f);assert.throws(f.create);assert.equal(f.queries.length,0);assert.equal(f.calls.length,0);
});
test("bound Meta: read overrides and concurrent or completed replay are forbidden",async()=>{
  const f=boundFixture(),reader=f.create();await assert.rejects(reader.readEvidence({adId:"999"}),/OVERRIDE_FORBIDDEN/);
  const pending=reader.readEvidence();await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);await pending;
  await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);assert.equal(f.calls.length,10);
});
for(const [name,change] of [["lost work or entitlement",f=>{f.q.lost=true;}],["wrong context account",f=>{f.c.accountId="act_124";}],
  ["wrong Graph version",f=>{f.c.apiVersion="v25.0";}],["missing native profile",f=>{f.q.missingFamily="token_debug";}],
]) test(`bound Meta: ${name} prevents token inspection HTTP`,async()=>{
  const f=boundFixture();change(f);await assert.rejects(f.create().readEvidence());assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);
});
test("bound Meta: reservation-time scope or authority drift settles without HTTP",async()=>{
  for(const change of [f=>{f.state.version++;},f=>{f.c.accountId="act_124";},f=>{f.c.connectionEpoch++;},f=>{f.q.lost=true;}]) {
    const f=boundFixture();f.q.reserved=()=>change(f);
    await assert.rejects(f.create().readEvidence(),e=>quotaBoundaryControl(e)?.status==="not_sent");
    assert.equal(f.calls.length,0);assert.equal(f.settles.length,1);assert.equal(f.stops.length,0);
  }
});
test("bound Meta: missing catalog profile preserves prior reads and consumes instance",async()=>{
  const f=boundFixture();f.q.missingFamily="catalog_products";const reader=f.create();
  await assert.rejects(reader.readEvidence(),e=>quotaBoundaryControl(e)?.status==="not_configured");assert.equal(f.calls.length,5);
  await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);assert.equal(f.calls.length,5);
});
test("bound Meta: first quota wait can become existing work-wait evidence but cannot replay",async()=>{
  const f=boundFixture();f.q.waitAt=1;const reader=f.create();let error;
  try{await reader.readEvidence();}catch(e){error=e;}
  assert.equal(refreshQuotaWait(error,"provider_page",f.config.claim)?.status,"quota_waiting");assert.equal(f.calls.length,0);
  await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
});
test("bound Meta: catalog quota wait retains five attempts and cannot become whole-job not-sent",async()=>{
  const f=boundFixture();f.q.waitAt=6;let error;try{await f.create().readEvidence();}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error)?.priorBoundaryAttempts,5);assert.equal(f.calls.length,5);
  assert.equal(refreshQuotaWait(error,"provider_page",f.config.claim),null);
});
test("bound Meta: each catalog continuation is another reservation",async()=>{
  const f=boundFixture();f.hooks.fetch=p=>p.pathname.endsWith("/products")&&!p.searchParams.has("after")
    &&response({data:[],paging:{next:"opaque",cursors:{after:"next"}}});
  assert.equal((await f.create().readEvidence()).native_source.pages,2);assert.equal(f.calls.length,11);assert.equal(f.reservations.length,11);
});
test("bound Meta: first native error stops once with no retry or app secret in stop",async()=>{
  const f=boundFixture();f.hooks.fetch=()=>response({error:{message:"SECRET-NATIVE"}},403);const reader=f.create();
  await assert.rejects(reader.readEvidence());assert.equal(f.calls.length,1);assert.equal(f.stops.length,1);
  assert.doesNotMatch(JSON.stringify(f.stops),/SECRET-NATIVE|secret-app|secret-access/);
  await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
});
test("bound Meta: native grant failure consumes instance after token inspection only",async()=>{
  const f=boundFixture();f.native.debug_token.data.scopes.pop();const reader=f.create();await assert.rejects(reader.readEvidence());
  assert.equal(f.calls.length,1);await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
});
test("bound Meta: deadline during context lookup prevents late reserve and dispatch",async()=>{
  const f=boundFixture();f.config.maxElapsedMs=40;let release;f.q.load=()=>new Promise(resolve=>{release=resolve;});
  await assert.rejects(f.create().readEvidence(),/DEADLINE_EXCEEDED/);delete f.q.load;release();await new Promise(r=>setTimeout(r,0));
  assert.equal(f.calls.length,0);assert.equal(f.reservations.length,0);assert.equal(f.stops.length,0);
});
test("bound Meta: pre-abort cannot read SQL or native HTTP",async()=>{
  const f=boundFixture(),controller=new AbortController();controller.abort();f.config.signal=controller.signal;
  await assert.rejects(f.create().readEvidence(),/IDENTITY_READ_ABORTED/);assert.equal(f.queries.length,0);assert.equal(f.loads.length,0);
});

const originalSdkFetch=abstractFetch;after(()=>setAbstractFetchFunc(originalSdkFetch));
const sdkRoot=import.meta.resolve("@shopify/shopify-app-react-router/server");
const {graphqlClientFactory}=await import(new URL("./clients/admin/graphql.mjs",sdkRoot));
const {handleClientErrorFactory}=await import(new URL("./authenticate/admin/helpers/handle-client-error.mjs",sdkRoot));
const sdkApi=shopifyApi({apiKey:"a".repeat(32),apiSecretKey:"b".repeat(32),hostName:"example.com",apiVersion:ApiVersion.October26,
  isEmbeddedApp:true,logger:{level:LogSeverity.Error,log:()=>{}}});
function candidateBoundFixture(withReport=false){
  const f=boundFixture(),adminCalls=[],adminLoads=[],feedback=[],auth=[];f.config.sourceRules=[rule()];
  if(withReport){f.config.reportIdentityRules=[reportRule()];f.native.insights=reportFixture().native.insights;}
  const bridge=createShopifyAdminIdentitySdkBridge();setAbstractFetchFunc(bridge.fetch);f.config.sdkBridge=bridge;
  const session=new Session({id:"offline_test.myshopify.com",shop:"test.myshopify.com",state:"synthetic",isOnline:false,accessToken:"SECRET-ADMIN",scope:"read_products"});
  f.config.verified.context.admin={graphql:graphqlClientFactory({params:{api:sdkApi,logger:{debug:()=>{}}},session,
    handleClientError:handleClientErrorFactory({request:new Request("https://example.com"),onError:async x=>auth.push(x)})})};
  const adminContext={provider:"shopify_admin",clientScopeKey:"c".repeat(64),connectionScopeKey:"d".repeat(64),connectionEpoch:3,
    accountId:"test.myshopify.com",organizationId:null,apiVersion:"2026-10"};f.q.adminContext=adminContext;
  const adminKeys=["identity_product","identity_variant","identity_product_variant"].map(family=>quotaRouteIdentity(adminContext,
    {provider:"shopify_admin",family,accountId:adminContext.accountId,organizationId:null,version:"2026-10",includes:[]}).routeKey);
  const reportKey=quotaRouteIdentity(f.c,{provider:"meta",family:"product_insights",accountId:"act_123",organizationId:null,version:f.c.apiVersion,includes:[]}).routeKey;
  const load=f.config.workStore.loadQuotaContext,resolve=f.config.quotaStore.resolveRoute,reserve=f.config.quotaStore.reserve,native=f.config.fetchFn;
  f.config.workStore={loadQuotaContext:async x=>{if(x.provider!=="shopify_admin")return load(x);
    adminLoads.push(x);await f.q.adminLoading?.();return f.q.adminMissing?null:f.q.adminContext;}};
  f.config.quotaStore.resolveRoute=async x=>adminKeys.includes(x.routeKey)?f.q.missingAdminProfile?null:x.routeKey:
    withReport&&x.routeKey===reportKey?f.q.missingReportProfile?null:x.routeKey:resolve(x);
  f.config.quotaStore.reserve=async x=>{const r=await reserve(x);return r.status==="reserved"?
    {...r,...f.q.noBudget?{}:{costBudget:{unit:"shopify_admin_query_points",reservedRequestedCost:10}}}:r;};
  f.config.quotaStore.recordFeedback=async x=>{feedback.push(x);return true;};
  f.config.fetchFn=async(endpoint,init)=>{
    if(new URL(endpoint).hostname!=="test.myshopify.com")return native(endpoint,init);
    adminCalls.push({endpoint,init});const payload={data:{shop:{id:"gid://shopify/Shop/12",myshopifyDomain:"test.myshopify.com"},
      product:{id:"gid://shopify/Product/10",legacyResourceId:"10"},productVariant:{id:"gid://shopify/ProductVariant/20",legacyResourceId:"20",
        product:{id:"gid://shopify/Product/10",legacyResourceId:"10"}}},extensions:{cost:{requestedQueryCost:8,actualQueryCost:5,
          throttleStatus:{maximumAvailable:1000,currentlyAvailable:995,restoreRate:50}}}};
    await f.q.adminNative?.(payload,init);if(f.q.adminThrow)throw Error("SECRET-NATIVE");return Response.json(payload,{status:f.q.adminStatus??200});
  };
  return {...f,adminCalls,adminLoads,feedback,auth,create:()=>withReport?createRefreshMetaReportCandidateReader(f.config):createRefreshMetaCandidateReader(f.config)};
}
for(const report of [false,true])test(`bound Meta candidate report=${report}: real SDK and provider share original fenced execution`,async()=>{
  const f=candidateBoundFixture(report),r=await f.create().readEvidence();assert.equal(f.calls.length,report?11:10);assert.equal(f.adminCalls.length,1);
  assert.equal(f.reservations.length,report?12:11);assert.equal(f.settles.length,f.reservations.length);assert.equal(f.auth.length,0);
  assert.equal(f.feedback.filter(x=>x.feedback.kind==="shopify_admin_cost_observed").length,1);
  assert.ok(f.adminLoads.every(x=>x.claim.provider==="meta"&&x.claim.accountId==="act_123"&&x.claim.id==="job1"&&x.claim.fence===2&&x.window.from==="2026-10-01"));
  assert.equal(r.product_identity_candidates.candidates[0].shopify_product_id,"gid://shopify/Product/10");
  assert.equal(r.product_identity_candidates.provider_link_verified,false);assert.equal(r.provider_link_verified,true);
  for(const k of ["persistable","canonical_scope_ready","authorizes_activation","mapping_write_performed","proves_product_delivery_or_Insights_namespace"])assert.equal(r[k],false);
  if(report){assert.deepEqual(r.native_product_report.rows,f.native.insights.data);assert.equal(r.native_product_report.metrics_interpreted,false);
    assert.equal(r.product_report_candidate_links.links[0].candidate_index,0);assert.equal(r.product_report_candidate_links.sales_role_assigned,false);
    const call=f.calls.find(c=>c.parsed.pathname.endsWith("/insights"));assert.equal(call.parsed.searchParams.get("fields"),META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS.join(","));}
  else assert.equal(r.native_product_report,undefined);
  assert.doesNotMatch(JSON.stringify([f.loads,f.adminLoads,f.reservations,f.feedback,r]),/SECRET|secret-access|secret-app/);
});
test("bound Meta report: both default registries empty mean no parsed retailer or inferred namespace",async()=>{
  const f=candidateBoundFixture(true);delete f.config.sourceRules;delete f.config.reportIdentityRules;const r=await f.create().readEvidence();
  assert.equal(f.adminCalls.length,0);assert.equal(r.product_identity_candidates.candidates.length,0);
  assert.equal(r.product_report_candidate_links.links[0].reason,"verified_report_identity_rule_required");
});
test("bound Meta report: valid source rule alone cannot infer report namespace",async()=>{
  const f=candidateBoundFixture(true);delete f.config.reportIdentityRules;const r=await f.create().readEvidence();
  assert.equal(f.adminCalls.length,1);assert.equal(r.product_report_candidate_links.links[0].candidate_index,null);
  assert.equal(r.product_report_candidate_links.links[0].reason,"verified_report_identity_rule_required");
});
test("bound Meta report: valid report rule alone cannot create a Shopify candidate",async()=>{
  const f=candidateBoundFixture(true);delete f.config.sourceRules;const r=await f.create().readEvidence();assert.equal(f.adminCalls.length,0);
  assert.equal(r.product_report_candidate_links.links[0].reason,"verified_source_rule_required");
});
test("bound Meta report: rules config native SDK and job captured before caller mutations",async()=>{
  const f=candidateBoundFixture(true),reader=f.create();f.config.sourceRules[0].market="CA";f.config.reportIdentityRules[0].identity_namespace="catalog_product_id";
  f.config.config.appSecret="changed";f.config.claim.fence=99;f.config.window.from="2026-10-02";f.config.verified.context.admin.graphql=()=>{throw Error("replacement");};
  const r=await reader.readEvidence();assert.equal(r.product_report_candidate_links.links[0].candidate_index,0);
  assert.ok(f.adminLoads.every(x=>x.claim.fence===2&&x.window.from==="2026-10-01"));assert.equal(r.native_product_report.rows[0].date_start,"2026-10-01");
});
for(const [name,change] of [["missing bridge",f=>{delete f.config.sdkBridge;}],["fake bridge",f=>{f.config.sdkBridge={wrap:x=>x.admin};}],
  ["mode override",f=>{f.config.mode="native";}],["date override",f=>{f.config.dateWindow={start:"2026-10-02",end:"2026-10-02"};}],
  ["ledger override",f=>{f.config.readExecution={};}],["context override",f=>{f.config.loadContext=()=>({});}],
  ["guard override",f=>{f.config.guard={};}],["wrong session",f=>{f.config.verified.identity.session.shopDomain="other.myshopify.com";}],
  ["conflicting source rules",f=>{f.config.sourceRules.push(rule());}],["conflicting report rules",f=>{f.config.reportIdentityRules.push(reportRule());}],
  ["unverified source",f=>{f.config.sourceRules[0].state="proposed";}],["unverified namespace",f=>{f.config.reportIdentityRules[0].state="proposed";}]])
test(`bound Meta report: ${name} stops before SQL and HTTP`,()=>{
  const f=candidateBoundFixture(true);change(f);assert.throws(f.create);assert.equal(f.queries.length+f.calls.length+f.adminCalls.length,0);
});
test("bound Meta candidate entry rejects report capability instead of silently requesting it",()=>{
  const f=candidateBoundFixture();f.config.reportIdentityRules=[];assert.throws(f.create);assert.equal(f.calls.length,0);
});
for(const [name,change] of [["catalog",r=>{r.product_context.catalog_id="457";}],["feed",r=>{r.product_context.product_feed_id="101";}],
  ["shop",r=>{r.shop_id="gid://shopify/Shop/13";}],["account",r=>{r.scope.platform_account_id="act_124";}]])
test(`bound Meta candidate: ${name} rule mismatch never queries Shopify`,async()=>{
  const f=candidateBoundFixture();change(f.config.sourceRules[0]);const r=await f.create().readEvidence();assert.equal(f.adminCalls.length,0);assert.equal(r.product_identity_candidates.candidates.length,0);
});
for(const kind of ["adminMissing","missingAdminProfile","noBudget"])test(`bound Meta candidate: ${kind} stops before Admin and final references`,async()=>{
  const f=candidateBoundFixture();f.q[kind]=true;await assert.rejects(f.create().readEvidence());assert.equal(f.adminCalls.length,0);assert.equal(f.calls.length,6);
});
for(const [waitAt,prior,nativeCalls,adminCalls] of [[1,0,0,0],[7,6,6,0],[8,7,6,1],[9,8,7,1]])
test(`bound Meta report: wait ${waitAt} retains shared prefix ${prior}`,async()=>{
  const f=candidateBoundFixture(true);f.q.waitAt=waitAt;let error;try{await f.create().readEvidence();}catch(e){error=e;}
  assert.equal(quotaBoundaryControl(error).priorBoundaryAttempts,prior);assert.equal(f.calls.length,nativeCalls);assert.equal(f.adminCalls.length,adminCalls);
  if(prior>0)assert.equal(refreshQuotaWait(error,"provider_page",f.config.claim),null);
});
for(const status of [401,403,429,500])test(`bound Meta candidate: Admin ${status} stops once without auth recovery`,async()=>{
  const f=candidateBoundFixture();f.q.adminStatus=status;const reader=f.create();await assert.rejects(reader.readEvidence());
  assert.equal(f.adminCalls.length,1);assert.equal(f.calls.length,6);assert.equal(f.auth.length,0);assert.equal(f.stops.length,1);
  await assert.rejects(reader.readEvidence(),/EXECUTION_USED/);
});
test("bound Meta report: missing product report profile discards candidate without fallback",async()=>{
  const f=candidateBoundFixture(true);f.q.missingReportProfile=true;await assert.rejects(f.create().readEvidence());assert.equal(f.adminCalls.length,1);assert.equal(f.calls.length,6);
});
test("bound Meta candidate: Admin requested cost above receipt cannot verify product",async()=>{
  const f=candidateBoundFixture();f.q.adminNative=p=>{p.extensions.cost.requestedQueryCost=11;};await assert.rejects(f.create().readEvidence());assert.equal(f.adminCalls.length,1);assert.equal(f.calls.length,6);
});
test("bound Meta report: final creative drift discards candidate and raw report",async()=>{
  const f=candidateBoundFixture(true);f.hooks.fetch=(p,init,n)=>n>7&&p.pathname.endsWith("/99")&&response({...f.native["99"],product_set_id:"89"});
  await assert.rejects(f.create().readEvidence());assert.equal(f.adminCalls.length,1);assert.ok(f.calls.some(c=>c.parsed.pathname.endsWith("/insights")));
});
test("bound Meta candidate: pinned Admin context drift prevents native dispatch",async()=>{
  const f=candidateBoundFixture();f.q.reserved=()=>{if(f.reservations.length===7)f.q.adminContext.connectionEpoch++;};
  await assert.rejects(f.create().readEvidence());assert.equal(f.adminCalls.length,0);assert.equal(f.calls.length,6);
});
test("bound Meta candidate: rotated provider credential during Admin cannot complete collection",async()=>{
  const f=candidateBoundFixture();f.q.adminNative=()=>{f.state.version++;};await assert.rejects(f.create().readEvidence());assert.equal(f.adminCalls.length,1);assert.equal(f.calls.length,6);
});
test("bound Meta candidate: wrong variant parent is conflicting evidence without a mapping",async()=>{
  const f=candidateBoundFixture();f.q.adminNative=p=>{p.data.productVariant.product={id:"gid://shopify/Product/999",legacyResourceId:"999"};};
  const r=await f.create().readEvidence();assert.equal(r.product_identity_candidates.candidates.length,0);assert.equal(r.product_identity_candidates.rows[0].product_identity_verification.state,"conflicting");
});
test("bound Meta candidate: real work repository with missing Admin SQL result stops before HTTP",async()=>{
  const f=candidateBoundFixture();let sql=0;const real=createRefreshWorkRepository({query:async()=>{sql++;return {rows:[]};}}),load=f.config.workStore.loadQuotaContext;
  f.config.workStore.loadQuotaContext=x=>x.provider==="shopify_admin"?real.loadQuotaContext(x):load(x);
  await assert.rejects(f.create().readEvidence());assert.equal(sql,1);assert.equal(f.adminCalls.length,0);assert.equal(f.calls.length,6);
});
test("bound Meta candidate: deadline at Admin lookup prevents late dispatch and final references",async()=>{
  const f=candidateBoundFixture();f.config.maxElapsedMs=500;let release;f.q.adminLoading=()=>new Promise(r=>{release=r;});
  await assert.rejects(f.create().readEvidence(),/DEADLINE_EXCEEDED/);delete f.q.adminLoading;release();await new Promise(r=>setTimeout(r,10));assert.equal(f.adminCalls.length,0);assert.equal(f.calls.length,6);
});
test("bound Meta report: deadline during sent Admin ignores late result without report HTTP",async()=>{
  const f=candidateBoundFixture(true);f.config.maxElapsedMs=500;let release;f.q.adminNative=()=>new Promise(r=>{release=r;});
  await assert.rejects(f.create().readEvidence(),/DEADLINE_EXCEEDED/);release();await new Promise(r=>setTimeout(r,10));assert.equal(f.calls.length,6);assert.equal(f.adminCalls[0].init.signal.aborted,true);
});
test("bound Meta candidate: missing actual SDK hook prevents unmanaged request",async()=>{
  const f=candidateBoundFixture();setAbstractFetchFunc(originalSdkFetch);await assert.rejects(f.create().readEvidence());assert.equal(f.adminCalls.length,0);assert.equal(f.calls.length,6);
});
test("bound Meta candidate: partial GraphQL data cannot yield successful candidates",async()=>{
  const f=candidateBoundFixture();f.q.adminNative=p=>{p.errors=[{message:"SECRET"}];};await assert.rejects(f.create().readEvidence(),e=>!/SECRET/.test(e.message));assert.equal(f.calls.length,6);
});
test("bound Meta report: every report page metered without interpreting the four raw conversion fields",async()=>{
  const f=candidateBoundFixture(true);f.hooks.fetch=p=>p.pathname.endsWith("/insights")&&!p.searchParams.has("after")&&response({data:[],paging:{cursors:{after:"next"},next:"ignored"}});
  const r=await f.create().readEvidence();assert.equal(f.calls.filter(c=>c.parsed.pathname.endsWith("/insights")).length,2);assert.equal(f.reservations.length,13);
  assert.deepEqual(r.native_product_report.rows,f.native.insights.data);assert.equal(r.native_product_report.metrics_interpreted,false);
});
test("bound Meta report: explicit internal catalog namespace does not fall back to retailer ID",async()=>{
  const f=candidateBoundFixture(true);f.config.reportIdentityRules[0].identity_namespace="catalog_product_id";
  const r=await f.create().readEvidence();assert.equal(r.product_report_candidate_links.links[0].candidate_index,null);
  const g=candidateBoundFixture(true);g.config.reportIdentityRules[0].identity_namespace="catalog_product_id";g.native.insights.data[0].product_id="900";
  assert.equal((await g.create().readEvidence()).product_report_candidate_links.links[0].candidate_index,0);
});
test("bound Meta report: foreign target report rule stays unregistered for this ad",async()=>{
  const f=candidateBoundFixture(true);f.config.reportIdentityRules[0].target.ad_id="67";
  assert.equal((await f.create().readEvidence()).product_report_candidate_links.links[0].reason,"verified_report_identity_rule_required");
});
test("bound Meta report: local page bound stops before second report page or final references",async()=>{
  const f=candidateBoundFixture(true);f.config.maxReportPages=1;
  f.hooks.fetch=p=>p.pathname.endsWith("/insights")&&response({data:[],paging:{cursors:{after:"next"},next:"ignored"}});
  await assert.rejects(f.create().readEvidence(),/COLLECTION_FAILED/);assert.equal(f.calls.length,7);assert.equal(f.adminCalls.length,1);
});
const candidatePrewriteOwner=()=>({installationId:"42",reportingSelectionEpoch:"71",provider:"meta",workspaceId:workspace,installGeneration:3,shopId:"gid://shopify/Shop/12",shopDomain:"test.myshopify.com",
  connectionId:connection,connectionVersion:2,accountId:"act_123"});
candidatePrewriteCases({provider:"meta",fixture:candidateBoundFixture,nativeFixture:boundFixture,expected:candidatePrewriteOwner,
  empty:f=>{f.native.products.data=[];},unresolved:f=>{delete f.config.sourceRules;},
  productOnly:f=>{f.config.sourceRules[0].format="shopify_product_id";delete f.config.sourceRules[0].market;f.native.products.data[0].retailer_id="10";}});

test("Meta reference prewrite: captured report links and four raw fields survive without claims or IO",async()=>{
  const f=candidateBoundFixture(true),observation=await f.create().readEvidence(),before=JSON.stringify(observation);
  const io=[f.calls.length,f.adminCalls.length,f.queries.length],r=reviewRefreshReferencePrewrite({expected:candidatePrewriteOwner(),observation});
  assert.equal(r.referenceLinksReviewed,true);assert.equal(r.referenceReview.family,"meta_product_report");
  assert.equal(r.referenceReview.rows[0].candidateIndex,0);assert.equal(r.referenceReview.rows[0].state,"catalog_candidate_reference");
  assert.equal(r.referenceReview.rows[0].observed,observation.native_product_report.rows[0]);
  assert.equal(r.referenceReview.observed,observation.product_report_candidate_links);assert.equal(r.candidateReview.reportLinksReviewed,false);
  for(const field of ["converted_product_quantity","converted_product_value","converted_promoted_product_quantity","converted_promoted_product_value"])
    assert.deepEqual(r.referenceReview.rows[0].observed[field],f.native.insights.data[0][field]);
  for(const field of ["providerClaimsReviewed","providerClaimVerified","exactOverlapVerified","providerLinkVerified","canonicalScopeReady",
    "nativePermissionVerified","persistable","authorizesActivation","mappingWritePerformed","DatasetWritePerformed","salesRolesChanged"])assert.equal(r[field],false);
  assert.equal(JSON.stringify(observation),before);assert.deepEqual([f.calls.length,f.adminCalls.length,f.queries.length],io);
  assert.ok(Object.isFrozen(r.referenceReview.rows));assert.deepEqual(reviewRefreshReferencePrewrite({expected:candidatePrewriteOwner(),observation}),r);
});
for(const [name,change,reason] of [
  ["no namespace",f=>{delete f.config.reportIdentityRules;},"verified_report_identity_rule_required"],
  ["no source rule",f=>{delete f.config.sourceRules;},"verified_source_rule_required"],
  ["internal namespace never falls back",f=>{f.config.reportIdentityRules[0].identity_namespace="catalog_product_id";},"native_catalog_record_not_observed"],
  ["outside selected Ad",f=>{f.native.insights.data[0].ad_id="67";},"outside_selected_Ad_catalog_observation"],
  ["catalog record not observed",f=>{f.native.products.data=[];},"native_catalog_record_not_observed"],
])test(`Meta reference prewrite: ${name} retained unresolved`,async()=>{
  const f=candidateBoundFixture(true);change(f);const observation=await f.create().readEvidence();
  const r=reviewRefreshReferencePrewrite({expected:candidatePrewriteOwner(),observation});assert.equal(r.referenceReview.rows[0].reason,reason);
  assert.equal(r.referenceReview.rows[0].candidateIndex,null);assert.equal(r.referenceReview.rows[0].standardizedProductId,null);
});
test("Meta reference prewrite: exact internal namespace is reviewed against original target and registry",async()=>{
  const f=candidateBoundFixture(true);f.config.reportIdentityRules[0].identity_namespace="catalog_product_id";f.native.insights.data[0].product_id="900";
  const reader=f.create();f.config.reportIdentityRules[0].identity_namespace="retailer_id";f.config.adId="67";f.config.window.from="2026-10-02";
  const observation=await reader.readEvidence(),r=reviewRefreshReferencePrewrite({expected:candidatePrewriteOwner(),observation});
  assert.equal(r.referenceReview.rows[0].candidateIndex,0);assert.equal(r.referenceReview.rows[0].reference.identity_namespace,"catalog_product_id");
});
test("Meta reference prewrite: ambiguous retailer across feeds is retained without picking first",async()=>{
  const f=candidateBoundFixture(true),other=rule();other.product_context.product_feed_id="101";f.config.sourceRules.push(other);
  const record=structuredClone(f.native.products.data[0]);record.id="901";record.product_feed.id="101";f.native.products.data.push(record);
  const observation=await f.create().readEvidence(),r=reviewRefreshReferencePrewrite({expected:candidatePrewriteOwner(),observation});
  assert.equal(r.candidateReview.rows.length,2);assert.equal(r.referenceReview.rows[0].state,"ambiguous");
  assert.equal(r.referenceReview.rows[0].candidateIndex,null);assert.equal(r.referenceReview.rows[0].reason,"multiple_native_catalog_records_for_verified_namespace");
});
test("Meta reference prewrite: complete empty report differs from report not collected",async()=>{
  const f=candidateBoundFixture(true);f.native.insights.data=[];const observation=await f.create().readEvidence();
  const r=reviewRefreshReferencePrewrite({expected:candidatePrewriteOwner(),observation});assert.equal(r.referenceReview.observedEmpty,true);assert.equal(r.referenceLinksReviewed,true);
  const g=candidateBoundFixture(),native=await g.create().readEvidence(),s=reviewRefreshReferencePrewrite({expected:candidatePrewriteOwner(),observation:native});
  assert.equal(s.referenceReview.state,"not_collected_in_this_reader_mode");assert.equal(s.referenceReview.observedEmpty,null);assert.equal(s.referenceLinksReviewed,false);
});
for(const [name,convert] of [["JSON clone",x=>structuredClone(x)],["spread",x=>({...x})],["forged flags",()=>({provider:"meta",provider_link_verified:true})]])
test(`Meta reference prewrite: ${name} has no provenance`,async()=>{
  const f=candidateBoundFixture(true),observation=convert(await f.create().readEvidence());
  assert.throws(()=>reviewRefreshReferencePrewrite({expected:candidatePrewriteOwner(),observation}),/OBSERVATION_REQUIRED/);
});
test("Meta reference prewrite: owner or caller registry override cannot change checked links",async()=>{
  const f=candidateBoundFixture(true),observation=await f.create().readEvidence();
  assert.throws(()=>reviewRefreshReferencePrewrite({expected:{...candidatePrewriteOwner(),connectionVersion:3},observation}),/OWNER_MISMATCH/);
  assert.throws(()=>reviewRefreshReferencePrewrite({expected:candidatePrewriteOwner(),observation,reportRules:[]}),/INPUT_INVALID/);
});
test("Meta prewrite: duplicated retailer ID across feeds does not collapse catalog records",async()=>{
  const f=candidateBoundFixture(),other=rule();other.product_context.product_feed_id="101";other.source_reference="synthetic-other-feed";f.config.sourceRules.push(other);
  const record=structuredClone(f.native.products.data[0]);record.id="901";record.product_feed.id="101";f.native.products.data.push(record);
  const observation=await f.create().readEvidence(),r=reviewRefreshCandidatePrewrite({expected:candidatePrewriteOwner(),observation});
  assert.equal(r.rows.length,2);assert.equal(r.counts.candidates,2);assert.equal(f.adminCalls.length,1);
  assert.notEqual(r.rows[0].sourceReference.nativeKey,r.rows[1].sourceReference.nativeKey);
});
test("Meta prewrite: candidate review does not certify raw report identity links or assign roles",async()=>{
  const f=candidateBoundFixture(true),observation=await f.create().readEvidence(),r=reviewRefreshCandidatePrewrite({expected:candidatePrewriteOwner(),observation});
  assert.equal(r.provenance.kind,"report");assert.equal(r.candidateReferencesChecked,true);assert.equal(r.reportLinksReviewed,false);
  assert.equal(r.providerClaimsReviewed,false);assert.equal(r.salesRolesChanged,false);
});
test("Meta prewrite: two variants of one product retain both catalog source records",async()=>{
  const f=candidateBoundFixture(),record=structuredClone(f.native.products.data[0]);record.id="901";record.retailer_id="shopify_US_10_21";f.native.products.data.push(record);
  f.q.adminNative=(p,init)=>{const id=JSON.parse(init.body).variables.variantId;p.data.productVariant.id=id;p.data.productVariant.legacyResourceId=id.split("/").at(-1);};
  const observation=await f.create().readEvidence(),r=reviewRefreshCandidatePrewrite({expected:candidatePrewriteOwner(),observation});
  assert.equal(r.rows.length,2);assert.equal(r.rows[0].candidateShopifyProductId,r.rows[1].candidateShopifyProductId);
  assert.notEqual(r.rows[0].candidateShopifyVariantId,r.rows[1].candidateShopifyVariantId);assert.equal(f.adminCalls.length,2);
});

providerClaimPrewriteCases({provider:"meta",fixture:candidateBoundFixture,expected:candidatePrewriteOwner,empty:f=>{f.native.products.data=[];}});

import {integratedPrewriteCases} from "./helpers/integrated-prewrite-cases.js";
integratedPrewriteCases({provider:"meta",fixture:candidateBoundFixture,expected:candidatePrewriteOwner});
