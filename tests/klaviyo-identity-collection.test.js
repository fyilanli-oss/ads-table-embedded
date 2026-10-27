import test from "node:test";
import assert from "node:assert/strict";
import {collectKlaviyoNativeIdentityEvidence, collectKlaviyoIdentityMessageEvidence,
  collectKlaviyoVerifiedProductCandidateEvidence} from "../app/lib/providers/klaviyo-identity-collection.server.js";
import {KLAVIYO_OAUTH_SCOPES} from "../app/lib/providers/klaviyo-api.server.js";
import {createQuotaManagedFetch, quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";

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
  f.hooks.fetch = (p, init) => {assert.equal(init.signal, control.signal); control.abort();};
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
  f.shopHooks.graphql = (query, options) => {assert.equal(options.signal, control.signal); control.abort();};
  await assert.rejects(f.run(), /ABORTED/); assert.equal(f.calls.length, 3);
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
