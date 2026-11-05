import test from "node:test";
import assert from "node:assert/strict";
import {createRefreshPdSourceReader} from "../app/lib/refresh/pd-source-reader.server.js";
import {runRefreshPdPrewriteChunk, reviewRefreshPdPrewrite} from "../app/lib/refresh/pd-prewrite-chunk.server.js";
import {pmaxHistoryFixture} from "./fixtures/pmax-history-fixture.js";

const workspace = "11111111-1111-4111-8111-111111111111";
const connection = "22222222-2222-4222-8222-222222222222";
const credential = "33333333-3333-4333-8333-333333333333";
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {"content-type": "application/json"}});

test("stored listing history reaches the actual PMax reader without assigning past Channel", async () => {
  const f=fixture("google_ads");delete f.config.queryFamily;f.config.googlePd={flow:"retail_pmax",includeProductSales:true};
  const r=f.state.row,owner={workspaceId:r.workspace_id,installationId:r.installation_id,generation:r.install_generation,
    shopId:r.shop_id,shopDomain:r.shop_domain,provider:"google_ads",connectionId:r.connection_id,
    connectionVersion:String(r.connection_version),credentialId:r.credential_id,accountId:r.reporting_account_id,selectionEpoch:r.reporting_selection_epoch};
  const history=pmaxHistoryFixture({owner,now:f.config.now});
  f.config.googlePmax={historyLoader:history.create()};f.config.limits.maxPages=3;
  f.hooks.response=(address,init)=>{
    if(address.includes("oauth2"))return json({access_token:"synthetic-access",token_type:"Bearer",expires_in:3600});
    const query=JSON.parse(init.body).query;
    return json({results:/conversion_action/.test(query)?[]:[{customer:{id:"123"},campaign:{id:"10",advertisingChannelType:"PERFORMANCE_MAX"},
      assetGroup:{id:"40"},segments:{date:"2026-10-01",productMerchantId:"50",productFeedLabel:"TR",productLanguage:"tr",productItemId:"A",productSoldItemId:"B"},
      metrics:{clicks:"1",unitsSold:"1",revenueMicros:"25000000",crossSellUnitsSold:"1"}}]});
  };
  const result=await f.create().readEvidence();
  assert.equal(result.pmax_membership_state,"observed_history_only");
  assert.equal(result.pmax_membership_history.snapshots[0].rows[0].assetGroup.id,"40");
  assert.equal(result.pmax_source_evidence.source_links.product_sales_links[0].channel_id,null);
  assert.equal(result.product_sales.rows[0].sales_role,"Cross-sell");
  assert.equal(result.product_sales.rows[0].channel_reference.channel_id,null);
  assert.ok(!JSON.stringify(result).includes(credential));
  assert.throws(()=>createRefreshPdSourceReader({...f.config,googlePmax:{historyLoader:{load(){return {};}}}}),/INPUT_INVALID/);
  assert.throws(()=>createRefreshPdSourceReader({...f.config,googlePmax:{historyLoader:history.create(),listingEvidence:{}}}),/INPUT_INVALID/);
});

test("authority changes during stored history loading stop before PMax requests",async()=>{
 const f=fixture("google_ads");delete f.config.queryFamily;f.config.googlePd={flow:"retail_pmax"};
 const history=pmaxHistoryFixture({now:f.config.now});
 let beforeHistory;
 history.hooks.query=()=>{beforeHistory=f.state.http;f.state.row.reporting_selection_epoch="72";return {rows:[{result:[]}]};};
 f.config.googlePmax={historyLoader:history.create()};f.config.limits.maxPages=3;
 f.hooks.response=(address,init)=>address.includes("oauth2")?json({access_token:"synthetic-access",token_type:"Bearer",expires_in:3600})
  :json({results:/conversion_action/.test(JSON.parse(init.body).query)?[]:[{customer:{id:"123"},
    campaign:{id:"10",advertisingChannelType:"PERFORMANCE_MAX"},assetGroup:{id:"40"},segments:{date:"2026-10-01"},metrics:{clicks:"1"}}]});
 await assert.rejects(f.create().readEvidence(),/PD_SOURCE_AUTHORITY_CHANGED/);
 assert.equal(history.calls.length,1); // no retry or follow-up historical query
 assert.equal(f.state.http,beforeHistory);
});

test("opt-in PMax source links run through the existing fenced reader and physical quota transport", async () => {
  const f = fixture("google_ads"), queries = [];
  delete f.config.queryFamily; f.config.googlePd = {flow: "retail_pmax"}; f.config.googlePmax = {};
  // A copied/wrong-generation membership envelope cannot be reused in this job.
  f.config.googlePmax.listingEvidence = {complete: true, binding: {installation_generation: "999"}, snapshots: []};
  f.config.limits.maxPages = 3;
  f.hooks.response = (address, init) => {
    if (address.includes("oauth2.googleapis.com")) return json({access_token: "synthetic-access", token_type: "Bearer", expires_in: 3600});
    const {query} = JSON.parse(init.body); queries.push(query);
    const row = {customer: {id: "123"}, campaign: {id: "10", advertisingChannelType: "PERFORMANCE_MAX"},
      assetGroup: {id: "40"}, segments: {date: "2026-10-01", productMerchantId: "50", productFeedLabel: "TR",
        productLanguage: "tr", productItemId: "A", productSoldItemId: "B"}, metrics: {clicks: "1", crossSellUnitsSold: "1"}};
    return json({results: /conversion_action/.test(query) ? [] : [row]});
  };
  const result = await f.create().readEvidence();
  assert.equal(queries.length, 6); // two PD families plus four CPD/current-inventory families
  assert.equal(result.pmax_source_evidence.source_links.product_sales_links[0].sales_role, "Cross-sell");
  assert.equal(result.pmax_source_evidence.source_links.product_sales_links[0].channel_id, null);
  assert.equal(result.pmax_membership_state, "source_binding_mismatch");
  assert.equal(f.state.reserves, f.state.http); assert.equal(result.publishable, false);
  assert.equal(result.rows_observed, 5);
  const g = fixture("google_ads"); delete g.config.queryFamily;
  g.config.googlePd = {flow: "retail_pmax", includeProductSales: true}; g.config.limits.maxPages = 3; g.hooks.response = f.hooks.response;
  const binding = {workspace_id: workspace, installation_id: "42", installation_generation: 1, provider: "google_ads",
    provider_connection_id: connection, connection_version: 2, reporting_selection_epoch: "71", platform_account_id: "123",
    credential_id: credential, business_date: "2026-10-01", source_timezone: "Europe/Istanbul", source_currency: "USD",
    job_or_run_id: "job-1", claim_fence: 1};
  g.config.googlePmax = {listingEvidence: {binding,
    scope: {workspace_id: workspace, install_generation: 1, connection_id: connection, reporting_account_id: "123"},
    timezone: "Europe/Istanbul", complete: true,
    businessWindow: {business_date: "2026-10-01", timezone: "Europe/Istanbul", start: "2026-09-30T21:00:00Z", end: "2026-10-01T21:00:00Z"},
    snapshots: [{account_id: "123", campaign_id: "10", asset_group_id: "40", merchant_id: "50", feed_label: "TR", language: "tr",
      timezone: "Europe/Istanbul", tree_hash: "reviewed-synthetic-tree", valid_from: "2026-09-30T21:00:00Z", valid_to: "2026-10-01T21:00:00Z",
      rows: [{customer: {id: "123"}, campaign: {id: "10"}, assetGroup: {id: "40"},
        assetGroupListingGroupFilter: {type: "UNIT_INCLUDED", listingSource: "SHOPPING", path: {dimensions: []}}}]}]}};
  const bound = await g.create().readEvidence();
  assert.equal(bound.pmax_membership_state, "bound_for_review_only");
  assert.equal(bound.pmax_source_evidence.source_links.product_sales_links[0].channel_id, "40");
  assert.equal(bound.product_sales.rows[0].channel_reference.channel_id, "40");
  assert.equal(bound.product_sales.rows[0].sales_role, "Cross-sell");
  assert.ok(!JSON.stringify(bound).includes(credential));
  binding.claim_fence = 2;
  const replay = await g.create().readEvidence();
  assert.equal(replay.pmax_membership_state, "source_binding_mismatch");
  assert.equal(replay.pmax_source_evidence.source_links.product_sales_links[0].channel_id, null);
});

