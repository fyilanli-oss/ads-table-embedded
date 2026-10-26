import assert from "node:assert/strict";
import test from "node:test";
import {buildKlaviyoAttributedEventRequest, readKlaviyoAttributedEvents} from "../app/lib/providers/klaviyo-attributed-event.server.js";

const sale = (id, interaction = "touch-1") => ({provider_event_id: id,
  provider_attributions: [{attribution_id: `attr-${id}`, attributed_event_id: interaction}]});
const detail = (id, name = "Clicked Email", properties = {"Bot Click": false}) => ({
  data: {type: "event", id, attributes: {datetime: "2026-10-25T12:00:00Z", event_properties: properties},
    relationships: {metric: {data: {type: "metric", id: "click-metric"}}}},
  included: [{type: "metric", id: "click-metric", attributes: {name, integration: {name: "Klaviyo"}}}],
});

test("detail requests use the fixed endpoint, existing read scope and metric relationship only", () => {
  const request = buildKlaviyoAttributedEventRequest({accessToken: "private-token", id: "touch-1"});
  const target = new URL(request.url);
  assert.equal(target.origin, "https://a.klaviyo.com");
  assert.equal(target.pathname, "/api/events/touch-1");
  assert.equal(target.searchParams.get("include"), "metric");
  assert.equal(target.searchParams.has("filter"), false); // Interaction can predate the sale day.
  assert.equal(request.headers.revision, "2026-10-15");
  assert.equal(request.headers.Authorization, "Bearer private-token");
  assert.equal(request.method, "GET");
  for (const id of ["../other", "x?include=profile", "https://foreign", "x/y", " x", ""]) {
    assert.throws(() => buildKlaviyoAttributedEventRequest({accessToken: "private-token", id}),
      {code: "KLAVIYO_ATTRIBUTED_EVENT_ID_INVALID"});
  }
});

test("multiple sales share one detail request while native properties and individual sale links survive", async () => {
  const calls = [];
  const raw = detail("touch-1", "Clicked Email", {ProductID: "A", "Bot Click": false});
  const input = [sale("sale-A"), sale("sale-B"), sale("sale-C"), sale("sale-D")];
  const before = structuredClone(input);
  const result = await readKlaviyoAttributedEvents({sales: input, fetchEvent: async id => {
    calls.push(id);
    return {payload: raw, requestId: "request-1"};
  }});
  assert.deepEqual(calls, ["touch-1"]);
  assert.equal(result.sale_links.length, 4);
  assert.deepEqual(result.rows[0].raw_event, raw.data);
  raw.data.attributes.event_properties.ProductID = "changed";
  assert.equal(result.rows[0].raw_event.attributes.event_properties.ProductID, "A");
  assert.deepEqual(input, before);
  assert.equal(result.rows[0].metric_name, "Clicked Email");
  assert.equal(result.product_interaction_verified, false);
  assert.equal(result.rows[0].product_interaction_verified, false);
  assert.equal(result.dataset_publishable, false);
  assert.equal(JSON.stringify(result).includes("Advertised"), false);
});

test("open and delivery attribution are retained without being reinterpreted as product clicks", async () => {
  for (const name of ["Opened Email", "Received SMS", "Clicked SMS"]) {
    const result = await readKlaviyoAttributedEvents({sales: [sale("sale-1")],
      fetchEvent: async id => ({payload: detail(id, name), requestId: null})});
    assert.equal(result.rows[0].metric_name, name);
    assert.equal(result.product_interaction_verified, false);
  }
});

test("missing interaction and an empty sale set do not become zeros or guessed requests", async () => {
  const fetchEvent = async () => {throw new Error("must not request");};
  const result = await readKlaviyoAttributedEvents({sales: [sale("sale-1", null)], fetchEvent});
  assert.equal(result.request_count, 0);
  assert.equal(result.sale_links[0].observation, "not_observed_in_this_execution");
  assert.equal(result.sale_links[0].attributed_event_id, null);
  assert.deepEqual((await readKlaviyoAttributedEvents({sales: [], fetchEvent})).rows, []);
});

test("all references and the distinct event limit are checked before dispatch", async () => {
  let calls = 0;
  const fetchEvent = async () => {calls++; throw Error("must not request");};
  await assert.rejects(() => readKlaviyoAttributedEvents({sales: [sale("one"), sale("two", "../other")], fetchEvent}),
    {code: "KLAVIYO_ATTRIBUTED_EVENT_ID_INVALID"});
  await assert.rejects(() => readKlaviyoAttributedEvents({
    sales: Array.from({length: 101}, (_, i) => sale(`sale-${i}`, `touch-${i}`)), fetchEvent}),
    {code: "KLAVIYO_ATTRIBUTED_EVENT_LIMIT_EXCEEDED"});
  assert.equal(calls, 0);
});

test("wrong event, missing metric and invalid properties fail instead of returning incomplete evidence", async () => {
  const mutations = [
    payload => {payload.data.id = "another-event";},
    payload => {payload.data.type = "profile";},
    payload => {payload.included = [];},
    payload => {payload.data.relationships.metric.data.type = "profile";},
    payload => {payload.data.attributes.event_properties = null;},
    payload => {payload.data.attributes.datetime = "invalid";},
    payload => {payload.included.push(payload.included[0]);},
  ];
  for (const mutate of mutations) {
    const payload = detail("touch-1"); mutate(payload);
    await assert.rejects(() => readKlaviyoAttributedEvents({sales: [sale("sale-1")],
      fetchEvent: async () => ({payload, requestId: null})}), /KLAVIYO_ATTRIBUTED_EVENT_/);
  }
});

test("first failed detail stops the sequence and never retries", async () => {
  const calls = [];
  await assert.rejects(() => readKlaviyoAttributedEvents({
    sales: [sale("a", "touch-1"), sale("b", "touch-2"), sale("c", "touch-3")],
    fetchEvent: async id => {
      calls.push(id);
      if (id === "touch-2") throw new Error("provider-rejected");
      return {payload: detail(id), requestId: null};
    }}), /provider-rejected/);
  assert.deepEqual(calls, ["touch-1", "touch-2"]);
});
