import test from "node:test";
import assert from "node:assert/strict";
import {collectKlaviyoNativeIdentityEvidence, collectKlaviyoIdentityMessageEvidence,
  collectKlaviyoVerifiedProductCandidateEvidence} from "../app/lib/providers/klaviyo-identity-collection.server.js";
import {KLAVIYO_OAUTH_SCOPES} from "../app/lib/providers/klaviyo-api.server.js";
import {createQuotaManagedFetch, quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createRefreshKlaviyoIdentityReader} from "../app/lib/refresh/quota-authority-binding.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {refreshQuotaWait} from "../app/lib/refresh/quota-work-wait.server.js";

const workspace = "11111111-1111-4111-8111-111111111111", connection = "22222222-2222-4222-8222-222222222222",
  credential = "33333333-3333-4333-8333-333333333333";
const metric = () => ({type: "metric", id: "metric1", attributes: {name: "Ordered Product", integration: {name: "Shopify"}}});
const event = (id = "event1") => ({type: "event", id, attributes: {datetime: "2026-10-01T12:00:00+03:00", uuid: "uuid1",
  event_properties: {ProductID: "123", "Variant ID": "456", Quantity: 2, "$value": "30.00", email: "private@example.com"}},
  relationships: {metric: {data: {type: "metric", id: "metric1"}}, attributions: {data: [{type: "attribution", id: "attribution1"}]},
    profile: {data: {type: "profile", id: "private-profile"}}}});
const attribution = () => ({type: "attribution", id: "attribution1", relationships: {
  "campaign-message": {data: {type: "campaign-message", id: "message1"}}, campaign: {data: {type: "campaign", id: "campaign1"}},
  profile: {data: {type: "profile", id: "private-profile"}}}});