test("PMax links cannot be enabled for Search, another provider, or unbounded caller options", () => {
  for (const flow of ["search", "shopping"]) {
    const f = fixture("google_ads"); delete f.config.queryFamily;
    assert.throws(() => createRefreshPdSourceReader({...f.config, googlePd: {flow}, googlePmax: {}}), /INPUT_INVALID/);
  }
  assert.throws(() => createRefreshPdSourceReader({...fixture().config, googlePmax: {}}), /INPUT_INVALID/);
  const f = fixture("google_ads"); delete f.config.queryFamily;
  assert.throws(() => createRefreshPdSourceReader({...f.config, googlePd: {flow: "retail_pmax"}, googlePmax: {activate: true}}), /INPUT_INVALID/);
});
function fixture(provider = "meta") {
  const accountId = provider === "meta" ? "act_123" : provider === "google_ads" ? "123" : "ABC123";
  const state = {http: 0, reserves: 0, vault: 0, clock: 0, stopped: 0, queries: [],
    row: {installation_id: "42", workspace_id: workspace, install_generation: "1", installation_status: "active",
      shop_id: "gid://shopify/Shop/12", shop_domain: "test.myshopify.com", connection_id: connection,
      credential_id: credential, connection_version: 2, lifecycle_status: "connected", reporting_selection_epoch: provider === "klaviyo" ? null : "71",
      reporting_account_id: provider === "klaviyo" ? null : accountId,
      granted_scopes: provider === "klaviyo" ? ["accounts:read", "campaigns:read", "flows:read", "events:read", "metrics:read"] : provider === "meta" ? ["ads_read"] : ["https://www.googleapis.com/auth/adwords"],
      accounts: [{id: accountId, kind: provider === "klaviyo" ? "account" : "advertiser", status: "active",
        reporting_eligible: true, currency: "USD", timezone: "Europe/Istanbul", login_account_id: null}]}};
  const hooks = {};
  const config = {
    verified: {installationAuthority: {authority: "shopify_installation_verified", status: "active", workspaceId: workspace, installGeneration: 1},
      identity: {session: {authority: "shopify_id_token_verified", shopDomain: "test.myshopify.com"},
        shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"}}},
    claim: {workspaceId: workspace, installGeneration: "1", provider, accountId, id: "job-1", fence: 1},
    window: {from: "2026-10-01", to: "2026-10-01"}, entitlementReceipt: {observedAt: "2026-10-30T00:00:00Z"},
    ...(provider === "google_ads" ? {queryFamily: "search_ad_channel_daily"} : {}),
    environment: {META_APP_SECRET: "synthetic-secret", GOOGLE_ADS_OAUTH_CLIENT_ID: "client", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "synthetic-secret",
      GOOGLE_ADS_OAUTH_REDIRECT_URI: "https://embedded.adstable.app/auth/google-ads/callback", GOOGLE_ADS_DEVELOPER_TOKEN: "synthetic-developer",
      KLAVIYO_CLIENT_ID: "synthetic-client", KLAVIYO_CLIENT_SECRET: "synthetic-secret", KLAVIYO_OAUTH_REDIRECT_URI: "https://embedded.adstable.app/auth/klaviyo/callback"},
    limits: {maxElapsedMs: 10000, maxRows: 100, maxBytes: 100000}, now: () => state.clock,
    readNow: () => new Date("2026-10-30T00:00:00Z"),
    database: {query: async (sql, params) => {state.queries.push(sql); await hooks.sql?.(sql, params); return {rows: [structuredClone(state.row)]};}},
    tokenVault: {loadProviderTokenSet: async () => {state.vault++; await hooks.vault?.(); return {access_token: "synthetic-access", refresh_token: "synthetic-refresh",
      expires_at: "2026-10-31T00:00:00Z", scopes: [...state.row.granted_scopes]};}},
    workStore: {
      loadBoundAuthority: async () => {await hooks.work?.(); return {workspaceId: workspace, installGeneration: "1", provider, accountId,
        installationVerified: true, connected: true, setupComplete: true, allowedWindow: true, connectionId: connection, connectionVersion: state.row.connection_version};},
      loadQuotaContext: async () => ({provider, clientScopeKey: "a".repeat(64), connectionScopeKey: "b".repeat(64), connectionEpoch: 2,
        accountId, organizationId: null, apiVersion: provider === "meta" ? "v26.0" : provider === "google_ads" ? "v25" : "2026-10-15"}),
    },
    quotaStore: {resolveRoute: async v => v.routeKey, reserve: async input => {state.reserves++; await hooks.reserve?.();
      return {...input, status: "reserved", dispatchBeforeMs: 1000, dispatchBudgetMs: 1000};},
      settle: async () => true, recordFeedback: async () => true, stop: async () => {state.stopped++; return true;}},
    fetchFn: async (address, init) => {state.http++; await hooks.http?.(address, init);
      if (hooks.response) return hooks.response(address, init);
      if (address.includes("oauth2.googleapis.com")) return json({access_token: "synthetic-access", token_type: "Bearer", expires_in: 3600});
      if (provider === "google_ads") return json({results: [{customer: {id: accountId}, campaign: {id: "10", advertisingChannelType: "SEARCH"}, adGroup: {id: "20"}, adGroupAd: {ad: {id: "30"}}, segments: {date: "2026-10-01"}, metrics: {clicks: "0"}}]});
      if (provider === "klaviyo") return address.includes("/metrics") ? json({data: ["Placed Order", "Added to Cart", "Checkout Started"].map((name, i) => ({id: `metric${i}`, type: "metric", attributes: {name, integration: {name: "Shopify"}}}))})
        : json({data: {attributes: {results: []}}});
      return json({data: [{account_id: "123", campaign_id: "10", adset_id: "20", ad_id: "30", product_id: "native-product", date_start: "2026-10-01", date_stop: "2026-10-01", account_currency: "USD", clicks: "0"}]});
    },
  };
  return {state, config, hooks, create: () => createRefreshPdSourceReader(config)};
}

for (const provider of ["meta", "google_ads", "klaviyo"]) test(`${provider}: existing native reader plus quota retains source/owner context without publication`, async () => {
  const f = fixture(provider), result = await f.create().readEvidence();
  assert.equal(result.status, "source_read");
  assert.equal(result.source_context.installation_id, "42");
  assert.equal(result.source_context.source_currency, "USD");
  assert.equal(result.source_context.source_timezone, "Europe/Istanbul");
  assert.equal(result.source_context.connection_version, 2);
  assert.equal(result.source_context.reporting_selection_epoch, provider === "klaviyo" ? null : "71");
  assert.equal(result.source_context.business_date, "2026-10-01");
  assert.equal(result.source_context.reporting_time_basis, provider === "meta" ? null : provider === "google_ads" ? "interaction_date" : "send_date");
  assert.equal(result.source_context.attribution_fingerprint, null);
  assert.equal(result.publishable, false); assert.equal(result.persistable, false); assert.equal(result.authorizes_activation, false);
  assert.equal(result.canonical_scope_ready, false);
  assert.equal(Object.isFrozen(result.evidence), true);
  assert.equal(f.state.reserves, f.state.http);
  assert.ok(f.state.http > 0);
  assert.ok(!JSON.stringify(result).includes("synthetic-access"));
  assert.ok(!JSON.stringify(result).includes(credential));
  assert.ok(f.state.queries.every(v => /select \* from integrations\.load_/.test(v)));
  if (provider !== "klaviyo") {
    const page = provider === "google_ads" ? result.evidence.page : result.evidence.channel;
    assert.equal(provider === "google_ads" ? page.rows[0].adGroup.id : page.rows[0].adset_id, "20");
    assert.equal(page.pd_metric_rows[0].raw_metrics.ad_click, provider === "google_ads" ? 0 : null);
  }
});

for (const field of ["currency", "timezone"]) test(`missing ${field} is rejected before native I/O`, async () => {
  const f = fixture(); delete f.state.row.accounts[0][field];
  await assert.rejects(f.create().readEvidence(), /ACCOUNT_METADATA_REQUIRED/);
  assert.equal(f.state.http, 0); assert.equal(f.state.vault, 0);
});

for (const mutate of [r => r.connection_version++, r => r.credential_id = workspace,
  r => r.reporting_selection_epoch = "72", r => r.accounts[0].currency = "TRY",
  r => r.accounts[0].timezone = "UTC", r => r.install_generation = "2",
  r => r.reporting_account_id = "act_999", r => r.lifecycle_status = "disconnected",
  r => r.installation_id = "43", r => r.shop_domain = "other.myshopify.com"])
test(`authority change during quota wait blocks dispatch: ${mutate}`, async () => {
  const f = fixture(); f.hooks.reserve = async () => mutate(f.state.row);
  await assert.rejects(f.create().readEvidence()); assert.equal(f.state.http, 0);
});

test("a change after response headers discards the read; no second family is requested", async () => {
  const f = fixture(); f.hooks.http = () => {f.state.row.reporting_selection_epoch = "72";};
  await assert.rejects(f.create().readEvidence()); assert.equal(f.state.http, 1);
});

test("single-use execution does not retry after a provider rejection or expose its payload", async () => {
  const f = fixture(), reader = f.create(); f.hooks.response = () => json({error: {code: 100, message: "secret"}}, 400);
  await assert.rejects(reader.readEvidence(), e => e.message === "PD_SOURCE_READ_FAILED");
  await assert.rejects(reader.readEvidence(), /EXECUTION_USED/);
  assert.equal(f.state.http, 1); assert.equal(f.state.stopped, 1);
});

test("native 401 never authorizes credential/lifecycle writes or fallback", async () => {
  const f = fixture(); f.hooks.response = () => json({error: {code: 190}}, 401);
  await assert.rejects(f.create().readEvidence()); assert.equal(f.state.http, 1);
  assert.ok(f.state.queries.every(v => !v.includes("mark_") && !v.includes("update_")));
});

test("Google cursor is partial, never a complete source or an automatic continuation", async () => {
  const f = fixture("google_ads"); f.hooks.response = address => address.includes("oauth2")
    ? json({access_token: "synthetic-access", token_type: "Bearer", expires_in: 3600}) : json({results: [], nextPageToken: "next"});
  await assert.rejects(f.create().readEvidence(), /PARTIAL_READ/); assert.equal(f.state.http, 2);
});

test("Klaviyo missing metric configuration is not zero or a complete source", async () => {
  const f = fixture("klaviyo"); f.hooks.response = () => json({data: []});
  await assert.rejects(f.create().readEvidence(), /INCOMPLETE_READ/); assert.equal(f.state.http, 1);
});

test("copy inputs before awaits, reject browser-style overrides, and never infer dates", async () => {
  const f = fixture(), reader = f.create(); f.config.window.from = "2026-09-30"; f.config.claim.accountId = "act_999";
  assert.equal((await reader.readEvidence()).source_context.platform_account_id, "act_123");
  assert.throws(() => createRefreshPdSourceReader({...fixture().config, loadContext: () => {}}), /INPUT_INVALID/);
  assert.throws(() => createRefreshPdSourceReader({...fixture().config, window: {from: "2026-02-30", to: "2026-02-30"}}), /INPUT_INVALID/);
  assert.throws(() => createRefreshPdSourceReader({...fixture("google_ads").config, queryFamily: "cart_data_product_sales_daily"}), /INPUT_INVALID/);
  await assert.rejects(fixture().create().readEvidence({accountId: "act_999"}), /OVERRIDE_FORBIDDEN/);
});

test("pre-aborted signal and missing work authority make no provider call", async () => {
  const f = fixture(), c = new AbortController(); c.abort(); f.config.signal = c.signal;
  await assert.rejects(f.create().readEvidence(), /EXECUTION_STOPPED/); assert.equal(f.state.http, 0);
  const g = fixture(); g.config.workStore.loadBoundAuthority = async () => null;
  await assert.rejects(g.create().readEvidence(), /WORK_AUTHORITY_REQUIRED/); assert.equal(g.state.http, 0);
});

test("abort during an unresolved authority read returns promptly and cannot dispatch later", async () => {
  const f = fixture(), c = new AbortController(); f.config.signal = c.signal;
  let release; f.hooks.work = () => new Promise(resolve => {release = resolve;});
  const pending = f.create().readEvidence(); c.abort();
  await assert.rejects(pending, /EXECUTION_STOPPED/); release();
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(f.state.http, 0);
});

for (const row of [
  {account_id: "999", date_start: "2026-10-01", date_stop: "2026-10-01"},
  {account_id: "123", date_start: "2026-09-30", date_stop: "2026-09-30"},
  {account_id: "123", date_start: "2026-10-01", date_stop: "2026-10-01", account_currency: "TRY"},
]) test(`native Meta row outside expected account/day/currency is rejected: ${JSON.stringify(row)}`, async () => {
  const f = fixture(); f.hooks.response = () => json({data: [{...row, product_id: "native", ad_id: "30"}]});
  await assert.rejects(f.create().readEvidence(), /NATIVE_SCOPE_MISMATCH/);
});

test("quota wait retains authentic worker proof and causes zero dispatches", async () => {
  const f = fixture(); f.config.quotaStore.reserve = async () => ({status: "waiting"});
  await assert.rejects(f.create().readEvidence(), e => e.message === "SHARED_QUOTA_WAITING");
  assert.equal(f.state.http, 0);
});

test("whole-read timeout covers SQL/vault/body and rejects late results", async () => {
  const f = fixture(); f.config.limits.maxElapsedMs = 20;
  let release; f.hooks.work = () => new Promise(resolve => {release = resolve;});
  await assert.rejects(f.create().readEvidence(), /DEADLINE_EXCEEDED/);
  release(); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(f.state.http, 0);
});

test("explicit result bounds reject successful but oversized source data", async () => {
  for (const limit of [{maxRows: 1}, {maxBytes: 1}]) {
    const f = fixture(); Object.assign(f.config.limits, limit);
    await assert.rejects(f.create().readEvidence(), /RESULT_BOUND_EXCEEDED/);
    assert.equal(f.state.http, 2);
  }
});

import {recordMetadata} from "./helpers/pd-record-metadata.js";
test("Meta runtime native read feeds the common bridge without changing either query family", async () => {
  const f = fixture();
  f.hooks.response = address => json({data: [{account_id: "123", campaign_id: "10", campaign_name: "Root",
    adset_id: "20", adset_name: "Parent", ad_id: "30", ad_name: "Leaf", date_start: "2026-10-01", date_stop: "2026-10-01",
    impressions: "10", spend: "20", outbound_clicks: [{action_type: "outbound_click", value: "0"}],
    ...(new URL(address).searchParams.has("breakdowns") ? {product_id: "source-product"} : {})}]});
  const native = await f.create().readEvidence();
  const scope = {...native.source_context, flow: "ads", entity_type: "ad", entity_id: "30",
    ancestors: [{entity_type: "campaign", entity_id: "10"}, {entity_type: "adset", entity_id: "20"}],
    conversion_scope: "normal", reporting_time_basis: "impression_date", completeness: "complete", bounded: true,
    composition_attempt_id: workspace, snapshot_id: "synthetic-meta", attribution_fingerprint: "a".repeat(64), metric_units_fingerprint: "b".repeat(64)};
  const metadata = recordMetadata(native.source_context, [{scope, source_execution: {metadata_references: {attribution: "synthetic-attribution", metric_units: "synthetic-units"}}}]);
  f.config.recordBridge = {metadata};
  const reader = f.create(); metadata.binding.claim_fence = 999;
  const result = await reader.readEvidence();
  assert.equal(result.records.status, "validated");
  assert.equal(result.records.rows[0].raw_metrics.spend_value, 20);
  assert.equal(result.records.rows[0].observation_state.ad_click, "zero");
  assert.equal(result.evidence.product.rows[0].product_id, "source-product");
  assert.equal(f.state.http, 4); assert.equal(result.records.persistable, false);
});
test("record bridge opt-in with no server metadata retains native evidence and an explicit wait", async () => {
  const f = fixture(); f.config.recordBridge = {};
  const result = await f.create().readEvidence();
  assert.equal(result.records.reason, "record_metadata_required");
  assert.equal(result.evidence.channel.rows.length, 1); assert.deepEqual(result.records.rows, []);
});

test("Meta native metadata uses explicit same report settings and preserves product fields",async()=>{
  const f=fixture();f.config.nativeMetadata=true;const requests=[];
  f.hooks.response=address=>{const u=new URL(address);requests.push(u);
    return json({data:[{account_id:"123",campaign_id:"10",campaign_name:"Root",adset_id:"20",adset_name:"Parent",ad_id:"30",ad_name:"Leaf",
      date_start:"2026-10-01",date_stop:"2026-10-01",account_currency:"USD",attribution_setting:"7d_click,1d_view",
      ...(u.searchParams.has("breakdowns")?{product_id:"native-product"}:{}),impressions:"10",spend:"30"}]});};
  const r=await f.create().readEvidence();assert.equal(r.native_metadata.status,"prepared");
  assert.equal(r.native_metadata.entries[0].scope.entity_id,"30");assert.equal(r.source_context.reporting_time_basis,"impression_date");
  assert.ok(requests.every(u=>u.searchParams.get("action_report_time")==="impression"&&u.searchParams.get("use_unified_attribution_setting")==="true"));
  assert.match(requests[1].searchParams.get("fields"),/converted_promoted_product_quantity/);
  assert.match(requests[1].searchParams.get("fields"),/converted_promoted_product_value/);
  assert.equal(r.persistable,false);assert.deepEqual(r.records.rows,[]);
});
test("Meta missing returned native attribution stays explicit and cannot use guessed window",async()=>{
  const f=fixture();f.config.nativeMetadata=true;
  const r=await f.create().readEvidence();assert.equal(r.native_metadata.reason,"native_attribution_setting_not_returned");
  assert.equal(r.records.reason,r.native_metadata.reason);assert.ok(r.evidence.channel.rows.length>0);
});

test("Meta native metadata reaches the actual canonical bridge with explicit external FX",async()=>{
  const f=fixture();f.config.nativeMetadata=true;
  f.hooks.response=address=>json({data:[{account_id:"123",campaign_id:"10",campaign_name:"Root",adset_id:"20",adset_name:"Parent",ad_id:"30",ad_name:"Leaf",
    date_start:"2026-10-01",date_stop:"2026-10-01",account_currency:"USD",attribution_setting:"7d_click,1d_view",impressions:"10",spend:"30",
    ...(new URL(address).searchParams.has("breakdowns")?{product_id:"native-product"}:{})}]});
  const first=await f.create().readEvidence();
  const facts=first.native_metadata.entries.map(e=>({scope:e.scope,source_execution:{metadata_references:e.metadata_references}}));
  f.config.recordBridge={metadata:recordMetadata(first.source_context,facts)};
  const r=await f.create().readEvidence();assert.equal(r.records.status,"validated");assert.equal(r.records.rows[0].raw_metrics.spend_value,30);
  assert.equal(r.records.rows[0].identity.platform,"meta");assert.equal(r.persistable,false);
});


function prewriteWorker(f) {
  const {claim, window, entitlementReceipt, now, ...source} = f.config;
  const stages = [], stops = [];
  const worker = {claim: {...claim, cost: {requests: 64, dbWrites: 32, connections: 4, rows: 100, bytes: 100000}}, window,
    limits: {deadlineAt: 100000, requestTimeoutMs: 10000, finishReserveMs: 100, maxRows: 100, maxBytes: 100000}, now,
    loadAuthority: f.config.workStore.loadBoundAuthority,
    verifyEntitlement: async () => ({status: "verified", receipt: entitlementReceipt}), isEntitlementCurrent: async () => true,
    store: {advanceStage: async s => {stages.push(s.stage);return true;}, isClaimCurrent: async () => true,
      readAdmissionSnapshot: async () => ({state: {revision: 1}}), recordStop: async s => {stops.push(s.reason);return {recorded: true};}}};
  return {worker, source, stages, stops};
}
async function completeMetaSource() {
  const f = fixture(); f.config.nativeMetadata = true;
  f.hooks.response = address => json({data: [{account_id: "123", campaign_id: "10", campaign_name: "Root", adset_id: "20", adset_name: "Parent",
    ad_id: "30", ad_name: "Leaf", date_start: "2026-10-01", date_stop: "2026-10-01", account_currency: "USD",
    attribution_setting: "7d_click,1d_view", impressions: "10", spend: "30",
    ...(new URL(address).searchParams.has("breakdowns") ? {product_id: "native-product"} : {})}]});
  const read = await f.create().readEvidence();
  f.config.recordBridge = {metadata: recordMetadata(read.source_context, read.native_metadata.entries.map(e => ({scope: e.scope,
    source_execution: {metadata_references: e.metadata_references}})))};
  return f;
}

test("PD source reaches actual worker prewrite handoff with native lineage, never a Dataset write", async () => {
  const f = await completeMetaSource(), w = prewriteWorker(f), r = await runRefreshPdPrewriteChunk({worker:w.worker,source:w.source});
  assert.equal(r.status, "awaiting_dataset"); assert.equal(r.source_review.status, "reviewed_not_written");
  assert.equal(r.rows[0].raw_metrics.spend_value, 30); assert.equal(r.rows[0].identity.platform, "meta");
  assert.equal(r.rows[0].provenance.raw_reference.source_fact.source_projections[0].rows[0].ad_id, "30");
  assert.equal(r.reservationRetained, true); assert.equal(r.persistable, false); assert.equal(r.Dataset_write_performed, false);
  assert.deepEqual(w.stages, ["checking_authority", "request_intent", "response_received", "ready_for_dataset"]);
  assert.ok(f.state.queries.every(q => q.startsWith("select * from integrations.load_")));
  const args = {claim: w.worker.claim, window: w.worker.window, authority: await w.worker.loadAuthority({}), observation: r.source_observation};
  assert.equal(reviewRefreshPdPrewrite({...args, observation: structuredClone(args.observation)}).reason, "source_observation_required");
  assert.equal(reviewRefreshPdPrewrite({...args, claim: {...args.claim, fence: 2}}).reason, "source_scope_mismatch");
  assert.equal(reviewRefreshPdPrewrite({...args, claim: {...args.claim, accountId: "act_999"}}).reason, "source_scope_mismatch");
  assert.equal(reviewRefreshPdPrewrite({...args, window: {from: "2026-10-02", to: "2026-10-02"}}).reason, "source_scope_mismatch");
});

for (const change of [r => r.reporting_selection_epoch = "72", r => r.granted_scopes = [], r => r.credential_id = workspace,
  r => r.installation_id = "43", r => r.connection_version++]) test("PD final worker boundary rechecks exact native authority: " + change, async () => {
  const f = await completeMetaSource(), w = prewriteWorker(f), original = w.worker.loadAuthority;
  let calls = 0;
  w.worker.loadAuthority = async input => {const current = await original(input); if (++calls === 3) change(f.state.row); return current;};
  const r = await runRefreshPdPrewriteChunk({worker:w.worker,source:w.source});
  assert.equal(r.reason, "authority_check_failed_after_request"); assert.equal(r.rows, undefined);
  assert.ok(!w.stages.includes("ready_for_dataset")); assert.equal(r.persistable, false);
});

for (const provider of ["meta", "google_ads", "klaviyo"]) test(provider + ": missing composition/FX never reaches worker handoff", async () => {
  const f = fixture(provider), w = prewriteWorker(f), r = await runRefreshPdPrewriteChunk({worker:w.worker,source:w.source});
  assert.equal(r.reason, "validation_failed_after_request"); assert.equal(r.source_review.status, "blocked");
  assert.ok(!w.stages.includes("ready_for_dataset")); assert.equal(r.rows, undefined);
});

test("PD worker entitlement denial sends no provider request; provider error is not retried", async () => {
  const f = fixture(), w = prewriteWorker(f);
  w.worker.verifyEntitlement = async () => ({status: "denied"});
  assert.equal((await runRefreshPdPrewriteChunk({worker:w.worker,source:w.source})).reason, "entitlement_required"); assert.equal(f.state.http, 0);
  const failed = fixture(), fw = prewriteWorker(failed); failed.hooks.response = () => json({error: {message: "private"}}, 403);
  const r = await runRefreshPdPrewriteChunk({worker:fw.worker,source:fw.source}); assert.equal(r.status, "uncertain"); assert.equal(failed.state.http, 1);
  assert.equal(r.source_observation, null); assert.ok(!JSON.stringify(r).includes("private"));
});

test("PD worker rejects caller claim/receipt, async validators and oversized source budgets before native read", async () => {
  for (const change of [w => w.source.claim = w.worker.claim, w => w.source.entitlementReceipt = {},
    w => w.worker.validatePage = async () => ({complete: true}), w => w.source.limits.maxRows++,
    w => w.source.limits.maxElapsedMs++]) {
    const f = fixture(), w = prewriteWorker(f); change(w);
    await assert.rejects(runRefreshPdPrewriteChunk({worker:w.worker,source:w.source}), /INPUT_INVALID/); assert.equal(f.state.http, 0);
  }
});


test("PD final SQL authority timeout returns without a late handoff", async () => {
  const f = await completeMetaSource(), w = prewriteWorker(f), original = w.worker.loadAuthority;
  let calls = 0, release;
  w.worker.loadAuthority = async input => {const current = await original(input); if (++calls === 3) {
    f.hooks.sql = () => new Promise(resolve => {release = resolve;});
  }return current;};
  // Capture a small bounded source timeout before construction; provider source
  // has already proved the fast fixture path, and final SQL must not hang.
  w.worker.limits.requestTimeoutMs = 500; w.source.limits.maxElapsedMs = 500;
  const r = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
  assert.equal(r.reason, "authority_check_failed_after_request");
  assert.ok(!w.stages.includes("ready_for_dataset")); assert.equal(typeof release, "function");
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(!w.stages.includes("ready_for_dataset"));
});


test("PD quota wait stays branded through the worker and does not dispatch or retry", async () => {
  const f = fixture(), w = prewriteWorker(f);let waits = 0;
  f.config.quotaStore.reserve = async () => ({status: "waiting"});
  w.worker.store.deferQuotaWait = async () => {waits++;return true;};
  const r = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
  assert.equal(r.status, "quota_waiting");assert.equal(waits, 1);assert.equal(f.state.http, 0);
  assert.equal(r.source_observation, null);assert.ok(!w.stages.includes("ready_for_dataset"));
});

test("PD native zero remains zero in worker rows and an expired entitlement stops final handoff", async () => {
  const f = await completeMetaSource(), w = prewriteWorker(f), response = f.hooks.response;
  f.hooks.response = async (address, init) => {const data = await (await response(address, init)).json();
    data.data[0].spend = "0";data.data[0].impressions = "0";return json(data);};
  const r = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
  assert.equal(r.status, "awaiting_dataset");assert.equal(r.rows[0].raw_metrics.spend_value, 0);
  const second = prewriteWorker(f);let checks = 0;
  second.worker.isEntitlementCurrent = async () => ++checks === 1;
  const stopped = await runRefreshPdPrewriteChunk({worker: second.worker, source: second.source});
  assert.equal(stopped.reason, "authority_check_failed_after_request");assert.equal(stopped.rows, undefined);
  assert.ok(!second.stages.includes("ready_for_dataset"));
});


test("PD retained envelope plus canonical rows cannot exceed worker serialized budget", async () => {
  const f = await completeMetaSource(), first = prewriteWorker(f);
  const observed = await runRefreshPdPrewriteChunk({worker:first.worker,source:first.source});
  const budget = Buffer.byteLength(JSON.stringify(observed.source_observation), "utf8") + 64;
  const w = prewriteWorker(f); w.worker.limits.maxBytes = budget; w.source.limits = {...w.source.limits,maxBytes:budget};
  const r = await runRefreshPdPrewriteChunk({worker:w.worker,source:w.source});
  assert.equal(r.source_review.reason,"prewrite_result_bound_exceeded");
  assert.equal(r.rows, undefined);assert.ok(!w.stages.includes("ready_for_dataset"));
  assert.ok(Buffer.byteLength(JSON.stringify(r), "utf8") <= budget);
});


import {projectGoogleProductSales} from "../app/lib/providers/google-product-sales.server.js";

function productSalesFixture(flow = "shopping") {
  const f = fixture("google_ads"); delete f.config.queryFamily;
  f.config.googlePd = {flow, includeProductSales: true};
  if (flow === "retail_pmax") f.config.googlePmax = {};
  Object.assign(f.config.limits, {maxPages: 3, maxBytes: 300000});
  const native = (segments, metrics) => ({customer: {id: "123"},
    campaign: {id: "10", advertisingChannelType: flow === "shopping" ? "SHOPPING" : "PERFORMANCE_MAX"},
    ...(flow === "shopping" ? {adGroup: {id: "20"}} : {assetGroup: {id: "40"}}),
    segments: {date: "2026-10-01", ...segments}, metrics});
  const sale = (advertised, sold, metrics) => native({productMerchantId: "50", productFeedLabel: "TR", ...(flow === "retail_pmax" ? {productLanguage: "tr"} : {}),
    ...(advertised === null ? {} : {productItemId: advertised}), productSoldItemId: sold}, metrics);
  f.sales = [
    sale("A", "A", {unitsSold: "2", revenueMicros: "123456789012345678", leadUnitsSold: "2", leadRevenueMicros: "123456789012345678", allUnitsSold: "900"}),
    sale("A", "B", {unitsSold: "0.5", revenueMicros: "1500000", crossSellUnitsSold: "0.5", crossSellRevenueMicros: "1500000"}),
    sale(null, "C", {unitsSold: 1, revenueMicros: "0"}),
    sale("A3", "B3", {unitsSold: "1", leadUnitsSold: "1", crossSellUnitsSold: "1", revenueMicros: "300"}),
    sale("A4", "A4", {allLeadUnitsSold: "50", allRevenueMicros: "99999"}),
    sale("A5", "A5", {unitsSold: "0", revenueMicros: "0", leadUnitsSold: "0"}),
  ];
  f.readQueries = [];
  f.hooks.response = (address, init) => {
    if (address.includes("oauth2")) return json({access_token: "synthetic-access", token_type: "Bearer", expires_in: 3600});
    const body = JSON.parse(init.body), query = body.query; f.readQueries.push(query);
    let results;
    if (/FROM cart_data_sales_view/.test(query)) results = f.sales;
    else if (/FROM asset_group_listing_group_filter/.test(query)) results = [];
    else if (/segments.conversion_action_category/.test(query)) results =
      ["PURCHASE", "ADD_TO_CART", "BEGIN_CHECKOUT"].map((category, i) => native({
        conversionActionCategory: category, conversionAction: "customers/123/conversionActions/" + (100 + i)},
        {conversions: "0", conversionsValue: "0"}));
    else if (/FROM shopping_performance_view/.test(query)) results = [sale("A", "A", {clicks: "1"})];
    else results = [native({}, {clicks: "7", impressions: "10", costMicros: "3000000"})];
    return new Response(JSON.stringify({results}), {headers: {"content-type": "application/json", "request-id": "synthetic-sales-request"}});
  };
  return f;
}

for (const flow of ["shopping", "retail_pmax"]) test(flow + ": existing classifier reaches independent main sales output with exact native metrics and provenance", async () => {
  const f = productSalesFixture(flow), r = await f.create().readEvidence(), sales = r.product_sales;
  assert.deepEqual(sales.rows.map(s => s.sales_role), ["Advertised", "Cross-sell", "Assisted", "Unclassified", "Unclassified", "Unclassified"]);
  assert.equal(sales.rows[0].raw_metrics.units_sold, "2");
  assert.equal(sales.rows[0].raw_metrics.revenue_micros, "123456789012345678");
  assert.equal(sales.rows[1].raw_metrics.units_sold, "0.5"); assert.equal(sales.rows[2].raw_metrics.units_sold, 1);
  assert.equal(sales.rows[4].raw_metrics.units_sold, null); assert.equal(sales.rows[5].raw_metrics.units_sold, "0");
  assert.equal(sales.rows[0].raw_row.metrics.allUnitsSold, "900");
  assert.equal(sales.rows[0].raw_metrics.all_units_sold, undefined);
  assert.equal(sales.rows[0].source_reference.query_family, flow === "shopping" ? "shopping_cart_data_product_sales_daily" : "pmax_cart_data_product_sales_daily");
  assert.equal(sales.rows[1].source_reference.source_row_index, 1);
  assert.equal(sales.rows[1].source_reference.page_row_index, 1);
  assert.equal(sales.rows[0].source_reference.provider_request_id, "synthetic-sales-request");
  assert.match(sales.rows[0].source_reference.query_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(sales.rows[0].channel_reference.channel_id ?? null, null);
  if (flow === "shopping") assert.equal(sales.rows[0].channel_reference.native_leaf_key.ad_group_id, "20");
  else assert.equal(sales.rows[0].channel_reference.channel_type, "Unclassified Channel");
  assert.equal(sales.publishable, false); assert.equal(sales.persistable, false);
  assert.equal(sales.totals_computed, false); assert.equal(sales.metrics_allocated, false);
  assert.equal(sales.source_context.claim_fence, 1);
  assert.equal(f.state.reserves, f.state.http);
  assert.equal(f.readQueries.filter(q => /FROM cart_data_sales_view/.test(q)).length, 1);
  assert.ok(f.readQueries.every(q => !/FROM cart_data_sales_view/.test(q) || /campaign.advertising_channel_type/.test(q)));
  f.sales[0].metrics.unitsSold = "999"; assert.equal(sales.rows[0].raw_row.metrics.unitsSold, "2");
  assert.equal(Object.isFrozen(sales.rows[0].raw_row.metrics), true);
  assert.ok(!JSON.stringify(r).includes("synthetic-access")); assert.ok(!JSON.stringify(r).includes(credential));
});

test("product sales require explicit internal opt-in and cannot be enabled on unsupported flows or a different provider", async () => {
  for (const flow of ["shopping", "retail_pmax"]) {
    const f = productSalesFixture(flow); delete f.config.googlePd.includeProductSales;
    const r = await f.create().readEvidence(); assert.equal(r.product_sales, undefined);
    if (flow === "shopping") assert.equal(f.readQueries.length, 2);
  }
  for (const options of [{flow: "unsupported", includeProductSales: true}, {flow: "shopping", includeProductSales: "true"}, {flow: "retail_pmax", includeProductSales: true}]) {
    const f = fixture("google_ads"); delete f.config.queryFamily;
    assert.throws(() => createRefreshPdSourceReader({...f.config, googlePd: options}), /INPUT_INVALID/);
  }
  assert.throws(() => createRefreshPdSourceReader({...fixture().config, googlePd: {flow: "shopping", includeProductSales: true}}), /INPUT_INVALID/);
});

for (const flow of ["shopping", "retail_pmax"]) test(flow + ": successful empty cart read is no observation, never a fabricated zero sale", async () => {
  const f = productSalesFixture(flow); f.sales.length = 0;
  const r = await f.create().readEvidence(); assert.equal(r.product_sales.status, "not_observed");
  assert.deepEqual(r.product_sales.rows, []);
});

for (const change of [
  e => e.authority.reporting_account_id = "999",
  e => e.authority.reporting_account_currency = "TRY",
  e => e.source_links.scope.install_generation = 2,
  e => e.results.shopping_cart_data_product_sales_daily.next_cursor = "partial",
  e => e.results.shopping_cart_data_product_sales_daily.evidence.page_spans[0].row_count--,
  e => e.results.shopping_cart_data_product_sales_daily.evidence.page_spans[0].query_fingerprint = "0".repeat(64),
  e => e.results.shopping_cart_data_product_sales_daily.rows[0].segments.date = "2026-10-02",
  e => e.source_links.product_sales_links[0].source_row_index = 99,
]) test("sales projection rejects foreign, partial or mismatched provenance: " + change, async () => {
  const r = await productSalesFixture().create().readEvidence(), e = structuredClone(r.shopping_source_evidence);
  change(e); assert.throws(() => projectGoogleProductSales({sourceContext: r.source_context, evidence: e}), /EVIDENCE_INVALID/);
});

for (const flow of ["shopping", "retail_pmax"]) test(flow + ": first source failure stops all later families and cannot return partial sales", async () => {
  const f = productSalesFixture(flow), original = f.hooks.response;
  f.hooks.response = (address, init) => !address.includes("oauth2") && /FROM shopping_performance_view/.test(JSON.parse(init.body).query)
    ? json({error: {message: "private"}}, 403) : original(address, init);
  await assert.rejects(f.create().readEvidence(), /READ_FAILED/);
  assert.equal(f.readQueries.filter(q => /FROM cart_data_sales_view/.test(q)).length, 0);
  assert.equal(f.state.stopped, 1); assert.ok(f.readQueries.length >= 3);
});

test("Shopping source row limit stops before cart read and authority drift discards sales", async () => {
  const f = productSalesFixture(); f.config.limits.maxRows = 4;
  await assert.rejects(f.create().readEvidence(), /RESULT_BOUND_EXCEEDED/); assert.equal(f.readQueries.length, 2);
  const g = productSalesFixture(), original = g.hooks.response;
  g.hooks.response = (address, init) => {
    const result = original(address, init);
    if (!address.includes("oauth2") && /FROM cart_data_sales_view/.test(JSON.parse(init.body).query)) g.state.row.connection_version++;
    return result;
  };
  await assert.rejects(g.create().readEvidence(), /READ_FAILED/);
  assert.ok(g.readQueries.some(q => /FROM cart_data_sales_view/.test(q)));
});

async function composedProductSalesFixture(flow) {
  const f = productSalesFixture(flow);
  f.sales = f.sales.filter(s => s.metrics.unitsSold !== undefined && s.metrics.revenueMicros !== undefined);
  const observed = await f.create().readEvidence();
  f.config.googlePd.compositionContext = {binding: observed.source_context, flow, conversion_scope: "normal",
    reporting_time_basis: "interaction_date", composition_attempt_id: workspace, snapshot_id: "synthetic-sales-snapshot",
    attribution_fingerprint: "a".repeat(64), metric_units_fingerprint: "b".repeat(64),
    references: {attribution: "synthetic-attribution", metric_units: "synthetic-units"}};
  const composed = await f.create().readEvidence();
  assert.equal(composed.composition.status, "composed");
  f.config.recordBridge = {metadata: recordMetadata(composed.source_context, composed.composition.rows)};
  return f;
}
for (const flow of ["shopping", "retail_pmax"]) test(flow + ": actual prewrite handoff carries sales independently of PD and suppresses them after final authority failure", async () => {
  const f = await composedProductSalesFixture(flow), w = prewriteWorker(f);
  w.worker.limits.maxBytes = 300000; w.worker.claim.cost.bytes = 300000;
  const r = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
  assert.equal(r.status, "awaiting_dataset"); assert.equal(r.source_review.status, "reviewed_not_written");
  assert.equal(r.product_sales.rows[1].sales_role, "Cross-sell");
  assert.equal(r.product_sales.rows[1].raw_metrics.revenue_micros, "1500000");
  assert.equal(r.rows[0].raw_metrics.spend_value, 3);
  assert.equal(r.rows[0].raw_metrics.purchase, 0);
  assert.equal(r.rows[0].sales_role, undefined);
  assert.equal(r.Dataset_write_performed, false);
  const stopped = prewriteWorker(f), original = stopped.worker.loadAuthority; let calls = 0;
  stopped.worker.limits.maxBytes = 300000; stopped.worker.claim.cost.bytes = 300000;
  stopped.worker.loadAuthority = async input => {
    const authority = await original(input); if (++calls === 3) f.state.row.connection_version++; return authority;
  };
  const denied = await runRefreshPdPrewriteChunk({worker: stopped.worker, source: stopped.source});
  assert.equal(denied.reason, "authority_check_failed_after_request"); assert.equal(denied.product_sales, null); assert.equal(denied.rows, undefined);
});

for (const flow of ["shopping", "retail_pmax"]) test(flow + ": paginated cart rows keep exact page-local provenance", async () => {
  const f = productSalesFixture(flow), original = f.hooks.response;
  f.hooks.response = (address, init) => {
    if (address.includes("oauth2")) return original(address, init);
    const body = JSON.parse(init.body);
    if (!/FROM cart_data_sales_view/.test(body.query)) return original(address, init);
    f.readQueries.push(body.query);
    return new Response(JSON.stringify({results: body.pageToken ? f.sales.slice(1) : f.sales.slice(0, 1),
      ...(body.pageToken ? {} : {nextPageToken: "cart-next"})}),
      {headers: {"content-type": "application/json", "request-id": body.pageToken ? "cart-page-2" : "cart-page-1"}});
  };
  const r = await f.create().readEvidence(), rows = r.product_sales.rows;
  assert.equal(rows.length, 6);
  assert.equal(rows[0].source_reference.provider_request_id, "cart-page-1");
  assert.deepEqual([rows[1].source_reference.source_row_index, rows[1].source_reference.page_index, rows[1].source_reference.page_row_index], [1, 1, 0]);
  assert.equal(rows[1].source_reference.provider_request_id, "cart-page-2");
  assert.equal(f.readQueries.filter(q => /FROM cart_data_sales_view/.test(q)).length, 2);
});

test("Shopping cart cursor loop, byte overflow and cancellation never produce accepted sales", async () => {
  const loop = productSalesFixture(), original = loop.hooks.response;
  loop.hooks.response = (address, init) => address.includes("oauth2") || !/FROM cart_data_sales_view/.test(JSON.parse(init.body).query)
    ? original(address, init) : json({results: [loop.sales[0]], nextPageToken: "repeat"});
  await assert.rejects(loop.create().readEvidence(), /READ_FAILED/);
  const big = productSalesFixture(); big.sales[0].segments.productSoldTitle = "x".repeat(400000);
  await assert.rejects(big.create().readEvidence(), /READ_FAILED/);
  const cancelled = productSalesFixture(), controller = new AbortController(); cancelled.config.signal = controller.signal;
  const response = cancelled.hooks.response;
  cancelled.hooks.response = (address, init) => {
    const result = response(address, init);
    if (!address.includes("oauth2") && /FROM cart_data_sales_view/.test(JSON.parse(init.body).query)) controller.abort();
    return result;
  };
  await assert.rejects(cancelled.create().readEvidence(), /EXECUTION_STOPPED/);
});

test("failed PD composition and serialized handoff bounds cannot promote product sales", async () => {
  const f = productSalesFixture(), w = prewriteWorker(f);
  w.worker.limits.maxBytes = w.worker.claim.cost.bytes = 300000;
  const denied = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
  assert.equal(denied.reason, "validation_failed_after_request"); assert.equal(denied.product_sales, null);
  const g = await composedProductSalesFixture("shopping"), first = prewriteWorker(g);
  first.worker.limits.maxBytes = first.worker.claim.cost.bytes = 300000;
  const observed = await runRefreshPdPrewriteChunk({worker: first.worker, source: first.source});
  const budget = Buffer.byteLength(JSON.stringify(observed.source_observation)) + 100;
  const bounded = prewriteWorker(g);
  bounded.worker.limits.maxBytes = bounded.worker.claim.cost.bytes = bounded.source.limits.maxBytes = budget;
  const rejected = await runRefreshPdPrewriteChunk({worker: bounded.worker, source: bounded.source});
  assert.equal(rejected.product_sales, null); assert.equal(rejected.rows, undefined);
  assert.ok(!bounded.stages.includes("ready_for_dataset"));
});

function searchSalesFixture() {
  const f = fixture("google_ads"); delete f.config.queryFamily;
  f.config.googlePd = {flow: "search", includeProductSales: true};
  Object.assign(f.config.limits, {maxPages: 3, maxBytes: 300000});
  const native = (segments, metrics) => ({customer: {id: "123"}, campaign: {id: "10", advertisingChannelType: "SEARCH"},
    adGroup: {id: "20"}, segments: {date: "2026-10-01", ...segments}, metrics});
  const sale = (sold, metrics, extra = {}) => native({productMerchantId: "50", productFeedLabel: "TR", productSoldItemId: sold, ...extra}, metrics);
  f.sales = [
    sale("A", {unitsSold: "1.5", revenueMicros: "123456789012345678", allUnitsSold: "999"}),
    sale("B", {unitsSold: "0", revenueMicros: "0"}),
    sale("C", {allUnitsSold: "5", allRevenueMicros: "5000000"}),
    sale(null, {unitsSold: "1", revenueMicros: "200"}),
    sale("A", {unitsSold: "2", revenueMicros: "100", leadUnitsSold: "2"}, {productItemId: "A"}),
    sale("B", {unitsSold: 3, revenueMicros: "200", crossSellUnitsSold: "3"}, {productItemId: "A"}),
    sale("D", {unitsSold: "malformed"}),
    sale("E", {leadUnitsSold: "1", crossSellUnitsSold: "1"}),
  ];
  f.ads = ["30", "31"]; f.readQueries = [];
  f.hooks.response = (address, init) => {
    if (address.includes("oauth2")) return json({access_token: "synthetic-access", token_type: "Bearer", expires_in: 3600});
    const {query} = JSON.parse(init.body); f.readQueries.push(query);
    const results = /FROM cart_data_sales_view/.test(query) ? f.sales
      : f.ads.flatMap((id, i) => /segments.conversion_action_category/.test(query)
        ? ["PURCHASE", "ADD_TO_CART", "BEGIN_CHECKOUT"].map((category, n) => ({
          ...native({conversionActionCategory: category, conversionAction: "customers/123/conversionActions/" + (100 + n)}, {conversions: "0", conversionsValue: "0"}),
          adGroupAd: {ad: {id}}}))
        : [{...native({}, {clicks: String(i + 1), impressions: "10", costMicros: "3000000"}), adGroupAd: {ad: {id}}}]);
    return new Response(JSON.stringify({results}), {headers: {"content-type": "application/json", "request-id": "search-native-request"}});
  };
  return f;
}

test("Search sold-only evidence reaches main sales output once at Ad Group grain, never one sale per Ad", async () => {
  const f = searchSalesFixture(), r = await f.create().readEvidence(), rows = r.product_sales.rows;
  assert.deepEqual(rows.map(s => s.sales_role), ["Assisted", "Assisted", "Unclassified", "Unclassified", "Assisted", "Assisted", "Unclassified", "Unclassified"]);
  assert.equal(rows.length, f.sales.length);
  assert.equal(rows[0].raw_metrics.units_sold, "1.5"); assert.equal(rows[0].raw_metrics.revenue_micros, "123456789012345678");
  assert.equal(rows[1].raw_metrics.units_sold, "0"); assert.equal(rows[2].raw_metrics.units_sold, null);
  assert.equal(rows[5].raw_metrics.units_sold, 3);
  assert.equal(rows[4].raw_metrics.lead_units_sold, null); assert.equal(rows[5].raw_metrics.cross_sell_units_sold, null);
  assert.equal(rows[0].raw_row.metrics.allUnitsSold, "999");
  assert.equal(rows[4].raw_row.segments.productItemId, "A"); assert.equal(rows[4].raw_row.metrics.leadUnitsSold, "2");
  assert.equal(rows[4].provider_product_key.advertised_item_id, null);
  assert.equal(rows[6].raw_metrics.units_sold, "malformed");
  for (const row of rows) {
    assert.equal(row.role_evidence_scope, "search_sold_product_only");
    assert.equal(row.advertised_cross_sell_evidence, "not_established_by_current_query");
    assert.equal(row.channel_reference.pd_parent_context.product_sales_attributed_to_these_ads, false);
  }
  assert.equal(rows[0].channel_reference.channel_type, "ad_group");
  assert.equal(rows[0].channel_reference.native_leaf_key.ad_group_id, "20");
  assert.deepEqual(rows[0].channel_reference.pd_parent_context.ad_row_indexes, [0, 1]);
  assert.equal(rows[0].source_reference.query_family, "search_cart_data_product_sales_daily");
  assert.equal(rows[0].source_reference.provider_request_id, "search-native-request");
  assert.match(rows[0].source_reference.query_fingerprint, /^[a-f0-9]{64}$/);
  const cart = f.readQueries.filter(q => /FROM cart_data_sales_view/.test(q));
  assert.equal(cart.length, 1);
  assert.doesNotMatch(cart[0], /segments[.]product_item_id|metrics[.](all_)?(lead|cross_sell)_|ad_group_ad[.]|metrics[.](impressions|clicks|cost_micros)/);
  assert.match(cart[0], /advertising_channel_type = 'SEARCH'/);
  assert.equal(f.state.reserves, f.state.http); assert.equal(r.product_sales.metrics_allocated, false);
  f.sales[0].metrics.unitsSold = "999"; assert.equal(rows[0].raw_row.metrics.unitsSold, "1.5");
  assert.equal(Object.isFrozen(rows[0].raw_row.metrics), true); assert.equal(r.product_sales.publishable, false);
});

test("Search sales preserve exact Ad Group without PD Ads and ambiguous PD context does not distribute sales", async () => {
  const f = searchSalesFixture(); f.ads = [];
  const emptyPd = await f.create().readEvidence();
  assert.equal(emptyPd.product_sales.rows[0].sales_role, "Assisted");
  assert.equal(emptyPd.product_sales.rows[0].channel_reference.channel_state, "exact_native_ad_group_reference");
  assert.equal(emptyPd.product_sales.rows[0].channel_reference.pd_parent_context.state, "not_observed");
  const g = searchSalesFixture(); g.ads = ["30", "30"];
  const ambiguous = await g.create().readEvidence();
  assert.equal(ambiguous.product_sales.rows.length, g.sales.length);
  assert.equal(ambiguous.product_sales.rows[0].channel_reference.pd_parent_context.state, "ambiguous_pd_ad_rows");
  assert.equal(ambiguous.product_sales.rows[0].sales_role, "Assisted");
});

test("Search empty successful cart read and absent opt-in cannot fabricate a sale", async () => {
  const f = searchSalesFixture(); f.sales.length = 0;
  const empty = await f.create().readEvidence(); assert.equal(empty.product_sales.status, "not_observed"); assert.deepEqual(empty.product_sales.rows, []);
  const g = searchSalesFixture(); delete g.config.googlePd.includeProductSales;
  const ordinary = await g.create().readEvidence(); assert.equal(ordinary.product_sales, undefined); assert.equal(g.readQueries.length, 2);
});

test("Search paginated sales retain exact source page and query provenance", async () => {
  const f = searchSalesFixture(), original = f.hooks.response;
  f.hooks.response = (address, init) => {
    if (address.includes("oauth2") || !/FROM cart_data_sales_view/.test(JSON.parse(init.body).query)) return original(address, init);
    const body = JSON.parse(init.body); f.readQueries.push(body.query);
    return new Response(JSON.stringify({results: body.pageToken ? f.sales.slice(1) : f.sales.slice(0, 1),
      ...(body.pageToken ? {} : {nextPageToken: "search-cart-next"})}),
      {headers: {"content-type": "application/json", "request-id": body.pageToken ? "search-page-2" : "search-page-1"}});
  };
  const r = await f.create().readEvidence();
  assert.equal(r.product_sales.rows.length, f.sales.length);
  assert.equal(r.product_sales.rows[0].source_reference.provider_request_id, "search-page-1");
  assert.equal(r.product_sales.rows[1].source_reference.provider_request_id, "search-page-2");
  assert.deepEqual([r.product_sales.rows[1].source_reference.page_index, r.product_sales.rows[1].source_reference.page_row_index], [1, 0]);
});

for (const scenario of ["first_error", "cursor_loop", "row_bound", "byte_bound", "cancel", "authority_drift"])
test("Search " + scenario + " stops without partial accepted sales", async () => {
  const f = searchSalesFixture(), original = f.hooks.response;
  const controller = new AbortController(); f.config.signal = controller.signal;
  if (scenario === "row_bound") f.config.limits.maxRows = 10;
  if (scenario === "byte_bound") f.sales[0].segments.productSoldTitle = "x".repeat(400000);
  f.hooks.response = (address, init) => {
    if (address.includes("oauth2")) return original(address, init);
    const q = JSON.parse(init.body).query, cart = /FROM cart_data_sales_view/.test(q);
    if (scenario === "first_error" && f.readQueries.length >= 2) return json({error: {message: "private-error"}}, 403);
    if (scenario === "cursor_loop" && cart) return json({results: [f.sales[0]], nextPageToken: "repeat"});
    const result = original(address, init);
    if (cart && scenario === "cancel") controller.abort();
    if (cart && scenario === "authority_drift") f.state.row.reporting_selection_epoch = "72";
    return result;
  };
  await assert.rejects(f.create().readEvidence());
  if (scenario === "first_error") assert.equal(f.readQueries.filter(q => /FROM cart_data_sales_view/.test(q)).length, 0);
});

for (const change of [
  e => e.authority.reporting_account_id = "999",
  e => e.source_links.scope.connection_id = workspace,
  e => e.results.search_cart_data_product_sales_daily.next_cursor = "partial",
  e => e.results.search_cart_data_product_sales_daily.evidence.page_spans[0].row_count--,
  e => e.results.search_cart_data_product_sales_daily.rows[0].campaign.advertisingChannelType = "SHOPPING",
  e => e.results.search_cart_data_product_sales_daily.rows[0].segments.date = "2026-09-30",
]) test("Search projection rejects foreign or incomplete source proof: " + change, async () => {
  const r = await searchSalesFixture().create().readEvidence(), e = structuredClone(r.search_source_evidence);
  change(e); assert.throws(() => projectGoogleProductSales({sourceContext: r.source_context, evidence: e}), /EVIDENCE_INVALID/);
});

async function composedSearchSalesFixture() {
  const f = searchSalesFixture();
  f.sales = f.sales.filter(s => s.segments.productSoldItemId && s.metrics.unitsSold !== undefined && s.metrics.unitsSold !== "malformed" && s.metrics.revenueMicros !== undefined)
    .filter((s, i, all) => all.findIndex(other => other.segments.productSoldItemId === s.segments.productSoldItemId) === i);
  const observed = await f.create().readEvidence();
  f.config.googlePd.compositionContext = {binding: observed.source_context, flow: "search", conversion_scope: "normal",
    reporting_time_basis: "interaction_date", composition_attempt_id: workspace, snapshot_id: "synthetic-search-sales",
    attribution_fingerprint: "a".repeat(64), metric_units_fingerprint: "b".repeat(64),
    references: {attribution: "synthetic-attribution", metric_units: "synthetic-units"}};
  const composed = await f.create().readEvidence(); assert.equal(composed.composition.status, "composed");
  f.config.recordBridge = {metadata: recordMetadata(composed.source_context, composed.composition.rows)};
  return f;
}
test("Search actual main worker handoff separates two PD Ads from one Ad Group sales set and blocks late authority drift", async () => {
  const f = await composedSearchSalesFixture(), w = prewriteWorker(f);
  w.worker.limits.maxBytes = w.worker.claim.cost.bytes = 300000;
  const r = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
  assert.equal(r.status, "awaiting_dataset"); assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].entity.entity_type, "ad");
  assert.equal(r.product_sales.rows.length, f.sales.length); assert.equal(r.product_sales.rows[0].sales_role, "Assisted");
  assert.equal(r.product_sales.rows[0].channel_reference.native_leaf_key.ad_group_id, "20");
  assert.equal(r.rows[0].raw_metrics.spend_value, 3); assert.equal(r.rows[1].raw_metrics.spend_value, 3);
  assert.equal(r.product_sales.rows[0].raw_metrics.revenue_micros, "123456789012345678"); assert.equal(r.Dataset_write_performed, false);
  const stopped = prewriteWorker(f), original = stopped.worker.loadAuthority; let calls = 0;
  stopped.worker.limits.maxBytes = stopped.worker.claim.cost.bytes = 300000;
  stopped.worker.loadAuthority = async input => {const a = await original(input); if (++calls === 3) f.state.row.connection_version++; return a;};
  const denied = await runRefreshPdPrewriteChunk({worker: stopped.worker, source: stopped.source});
  assert.equal(denied.reason, "authority_check_failed_after_request"); assert.equal(denied.product_sales, null); assert.equal(denied.rows, undefined);
});

async function roleWorkerFixture(flow) {
  const f = flow === "search" ? await composedSearchSalesFixture() : await composedProductSalesFixture(flow);
  const w = prewriteWorker(f); w.worker.limits.maxBytes = w.worker.claim.cost.bytes = 300000;
  return {f, w};
}
for (const flow of ["shopping", "retail_pmax", "search"]) {
  test(flow + ": actual worker deduplicates an identical native sale across pages without losing raw source", async () => {
    const {f, w} = await roleWorkerFixture(flow);
    f.sales = [f.sales[0], structuredClone(f.sales[0])];
    const r = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
    assert.equal(r.status, "awaiting_dataset"); assert.equal(r.product_sales.rows.length, 1);
    assert.equal(r.source_observation.product_sales.rows.length, 2);
    assert.equal(r.sales_role_review.counts.duplicate_rows, 1);
    assert.equal(r.sales_role_review.rows[0].source_references.length, 2);
    assert.equal(r.product_sales.rows[0].raw_metrics.units_sold, f.sales[0].metrics.unitsSold);
  });
  test(flow + ": same native sale with different amount blocks actual handoff and retains conflict evidence", async () => {
    const {f, w} = await roleWorkerFixture(flow), a = structuredClone(f.sales[0]), b = structuredClone(a);
    b.metrics.revenueMicros = "77"; f.sales = [a, b];
    const r = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
    assert.equal(r.source_review.reason, "sales_role_prewrite_blocked");
    assert.equal(r.product_sales, null); assert.equal(r.rows, undefined);
    assert.equal(r.sales_role_review.counts.conflicting_rows, 1);
    assert.equal(r.sales_role_review.rows[0].conflicting_observations[0].raw_metrics.revenue_micros, "77");
    assert.ok(!w.stages.includes("ready_for_dataset"));
  });
}
for (const [name, change] of [
  ["missing quantity", s => delete s.metrics.unitsSold],
  ["invalid quantity", s => s.metrics.unitsSold = "bad"],
  ["unsafe integer", s => s.metrics.unitsSold = 9007199254740992],
  ["missing sold identity", s => delete s.segments.productSoldItemId],
]) test("Google actual role guard holds " + name + " without turning it into zero", async () => {
  const {f, w} = await roleWorkerFixture("shopping"), a = structuredClone(f.sales[0]); change(a); f.sales = [a];
  const r = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
  assert.equal(r.source_review.reason, "sales_role_prewrite_blocked"); assert.equal(r.product_sales, null);
  assert.equal(r.sales_role_review.rows[0].state, "held"); assert.ok(!w.stages.includes("ready_for_dataset"));
});
test("Google explicit zero stays a native metric while role and Channel remain separate", async () => {
  const {f, w} = await roleWorkerFixture("retail_pmax");
  const a = structuredClone(f.sales[0]); a.metrics.unitsSold = "0"; a.metrics.revenueMicros = "0";
  a.metrics.leadUnitsSold = "0"; a.metrics.leadRevenueMicros = "0"; f.sales = [a];
  const r = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
  assert.equal(r.status, "awaiting_dataset"); assert.equal(r.sales_role_review.rows[0].metric_states.quantity, "zero");
  assert.equal(r.product_sales.rows[0].raw_metrics.units_sold, "0"); assert.equal(r.product_sales.rows[0].sales_role, "Unclassified");
  assert.equal(r.product_sales.rows[0].channel_reference.channel_type, "Unclassified Channel");
});
test("Google native metadata stays bound to the exact post-metadata source context during role review", async () => {
  const f = productSalesFixture("shopping"); f.sales = [f.sales[0]]; f.config.nativeMetadata = true;
  const original = f.hooks.response;
  f.hooks.response = (address, init) => {
    if (address.includes("oauth2")) return original(address, init);
    const query = JSON.parse(init.body).query;
    if (/FROM customer$/.test(query)) return json({results: [{customer: {id: "123", currencyCode: "USD", timeZone: "Europe/Istanbul"}}]});
    if (/FROM conversion_action/.test(query)) return json({results: ["PURCHASE", "ADD_TO_CART", "BEGIN_CHECKOUT"].map((category, i) => ({
      conversionAction: {resourceName: "customers/123/conversionActions/" + (100 + i), ownerCustomer: "customers/123", category,
        attributionModelSettings: {attributionModel: "GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN"},
        clickThroughLookbackWindowDays: 30, viewThroughLookbackWindowDays: 1, countingType: "MANY_PER_CLICK"}}))});
    return original(address, init).json().then(payload => {
      for (const row of payload.results ?? []) {if (row.campaign) row.campaign.name = "Root"; if (row.adGroup) row.adGroup.name = "Leaf";}
      return json(payload);
    });
  };
  const observed = await f.create().readEvidence();
  assert.equal(observed.native_metadata.status, "prepared");
  assert.deepEqual(observed.product_sales.source_context, observed.source_context);
  f.config.recordBridge = {metadata: recordMetadata(observed.source_context, observed.composition.rows)};
  const w = prewriteWorker(f); w.worker.limits.maxBytes = w.worker.claim.cost.bytes = 300000;
  const r = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
  assert.equal(r.status, "awaiting_dataset", JSON.stringify({review:r.source_review,records:r.source_observation?.records?.reason,decisions:r.source_observation?.records?.decisions?.map(d=>d.reason),composition:r.source_observation?.composition?.reason})); assert.equal(r.sales_role_review.complete, true);
});


for (const flow of ["shopping", "retail_pmax"]) test(flow + ": unrequested identity fields cannot disguise a duplicate source sale", async () => {
  const {f, w} = await roleWorkerFixture(flow), a = structuredClone(f.sales[0]), b = structuredClone(a);
  if (flow === "shopping") b.segments.productLanguage = "unrequested"; else b.adGroup = {id: "999"};
  f.sales = [a, b];
  const r = await runRefreshPdPrewriteChunk({worker: w.worker, source: w.source});
  assert.equal(r.source_review.reason, "sales_role_prewrite_blocked"); assert.equal(r.product_sales, null);
  assert.equal(r.sales_role_review.counts.conflicting_rows, 1);
});
