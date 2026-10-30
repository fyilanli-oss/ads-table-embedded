import test from "node:test";
import assert from "node:assert/strict";
import {buildKlaviyoAttributedEventRequest, readKlaviyoAttributedInteractions as read} from "../app/lib/providers/klaviyo-attributed-interaction.server.js";
import {attachAttributionEvidence} from "../app/lib/providers/klaviyo-reporting-authority.server.js";
import {createQuotaManagedFetch, quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";

function fixture() {
  const events = [{type: "event", id: "sale1", attributes: {datetime: "2026-10-01T12:00:00Z", event_properties: {Quantity: 1}},
    relationships: {attributions: {data: [{type: "attribution", id: "attr1"}]}}}];
  const attributions = [{type: "attribution", id: "attr1", relationships: {event: {data: {type: "event", id: "sale1"}},
    "attributed-event": {data: {type: "event", id: "click1"}}}}];
  const body = {data: {type: "event", id: "click1", attributes: {datetime: "2026-10-01T11:00:00Z", timestamp: 1759316400,
    event_properties: {ProductID: "not-proof", email: "private@example.com"}},
    relationships: {metric: {data: {type: "metric", id: "metric1"}}, profile: {data: {type: "profile", id: "private"}}}},
    included: [{type: "metric", id: "metric1", attributes: {name: "Clicked Email", integration: {name: "Klaviyo", private: "private"}}},
      {type: "profile", id: "private", attributes: {email: "private@example.com"}}]};
  // All data in these tests is synthetic; timestamps are exact native seconds.
  body.data.attributes.timestamp = Date.parse(body.data.attributes.datetime) / 1000;
  const calls = [];
  const input = {events, attributions, check() {}, fetchEvent: async eventId => {calls.push(eventId); return structuredClone(body);}};
  return {events, attributions, body, calls, input, run: () => read(input)};
}

test("exact event request carries only minimal documented fields and existing scope", () => {
  const r = buildKlaviyoAttributedEventRequest({eventId: "click1", accessToken: "synthetic"}), address = new URL(r.url);
  assert.equal(address.pathname, "/api/events/click1"); assert.equal(r.method, "GET");
  assert.equal(address.searchParams.get("include"), "metric");
  assert.equal(address.searchParams.get("fields[event]"), "id,datetime,timestamp");
  assert.equal(address.searchParams.get("fields[metric]"), "id,name,integration");
  assert.equal(r.headers.revision, "2026-10-15");
  assert.doesNotMatch(r.url, /profile|event_properties|ProductID|filter/);
});
for (const eventId of ["", "..", "a/b", "a?include=profile", "a%2Fb", "a b", null]) test(`rejects unsafe event path ${eventId}`, () => {
  assert.throws(() => buildKlaviyoAttributedEventRequest({eventId, accessToken: "synthetic"}));
});
test("linked native reference retains event/metric/time, discards profile/properties, and never makes a role", async () => {
  const f = fixture(), before = structuredClone(f.events), r = await f.run();
  assert.equal(r.links[0].status, "linked"); assert.equal(r.links[0].interaction_kind, "click");
  assert.equal(r.events[0].metric_name, "Clicked Email"); assert.deepEqual(f.calls, ["click1"]);
  assert.equal(r.clicked_product_verified, false); assert.equal(r.sales_roles_changed, false); assert.equal(r.persistable, false);
  assert.doesNotMatch(JSON.stringify(r), /private|ProductID|event_properties|profile|sales_role"/);
  assert.deepEqual(f.events, before); assert.ok(Object.isFrozen(r.events[0]));
});
test("reporting normalizer now retains both typed event references", () => {
  const f = fixture();
  const row = attachAttributionEvidence(f.events, f.attributions)[0];
  assert.equal(row.provider_attributions[0].event_id, "sale1");
  assert.equal(row.provider_attributions[0].attributed_event_id, "click1");
  f.attributions[0].relationships.event.data.type = "profile";
  assert.throws(() => attachAttributionEvidence(f.events, f.attributions), e => e.code === "KLAVIYO_ATTRIBUTION_EVENT_REFERENCE_INVALID");
});
for (const [label, change, status] of [
  ["no attribution", f => f.events[0].relationships.attributions.data = [], "no_attribution"],
  ["unreturned attribution relationship", f => delete f.events[0].relationships.attributions, "missing_reference"],
  ["missing sale reference", f => delete f.attributions[0].relationships.event, "missing_reference"],
  ["null interaction", f => f.attributions[0].relationships["attributed-event"].data = null, "missing_reference"],
  ["other sale", f => f.attributions[0].relationships.event.data.id = "other", "reference_conflict"],
  ["wrong event type", f => f.attributions[0].relationships["attributed-event"].data.type = "profile", "reference_conflict"],
  ["self reference", f => f.attributions[0].relationships["attributed-event"].data.id = "sale1", "reference_conflict"],
]) test(`${label} does not search or dispatch`, async () => {
  const f = fixture(); change(f); const r = await f.run();
  assert.equal(r.links[0].status, status); assert.equal(f.calls.length, 0);
});
test("shared interaction is read once; time is checked for each sale independently", async () => {
  const f = fixture(), sale = structuredClone(f.events[0]), attr = structuredClone(f.attributions[0]);
  sale.id = "sale2"; sale.attributes.datetime = "2026-10-01T10:00:00Z";
  sale.relationships.attributions.data[0].id = "attr2";
  attr.id = "attr2"; attr.relationships.event.data.id = "sale2";
  f.events.push(sale); f.attributions.push(attr);
  const r = await f.run(); assert.equal(r.requests, 1);
  assert.deepEqual(r.links.map(l => l.status), ["linked", "time_conflict"]);
});
test("duplicate attribution references do not duplicate interactions or links", async () => {
  const f = fixture(); f.events[0].relationships.attributions.data.push({type: "attribution", id: "attr1"});
  const r = await f.run(); assert.equal(r.requests, 1); assert.equal(r.links.length, 1);
});
for (const [name, integration, kind] of [["Opened Email", "Klaviyo", "open"], ["Viewed Product", "Shopify", "other"], ["Clicked Email", "API", "other"]])
test(`preserves metric ${name}/${integration} as ${kind}`, async () => {
  const f = fixture(); f.body.included[0].attributes.name = name; f.body.included[0].attributes.integration.name = integration;
  assert.equal((await f.run()).events[0].kind, kind);
});
test("an attributed interaction from a prior business day remains valid if it precedes the sale", async () => {
  const f = fixture(); f.body.data.attributes.datetime = "2026-09-27T11:00:00Z";
  f.body.data.attributes.timestamp = Date.parse(f.body.data.attributes.datetime) / 1000;
  assert.equal((await f.run()).links[0].status, "linked");
});
for (const [label, change] of [
  ["wrong returned event", f => f.body.data.id = "other"],
  ["wrong metric relationship", f => f.body.data.relationships.metric.data.id = "other"],
  ["missing metric", f => f.body.included = []],
  ["duplicate metric", f => f.body.included.push(structuredClone(f.body.included[0]))],
  ["missing metric name", f => delete f.body.included[0].attributes.name],
  ["invalid time", f => f.body.data.attributes.datetime = "yesterday"],
  ["invalid calendar date", f => {f.body.data.attributes.datetime = "2026-02-30T11:00:00Z";
    f.body.data.attributes.timestamp = Date.parse(f.body.data.attributes.datetime) / 1000;}],
  ["timestamp conflict", f => f.body.data.attributes.timestamp++],
  ["byte bound", f => f.input.maxBytes = 1],
]) test(`${label} is a terminal error`, async () => {
  const f = fixture(); change(f); await assert.rejects(f.run()); assert.equal(f.calls.length, 1);
});
test("distinct interaction cap is checked before any event detail request", async () => {
  const f = fixture(); f.input.maxInteractions = 0; await assert.rejects(f.run()); assert.equal(f.calls.length, 0);
});
test("two distinct references over the cap stop before either detail is read", async () => {
  const f = fixture(); f.input.maxInteractions = 1;
  const a = structuredClone(f.attributions[0]); a.id = "attr2"; a.relationships["attributed-event"].data.id = "click2";
  f.attributions.push(a); f.events[0].relationships.attributions.data.push({type: "attribution", id: "attr2"});
  await assert.rejects(f.run(), e => e.code === "KLAVIYO_INTERACTION_LIMIT_EXCEEDED"); assert.equal(f.calls.length, 0);
});
test("contradictory attribution duplicates stop before fetching", async () => {
  const f = fixture(), a = structuredClone(f.attributions[0]); a.relationships["attributed-event"].data.id = "other";
  f.attributions.push(a); await assert.rejects(f.run(), e => e.code === "KLAVIYO_INTERACTION_ATTRIBUTION_CONFLICT");
  assert.equal(f.calls.length, 0);
});
test("first provider failure prevents the next reference and preserves authentic quota control", async () => {
  const f = fixture(); f.events[0].relationships.attributions.data.push({type: "attribution", id: "attr2"});
  const a = structuredClone(f.attributions[0]); a.id = "attr2"; a.relationships["attributed-event"].data.id = "click2"; f.attributions.push(a);
  const failure = new Error("native failure"); let calls = 0;
  f.input.fetchEvent = async () => {calls++; throw failure;};
  await assert.rejects(f.run(), e => e === failure); assert.equal(calls, 1);
});
test("quota descriptor isolates event_detail and excludes event ID from quota identity", async () => {
  let descriptor, sent = 0;
  const fetchFn = createQuotaManagedFetch({provider: "klaviyo", lane: "background", fetchFn: async () => {sent++; return new Response("{}");},
    guard: {execute: async (_, run) => run()}, resolveOperation: async d => {descriptor = d; return "a".repeat(64);}});
  // A minimal guard cannot mint a dispatch grant; metadata extraction can still be checked.
  const r = buildKlaviyoAttributedEventRequest({eventId: "click1", accessToken: "synthetic"});
  await assert.rejects(fetchFn(r.url, {method: r.method, headers: r.headers}));
  assert.equal(descriptor.family, "event_detail"); assert.equal(sent, 0);
  assert.doesNotMatch(JSON.stringify(descriptor), /click1|synthetic|event_properties/);
  const context = {provider: "klaviyo", clientScopeKey: "a".repeat(64), connectionScopeKey: "b".repeat(64), connectionEpoch: 1,
    accountId: "account1", organizationId: null, apiVersion: "2026-10-15"};
  assert.notEqual(quotaRouteIdentity(context, descriptor).routeKey, quotaRouteIdentity(context, {...descriptor, family: "events"}).routeKey);
});
test("event-detail quota shape rejects expanded properties before resolver or dispatch", async () => {
  let resolved = 0, sent = 0;
  const fetchFn = createQuotaManagedFetch({provider: "klaviyo", lane: "background",
    guard: {execute: async () => {throw Error("must not dispatch");}},
    resolveOperation: async () => {resolved++; return "a".repeat(64);}, fetchFn: async () => {sent++;}});
  const r = buildKlaviyoAttributedEventRequest({eventId: "click1", accessToken: "synthetic"});
  const address = new URL(r.url); address.searchParams.set("fields[event]", "id,datetime,event_properties");
  await assert.rejects(fetchFn(address, {method: r.method, headers: r.headers}), e => quotaBoundaryControl(e)?.status === "not_configured");
  assert.equal(resolved, 0); assert.equal(sent, 0);
});
