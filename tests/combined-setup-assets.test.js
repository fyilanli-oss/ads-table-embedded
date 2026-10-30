import assert from "node:assert/strict";
import test from "node:test";
import {createGoogleOAuthRuntime} from "../app/lib/oauth/google-oauth-runtime.server.js";
import {createMetaOAuthRuntime} from "../app/lib/oauth/meta-oauth-runtime.server.js";
import {createCombinedSetupAssetAccess} from "../app/lib/oauth/combined-setup-assets.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {OAUTH_CALLBACK_URIS} from "../app/lib/oauth/oauth-transaction.server.js";
import {META_GRAPH_VERSION} from "../app/lib/providers/meta-graph.server.js";

const workspace = "11111111-1111-4111-8111-111111111111", connection = "22222222-2222-4222-8222-222222222222",
  credential = "33333333-3333-4333-8333-333333333333";
const response = (body, status = 200) => new Response(JSON.stringify(body), {status});
function fixture(provider, options = {}) {
  const calls = [], queries = [], hooks = {};
  const state = {account: provider === "meta" ? "act_123" : "123", manager: provider === "google_ads" ? "321" : null,
    version: 2, epoch: "71", generation: 3, status: "connected", credential,
    now: new Date("2026-10-29T15:00:00.000Z"), scopes: [...oauthPermissionScopes(provider, "identity_v1")]};
  const verified = {installationAuthority: {authority: "shopify_installation_verified", workspaceId: workspace, installGeneration: 3, status: "active"},
    identity: {session: {authority: "shopify_id_token_verified", shopDomain: "test.myshopify.com"},
      shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"}},
    context: {admin: {graphql() {throw Error("SHOPIFY_PRODUCT_READ_NOT_ALLOWED_IN_ACCESS_PROBE");}}}};
  const token = {access_token: "secret-access", refresh_token: "secret-refresh", permission_profile: "identity_v1",
    scope: state.scopes.join(" "), scopes: [...state.scopes], scope_verified_at: state.now.toISOString(), expires_in: 3600,
    expires_at: "2026-10-29T16:00:00.000Z"};
  const database = {async query(sql, params) {
    queries.push({sql, params}); await hooks.query?.(queries.length);
    assert.match(sql, /load_provider_identity_authority/);
    assert.deepEqual(params, [workspace, 3, provider, "gid://shopify/Shop/12", "test.myshopify.com"]);
    return {rows: options.absent ? [] : [{installation_id: "42", workspace_id: workspace, install_generation: state.generation,
      installation_status: "active", shop_id: "gid://shopify/Shop/12", shop_domain: "test.myshopify.com",
      connection_id: connection, connection_version: state.version, lifecycle_status: state.status, credential_id: state.credential,
      granted_scopes: state.scopes, reporting_account_id: state.account, reporting_selection_epoch: state.epoch,
      accounts: [{id: state.account, kind: "advertiser", reporting_eligible: true, status: "active", login_account_id: state.manager}]}]};
  }};
  const unexpected = async () => {throw Error("NO_TOKEN_WRITE_OR_EXCHANGE_ALLOWED");};
  const tokenVault = {assertReady: unexpected, store: unexpected, take: unexpected, remove: unexpected,
    async loadProviderTokenSet(value) {assert.equal(value.credentialId, state.credential); return token;}};
  let debug = 0;
  const fetchFn = async (address, init) => {
    const parsed = new URL(address); calls.push({parsed, init});
    const custom = await hooks.fetch?.(parsed, init, calls.length); if (custom) return custom;
    if (provider === "google_ads") {
      if (parsed.hostname === "googleads.googleapis.com") return response({results: [{productLink: {
        resourceName: "customers/123/productLinks/7", productLinkId: "7", type: "MERCHANT_CENTER", merchantCenter: {merchantCenterId: "99"}}}]});
      if (parsed.pathname === "/accounts/v1/accounts/99") return response({name: "accounts/99", accountId: "99"});
      if (parsed.pathname === "/products/v1/accounts/99/products") return response(options.empty ? {} : {products: [{name: "accounts/99/products/opaque-item"}]});
    } else {
      if (parsed.pathname.endsWith("/debug_token")) {debug++;
        return response({data: {app_id: "123", is_valid: true, scopes: state.scopes, expires_at: 1893456000}});}
      if (parsed.pathname.endsWith("/me/adaccounts")) return response({data: [{id: "act_123", name: "Advertiser"}]});
      if (parsed.pathname.endsWith("/88") || parsed.pathname.endsWith("/456")) return response({id: parsed.pathname.split("/").at(-1)});
      if (parsed.pathname.endsWith("/owned_ad_accounts")) return response({data: options.shared ? [] : [{id: "act_123"}]});
      if (parsed.pathname.endsWith("/client_ad_accounts")) return response({data: [{id: "act_123"}]});
      if (parsed.pathname.endsWith("/owned_product_catalogs")) return response({data: options.shared ? [] : [{id: "456"}]});
      if (parsed.pathname.endsWith("/client_product_catalogs")) return response({data: [{id: "456"}]});
      if (parsed.pathname.endsWith("/456/products")) return response({data: options.empty ? [] : [{id: "900"}]});
    }
    throw Error("UNEXPECTED_NATIVE_ENDPOINT");
  };
  const config = provider === "google_ads" ? {developerToken: "secret-developer"}
    : {appId: "123", appSecret: "secret-app", graphVersion: META_GRAPH_VERSION};
  const environment = provider === "google_ads" ? {GOOGLE_ADS_OAUTH_CLIENT_ID: "client", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "secret",
    GOOGLE_ADS_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.google_ads, GOOGLE_ADS_DEVELOPER_TOKEN: "secret-developer"}
    : {META_APP_ID: "123", META_APP_SECRET: "secret-app", META_GRAPH_VERSION, META_OAUTH_REDIRECT_URI: OAUTH_CALLBACK_URIS.meta};
  const runtime = (provider === "google_ads" ? createGoogleOAuthRuntime : createMetaOAuthRuntime)({database, tokenVault,
    environment, fetchFn, now: () => state.now, identityAuthorizationEnabled: options.enabled ?? true});
  const input = {installationAuthority: verified.installationAuthority, verified,
    ...(provider === "google_ads" ? {merchantId: "99"} : {businessId: "88", catalogId: "456"})};
  return {calls, queries, hooks, state, token, input, runtime, config,
    run: overrides => runtime.combinedSetup.verifyAssets({...input, ...overrides}), debugCount: () => debug,
    direct: settings => createCombinedSetupAssetAccess({provider, enabled: true, database, tokenVault, config, fetchFn,
      now: () => state.now, ...settings}).verify(input)};
}
for (const provider of ["google_ads", "meta"]) {
  test(`${provider}: access proof is native, account/epoch bound, and does not complete or persist setup`, async () => {
    const f = fixture(provider), result = await f.run({assetAccessVerified: true, setupComplete: true, provider: "other"});
    assert.equal(result.provider, provider); assert.equal(result.accessState, "verified");
    assert.equal(result.reportingAccountId, f.state.account); assert.equal(result.connectionVersion, 2);
    assert.equal(result.reportingSelectionEpoch, "71"); assert.equal(result.installationId, "42");
    assert.equal(result.setupComplete, false); assert.equal(result.setupResumeAction, "review_setup");
    assert.equal(result.developerAppApproval, "not_evaluated"); assert.equal(result.persisted, false);
    assert.equal(result.productMappingVerified, false); assert.equal(result.salesRolesVerified, false);
    assert.equal(result.authorizesActivation, false); assert.ok(Object.isFrozen(result.assetAccess));
    assert.doesNotMatch(JSON.stringify(result), /secret-|credentialId|access_token|refresh_token|retailer_id|opaque-item/);
    assert.ok(f.queries.every(q => q.sql.startsWith("select *")));
    assert.ok(f.calls.every(c => c.init.redirect === "error" && c.init.signal instanceof AbortSignal));
    assert.ok(f.calls.every(c => !/insights|oauth\/access_token|oauth2.googleapis|adsets|campaigns/.test(c.parsed.toString())));
    assert.ok(Date.parse(result.expiresAt) > Date.parse(result.completedAt));
    if (provider === "google_ads") {
      assert.equal(f.calls.length, 5);
      assert.equal(f.calls[0].init.headers["login-customer-id"], "321");
      assert.equal(f.calls[0].init.headers["developer-token"], "secret-developer");
    } else {assert.equal(f.debugCount(), 2); assert.equal(result.assetAccess.accountMembership, "owned_ad_accounts");}
  });
  test(`${provider}: empty product collection proves readable endpoint, never zero inventory or identity`, async () => {
    const result = await fixture(provider, {empty: true}).run();
    assert.equal(result.assetAccess.productsEndpointReadable, true);
    assert.equal(result.productMappingVerified, false); assert.equal(result.assetAccess.productCount, undefined);
  });
  test(`${provider}: default-closed gate cannot be opened by request fields`, async () => {
    const f = fixture(provider, {enabled: false});
    await assert.rejects(f.run({enabled: true, identityAuthorizationEnabled: true}), /START_DISABLED/);
    assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
  });
  test(`${provider}: wrong owner or unverifiable installation fails before native requests`, async () => {
    const f = fixture(provider);
    await assert.rejects(f.run({installationAuthority: {...f.input.installationAuthority, installGeneration: 4}}), /OWNER_MISMATCH/);
    await assert.rejects(f.run({verified: {installationAuthority: f.input.installationAuthority}}));
    assert.equal(f.calls.length, 0);
  });
  test(`${provider}: legacy profile and missing grant cannot reach provider APIs`, async () => {
    for (const mode of ["legacy", "scope"]) {
      const f = fixture(provider);
      if (mode === "legacy") f.token.permission_profile = "reporting_v1";
      else f.state.scopes = [f.state.scopes[0]];
      await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
    }
  });
  test(`${provider}: invalid target is not used as a provider request path`, async () => {
    const f = fixture(provider);
    await assert.rejects(f.run(provider === "google_ads" ? {merchantId: "../99"} : {businessId: "88", catalogId: "../456"}), /TARGET_INVALID/);
    assert.equal(f.queries.length, 0); assert.equal(f.calls.length, 0);
  });
  test(`${provider}: caller reader and authority fields cannot replace the fixed native path`, async () => {
    const f = fixture(provider);
    const result = await f.run({fetchFn() {throw Error("CALLER_READER_USED");}, loadCurrent() {throw Error("CALLER_AUTHORITY_USED");},
      reportingAccountId: "other", credentialId: "other", config: {appId: "other"}});
    assert.equal(result.reportingAccountId, f.state.account);
    assert.ok(f.calls.length > 0);
  });
  for (const status of ["pending_account_selection", "disconnected", "reauthorization_required"]) {
    test(`${provider}: ${status} cannot run native asset verification`, async () => {
      const f = fixture(provider); f.state.status = status;
      await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
    });
  }
  for (const field of ["version", "epoch", "credential", "account", "generation"]) {
    test(`${provider}: ${field} change while reading discards result and stops further requests`, async () => {
      const f = fixture(provider);
      f.hooks.fetch = () => {f.state[field] = field === "version" || field === "generation" ? 4
        : field === "epoch" ? "72" : field === "credential" ? workspace : provider === "meta" ? "act_999" : "999";};
      await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
    });
  }
  test(`${provider}: explicit abort stops before I/O and during native response`, async () => {
    const f = fixture(provider), controller = new AbortController(); controller.abort();
    await assert.rejects(f.run({signal: controller.signal})); assert.equal(f.calls.length, 0);
    const active = new AbortController(); f.hooks.fetch = () => {active.abort();};
    await assert.rejects(f.run({signal: active.signal})); assert.equal(f.calls.length, 1);
  });
  test(`${provider}: HTTP error is one attempt, with no fallback/token exchange or secret error text`, async () => {
    const f = fixture(provider); f.hooks.fetch = () => response({error: {message: "secret-provider-message"}}, 403);
    await assert.rejects(f.run(), error => !/secret-/.test(error.message)); assert.equal(f.calls.length, 1);
  });
  test(`${provider}: malformed native JSON or 200 error envelope never becomes access proof`, async () => {
    for (const body of [null, [], {error: {message: "no"}}]) {
      const f = fixture(provider); f.hooks.fetch = () => response(body);
      await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
    }
  });
  test(`${provider}: elapsed/clock rollback observations are rejected`, async () => {
    for (const offset of [120001, -1]) {
      const f = fixture(provider); f.hooks.fetch = () => {f.state.now = new Date(f.state.now.valueOf() + offset);};
      await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
    }
  });
  test(`${provider}: hanging native read has one total deadline`, async () => {
    const f = fixture(provider);
    f.hooks.fetch = (parsed, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(Error("aborted")), {once: true}));
    await assert.rejects(f.direct({maxElapsedMs: 20}), /DEADLINE_EXCEEDED/); assert.equal(f.calls.length, 1);
  });
}
test("Google: Merchant ID/link/account mismatches and malformed products cannot prove access", async () => {
  for (const mode of ["missing_link", "wrong_account", "null_products", "other_merchant_products", "changed_link"]) {
    const f = fixture("google_ads"); let links = 0;
    f.hooks.fetch = parsed => {
      if (parsed.hostname === "googleads.googleapis.com") {links++;
        if (mode === "missing_link" || mode === "changed_link" && links === 2) return response({results: []});}
      if (mode === "wrong_account" && parsed.pathname.startsWith("/accounts/")) return response({name: "accounts/100", accountId: "100"});
      if (parsed.pathname.includes("/products/")) {
        if (mode === "null_products") return response({products: null});
        if (mode === "other_merchant_products") return response({products: [{name: "accounts/100/products/item"}]});
      }
    };
    await assert.rejects(f.run());
  }
});
test("Meta: client/shared business assets are supported without requiring an active campaign", async () => {
  const f = fixture("meta", {shared: true}), result = await f.run();
  assert.equal(result.assetAccess.accountMembership, "client_ad_accounts");
  assert.equal(result.assetAccess.catalogMembership, "client_product_catalogs");
  assert.match(result.assetAccess.relationship, /not_ad_catalog_delivery/);
});
test("Meta: readable but unrelated catalog is rejected before product probe", async () => {
  const f = fixture("meta");
  f.hooks.fetch = parsed => /product_catalogs$/.test(parsed.pathname) ? response({data: [{id: "777"}]}) : undefined;
  await assert.rejects(f.run(), /NOT_IN_SELECTED_BUSINESS/);
  assert.ok(f.calls.every(c => !c.parsed.pathname.endsWith("/456/products")));
});
test("Meta: pagination uses only the cursor on the fixed business edge, even after an empty page", async () => {
  const f = fixture("meta");
  f.hooks.fetch = parsed => parsed.pathname.endsWith("/owned_product_catalogs") && !parsed.searchParams.has("after")
    ? response({data: [], paging: {next: "https://untrusted.invalid/path?access_token=secret", cursors: {after: "second"}}}) : undefined;
  const result = await f.run(); assert.equal(result.accessState, "verified");
  assert.ok(f.calls.every(c => c.parsed.hostname === "graph.facebook.com"));
  assert.equal(f.calls.filter(c => c.parsed.searchParams.get("after") === "second").length, 2);
});
for (const mode of ["invalid_cursor", "repeated_cursor", "duplicate_id", "wrong_business", "wrong_catalog", "bad_products", "membership_changed", "revoked_scope"]) {
  test(`Meta: ${mode} rejects native proof`, async () => {
    const f = fixture("meta"); let membership = 0, debug = 0;
    f.hooks.fetch = parsed => {
      if (parsed.pathname.endsWith("/88") && mode === "wrong_business") return response({id: "89"});
      if (parsed.pathname.endsWith("/456") && mode === "wrong_catalog") return response({id: "457"});
      if (parsed.pathname.endsWith("/456/products") && mode === "bad_products") return response({data: null});
      if (parsed.pathname.endsWith("/debug_token")) {debug++;
        if (mode === "revoked_scope" && debug === 2) return response({data: {app_id: "123", is_valid: true, scopes: ["ads_read"], expires_at: 1893456000}});}
      if (parsed.pathname.endsWith("/owned_product_catalogs")) {membership++;
        if (mode === "invalid_cursor") return response({data: [], paging: {next: "next", cursors: {}}});
        if (mode === "repeated_cursor") return response({data: [], paging: {next: "next", cursors: {after: "same"}}});
        if (mode === "duplicate_id") return response({data: [{id: "456"}, {id: "456"}]});
        if (mode === "membership_changed" && membership === 2) return response({data: []});
      }
    };
    await assert.rejects(f.run());
  });
}
test("Meta: page and total row limits apply to the whole verification, not each individual edge", async () => {
  for (const settings of [{maxPages: 1}, {maxRows: 1}]) await assert.rejects(fixture("meta").direct(settings), /LIMIT/);
});
test("Meta: token from another app is rejected before business/catalog reads", async () => {
  const f = fixture("meta");
  f.hooks.fetch = () => response({data: {app_id: "999", is_valid: true, scopes: f.state.scopes, expires_at: 1893456000}});
  await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
});
test("Meta: business ownership does not replace the token user's advertiser access", async () => {
  const f = fixture("meta");
  f.hooks.fetch = parsed => parsed.pathname.endsWith("/me/adaccounts") ? response({data: [{id: "act_999"}]}) : undefined;
  await assert.rejects(f.run(), /ADVERTISER_ACCESS_NOT_CONFIRMED/);
  assert.equal(f.calls.length, 2);
});
test("Meta: advertiser access removed during product probe invalidates otherwise matching business assets", async () => {
  const f = fixture("meta"); let reads = 0;
  f.hooks.fetch = parsed => {
    if (parsed.pathname.endsWith("/me/adaccounts") && ++reads === 2) return response({data: [{id: "act_999"}]});
  };
  await assert.rejects(f.run(), /ADVERTISER_ACCESS_NOT_CONFIRMED/);
  assert.equal(reads, 2);
});
test("Google: expired credential requires renewal outside this probe, no automatic token request", async () => {
  const f = fixture("google_ads"); f.state.now = new Date("2026-10-29T16:00:00.000Z");
  await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
});


