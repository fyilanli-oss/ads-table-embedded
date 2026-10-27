import test from "node:test";
import assert from "node:assert/strict";
import {collectKlaviyoNativeIdentityEvidence} from "../app/lib/providers/klaviyo-identity-collection.server.js";
import {KLAVIYO_OAUTH_SCOPES} from "../app/lib/providers/klaviyo-api.server.js";

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
