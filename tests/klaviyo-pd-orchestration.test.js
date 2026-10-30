import test from "node:test";
import assert from "node:assert/strict";
import {createRefreshPdSourceReader} from "../app/lib/refresh/pd-source-reader.server.js";
import {quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";

const workspace = "11111111-1111-4111-8111-111111111111", connection = "22222222-2222-4222-8222-222222222222";
const credential = "33333333-3333-4333-8333-333333333333";
const names = ["Placed Order", "Added to Cart", "Checkout Started"];
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {"content-type": "application/json", "x-request-id": "synthetic-request"}});
function fixture() {
  const state = {requests: [], reserves: 0, version: 2, clock: 0};
  const hooks = {};
  const metrics = [...names, "Ordered Product"].map((name, i) => ({type: "metric", id: `metric-${i}`, attributes: {name, integration: {name: "Shopify"}}}));
  const row = (kind, message, variation, medium, statistics) => ({groupings: {[`${kind}_id`]: `parent-${kind}`,
    [`${kind}_message_id`]: message, [`${kind}_message_name`]: `Name ${message}`, ...(kind === "flow" ? {flow_name: "Flow"} : {}),
    send_channel: medium, variation, variation_name: variation === null ? null : `Name ${variation}`}, statistics});
  const reports = {};
  for (const kind of ["campaign", "flow"]) for (const [index, name] of names.entries()) {
    const stats = index === 0 ? {delivered: 100, clicks: 10, conversions: 2, conversion_value: 300}
      : index === 1 ? {conversions: 5, conversion_value: 500, delivered: 9999} : {conversions: 3, conversion_value: 400, clicks: 9999};
    reports[`${kind}:${name}`] = [row(kind, "message-1", "A", "email", stats),
      row(kind, "message-2", null, "email", Object.fromEntries(Object.keys(stats).map(k => [k, 0]))),
      row(kind, "message-1", null, "sms", Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v * 2])))];
  }
  const binding = {workspace_id: workspace, installation_id: "42", installation_generation: 1, provider: "klaviyo",
    provider_connection_id: connection, connection_version: 2, reporting_selection_epoch: null, platform_account_id: "ABC123",
    canonical_reporting_account_id: null, business_date: "2026-10-01", source_timezone: "Europe/Istanbul", source_currency: "USD", job_or_run_id: "job-1", claim_fence: 1};
  const contexts = Object.fromEntries(["campaign", "flow"].map(kind => [kind, {binding: {...binding}, flow: kind,
    conversion_scope: "normal", reporting_time_basis: "send_date", composition_attempt_id: workspace, snapshot_id: `snapshot-${kind}`,
    attribution_fingerprint: (kind === "campaign" ? "b" : "c").repeat(64), metric_units_fingerprint: "a".repeat(64),
    references: {attribution: `synthetic-${kind}-attribution`, metric_units: "synthetic-units"}}]));
  const account = {id: "ABC123", kind: "account", status: "active", reporting_eligible: true, currency: "USD", timezone: "Europe/Istanbul"};
  const config = {klaviyoPd: {compositionContexts: contexts},
    verified: {installationAuthority: {authority: "shopify_installation_verified", status: "active", workspaceId: workspace, installGeneration: 1},
      identity: {session: {authority: "shopify_id_token_verified", shopDomain: "test.myshopify.com"},
        shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"}}},
    claim: {workspaceId: workspace, installGeneration: "1", provider: "klaviyo", accountId: "ABC123", id: "job-1", fence: 1},
    window: {from: "2026-10-01", to: "2026-10-01"}, entitlementReceipt: {observedAt: "2026-10-30T00:00:00Z"},
    limits: {maxElapsedMs: 30000, maxPages: 100, maxRows: 100, maxBytes: 300000}, now: () => state.clock,
    readNow: () => new Date("2026-10-30T00:00:00Z"), environment: {KLAVIYO_CLIENT_ID: "client", KLAVIYO_CLIENT_SECRET: "synthetic-secret",
      KLAVIYO_OAUTH_REDIRECT_URI: "https://embedded.adstable.app/auth/klaviyo/callback"},
    database: {query: async () => ({rows: [{installation_id: "42", workspace_id: workspace, install_generation: "1", installation_status: "active",
      shop_id: "gid://shopify/Shop/12", shop_domain: "test.myshopify.com", connection_id: connection, credential_id: credential,
      connection_version: state.version, lifecycle_status: "connected", reporting_selection_epoch: null, reporting_account_id: null,
      granted_scopes: ["accounts:read", "campaigns:read", "events:read", "flows:read", "metrics:read"], accounts: [account]}]})},
    tokenVault: {loadProviderTokenSet: async () => ({access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_at: "2026-10-31T00:00:00Z"})},
    workStore: {loadBoundAuthority: async () => ({workspaceId: workspace, installGeneration: "1", provider: "klaviyo", accountId: "ABC123",
      installationVerified: true, connected: true, setupComplete: true, allowedWindow: true, connectionId: connection, connectionVersion: state.version}),
      loadQuotaContext: async () => ({provider: "klaviyo", accountId: "ABC123", organizationId: null, apiVersion: "2026-10-15",
        clientScopeKey: "a".repeat(64), connectionScopeKey: "b".repeat(64), connectionEpoch: 2})},
    quotaStore: {resolveRoute: async v => v.routeKey, reserve: async input => {state.reserves++; await hooks.reserve?.();
      return {...input, status: "reserved", dispatchBeforeMs: 1000, dispatchBudgetMs: 1000};}, settle: async () => true, stop: async () => true, recordFeedback: async () => true},
    fetchFn: async (address, init) => {
      const url = new URL(address), isMetrics = url.pathname === "/api/metrics", body = init.body ? JSON.parse(init.body) : null;
      const next = isMetrics ? url.searchParams.get("page[cursor]") : url.searchParams.get("page_cursor");
      const kind = body?.data?.type.split("-")[0], metricIndex = names.findIndex((_, i) => `metric-${i}` === body?.data?.attributes?.conversion_metric_id);
      const request = {isMetrics, kind, name: names[metricIndex], next, body}; state.lastSignal = init.signal; state.requests.push(request); await hooks.request?.(request);
      if (hooks.response) return hooks.response(request);
      const all = isMetrics ? metrics : reports[`${kind}:${names[metricIndex]}`];
      const page = next ? all.slice(1) : all.slice(0, 1);
      return json({data: isMetrics ? page : {attributes: {results: page}},
        ...(next ? {} : {links: {next: `https://a.klaviyo.com${url.pathname}?${isMetrics ? 'page%5Bcursor%5D' : 'page_cursor'}=next`}})});
    }};
  return {config, contexts, state, hooks, metrics, reports, row, create: () => createRefreshPdSourceReader(config)};
}

test("one quota-bound collection composes Campaign and Flow Messages with Medium/Variation and lineage", async () => {
  const f = fixture(), result = await f.create().readEvidence();
  assert.equal(result.composition.status, "composed"); assert.equal(result.composition.rows.length, 4);
  for (const kind of ["campaign", "flow"]) {
    const fact = result.composition.rows.find(r => r.scope.flow === kind && r.scope.entity_id === "message-1");
    assert.deepEqual(fact.raw_metrics, {impression: 300, ad_click: 30, spend_value: null, add_to_cart: 15, add_to_cart_value: 1500,
      checkout: 9, checkout_value: 1200, purchase: 6, purchase_value: 900});
    assert.equal(fact.scope.entity_type, `${kind}_message`); assert.equal(fact.scope.ancestors[0].entity_id, `parent-${kind}`);
    assert.equal(fact.scope.reporting_time_basis, "send_date"); assert.equal(fact.spend_state, "open_no_calculation");
    assert.equal(fact.observation_state.spend_value, "not_requested"); assert.equal("sales_role" in fact, false);
    assert.deepEqual(fact.details.map(r => [r.medium, r.variation_id]), [["Email", "A"], ["SMS", null]]);
    assert.equal(fact.source_projections[0].rows[0].groupings.variation_name, "Name A");
    assert.deepEqual(fact.source_execution.slices[0].native_row_indices, [0, 2]);
    assert.deepEqual(fact.source_execution.slices[0].page_spans.map(p => [p.row_start, p.row_count]), [[0, 1], [1, 2]]);
    assert.deepEqual(fact.metric_evidence.purchase.map(r => r.source_row_index), [0, 1]);
    const zero = result.composition.rows.find(r => r.scope.flow === kind && r.scope.entity_id === "message-2");
    assert.equal(zero.raw_metrics.purchase, 0); assert.equal(zero.observation_state.purchase, "zero");
  }
  assert.equal(f.state.requests.length, 14); assert.equal(f.state.reserves, 14); assert.equal(result.rows_observed, 22);
  assert.equal(result.publishable, false); assert.equal(result.persistable, false); assert.equal(result.canonical_scope_ready, false);
  assert.ok(!JSON.stringify(result).includes("synthetic-access"));
  assert.ok(f.state.requests.filter(r => !r.isMetrics).every(r => r.body.data.attributes.conversion_metric_id !== "metric-3"));
});

test("missing attribution/unit metadata blocks composition without losing native reports", async () => {
  const f = fixture(); delete f.config.klaviyoPd.compositionContexts;
  const r = await f.create().readEvidence(); assert.equal(r.composition.reason, "composition_context_required");
  assert.equal(r.rows_observed, 22); assert.deepEqual(r.composition.rows, []); assert.equal(r.source_context.attribution_fingerprint, null);
});

for (const [key, value] of Object.entries({workspace_id: connection, installation_id: "43", installation_generation: 2,
  connection_version: 3, platform_account_id: "other", canonical_reporting_account_id: "ABC123", business_date: "2026-10-02",
  source_currency: "TRY", source_timezone: "UTC", job_or_run_id: "other", claim_fence: 2}))
test(`metadata binding mismatch is closed: ${key}`, async () => {
  const f = fixture(); f.contexts.flow.binding[key] = value;
  const r = await f.create().readEvidence(); assert.equal(r.composition.reason, "composition_context_mismatch"); assert.equal(r.composition.rows.length, 0);
});

test("flow/time basis, missing fingerprints and all scope cannot substitute for message context", async () => {
  for (const change of [m => m.flow = "campaign", m => m.reporting_time_basis = "event_date", m => m.conversion_scope = "all",
    m => m.attribution_fingerprint = null, m => m.references = {}]) {
    const f = fixture(); change(f.contexts.flow);
    assert.equal((await f.create().readEvidence()).composition.status, "blocked");
  }
});

test("a missing metric remains account_configuration_missing; other message metrics survive", async () => {
  const f = fixture(); f.metrics.splice(1, 1);
  const r = await f.create().readEvidence(), fact = r.composition.rows[0];
  assert.equal(r.composition.status, "partial"); assert.equal(fact.raw_metrics.add_to_cart, null);
  assert.equal(fact.observation_state.add_to_cart, "account_configuration_missing"); assert.equal(fact.raw_metrics.purchase_value, 900);
  assert.equal(f.state.requests.filter(r => r.name === "Added to Cart").length, 0);
});

test("missing detail/value stays absent or partial, never copied from another funnel", async () => {
  const f = fixture(); f.reports["campaign:Added to Cart"].pop(); delete f.reports["flow:Placed Order"][2].statistics.conversion_value;
  const r = await f.create().readEvidence();
  const campaign = r.composition.rows.find(v => v.scope.flow === "campaign" && v.scope.entity_id === "message-1");
  const flow = r.composition.rows.find(v => v.scope.flow === "flow" && v.scope.entity_id === "message-1");
  assert.equal(campaign.raw_metrics.add_to_cart, null); assert.equal(campaign.observation_state.add_to_cart, "partial");
  assert.equal(flow.raw_metrics.purchase, 6); assert.equal(flow.raw_metrics.purchase_value, null);
});

for (const change of [f => f.reports["campaign:Placed Order"].push(structuredClone(f.reports["campaign:Placed Order"][0])),
  f => f.reports["flow:Added to Cart"][0].groupings.flow_id = "other",
  f => {f.reports["campaign:Added to Cart"][2].groupings.send_channel = "email";},
  f => f.reports["campaign:Checkout Started"][0].groupings.other_dimension = "unexpected"])
test(`duplicate/hierarchy/mixed grain blocks the whole composition: ${change}`, async () => {
  const f = fixture(); change(f); const r = await f.create().readEvidence(); assert.equal(r.composition.status, "blocked"); assert.equal(r.composition.rows.length, 0);
});

test("every report preserves the bound account timezone and send-date window", async () => {
  const f = fixture(), r = await f.create().readEvidence();
  for (const request of f.state.requests.filter(v => !v.isMetrics)) {
    assert.deepEqual(request.body.data.attributes.timeframe, {start: r.evidence.timeframe.start, end: r.evidence.timeframe.end});
  }
});

test("late transport failure discards earlier families and does not retry", async () => {
  const f = fixture(); f.hooks.request = r => {if (r.kind === "flow" && r.name === "Added to Cart" && r.next) throw Error("synthetic first failure");};
  const reader = f.create(); await assert.rejects(reader.readEvidence()); await assert.rejects(reader.readEvidence(), /EXECUTION_USED/);
  assert.equal(f.state.requests.some(r => r.name === "Checkout Started"), false);
});

test("authority drift during continuation quota wait sends no stale request", async () => {
  const f = fixture(); f.hooks.reserve = () => {if (f.state.reserves === 4) f.state.version++;};
  await assert.rejects(f.create().readEvidence()); assert.equal(f.state.requests.length, 3);
});

test("genuine quota wait remains branded; no partial facts are returned", async () => {
  const f = fixture(); f.config.quotaStore.reserve = async input => ++f.state.reserves === 4 ? {status: "waiting"}
    : {...input, status: "reserved", dispatchBeforeMs: 1000, dispatchBudgetMs: 1000};
  await assert.rejects(f.create().readEvidence(), e => quotaBoundaryControl(e)?.status === "waiting");
  assert.equal(f.state.requests.length, 3);
});

test("abort during report collection propagates to HTTP and prevents later funnel reads", async () => {
  const f = fixture(), controller = new AbortController(); f.config.signal = controller.signal;
  let propagated = false;
  f.hooks.request = r => {if (r.name === "Added to Cart") {controller.abort(); propagated = f.state.lastSignal.aborted;}};
  await assert.rejects(f.create().readEvidence(), /EXECUTION_STOPPED/);
  assert.equal(propagated, true);
  assert.equal(f.state.requests.some(r => r.name === "Checkout Started"), false);
});

test("metadata is detached before awaits and a partial Variation never becomes a message fact", async () => {
  const f = fixture(), reader = f.create(); f.contexts.flow.binding.source_currency = "TRY";
  assert.equal((await reader.readEvidence()).composition.status, "composed");
  const g = fixture(); delete g.reports["campaign:Placed Order"][0].groupings.variation_name;
  await assert.rejects(g.create().readEvidence());
});

test("complete empty reports and missing account configuration remain distinct", async () => {
  for (const configured of [true, false]) {
    const f = fixture(); f.hooks.response = request => request.isMetrics ? json({data: configured ? f.metrics : []}) : json({data: {attributes: {results: []}}});
    const r = await f.create().readEvidence(); assert.equal(r.composition.status, configured ? "not_observed" : "configuration_missing");
    assert.deepEqual(r.composition.rows, []);
  }
});

test("page limits, aggregate row/byte budgets and cyclic cursors reject incomplete reads", async () => {
  for (const change of [f => f.config.limits.maxPages = 1, f => f.config.limits.maxRows = 8, f => f.config.limits.maxBytes = 100,
    f => {f.hooks.response = () => json({data: f.metrics, links: {next: "https://a.klaviyo.com/api/metrics?page%5Bcursor%5D=loop"}});}]) {
    const f = fixture(); change(f); await assert.rejects(f.create().readEvidence()); assert.ok(f.state.requests.length < 14);
  }
});

test("unsupported provider overrides and unsafe limits stop before native access", () => {
  for (const change of [f => f.config.claim.provider = "meta", f => f.config.klaviyoPd.newQuery = true,
    f => f.config.klaviyoPd.compositionContexts.other = {}, f => f.config.limits.maxPages = 101]) {
    const f = fixture(); change(f); assert.throws(() => f.create(), /INPUT_INVALID/); assert.equal(f.state.requests.length, 0);
  }
});

import {recordMetadata} from "./helpers/pd-record-metadata.js";
test("runtime common-record bridge validates all observed entities and retains raw source", async () => {
  const f = fixture(), native = await f.create().readEvidence();
  f.config.recordBridge = {metadata: recordMetadata(native.source_context, native.composition.rows)};
  const result = await f.create().readEvidence();
  assert.equal(result.records.status, "validated");
  assert.equal(result.records.rows.length, native.composition.rows.length);
  assert.deepEqual(result.records.rows.map(r => r.raw_metrics), native.composition.rows.map(r => r.raw_metrics));
  assert.deepEqual(result.records.source_facts, result.composition.rows);
  assert.equal(result.canonical_scope_ready, false);
  assert.equal(result.persistable, false);
  assert.equal(result.records.publishable, false);
});
test("runtime common-record bridge preserves native evidence when FX is missing", async () => {
  const f = fixture(), native = await f.create().readEvidence();
  const metadata = recordMetadata(native.source_context, native.composition.rows);
  delete metadata.entries[0].enrichment.currency.fx_rate;
  f.config.recordBridge = {metadata};
  const result = await f.create().readEvidence();
  assert.equal(result.records.status, "blocked");
  assert.equal(result.records.decisions[0].reason, "fx_metadata_missing_or_conflicting");
  assert.deepEqual(result.records.rows, []);
  assert.deepEqual(result.evidence, native.evidence);
});

test("Klaviyo documented default unlocks composition without recalculating native sales or adding requests",async()=>{
  const f=fixture();f.config.nativeMetadata=true;delete f.config.klaviyoPd.compositionContexts;
  const baseline=await fixture().create().readEvidence();
  const original=f.config.fetchFn;let accountReads=0;
  f.config.fetchFn=async(address,init)=>{if(new URL(address).pathname==="/api/accounts"){
    accountReads++;assert.equal(new URL(address).searchParams.get("fields[account]"),"id,preferred_currency,timezone");
    return json({data:[{type:"account",id:"ABC123",attributes:{preferred_currency:"USD",timezone:"Europe/Istanbul"}}]});}
    return original(address,init);};
  const r=await f.create().readEvidence();assert.equal(accountReads,2);
  assert.equal(r.native_metadata.status,"prepared");
  assert.equal(r.native_metadata.attribution.account_settings_verified,false);
  assert.equal(r.evidence.results.reports.length,6);
  assert.equal(r.composition.status,"composed");
  assert.deepEqual(r.composition.rows.map(f=>f.raw_metrics),baseline.composition.rows.map(f=>f.raw_metrics));
  assert.equal(r.source_context.metadata_state,"native_account_with_documented_default_attribution_reference");
  assert.equal(r.records.reason,"reporting_currency_reference_required");
  assert.equal(f.state.requests.length,14);
  assert.equal(r.native_metadata.units.source_currency,"USD");assert.equal(r.persistable,false);
  for(const fact of r.composition.rows) assert.equal("sales_role" in fact,false);
  f.config.recordBridge={metadata:recordMetadata(r.source_context,r.composition.rows)};
  const withFx=await f.create().readEvidence();
  // Missing Campaign names stay missing; native default does not manufacture
  // hierarchy labels to force canonical acceptance.
  assert.equal(withFx.records.status,"blocked");
  assert.ok(withFx.records.decisions.some(d=>d.status!=="validated"));
  // Flow has a native parent name; Campaign reports do not promise one.
  // Exercise the complete Flow path without adding an unsupported grouping.
  for (const name of names) f.reports[`campaign:${name}`]=[];
  const complete=await f.create().readEvidence();
  assert.equal(complete.records.status,"validated",JSON.stringify({reason:complete.records.reason,composition:complete.composition.reason,decisions:complete.records.decisions}));
  for(const row of complete.records.rows) {
    assert.equal(row.provenance.source_confidence,"fallback");
    assert.equal(row.provenance.raw_reference.source_fact.source_execution.attribution_reference.account_settings_verified,false);
    assert.equal(row.provenance.raw_reference.source_fact.source_execution.attribution_reference.source,"official_documented_default");
  }
});
test("Klaviyo changed native account blocks before reports",async()=>{
  const f=fixture();f.config.nativeMetadata=true;delete f.config.klaviyoPd.compositionContexts;
  f.config.fetchFn=async()=>json({data:[{type:"account",id:"WRONG",attributes:{preferred_currency:"USD",timezone:"Europe/Istanbul"}}]});
  await assert.rejects(f.create().readEvidence());assert.equal(f.state.reserves,1);
});