import {reviewRefreshSetupProof} from "../app/lib/refresh/setup-proof-review.server.js";
import {pdSourceObservation} from "./helpers/pd-source-observation.js";
import {shopifyScopeProof} from "./helpers/shopify-scope-proof.js";
import {runRefreshPdPrewriteChunk} from "../app/lib/refresh/pd-prewrite-chunk.server.js";
async function setupProofFixture(provider="meta",options={}) {
  const f=fixture(provider), assets=await f.run(), scope={provider,workspaceId:workspace,installGeneration:3,installationId:"42",
    shopId:"gid://shopify/Shop/12",shopDomain:"test.myshopify.com",connectionId:connection,connectionVersion:2,
    reportingSelectionEpoch:"71",accountId:f.state.account};
  const pd=await pdSourceObservation(scope,{id:"job1",fence:2},{from:"2026-10-01",to:"2026-10-01"},{identityScopes:options.identityScopes??true,readAt:f.state.now.toISOString(),loginAccountId:f.state.manager});
  const shopify=await shopifyScopeProof(scope,options.scopes??["read_products"],f.state.now.toISOString());
  return {f,pd,scope,input:{pdObservation:pd.observation,assets,shopify,now:()=>f.state.now}};
}
for(const provider of ["meta","google_ads"]) {
  test(provider+": setup proof binds actual native readers but does not manufacture app approval",async()=>{
    const {input}=await setupProofFixture(provider),r=reviewRefreshSetupProof(input);
    assert.equal(r.status,"reviewed_for_prewrite_only");assert.equal(r.baseReady,true);assert.equal(r.ordersReady,false);
    assert.equal(r.providerScopeState,"stored_sufficient");assert.equal(r.providerScopeSource,"retained_scope_list_not_fresh_native_grant");
    assert.equal(r.developerAppApproval,"not_observed");assert.equal(r.nativePermissionVerified,false);assert.equal(r.authorizesActivation,false);
  });
  test(provider+": setup proof does not accept Connected, scope JSON or copied native observations",async()=>{
    const {input}=await setupProofFixture(provider);
    assert.equal(reviewRefreshSetupProof({...input,assets:structuredClone(input.assets)}).reason,"original_provider_asset_observation_required");
    assert.equal(reviewRefreshSetupProof({...input,shopify:structuredClone(input.shopify)}).reason,"original_shopify_scope_inspection_required");
    assert.equal(reviewRefreshSetupProof({...input,pdObservation:structuredClone(input.pdObservation)}).reason,"original_pd_observation_required");
    assert.throws(()=>reviewRefreshSetupProof({...input,setupComplete:true}),/INPUT_INVALID/);
  });
  test(provider+": Orders is separate from Products and read/write equivalents keep existing semantics",async()=>{
    const {input,scope,f}=await setupProofFixture(provider);
    const orders=reviewRefreshSetupProof({...input,includeOrders:true});
    assert.equal(orders.baseReady,true);assert.equal(orders.status,"blocked");assert.equal(orders.reason,"shopify_orders_scope_required");
    const granted=await shopifyScopeProof(scope,["write_products","write_orders"],f.state.now.toISOString());
    assert.equal(reviewRefreshSetupProof({...input,shopify:granted,includeOrders:true}).status,"reviewed_for_prewrite_only");
    const revoked=await shopifyScopeProof(scope,[],f.state.now.toISOString());
    assert.equal(reviewRefreshSetupProof({...input,shopify:revoked}).reason,"shopify_products_scope_missing");
  });
  test(provider+": foreign shop and different provider account evidence cannot satisfy setup",async()=>{
    const {input,scope,f}=await setupProofFixture(provider);
    const foreign=await shopifyScopeProof({...scope,shopId:"gid://shopify/Shop/99"},["read_products"],f.state.now.toISOString());
    assert.equal(reviewRefreshSetupProof({...input,shopify:foreign}).reason,"shopify_scope_owner_mismatch");
    f.state.epoch="72";const other=await f.run();
    assert.equal(reviewRefreshSetupProof({...input,assets:other}).reason,"provider_asset_scope_mismatch");
  });
  test(provider+": stale and future observations stay unknown instead of activating",async()=>{
    const {input,f}=await setupProofFixture(provider);
    f.state.now=new Date(f.state.now.valueOf()+600001);
    assert.equal(reviewRefreshSetupProof(input).reason,"shopify_scope_evidence_unconfirmed");
    f.state.now=new Date("2026-10-29T14:59:00.000Z");
    assert.equal(reviewRefreshSetupProof(input).reason,"shopify_scope_evidence_unconfirmed");
  });
}
test("Meta stored reporting-only scope cannot masquerade as full catalog scope proof",async()=>{
  const {input}=await setupProofFixture("meta",{identityScopes:false});
  assert.equal(reviewRefreshSetupProof(input).reason,"provider_stored_scope_profile_incomplete");
});
test("Meta setup proof is consumed and rechecked by the actual worker without Orders blocking base work",async()=>{
  const {input,pd,f}=await setupProofFixture(),{claim,window,entitlementReceipt,now,...source}=pd.config;
  source.readNow=()=>f.state.now;
  const stages=[];const worker={claim:{...claim,cost:{requests:64,dbWrites:32,connections:4,rows:100,bytes:300000}},window,now,
    limits:{deadlineAt:100000,requestTimeoutMs:10000,finishReserveMs:100,maxRows:100,maxBytes:300000},loadAuthority:pd.authority,
    verifyEntitlement:async()=>({status:"verified",receipt:entitlementReceipt}),isEntitlementCurrent:async()=>true,
    store:{advanceStage:async s=>{stages.push(s.stage);return true;},isClaimCurrent:async()=>true,
      readAdmissionSnapshot:async()=>({state:{revision:1}}),recordStop:async()=>({recorded:true})}};
  const r=await runRefreshPdPrewriteChunk({worker,source,setup:{shopify:input.shopify,assets:input.assets}});
  assert.equal(r.status,"awaiting_dataset");assert.equal(r.setup_review.baseReady,true);assert.equal(r.setup_review.ordersReady,false);
  assert.equal(r.setup_review.authorizesActivation,false);assert.equal(r.persistable,false);
  const missing=await runRefreshPdPrewriteChunk({worker,source,setup:{}});
  assert.equal(missing.source_review.reason,"original_shopify_scope_inspection_required");assert.equal(missing.rows,undefined);
  let n=0;worker.loadAuthority=async()=>{const a=await pd.authority();if(++n===3)f.state.now=new Date(f.state.now.valueOf()+600001);return a;};
  const expired=await runRefreshPdPrewriteChunk({worker,source,setup:{shopify:input.shopify,assets:input.assets}});
  assert.equal(expired.reason,"authority_check_failed_after_request");assert.equal(expired.rows,undefined);
});