function fixture() {
  const calls = [], queries = [], hooks = {}, state = {version: 2, account: "account1", now: new Date("2026-10-27T14:00:00.000Z")};
  const verified = {installationAuthority: {authority: "shopify_installation_verified", workspaceId: workspace, installGeneration: 3, status: "active"},
    identity: {session: {authority: "shopify_id_token_verified", shopDomain: "test.myshopify.com"},
      shop: {authority: "shopify_admin_verified", shopId: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"}},
    context: {admin: {graphql() {throw Error("Shopify must not be called");}}}};
  const database = {async query(sql, params) {
    queries.push({sql, params}); await hooks.query?.(sql);
    if (sql.includes("resolve_active_installation")) return {rows: [{workspace_id: workspace, install_generation: 3, installation_status: "active"}]};
    if (sql.includes("load_provider_connection_lifecycle_by_owner")) return {rows: [{connection_id: connection, connection_version: state.version,
      lifecycle_status: "connected", credential_id: credential}]};
    if (sql.includes("load_provider_account_authority")) return {rows: [{connection_id: connection, credential_id: credential,
      reporting_account_id: null, granted_scopes: [...KLAVIYO_OAUTH_SCOPES], accounts: [{id: state.account, kind: "account",
        status: "active", reporting_eligible: true}]}]};
    throw Error("unexpected SQL");
  }};
  const token = {access_token: "secret-access", refresh_token: "secret-refresh", scopes: [...KLAVIYO_OAUTH_SCOPES],
    expires_at: "2026-10-27T15:00:00.000Z", scope_source: "retained_previous_grant", scope_observed_at: null};
  const tokenVault = {async loadProviderTokenSet() {return token;}};
  const fetchFn = async (endpoint, init) => {
    const parsed = new URL(endpoint); calls.push({endpoint, parsed, init});
    const custom = await hooks.fetch?.(parsed, init, calls.length); if (custom) return custom;
    if (parsed.pathname === "/api/accounts/") return response({data: [{type: "account", id: "account1",
      attributes: {preferred_currency: "TRY", timezone: "Europe/Istanbul", contact_information: {organization_name: "private account"}}}]});
    if (parsed.pathname === "/api/metrics") return response({data: [metric()], links: {next: null}});
    if (parsed.pathname === "/api/events") return response({data: [event()], included: [metric(), attribution(), {type: "profile", id: "private-profile"}], links: {next: null}});
    throw Error("unexpected request");
  };
  const options = {verified, database, tokenVault, fetchFn, now: () => state.now, businessDate: "2026-10-01"};
  return {calls, queries, hooks, state, token, options, run: () => collectKlaviyoNativeIdentityEvidence(options)};
}
function response(body, status = 200) {return {ok: status === 200, status, headers: {get: () => "request1"}, json: async () => body};}

test("real SQL/vault loader composes native account, selected metric and sparse event collection", async () => {
  const f = fixture(), r = await f.run();
  assert.equal(f.calls.length, 4); assert.equal(r.events[0].relationships.metric.data.id, r.metric.id);
  assert.equal(r.events[0].attributes.event_properties.Quantity, 2);
  assert.equal(r.events[0].attributes.event_properties.$value, "30.00");
  assert.equal(r.attributions[0].relationships["campaign-message"].data.id, "message1");
  assert.equal(r.account.timezone, "Europe/Istanbul"); assert.equal(r.timeframe.start, "2026-10-01T00:00:00+03:00");
  assert.equal(r.canonical_scope_ready, false); assert.equal(r.installation_id, null);
  assert.equal(r.persistable, false); assert.equal(r.mapping_write_performed, false); assert.equal(r.sales_roles_changed, false);
  assert.equal(r.Shopify_store_integration_binding_verified, false); assert.ok(Object.isFrozen(r.events[0].attributes));
  assert.ok(f.queries.every(q => q.sql.startsWith("select *")));
  assert.ok(f.calls.every(c => c.init.redirect === "error" && c.init.headers.authorization === "Bearer secret-access"));
  const request = f.calls.find(c => c.parsed.pathname === "/api/events").parsed;
  assert.equal(request.searchParams.get("include"), "attributions,metric"); assert.equal(request.searchParams.get("page[size]"), "200");
  assert.ok(request.searchParams.get("filter").includes("metric1"));
  assert.ok(!/private@|private-profile|private account|secret-access|secret-refresh|credentialId/.test(JSON.stringify(r)));
});
test("empty event day returns observed collection with no invented event/attribution", async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname === "/api/events" && response({data: [], links: {next: null}});
  const r = await f.run(); assert.deepEqual(r.events, []); assert.deepEqual(r.attributions, []);
});
test("pagination rebuilds fixed endpoint, preserves filter and follows empty intermediate pages", async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname === "/api/events" && !p.searchParams.has("page[cursor]")
    && response({data: [], links: {next: "https://a.klaviyo.com/api/events?page[cursor]=second&filter=untrusted&access_token=never-follow"}});
  const r = await f.run(); assert.equal(r.events.length, 1); assert.equal(r.evidence.event_pages, 2);
  const next = f.calls.filter(c => c.parsed.pathname === "/api/events")[1].parsed;
  assert.equal(next.searchParams.get("page[cursor]"), "second"); assert.ok(next.searchParams.get("filter").includes("metric1"));
  assert.equal(next.searchParams.has("access_token"), false);
});
test("identical replayed events deduplicate only once", async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname === "/api/events" && response({data: [event(), event()], included: [attribution()], links: {next: null}});
  assert.equal((await f.run()).events.length, 1);
});
for (const [name, mutate, code] of [
  ["missing event metric", e => {delete e.relationships.metric;}, "EVENT_METRIC_MISMATCH"],
  ["other event metric", e => {e.relationships.metric.data.id = "different";}, "EVENT_METRIC_MISMATCH"],
  ["out of day event", e => {e.attributes.datetime = "2026-09-30T12:00:00Z";}, "EVENT_DATE_MISMATCH"],
  ["nested property", e => {e.attributes.event_properties.ProductID = {email: "private"};}, "EVENT_PROPERTY_INVALID"],
  ["malformed attribution reference", e => {e.relationships.attributions.data[0].type = "profile";}, "ATTRIBUTION_INVALID"],
]) test(`${name} rejects entire collection without next provider call`, async () => {
  const f = fixture(), e = event(); mutate(e); f.hooks.fetch = p => p.pathname === "/api/events" && response({data: [e], links: {next: null}});
  await assert.rejects(f.run(), new RegExp(code)); assert.equal(f.calls.length, 3);
});
test("conflicting event replay rejects collection", async () => {
  const f = fixture(), e = event(); e.attributes.event_properties.Quantity = 5;
  f.hooks.fetch = p => p.pathname === "/api/events" && response({data: [event(), e], links: {next: null}});
  await assert.rejects(f.run(), /EVENT_CONFLICT/);
});
test("included metric conflict never overwrites discovered metric", async () => {
  const f = fixture(), m = metric(); m.attributes.name = "Other";
  f.hooks.fetch = p => p.pathname === "/api/events" && response({data: [event()], included: [m, attribution()], links: {next: null}});
  await assert.rejects(f.run(), /METRIC_CONFLICT/);
});
test("missing included attribution never becomes a message guess", async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname === "/api/events" && response({data: [event()], links: {next: null}});
  await assert.rejects(f.run(), /ATTRIBUTION_MISSING/);
});
for (const [name, metrics] of [["no native metric", []], ["custom same-name metric", [{...metric(), attributes: {name: "Ordered Product", integration: {name: "Custom"}}}]],
  ["ambiguous metrics", [metric(), {...metric(), id: "metric2"}]]]) test(name, async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname === "/api/metrics" && response({data: metrics, links: {next: null}});
  await assert.rejects(f.run(), /AMBIGUOUS_OR_MISSING/); assert.equal(f.calls.length, 2);
});
test("native credential account must equal persisted selected account", async () => {
  const f = fixture(); f.state.account = "other"; await assert.rejects(f.run(), /ACCOUNT_MISMATCH/); assert.equal(f.calls.length, 1);
});
test("account timezone/currency change discards source collection", async () => {
  const f = fixture(); f.hooks.fetch = (p, init, n) => p.pathname === "/api/accounts/" && n > 1 && response({data: [{type: "account", id: "account1",
    attributes: {preferred_currency: "USD", timezone: "UTC"}}]});
  await assert.rejects(f.run(), /ACCOUNT_CHANGED/);
});
test("credential rotation after metrics prevents events request", async () => {
  const f = fixture(); f.hooks.fetch = p => {if (p.pathname === "/api/metrics") f.state.version++;};
  await assert.rejects(f.run(), /COLLECTION_FAILED/); assert.equal(f.calls.length, 2);
});
for (const status of [401, 403, 429, 500]) test(`first native ${status} stops, no retry or lifecycle mutation`, async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname === "/api/metrics" && response({errors: [{detail: "secret-native"}]}, status);
  await assert.rejects(f.run(), /HTTP_FAILED/); assert.equal(f.calls.length, 2); assert.ok(f.queries.every(q => q.sql.startsWith("select *")));
});
test("transport errors cannot expose native/credential data", async () => {
  const f = fixture(); f.hooks.fetch = () => {throw Error("secret-access-native-body");};
  await assert.rejects(f.run(), e => e.message === "KLAVIYO_IDENTITY_COLLECTION_FAILED"); assert.equal(f.calls.length, 1);
});
for (const next of ["https://evil.example/api/events?page[cursor]=bad", "https://a.klaviyo.com/api/other?page[cursor]=bad", "https://a.klaviyo.com/api/events"]) {
  test("untrusted pagination destination or missing cursor rejected", async () => {
    const f = fixture(); f.hooks.fetch = p => p.pathname === "/api/events" && response({data: [], links: {next}});
    await assert.rejects(f.run(), /PAGINATION_INVALID/); assert.equal(f.calls.length, 3);
  });
}
test("cursor loop stops without partial output", async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname === "/api/events" && response({data: [], links: {next: "https://a.klaviyo.com/api/events?page[cursor]=repeat"}});
  await assert.rejects(f.run(), /CURSOR_REPEATED/); assert.equal(f.calls.length, 4);
});
test("event raw row bound counts replays", async () => {
  const f = fixture(); f.options.maxEvents = 1; f.hooks.fetch = p => p.pathname === "/api/events" && response({data: [event(), event()], links: {next: null}});
  await assert.rejects(f.run(), /ROW_LIMIT/);
});
test("invalid date rejected before SQL or provider call", async () => {
  const f = fixture(); f.options.businessDate = "2026-02-30"; await assert.rejects(f.run()); assert.equal(f.queries.length, 0); assert.equal(f.calls.length, 0);
});
test("abort during native response prevents next request", async () => {
  const f = fixture(), control = new AbortController(); f.options.signal = control.signal;
  f.hooks.fetch = (p, init) => {assert.ok(init.signal instanceof AbortSignal); control.abort(); assert.equal(init.signal.aborted, true);};
  await assert.rejects(f.run(), /ABORTED/); assert.equal(f.calls.length, 1);
});
test("observation window is checked between native calls", async () => {
  const f = fixture(); f.hooks.fetch = p => {if (p.pathname === "/api/metrics") f.state.now = new Date(f.state.now.valueOf() + 121000);};
  await assert.rejects(f.run(), /OBSERVATION_STALE/); assert.equal(f.calls.length, 2);
});
test("token approaching expiry stops before events, without refresh", async () => {
  const f = fixture(); f.token.expires_at = "2026-10-27T14:02:00.000Z";
  f.hooks.fetch = p => {if (p.pathname === "/api/metrics") f.state.now = new Date("2026-10-27T14:01:30.000Z");};
  await assert.rejects(f.run(), /COLLECTION_FAILED/); assert.equal(f.calls.length, 2);
});
test("200 plus native errors never accepted even on account discovery", async () => {
  const f = fixture(); f.hooks.fetch = () => response({data: [], errors: [{detail: "secret"}]});
  await assert.rejects(f.run(), e => !e.message.includes("secret")); assert.equal(f.calls.length, 1);
});
test("invalid JSON stops before next family", async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname === "/api/metrics" && {ok: true, json: async () => {throw Error("secret");}};
  await assert.rejects(f.run()); assert.equal(f.calls.length, 2);
});
test("page limit rejects continuation without fetching beyond bound", async () => {
  const f = fixture(); f.options.maxPages = 1;
  f.hooks.fetch = p => p.pathname === "/api/events" && response({data: [], links: {next: "https://a.klaviyo.com/api/events?page[cursor]=second"}});
  await assert.rejects(f.run(), /PAGE_LIMIT/); assert.equal(f.calls.length, 3);
});
test("included resource bound counts ignored profiles too", async () => {
  const f = fixture(); f.options.maxIncluded = 1;
  await assert.rejects(f.run(), /ROW_LIMIT/); assert.equal(f.calls.length, 3);
});
test("absence of pagination completion marker is not completion", async () => {
  const f = fixture(); f.hooks.fetch = p => p.pathname === "/api/events" && response({data: []});
  await assert.rejects(f.run(), /PAGINATION_INVALID/);
});
test("duplicate included attribution conflict rejects all events", async () => {
  const f = fixture(), other = attribution(); other.relationships.campaign.data.id = "other";
  f.hooks.fetch = p => p.pathname === "/api/events" && response({data: [event()], included: [attribution(), other], links: {next: null}});
  await assert.rejects(f.run(), /ATTRIBUTION_CONFLICT/);
});

