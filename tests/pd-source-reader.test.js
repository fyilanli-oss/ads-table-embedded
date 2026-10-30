import test from "node:test";
import assert from "node:assert/strict";
import {createRefreshPdSourceReader} from "../app/lib/refresh/pd-source-reader.server.js";

const workspace = "11111111-1111-4111-8111-111111111111";
const connection = "22222222-2222-4222-8222-222222222222";
const credential = "33333333-3333-4333-8333-333333333333";
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {"content-type": "application/json"}});
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
