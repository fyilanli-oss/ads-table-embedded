import test from "node:test";
import assert from "node:assert/strict";
import {createRefreshPdSourceReader} from "../app/lib/refresh/pd-source-reader.server.js";
import {quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";

const workspace = "11111111-1111-4111-8111-111111111111", connection = "22222222-2222-4222-8222-222222222222";
const credential = "33333333-3333-4333-8333-333333333333";
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {"content-type": "application/json", "request-id": "synthetic-request"}});
function fixture(flow = "search") {
  const state = {requests: [], reserve: 0, version: 2, selection: "71", clock: 0};
  const hooks = {};
  const native = (leaf, metrics, category = null, action = "100") => ({customer: {id: "123"},
    campaign: {id: "10", advertisingChannelType: {search: "SEARCH", shopping: "SHOPPING", retail_pmax: "PERFORMANCE_MAX"}[flow]},
    ...(flow === "search" ? {adGroup: {id: "20"}, adGroupAd: {ad: {id: leaf}}} : flow === "shopping" ? {adGroup: {id: leaf}} : {assetGroup: {id: leaf}}),
    segments: {date: "2026-10-01", ...(category ? {conversionActionCategory: category, conversionAction: `customers/123/conversionActions/${action}`} : {})}, metrics});
  const performance = [native("30", {impressions: "100", clicks: "10", costMicros: "300000000", conversions: "999", conversionsValue: "99999"}),
    native("31", {impressions: "0", clicks: "0", costMicros: "0"})];
  const conversions = [native("30", {conversions: "1.5", conversionsValue: "3000", allConversions: "999", allConversionsValue: "99999"}, "PURCHASE"),
    native("31", {conversions: "1", conversionsValue: "200"}, "PURCHASE"),
    native("30", {conversions: "0.5", conversionsValue: "900"}, "PURCHASE", "101"),
    native("30", {conversions: "5", conversionsValue: "500"}, "ADD_TO_CART", "102"),
    native("30", {conversions: "3", conversionsValue: "300"}, "BEGIN_CHECKOUT", "103")];
  const binding = {workspace_id: workspace, installation_id: "42", installation_generation: 1, provider: "google_ads",
    provider_connection_id: connection, connection_version: 2, reporting_selection_epoch: "71", platform_account_id: "123",
    canonical_reporting_account_id: "123", business_date: "2026-10-01", source_timezone: "UTC", source_currency: "USD", job_or_run_id: "job-1", claim_fence: 1};
  // Synthetic metadata from this test's server planner; not evidence of native attribution.
  const metadata = {binding, flow, conversion_scope: "normal", reporting_time_basis: "interaction_date",
    composition_attempt_id: workspace, snapshot_id: "snapshot-1", metric_units_fingerprint: "a".repeat(64), attribution_fingerprint: "b".repeat(64),
    references: {attribution: "synthetic-server-attribution", metric_units: "synthetic-server-units"}};
  const account = {id: "123", kind: "advertiser", reporting_eligible: true, currency: "USD", timezone: "UTC", login_account_id: null};
  const config = {googlePd: {flow, compositionContext: metadata},
    verified: {installationAuthority: {authority: "shopify_installation_verified", status: "active", workspaceId: workspace, installGeneration: 1},
      identity: {session: {authority: "shopify_id_token_verified", shopDomain: "test.myshopify.com"},
        shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"}}},
    claim: {workspaceId: workspace, installGeneration: "1", provider: "google_ads", accountId: "123", id: "job-1", fence: 1},
    window: {from: "2026-10-01", to: "2026-10-01"}, entitlementReceipt: {observedAt: "2026-10-30T00:00:00Z"},
    limits: {maxElapsedMs: 30000, maxPages: 20, maxRows: 100, maxBytes: 200000}, now: () => state.clock,
    environment: {GOOGLE_ADS_OAUTH_CLIENT_ID: "client", GOOGLE_ADS_OAUTH_CLIENT_SECRET: "synthetic-secret",
      GOOGLE_ADS_OAUTH_REDIRECT_URI: "https://embedded.adstable.app/auth/google-ads/callback", GOOGLE_ADS_DEVELOPER_TOKEN: "synthetic-developer"},
    database: {query: async () => ({rows: [{installation_id: "42", workspace_id: workspace, install_generation: "1", installation_status: "active",
      shop_id: "gid://shopify/Shop/12", shop_domain: "test.myshopify.com", connection_id: connection, credential_id: credential,
      connection_version: state.version, lifecycle_status: "connected", reporting_selection_epoch: state.selection,
      granted_scopes: ["https://www.googleapis.com/auth/adwords"], reporting_account_id: "123", accounts: [account]}]})},
    tokenVault: {loadProviderTokenSet: async () => ({refresh_token: "synthetic-refresh"})},
    workStore: {loadBoundAuthority: async () => ({workspaceId: workspace, installGeneration: "1", provider: "google_ads", accountId: "123",
      installationVerified: true, connected: true, setupComplete: true, allowedWindow: true, connectionId: connection, connectionVersion: state.version}),
      loadQuotaContext: async () => ({provider: "google_ads", accountId: "123", organizationId: null, apiVersion: "v25",
        clientScopeKey: "a".repeat(64), connectionScopeKey: "b".repeat(64), connectionEpoch: 2})},
    quotaStore: {resolveRoute: async v => v.routeKey, reserve: async input => {state.reserve++; await hooks.reserve?.();
      return {...input, status: "reserved", dispatchBeforeMs: 1000, dispatchBudgetMs: 1000};}, settle: async () => true, stop: async () => true},
    fetchFn: async (address, init) => {
      if (address.includes("oauth2")) {state.requests.push({token: true}); return json({access_token: "synthetic-access", token_type: "Bearer", expires_in: 3600});}
      const body = JSON.parse(init.body), conversion = body.query.includes("segments.conversion_action_category");
      const request = {conversion, ...body}; state.requests.push(request); await hooks.request?.(request);
      if (hooks.response) return hooks.response(request);
      const rows = conversion ? conversions : performance;
      return json({results: body.pageToken ? rows.slice(1) : rows.slice(0, 1), ...(body.pageToken ? {} : {nextPageToken: conversion ? "conversions-next" : "performance-next"})});
    }};
  return {state, config, hooks, native, performance, conversions, metadata, create: () => createRefreshPdSourceReader(config)};
}

for (const flow of ["search", "shopping", "retail_pmax"]) test(`${flow}: native quota-bound pages feed the composer for every observed leaf with full lineage`, async () => {
  const f = fixture(flow), result = await f.create().readEvidence();
  assert.equal(result.composition.status, "partial"); assert.equal(result.composition.rows.length, 2);
  const fact = result.composition.rows.find(v => v.scope.entity_id === "30");
  assert.deepEqual(fact.raw_metrics, {impression: 100, ad_click: 10, spend_value: 300,
    add_to_cart: 5, add_to_cart_value: 500, checkout: 3, checkout_value: 300, purchase: 2, purchase_value: 3900});
  assert.equal(fact.scope.entity_type, flow === "search" ? "ad" : flow === "shopping" ? "ad_group" : "asset_group");
  assert.deepEqual(fact.source_execution.slices[1].native_row_indices, [0, 2, 3, 4]);
  assert.deepEqual(fact.metric_evidence.purchase.map(r => r.source_row_index), [0, 1]);
  assert.deepEqual(fact.source_execution.slices[1].page_spans.map(p => [p.row_start, p.row_count]), [[0, 1], [1, 4]]);
  assert.deepEqual(result.evidence.results.conversions.pd_metric_rows.map(r => r.source_row_index), [0, 1, 2, 3, 4]);
  assert.equal(result.evidence.results.conversions.rows[0].metrics.conversions, "1.5");
  const zero = result.composition.rows.find(v => v.scope.entity_id === "31");
  assert.equal(zero.raw_metrics.spend_value, 0); assert.equal(zero.raw_metrics.add_to_cart, null);
  assert.equal(result.rows_observed, 7); assert.equal(result.publishable, false); assert.equal(result.persistable, false);
  assert.equal(result.canonical_scope_ready, false); assert.equal(Object.isFrozen(fact.source_execution), true);
  const queries = f.state.requests.filter(r => !r.token);
  assert.equal(queries.length, 4); assert.equal(f.state.requests.filter(r => r.token).length, 1);
  assert.equal(queries[0].query, queries[1].query); assert.equal(queries[2].query, queries[3].query);
  assert.equal(f.state.reserve, 5); assert.doesNotMatch(queries.map(r => r.query).join("\n"), /cart_data|shopping_performance|metrics\.all_/);
  assert.ok(!JSON.stringify(result).includes("synthetic-access"));
});

test("missing composition metadata preserves native reads without manufacturing fingerprints", async () => {
  const f = fixture(); delete f.config.googlePd.compositionContext;
  const result = await f.create().readEvidence();
  assert.equal(result.composition.reason, "composition_context_required"); assert.deepEqual(result.composition.rows, []);
  assert.equal(result.source_context.attribution_fingerprint, null); assert.equal(result.rows_observed, 7);
});

for (const [key, value] of Object.entries({workspace_id: connection, installation_id: "43", installation_generation: 2,
  platform_account_id: "999", connection_version: 3, reporting_selection_epoch: "72", business_date: "2026-10-02",
  source_timezone: "Europe/Istanbul", source_currency: "TRY", job_or_run_id: "other", claim_fence: 2}))
test(`metadata for another execution cannot be composed: ${key}`, async () => {
  const f = fixture(); f.metadata.binding[key] = value;
  const result = await f.create().readEvidence(); assert.equal(result.composition.reason, "composition_context_mismatch");
  assert.deepEqual(result.composition.rows, []);
});

test("all conversion scope and missing fingerprints cannot authorize the normal-scope composer", async () => {
  for (const modify of [m => m.conversion_scope = "all", m => m.flow = "shopping", m => m.attribution_fingerprint = null, m => m.metric_units_fingerprint = null]) {
    const f = fixture(); modify(f.metadata);
    const r = await f.create().readEvidence(); assert.equal(r.composition.status, "blocked"); assert.equal(r.composition.rows.length, 0);
  }
});

test("input metadata is detached before the first await", async () => {
  const f = fixture(), reader = f.create(); f.metadata.binding.source_currency = "TRY";
  assert.equal((await reader.readEvidence()).composition.rows[0].scope.source_currency, "USD");
});

for (const mutation of [f => f.performance.push(structuredClone(f.performance[0])),
  f => f.conversions.push(structuredClone(f.conversions[0])),
  f => f.conversions[2].adGroup = {id: "999"},
  f => f.conversions[2].segments.device = "MOBILE"])
test(`duplicate/ambiguous grain never returns partial accepted leaves: ${mutation}`, async () => {
  const f = fixture(); mutation(f);
  const r = await f.create().readEvidence(); assert.equal(r.composition.status, "blocked"); assert.deepEqual(r.composition.rows, []);
});

test("conversion-only and performance-only leaves retain unknown values rather than invented zeros", async () => {
  const f = fixture(); f.performance.splice(0, 1);
  const r = await f.create().readEvidence(), fact = r.composition.rows.find(v => v.scope.entity_id === "30");
  assert.equal(fact.raw_metrics.spend_value, null); assert.equal(fact.raw_metrics.purchase_value, 3900);
});

test("missing revenue preserves quantity and reports partial value", async () => {
  const f = fixture(); delete f.conversions[2].metrics.conversionsValue;
  const fact = (await f.create().readEvidence()).composition.rows[0];
  assert.equal(fact.raw_metrics.purchase, 2); assert.equal(fact.raw_metrics.purchase_value, null);
  assert.equal(fact.observation_state.purchase_value, "partial");
});

test("first later-page rejection stops before the other family and cannot be retried", async () => {
  const f = fixture(); f.hooks.response = r => r.pageToken ? json({error: {message: "SENSITIVE"}}, 400)
    : json({results: f.performance.slice(0, 1), nextPageToken: "next"});
  const reader = f.create(); await assert.rejects(reader.readEvidence(), e => e.message === "PD_SOURCE_READ_FAILED");
  await assert.rejects(reader.readEvidence(), /EXECUTION_USED/); assert.equal(f.state.requests.length, 3);
});

test("a failure in conversion continuation discards already-collected performance", async () => {
  const f = fixture(); f.hooks.response = r => r.conversion && r.pageToken ? json({error: {}}, 400)
    : json({results: (r.conversion ? f.conversions : f.performance).slice(r.pageToken ? 1 : 0, r.pageToken ? undefined : 1),
      ...(r.pageToken ? {} : {nextPageToken: "next"})});
  const reader = f.create(); await assert.rejects(reader.readEvidence());
  assert.equal(f.state.requests.length, 5);
});

test("complete empty families mean not observed, never synthetic zero metric records", async () => {
  const f = fixture(); f.hooks.response = () => json({results: []});
  const r = await f.create().readEvidence(); assert.equal(r.composition.status, "not_observed");
  assert.deepEqual(r.composition.rows, []); assert.equal(r.rows_observed, 0); assert.equal(r.publishable, false);
});

test("cyclic cursor and configured page/row bounds reject incomplete snapshots", async () => {
  for (const change of [f => {f.hooks.response = () => json({results: [], nextPageToken: "loop"});},
    f => f.config.limits.maxPages = 1, f => f.config.limits.maxRows = 2]) {
    const f = fixture(); change(f); await assert.rejects(f.create().readEvidence());
    assert.ok(f.state.requests.length <= 5);
  }
});

test("scope drift at the continuation request prevents dispatch and invalidates both families", async () => {
  const f = fixture(); f.hooks.reserve = () => {if (f.state.reserve === 3) f.state.selection = "72";};
  await assert.rejects(f.create().readEvidence()); assert.equal(f.state.requests.length, 2);
});

test("genuine continuation quota wait remains inspectable; it is not treated as a complete read", async () => {
  const f = fixture(); f.config.quotaStore.reserve = async input => ++f.state.reserve === 3
    ? {status: "waiting"} : {...input, status: "reserved", dispatchBeforeMs: 1000, dispatchBudgetMs: 1000};
  await assert.rejects(f.create().readEvidence(), e => quotaBoundaryControl(e)?.status === "waiting");
  assert.equal(f.state.requests.length, 2);
});

test("malformed flow, mixed query overrides and unsafe limits fail before provider access", () => {
  for (const change of [f => f.config.googlePd.flow = "campaign", f => f.config.queryFamily = "search_ad_channel_daily",
    f => f.config.limits.maxPages = 21, f => f.config.limits.maxRows = 20001]) {
    const f = fixture(); change(f); assert.throws(() => f.create(), /INPUT_INVALID/); assert.equal(f.state.requests.length, 0);
  }
});