function messageRow(kind, medium = "email", name = "Message name") {
  return {groupings: {[`${kind}_id`]: `${kind}1`, [`${kind}_message_id`]: kind === "campaign" ? "message1" : "flow-message1",
    [`${kind}_message_name`]: name, ...(kind === "flow" ? {flow_name: "Flow name"} : {}),
    send_channel: medium, variation: null, variation_name: null}, statistics: {conversions: 999, conversion_value: 99999}};
}
function messageFixture() {
  const f = fixture(), rows = {campaign: [messageRow("campaign")], flow: [messageRow("flow")]};
  const baseFetch = p => {
    if (p.pathname === "/api/metrics") return response({data: [metric(), {type: "metric", id: "placed1", attributes: {name: "Placed Order", integration: {name: "Shopify"}}}], links: {next: null}});
    for (const kind of ["campaign", "flow"]) if (p.pathname === `/api/${kind}-values-reports`) return response({data: {
      type: `${kind}-values-report`, attributes: {results: rows[kind]}}, links: {next: null}});
  };
  f.hooks.fetch = baseFetch;
  return {...f, rows, baseFetch, run: () => collectKlaviyoIdentityMessageEvidence(f.options)};
}
test("Message composition: same execution joins native event to Campaign Message without using report sales", async () => {
  const f = messageFixture(), r = await f.run(), sale = r.message_evidence.resolved_product_sales.rows[0];
  assert.equal(f.calls.length, 6); assert.equal(r.message_evidence.reporting_metric.id, "placed1");
  assert.equal(sale.provider_event_id, "event1"); assert.equal(sale.provider_metric_id, "metric1");
  assert.equal(sale.attribution_resolution.channel_id, "message1"); assert.equal(sale.attribution_resolution.source_entity_id, "campaign1");
  assert.equal(sale.attribution_resolution.sales_role, "Assisted"); assert.equal(sale.attribution_resolution.medium, "Email");
  assert.equal(sale.provider_product_properties.Quantity.value, 2); assert.equal(sale.provider_product_properties.$value.value, "30.00");
  assert.equal(r.message_evidence.reporting_statistics_used_as_product_sales, false);
  assert.equal(r.message_evidence.channels.campaign[0].statistics, undefined);
  assert.equal(sale.standardized_product_id, null); assert.equal(r.persistable, false); assert.equal(r.installation_id, null);
  assert.ok(!r.remaining.includes("Message_channel_join"));
  for (const c of f.calls.filter(c => c.init.method === "POST")) {
    const body = JSON.parse(c.init.body).data.attributes;
    assert.equal(body.conversion_metric_id, "placed1"); assert.equal(body.timeframe.start, r.timeframe.start);
    assert.ok(body.group_by.includes("send_channel")); assert.ok(body.group_by.includes("variation"));
  }
  assert.ok(!/99999|secret-access|private-profile|private@/.test(JSON.stringify(r)));
});
test("Message composition: Flow and variation native references resolve through existing classifier", async () => {
  const f = messageFixture(), a = {type: "attribution", id: "attribution1", relationships: {
    flow: {data: {type: "flow", id: "flow1"}}, "flow-message": {data: {type: "flow-message", id: "flow-message1"}},
    "flow-message-variation": {data: {type: "flow-message-variation", id: "variation1"}}}};
  f.rows.flow[0].groupings.variation = "variation1"; f.rows.flow[0].groupings.variation_name = "Variation name";
  f.hooks.fetch = p => p.pathname === "/api/events" ? response({data: [event()], included: [a], links: {next: null}}) : f.baseFetch(p);
  const sale = (await f.run()).message_evidence.resolved_product_sales.rows[0];
  assert.equal(sale.attribution_resolution.sales_role, "Triggered"); assert.equal(sale.attribution_resolution.channel_id, "flow-message1");
  assert.equal(sale.attribution_resolution.variation_id, "variation1");
});
test("Message composition: exact Message without observed report row keeps metadata unresolved", async () => {
  const f = messageFixture(); f.rows.campaign = []; const sale = (await f.run()).message_evidence.resolved_product_sales.rows[0];
  assert.equal(sale.attribution_resolution.channel_id, "message1"); assert.equal(sale.attribution_resolution.channel_name, null);
  assert.equal(sale.attribution_resolution.medium, null); assert.equal(sale.attribution_resolution.reason, "message_exact_catalog_not_observed");
});
test("Message composition: attribution absent remains Unclassified even when reports contain one Message", async () => {
  const f = messageFixture(), e = event(); delete e.relationships.attributions;
  f.hooks.fetch = p => p.pathname === "/api/events" ? response({data: [e], links: {next: null}}) : f.baseFetch(p);
  const sale = (await f.run()).message_evidence.resolved_product_sales.rows[0];
  assert.equal(sale.attribution_resolution.channel_id, null); assert.equal(sale.attribution_resolution.sales_role, "Unclassified");
});
test("Message composition: Campaign parent conflict remains Unclassified", async () => {
  const f = messageFixture(); f.rows.campaign[0].groupings.campaign_id = "other";
  const sale = (await f.run()).message_evidence.resolved_product_sales.rows[0];
  assert.equal(sale.attribution_resolution.sales_role, "Unclassified"); assert.equal(sale.attribution_resolution.reason, "message_parent_relationship_conflict");
});
test("Message composition: multiple attributed Messages never pick first", async () => {
  const f = messageFixture(), e = event(), a = attribution(); a.id = "attribution2"; a.relationships["campaign-message"].data.id = "message2";
  e.relationships.attributions.data.push({type: "attribution", id: "attribution2"});
  f.hooks.fetch = p => p.pathname === "/api/events" ? response({data: [e], included: [attribution(), a], links: {next: null}}) : f.baseFetch(p);
  const sale = (await f.run()).message_evidence.resolved_product_sales.rows[0]; assert.equal(sale.attribution_resolution.sales_role, "Unclassified");
});
test("Message composition: conflicting catalog names preserved, never silently replaced", async () => {
  const f = messageFixture(); f.rows.campaign.push(messageRow("campaign", "email", "Other name"));
  const sale = (await f.run()).message_evidence.resolved_product_sales.rows[0];
  assert.equal(sale.attribution_resolution.channel_name, null); assert.equal(sale.attribution_resolution.reason, "message_exact_catalog_metadata_conflict");
});
test("Message composition: ambiguous medium does not pick first", async () => {
  const f = messageFixture(); f.rows.campaign.push(messageRow("campaign", "sms"));
  const sale = (await f.run()).message_evidence.resolved_product_sales.rows[0]; assert.equal(sale.attribution_resolution.medium, null);
});
test("Message composition: identical catalog rows deduplicate without summing report conversions", async () => {
  const f = messageFixture(); f.rows.campaign.push(messageRow("campaign"));
  const r = await f.run(); assert.equal(r.message_evidence.channels.campaign.length, 1);
  assert.equal(r.message_evidence.resolved_product_sales.rows.length, 1);
});
test("Message composition: only event entry point cannot enable reports through caller option", async () => {
  const f = fixture(); f.options.withMessages = true; const r = await f.run();
  assert.equal(f.calls.length, 4); assert.equal(r.message_evidence, undefined);
});
test("Message composition: Message entry point cannot disable binding through caller option", async () => {
  const f = messageFixture(); f.options.withMessages = false; assert.ok((await f.run()).message_evidence);
});
test("Message composition: report pagination retains POST body and native conversion metric", async () => {
  const f = messageFixture(); f.hooks.fetch = p => p.pathname === "/api/campaign-values-reports" && !p.searchParams.has("page_cursor")
    ? response({data: {type: "campaign-values-report", attributes: {results: []}}, links: {next: "https://a.klaviyo.com/api/campaign-values-reports?page_cursor=second&conversion_metric_id=other"}})
    : f.baseFetch(p);
  const r = await f.run(); assert.equal(r.message_evidence.pages.campaign, 2);
  const requests = f.calls.filter(c => c.parsed.pathname === "/api/campaign-values-reports");
  assert.equal(requests[0].init.body, requests[1].init.body); assert.equal(requests[1].parsed.searchParams.get("page_cursor"), "second");
  assert.equal(requests[1].parsed.searchParams.has("conversion_metric_id"), false);
});
test("Message composition: missing Placed Order metric stops before events or report calls", async () => {
  const f = fixture(); await assert.rejects(collectKlaviyoIdentityMessageEvidence(f.options), /PLACED_ORDER_METRIC/); assert.equal(f.calls.length, 2);
});
test("Message composition: report response type mismatch rejects complete collection", async () => {
  const f = messageFixture(); f.hooks.fetch = p => p.pathname === "/api/campaign-values-reports"
    ? response({data: {type: "flow-values-report", attributes: {results: []}}, links: {next: null}}) : f.baseFetch(p);
  await assert.rejects(f.run(), /RESPONSE_INVALID/); assert.equal(f.calls.length, 4);
});
test("Message composition: first report error prevents Flow/account recheck with no partial output", async () => {
  const f = messageFixture(); f.hooks.fetch = p => p.pathname === "/api/campaign-values-reports" ? response({}, 429) : f.baseFetch(p);
  await assert.rejects(f.run(), /HTTP_FAILED/); assert.equal(f.calls.length, 4);
});
test("Message composition: authority change after Campaign prevents Flow request", async () => {
  const f = messageFixture(); f.hooks.fetch = p => {if (p.pathname === "/api/campaign-values-reports") f.state.version++; return f.baseFetch(p);};
  await assert.rejects(f.run(), /COLLECTION_FAILED/); assert.equal(f.calls.length, 4);
});
test("Message composition: raw report row limit includes identical replays", async () => {
  const f = messageFixture(); f.options.maxMessageRows = 1; f.rows.campaign.push(messageRow("campaign"));
  await assert.rejects(f.run(), /ROW_LIMIT/);
});
test("Message composition: report continuation without explicit completion is not empty catalog", async () => {
  const f = messageFixture(); f.hooks.fetch = p => p.pathname === "/api/campaign-values-reports"
    ? response({data: {type: "campaign-values-report", attributes: {results: []}}, links: {self: "ignored"}}) : f.baseFetch(p);
  await assert.rejects(f.run(), /PAGINATION_INVALID/);
});
test("Message composition: no observed events does not convert report conversions into sale rows", async () => {
  const f = messageFixture(); f.hooks.fetch = p => p.pathname === "/api/events" ? response({data: [], links: {next: null}}) : f.baseFetch(p);
  assert.deepEqual((await f.run()).message_evidence.resolved_product_sales.rows, []);
});