test("Setup proof checks provider expiry separately from fresh Shopify scope evidence",async()=>{
  const {input,scope,f}=await setupProofFixture();
  f.state.now=new Date(f.state.now.valueOf()+600001);
  const fresh=await shopifyScopeProof(scope,["read_products"],f.state.now.toISOString());
  assert.equal(reviewRefreshSetupProof({...input,shopify:fresh}).reason,"provider_access_evidence_stale_or_future");
});


test("Google setup proof binds the manager context even when public account/version match",async()=>{
  const {input,scope,f}=await setupProofFixture("google_ads");
  const pd=await pdSourceObservation(scope,{id:"job1",fence:2},{from:"2026-10-01",to:"2026-10-01"},
    {identityScopes:true,readAt:f.state.now.toISOString(),loginAccountId:"654"});
  assert.equal(reviewRefreshSetupProof({...input,pdObservation:pd.observation}).reason,"provider_asset_scope_mismatch");
});
test("Setup proof does not accept a replaced credential reference under the same public scope",async()=>{
  const {input,f}=await setupProofFixture();f.state.credential=workspace;
  const assets=await f.run();
  assert.equal(reviewRefreshSetupProof({...input,assets}).reason,"provider_asset_scope_mismatch");
});


test("Order history requires its own scope without blocking basic Products",async()=>{
  const {input,scope,f}=await setupProofFixture(undefined,{scopes:["read_products","read_orders"]});
  const r=reviewRefreshSetupProof({...input,includeOrders:true,includeOrderHistory:true});
  assert.equal(r.baseReady,true);assert.equal(r.ordersReady,false);assert.deepEqual(r.orderMissingScopes,["read_all_orders"]);
  const shopify=await shopifyScopeProof(scope,["read_products","read_orders","read_all_orders"],f.state.now.toISOString());
  const complete=reviewRefreshSetupProof({...input,shopify,includeOrders:true,includeOrderHistory:true});
  assert.equal(complete.ordersReady,true);assert.equal(complete.developerAppApproval,"not_observed");assert.equal(complete.authorizesActivation,false);
});