function candidateFixture() {
  const f = messageFixture(), shopCalls = [], shopHooks = {};
  f.options.verified.context.admin.graphql = async (query, options) => {
    shopCalls.push({query, options}); const custom = await shopHooks.graphql?.(query, options); if (custom) return custom;
    const p = options.variables.productId.split("/").at(-1), v = options.variables.variantId?.split("/").at(-1);
    return response({data: {shop: {id: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"},
      product: {id: `gid://shopify/Product/${p}`, legacyResourceId: p},
      ...(v ? {productVariant: {id: `gid://shopify/ProductVariant/${v}`, legacyResourceId: v,
        product: {id: `gid://shopify/Product/${p}`, legacyResourceId: p}}} : {})}});
  };
  return {...f, shopCalls, shopHooks, run: () => collectKlaviyoVerifiedProductCandidateEvidence(f.options)};
}
test("Shopify composition: native collection verifies parent and keeps evidence separate from canonical mapping", async () => {
  const f = candidateFixture(), r = await f.run(), candidates = r.product_identity_candidates;
  assert.equal(f.shopCalls.length, 1); assert.equal(f.shopCalls[0].options.tries, 1);
  assert.deepEqual(f.shopCalls[0].options.variables, {productId: "gid://shopify/Product/123", variantId: "gid://shopify/ProductVariant/456"});
  assert.equal(candidates.rows[0].product_identity_verification.state, "candidate_verified_in_shop");
  assert.equal(candidates.rows[0].standardized_product_id, null); assert.equal(candidates.mappings, undefined);
  assert.equal(candidates.candidates[0].shopify_product_id, "gid://shopify/Product/123");
  assert.equal(candidates.candidates[0].installation_id, undefined); assert.equal(r.installation_id, null);
  assert.equal(r.canonical_scope_ready, false); assert.equal(r.persistable, false); assert.equal(r.mapping_write_performed, false);
  const sale = r.message_evidence.resolved_product_sales.rows[0];
  assert.equal(sale.attribution_resolution.channel_id, "message1"); assert.equal(sale.attribution_resolution.sales_role, "Assisted");
  assert.equal(sale.product_identity_verification.shopify_variant_id, "gid://shopify/ProductVariant/456");
  assert.equal(sale.standardized_product_id, null); assert.equal(sale.provider_product_properties.$value.value, "30.00");
  assert.equal(r.Shopify_store_integration_binding_verified, false); assert.equal(candidates.provider_link_verified, false);
});
test("Shopify composition: repeated products verify once and retain every native event ID", async () => {
  const f = candidateFixture(); f.hooks.fetch = p => p.pathname === "/api/events"
    ? response({data: [event(), event("event2")], included: [attribution()], links: {next: null}}) : f.baseFetch(p);
  const r = await f.run(); assert.equal(f.shopCalls.length, 1);
  assert.deepEqual(r.product_identity_candidates.candidates[0].candidate_evidence.source_event_ids, ["event1", "event2"]);
  assert.equal(r.message_evidence.resolved_product_sales.rows.length, 2);
});
test("Shopify composition: product-only event never invents variant query", async () => {
  const f = candidateFixture(), e = event(); delete e.attributes.event_properties["Variant ID"];
  f.hooks.fetch = p => p.pathname === "/api/events" ? response({data: [e], included: [attribution()], links: {next: null}}) : f.baseFetch(p);
  const r = await f.run(); assert.equal(f.shopCalls[0].options.variables.variantId, undefined);
  assert.equal(r.product_identity_candidates.candidates[0].shopify_variant_id, null);
});
test("Shopify composition: ambiguous legacy-only variant does not query or create candidate", async () => {
  const f = candidateFixture(), e = event(); e.attributes.event_properties.VariantID = "456"; delete e.attributes.event_properties["Variant ID"];
  f.hooks.fetch = p => p.pathname === "/api/events" ? response({data: [e], included: [attribution()], links: {next: null}}) : f.baseFetch(p);
  const r = await f.run(); assert.equal(f.shopCalls.length, 0); assert.deepEqual(r.product_identity_candidates.candidates, []);
  assert.match(r.product_identity_candidates.rows[0].product_identity_verification.reason, /requires_source_evidence/);
});
test("Shopify composition: missing product and wrong parent stay distinct", async () => {
  for (const wrongParent of [false, true]) {
    const f = candidateFixture(); f.shopHooks.graphql = () => response({data: {shop: {id: "gid://shopify/Shop/12", myshopifyDomain: "test.myshopify.com"},
      product: wrongParent ? {id: "gid://shopify/Product/123", legacyResourceId: "123"} : null,
      productVariant: wrongParent ? {id: "gid://shopify/ProductVariant/456", legacyResourceId: "456", product: {id: "gid://shopify/Product/789", legacyResourceId: "789"}} : null}});
    const r = await f.run(), resolution = r.product_identity_candidates.rows[0].product_identity_verification;
    assert.equal(resolution.state, wrongParent ? "conflicting" : "unresolved"); assert.deepEqual(r.product_identity_candidates.candidates, []);
    assert.equal(r.message_evidence.resolved_product_sales.rows[0].attribution_resolution.channel_id, "message1");
  }
});
test("Shopify composition: first Admin failure prevents reporting or another product check", async () => {
  const f = candidateFixture(); f.shopHooks.graphql = () => {throw Error("secret-native-admin-token");};
  await assert.rejects(f.run(), e => e.message === "KLAVIYO_IDENTITY_COLLECTION_FAILED");
  assert.equal(f.shopCalls.length, 1); assert.equal(f.calls.length, 3);
});
test("Shopify composition: authority changes during native Admin response discard everything", async () => {
  const f = candidateFixture(); f.shopHooks.graphql = () => {f.state.version++;};
  await assert.rejects(f.run(), /COLLECTION_FAILED/); assert.equal(f.shopCalls.length, 1); assert.equal(f.calls.length, 3);
});
test("Shopify composition: authority changes after event read prevent first Admin query", async () => {
  const f = candidateFixture(); f.hooks.fetch = p => {
    if (p.pathname === "/api/events") f.state.version++; return f.baseFetch(p);
  };
  await assert.rejects(f.run(), /COLLECTION_FAILED/); assert.equal(f.shopCalls.length, 0);
});
test("Shopify composition: foreign shop native response is rejected", async () => {
  const f = candidateFixture(); f.shopHooks.graphql = () => response({data: {shop: {id: "gid://shopify/Shop/99", myshopifyDomain: "other.myshopify.com"},
    product: null, productVariant: null}});
  await assert.rejects(f.run(), /COLLECTION_FAILED/); assert.equal(f.calls.length, 3);
});
test("Shopify composition: abort signal reaches Admin query and prevents reporting", async () => {
  const f = candidateFixture(), control = new AbortController(); f.options.signal = control.signal;
  f.shopHooks.graphql = (query, options) => {assert.ok(options.signal instanceof AbortSignal); control.abort(); assert.equal(options.signal.aborted, true);};
  await assert.rejects(f.run(), /ABORTED/); assert.equal(f.calls.length, 3);
});

test("deadline: stalled account fetch or JSON is bounded with cancellation signal", async () => {
  for (const mode of ["fetch", "body"]) {
    const f = fixture(); f.options.maxElapsedMs = 30; let signal;
    f.hooks.fetch = (p, init) => {signal = init.signal;
      return mode === "fetch" ? new Promise(() => {}) : {...response({}), json: () => new Promise(() => {})};};
    await assert.rejects(f.run(), /IDENTITY_READ_DEADLINE_EXCEEDED/); assert.equal(signal.aborted, true); assert.equal(f.calls.length, 1);
  }
});
test("deadline: stalled Shopify body cannot proceed to Message reports or final account", async () => {
  const f = candidateFixture(); f.options.maxElapsedMs = 100; let signal;
  f.shopHooks.graphql = (q, o) => {signal = o.signal; return {...response({}), json: () => new Promise(() => {})};};
  await assert.rejects(f.run(), /DEADLINE_EXCEEDED/); assert.equal(signal.aborted, true); assert.equal(f.shopCalls.length, 1);
  assert.equal(f.calls.filter(c => c.parsed.pathname === "/api/accounts/").length, 1);
});
test("deadline: pending vault cannot start provider request after late resolution", async () => {
  const f = fixture(); f.options.maxElapsedMs = 20; let resume;
  f.options.tokenVault.loadProviderTokenSet = () => new Promise(resolve => {resume = resolve;});
  await assert.rejects(f.run(), /DEADLINE_EXCEEDED/); const count = f.queries.length;
  resume(f.token); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(f.calls.length, 0); assert.equal(f.queries.length, count);
});
test("deadline: caller abort before collection reads no SQL or Klaviyo", async () => {
  const f = fixture(), caller = new AbortController(); caller.abort(); f.options.signal = caller.signal;
  await assert.rejects(f.run(), /IDENTITY_READ_ABORTED/); assert.equal(f.queries.length, 0); assert.equal(f.calls.length, 0);
});
test("Shopify composition: native/Admin helpers captured before asynchronous collection", async () => {
  const f = candidateFixture(); f.hooks.fetch = p => {
    f.options.verified.context.admin.graphql = () => {throw Error("replaced after capture");}; return f.baseFetch(p);
  };
  assert.equal((await f.run()).product_identity_candidates.candidates.length, 1);
});
test("Shopify composition: empty native events produce no invented Shopify query or candidates", async () => {
  const f = candidateFixture(); f.hooks.fetch = p => p.pathname === "/api/events" ? response({data: [], links: {next: null}}) : f.baseFetch(p);
  const r = await f.run(); assert.equal(f.shopCalls.length, 0); assert.deepEqual(r.product_identity_candidates.candidates, []);
});
test("Shopify composition: caller options cannot enable Admin in existing entry points", async () => {
  const f = messageFixture(); f.options.withShopify = true; await f.run();
  const g = fixture(); g.options.withShopify = true; await g.run();
});
test("Shopify composition: new entry point cannot disable Admin or Message checks", async () => {
  const f = candidateFixture(); f.options.withShopify = false; f.options.withMessages = false;
  const r = await f.run(); assert.equal(f.shopCalls.length, 1); assert.ok(r.message_evidence);
});
test("Shopify composition: authentic local quota control survives verifier error sanitization", async () => {
  const managed = createQuotaManagedFetch({provider: "klaviyo", guard: {execute: async () => ({status: "waiting"})},
    resolveOperation: async () => "a".repeat(64), lane: "background", fetchFn: async () => {throw Error("must not send");}});
  let control; try {await managed("https://a.klaviyo.com/api/metrics");} catch (error) {control = error;}
  assert.equal(quotaBoundaryControl(control).status, "waiting");
  const f = candidateFixture(); f.shopHooks.graphql = () => {throw control;};
  await assert.rejects(f.run(), error => error === control); assert.equal(f.calls.length, 3);
});

function boundFixture(mode = "native") {
  const f = mode === "message" ? messageFixture() : fixture(), native = f.options.fetchFn;
  const q = {}, loads = [], reservations = [], settles = [], stops = [], feedback = [];
  const c = {provider: "klaviyo", clientScopeKey: "a".repeat(64), connectionScopeKey: "b".repeat(64), connectionEpoch: 1,
    accountId: "account1", organizationId: null, apiVersion: "2026-10-15"};
  const keys = new Map(["account_discovery", "metrics", "events", "campaign_values", "flow_values"].map(family => [family,
    quotaRouteIdentity(c, {provider: "klaviyo", family, accountId: null, organizationId: null, version: c.apiVersion,
      includes: family === "events" ? ["attributions", "metric"] : []}).routeKey]));
  const config = {verified: f.options.verified, database: f.options.database, tokenVault: f.options.tokenVault, mode,
    readNow: () => f.state.now, now: Date.now,
    claim: {workspaceId: workspace, installGeneration: "3", provider: "klaviyo", accountId: "account1", id: "job1", fence: 2},
    window: {from: "2026-10-01", to: "2026-10-01"}, entitlementReceipt: {observedAt: f.state.now.toISOString()},
    workStore: {loadQuotaContext: async input => {
      loads.push(input); await q.load?.();
      if (q.lost || f.state.version !== 2 || f.state.account !== "account1") return null;
      return c;
    }},
    quotaStore: {resolveRoute: async x => [...keys.values()].includes(x.routeKey) && x.routeKey !== keys.get(q.missingFamily) ? x.routeKey : null,
      reserve: async x => {reservations.push(x); if (reservations.length === q.waitAt) return {status: "waiting"};
        const permit = {...x, status: "reserved", dispatchBeforeMs: Date.now() + 10000, dispatchBudgetMs: 10000};
        q.reserved?.(); return permit;}, settle: async x => {settles.push(x); return true;}, stop: async x => {stops.push(x); return true;},
      recordFeedback: async x => {feedback.push(x); return true;}},
    fetchFn: async (...args) => {const r = await native(...args); return new Response(JSON.stringify(await r.json()),
      {status: r.status, headers: {"content-type": "application/json"}});}};
  return {...f, config, c, q, loads, reservations, settles, stops, feedback, create: () => createRefreshKlaviyoIdentityReader(config)};
}
test("bound constructor: native mode uses concrete SQL/vault plus fenced work/entitlement quota on every HTTP", async () => {
  const f = boundFixture(), r = await f.create().readEvidence();
  assert.equal(f.calls.length, 4); assert.equal(f.reservations.length, 4); assert.equal(f.settles.length, 4); assert.equal(f.loads.length, 8);
  assert.ok(f.loads.every(x => x.provider === "klaviyo" && x.claim.id === "job1" && x.claim.fence === 2
    && x.claim.accountId === "account1" && x.window.from === "2026-10-01" && x.entitlementReceipt.observedAt === f.state.now.toISOString()));
  assert.equal(r.persistable, false); assert.equal(r.installation_id, null); assert.equal(r.message_evidence, undefined);
  assert.equal(r.product_identity_candidates, undefined); assert.equal(r.events.length, 1);
  assert.doesNotMatch(JSON.stringify([f.reservations, f.feedback]), /secret-access|secret-refresh|private@|ProductID|event1/);
});
test("bound constructor: Message mode meters six reads without Shopify Admin or changing existing roles", async () => {
  const f = boundFixture("message"), r = await f.create().readEvidence();
  assert.equal(f.calls.length, 6); assert.equal(f.reservations.length, 6); assert.equal(f.loads.length, 12);
  assert.equal(r.product_identity_candidates, undefined);
  assert.equal(r.message_evidence.resolved_product_sales.rows[0].attribution_resolution.sales_role, "Assisted");
  assert.equal(r.message_evidence.reporting_statistics_used_as_product_sales, false);
});
test("bound constructor: inputs captured before later caller mutations cannot retarget owner/day/job", async () => {
  const f = boundFixture(), reader = f.create(); f.config.claim.accountId = "other"; f.config.claim.fence = 9;
  f.config.window.from = "2026-10-02"; f.config.verified.identity.shop.shopId = "gid://shopify/Shop/99";
  f.config.entitlementReceipt.observedAt = "2000-01-01T00:00:00Z";
  const r = await reader.readEvidence(); assert.equal(r.shop.shopId, "gid://shopify/Shop/12");
  assert.ok(f.loads.every(x => x.claim.accountId === "account1" && x.claim.fence === 2 && x.window.from === "2026-10-01"));
});
for (const [name, change] of [["provider", f => {f.config.claim.provider = "meta";}],
  ["workspace", f => {f.config.claim.workspaceId = connection;}], ["generation", f => {f.config.claim.installGeneration = "4";}],
  ["missing fence", f => {delete f.config.claim.fence;}], ["multi-day window", f => {f.config.window.to = "2026-10-02";}],
  ["invalid date", f => {f.config.window.from = "2026-02-30"; f.config.window.to = f.config.window.from;}],
  ["Shopify mode", f => {f.config.mode = "shopify";}], ["missing receipt", f => {delete f.config.entitlementReceipt;}],
  ["inactive owner", f => {f.config.verified.installationAuthority.status = "inactive";}],
  ["arbitrary resolver", f => {f.config.resolveOperation = () => "a".repeat(64);}],
  ["arbitrary guard", f => {f.config.guard = {};}], ["arbitrary scope loader", f => {f.config.loadContext = () => f.c;}],
  ["double-debit callback", f => {f.config.authorizeRead = () => true;}],
]) test(`bound constructor: ${name} rejected before SQL or HTTP`, () => {
  const f = boundFixture(); change(f); assert.throws(f.create); assert.equal(f.queries.length, 0); assert.equal(f.calls.length, 0);
});
test("bound constructor: read method cannot override mode, fetch or date; one execution cannot replay", async () => {
  const f = boundFixture(), reader = f.create();
  await assert.rejects(reader.readEvidence({mode: "shopify", fetchFn: () => {throw Error("bypass");}}), /OVERRIDE_FORBIDDEN/);
  await reader.readEvidence(); await assert.rejects(reader.readEvidence(), /EXECUTION_USED/); assert.equal(f.calls.length, 4);
});
for (const [name, change] of [["lost work or entitlement", f => {f.q.lost = true;}],
  ["wrong account context", f => {f.c.accountId = "account2";}], ["wrong API revision", f => {f.c.apiVersion = "2026-07-15";}],
  ["missing owner profile", f => {f.q.missingFamily = "account_discovery";}]]) test(`bound constructor: ${name} prevents first HTTP`, async () => {
  const f = boundFixture(); change(f); await assert.rejects(f.create().readEvidence()); assert.equal(f.calls.length, 0); assert.equal(f.reservations.length, 0);
});
test("bound constructor: authority or scope drift during reservation settles without HTTP", async () => {
  for (const change of [f => {f.state.version++;}, f => {f.c.connectionEpoch++;}, f => {f.q.lost = true;}]) {
    const f = boundFixture(); f.q.reserved = () => {change(f);};
    await assert.rejects(f.create().readEvidence(), e => quotaBoundaryControl(e)?.status === "not_sent");
    assert.equal(f.calls.length, 0); assert.equal(f.reservations.length, 1); assert.equal(f.settles.length, 1); assert.equal(f.stops.length, 0);
  }
});
test("bound constructor: missing Campaign report profile stops after prior observations without return or replay", async () => {
  const f = boundFixture("message"); f.q.missingFamily = "campaign_values"; const reader = f.create();
  await assert.rejects(reader.readEvidence(), e => quotaBoundaryControl(e)?.status === "not_configured");
  assert.equal(f.calls.length, 3); await assert.rejects(reader.readEvidence(), /EXECUTION_USED/); assert.equal(f.calls.length, 3);
});
test("bound constructor: first-boundary quota wait remains genuine work-wait evidence", async () => {
  const f = boundFixture(); f.q.waitAt = 1; let error;
  try {await f.create().readEvidence();} catch (e) {error = e;}
  assert.equal(quotaBoundaryControl(error)?.status, "waiting"); assert.equal(f.calls.length, 0);
  assert.equal(refreshQuotaWait(error, "provider_page", f.config.claim)?.status, "quota_waiting");
});
test("bound constructor: mid-collection wait keeps prior attempts and cannot authorize whole-job replay", async () => {
  const f = boundFixture("message"); f.q.waitAt = 4; let error;
  try {await f.create().readEvidence();} catch (e) {error = e;}
  assert.equal(quotaBoundaryControl(error)?.priorBoundaryAttempts, 3); assert.equal(f.calls.length, 3);
  assert.equal(refreshQuotaWait(error, "provider_page", f.config.claim), null);
});
test("bound constructor: each native event page is separately metered", async () => {
  const f = boundFixture(); f.hooks.fetch = p => p.pathname === "/api/events" && !p.searchParams.has("page[cursor]")
    && response({data: [], links: {next: "https://a.klaviyo.com/api/events?page[cursor]=next"}});
  assert.equal((await f.create().readEvidence()).evidence.event_pages, 2); assert.equal(f.calls.length, 5); assert.equal(f.reservations.length, 5);
});
test("bound constructor: first HTTP failure is one persisted stop and no refresh/next family", async () => {
  const f = boundFixture(); f.hooks.fetch = () => response({errors: [{detail: "SECRET"}]}, 403);
  await assert.rejects(f.create().readEvidence()); assert.equal(f.calls.length, 1); assert.equal(f.stops.length, 1);
  assert.doesNotMatch(JSON.stringify(f.stops), /SECRET/);
});
test("bound constructor: deadline during initial scope lookup cannot reserve or dispatch after late return", async () => {
  const f = boundFixture(); f.config.maxElapsedMs = 40; let release;
  f.q.load = () => new Promise(resolve => {release = resolve;});
  const reader = f.create(); await assert.rejects(reader.readEvidence(), /DEADLINE_EXCEEDED/);
  delete f.q.load; release(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.calls.length, 0); assert.equal(f.reservations.length, 0); assert.equal(f.stops.length, 0);
});
test("bound constructor: pre-aborted caller does not read runtime or quota SQL", async () => {
  const f = boundFixture(), caller = new AbortController(); caller.abort(); f.config.signal = caller.signal;
  await assert.rejects(f.create().readEvidence(), /IDENTITY_READ_ABORTED/); assert.equal(f.loads.length, 0); assert.equal(f.queries.length, 0);
});
