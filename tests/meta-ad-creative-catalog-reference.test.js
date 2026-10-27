import test from "node:test";
import assert from "node:assert/strict";
import {readMetaAdCatalogReference as reference, readAdReferencedMetaCatalogIdentitySnapshot as read,
  readReferencedMetaCatalogIdentitySnapshot as readAdSet} from "../app/lib/providers/meta-adset-catalog-reference.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";

const scopes = [...oauthPermissionScopes("meta", "identity_v1")];
const authority = {workspace_id: "11111111-1111-4111-8111-111111111111", installation_id: "12", installation_generation: 2,
  provider_connection_id: "22222222-2222-4222-8222-222222222222", platform: "meta", platform_account_id: "act_123",
  catalog_id: "456", adset_id: "77", ad_id: "66", campaign_id: "55", granted_scopes: scopes};
const ad = {id: "66", account_id: "123", adset_id: "77", campaign_id: "55", creative: {id: "99"}};
const adSet = {id: "77", account_id: "123", campaign_id: "55", promoted_object: {product_set_id: "88"}};
const set = {id: "88", product_catalog: {id: "456"}};
const creative = {id: "99", account_id: "123", product_set_id: "88"};
const now = () => new Date("2026-10-27T10:00:00.000Z"), seconds = now().valueOf() / 1000;
const permission = {data: {app_id: "123", is_valid: true, scopes, expires_at: seconds + 3600, data_access_expires_at: seconds + 7200}};
const product = {id: "900", retailer_id: "shopify_US_10_20", product_catalog: {id: "456"}};
const config = {appId: "123", appSecret: "app-secret", graphVersion: "v26.0"};
const sequence = () => [structuredClone(ad), structuredClone(adSet), structuredClone(set), structuredClone(creative)];
function current() {return {authority: structuredClone(authority), status: "connected", connectionVersion: 3,
  credentialId: "33333333-3333-4333-8333-333333333333", tokenSet: {permission_profile: "identity_v1", access_token: "source-token"}};}
function fixture(bodies, contexts) {
  const calls = []; let loads = 0;
  const options = {config, now, loadCurrent: async () => {const c = contexts ? contexts[Math.min(loads, contexts.length - 1)] : current(); loads++; return c;},
    fetchFn: async (...args) => {calls.push(args); return new Response(JSON.stringify(bodies[calls.length - 1]), {status: 200});}};
  return {calls, options, get loads() {return loads;}};
}
function primitive(bodies = sequence()) {
  const f = fixture(bodies);
  return {calls: f.calls, options: {authority: structuredClone(authority), accessToken: "source-token", appSecret: "app-secret", fetchFn: f.options.fetchFn}};
}
const complete = () => [permission, ...sequence(), {data: [product]}, ...sequence()];

test("binds exact Ad, account, campaign, Ad Set and creative, reusing identical Product Set evidence", async () => {
  const f = primitive(), result = await reference(f.options);
  assert.equal(result.state, "confirmed"); assert.equal(result.ad_id, "66");
  assert.deepEqual(f.calls.map(([target]) => new URL(target).pathname), ["/v26.0/66", "/v26.0/77", "/v26.0/88", "/v26.0/99"]);
  assert.equal(new URL(f.calls[0][0]).searchParams.get("fields"), "id,account_id,campaign_id,adset_id,creative");
  assert.match(new URL(f.calls[1][0]).searchParams.get("fields"), /campaign_id/);
  assert.equal(result.evidence.creative_reference.product_set_state, "observed");
  assert.equal(result.proves_product_delivery_or_Insights_namespace, false);
  assert.ok(Object.isFrozen(result.evidence.creative_product_set_reference.product_catalog));
});
test("different creative and parent sets can reference the same catalog without assuming membership", async () => {
  const f = primitive([ad, adSet, set, {...creative, product_set_id: "100"}, {id: "100", product_catalog: {id: "456"}}]);
  const result = await reference(f.options);
  assert.equal(result.state, "confirmed"); assert.equal(result.evidence.creative_product_set_reference.id, "100");
  assert.equal(f.calls.length, 5); assert.equal(result.proves_product_delivery_or_Insights_namespace, false);
});
test("conflicting parent and creative catalog references stop without precedence or target switch", async () => {
  const f = primitive([ad, adSet, set, {...creative, product_set_id: "100"}, {id: "100", product_catalog: {id: "999"}}]);
  await assert.rejects(reference(f.options), /CONFLICTING/); assert.equal(f.calls.length, 5);
});
for (const [label, native, state] of [["absent", {id: "99", account_id: "123"}, "missing"],
  ["null", {...creative, product_set_id: null}, "null"], ["empty", {...creative, product_set_id: ""}, "empty"]]) {
  test(`creative ${label} set remains explicit without inferring absence of overrides`, async () => {
    const result = await reference(primitive([ad, adSet, set, native]).options);
    assert.equal(result.state, "confirmed"); assert.equal(result.evidence.creative_reference.product_set_state, state);
    assert.equal(result.evidence.creative_product_set_reference, null);
  });
}
test("creative-only explicit catalog reference works; no observed reference stays not_observed", async () => {
  const parent = {...adSet, promoted_object: {pixel_id: "private"}};
  const one = await reference(primitive([ad, parent, creative, set]).options);
  assert.equal(one.state, "confirmed"); assert.equal(one.evidence.parent_reference.product_set_reference, null);
  const none = await reference(primitive([ad, parent, {id: "99", account_id: "123"}]).options);
  assert.equal(none.state, "not_observed"); assert.equal(none.observed_catalog_id, null);
});
for (const [label, change] of [["Ad", {id: "other"}], ["account", {account_id: "999"}],
  ["Campaign", {campaign_id: "999"}], ["Ad Set", {adset_id: "999"}], ["missing creative", {creative: null}]]) {
  test(`rejects wrong ${label} before following any dependent node`, async () => {
    const f = primitive([{...ad, ...change}]); await assert.rejects(reference(f.options)); assert.equal(f.calls.length, 1);
  });
}
test("Ad Set campaign mismatch fails before Product Set or creative read", async () => {
  const f = primitive([ad, {...adSet, campaign_id: "999"}]);
  await assert.rejects(reference(f.options), /CAMPAIGN_MISMATCH/); assert.equal(f.calls.length, 2);
});
for (const [label, changed] of [["creative ID", {...creative, id: "999"}], ["creative account", {...creative, account_id: "999"}],
  ["malformed creative set", {...creative, product_set_id: 88}]]) {
  test(`rejects ${label}`, async () => {await assert.rejects(reference(primitive([ad, adSet, set, changed]).options));});
}
test("only identity reference projection is returned from rich Ad and creative responses", async () => {
  const result = await reference(primitive([{...ad, name: "private-ad-name"}, adSet, set, {...creative, body: "private-body"}]).options);
  assert.equal(JSON.stringify(result).includes("private-"), false);
});
test("Ad-level composition keeps token checks and before/after reference comparisons", async () => {
  const f = fixture(complete()), result = await read(f.options);
  assert.equal(f.calls.length, 10); assert.equal(f.loads, 5);
  assert.equal(result.relationship_scope, "current_ad_parent_and_observed_creative_catalog_references_only");
  assert.equal(result.link_evidence.before.ad_id, "66"); assert.equal(result.snapshot.records[0].catalog_product_id, "900");
  assert.equal(result.authorizes_activation, false); assert.equal(result.shopify_mapping_state, "not_resolved");
  assert.equal(result.proves_product_delivery_or_Insights_namespace, false);
  for (const secret of ["source-token", "app-secret", "input_token"]) assert.equal(JSON.stringify(result).includes(secret), false);
  for (const [, init] of f.calls) {assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");}
});
for (const field of ["ad_id", "campaign_id", "adset_id"]) {
  test(`changing server ${field} during products discards the result`, async () => {
    const changed = current(); changed.authority[field] = "999";
    const f = fixture(complete(), [current(), current(), current(), changed]);
    await assert.rejects(read(f.options), /AUTHORITY_CHANGED/); assert.equal(f.calls.length, 6);
  });
}
for (const [label, native] of [["changed creative", {...ad, creative: {id: "100"}}],
  ["changed creative set availability", {...creative, product_set_id: null}]]) {
  test(`${label} after product collection cannot produce accepted evidence`, async () => {
    const bodies = complete();
    if (label === "changed creative") {bodies[6] = native; bodies[9] = {...creative, id: "100"};}
    else bodies[9] = native;
    const f = fixture(bodies); await assert.rejects(read(f.options), /REFERENCE_CHANGED/);
  });
}
test("no catalog reference prevents product collection", async () => {
  const f = fixture([permission, ad, {...adSet, promoted_object: {}}, {id: "99", account_id: "123"}]);
  await assert.rejects(read(f.options), /NOT_CONFIRMED/); assert.equal(f.calls.length, 4);
});
test("first provider failure at each reference stage makes no retry or alternate lookup", async () => {
  for (let at = 1; at <= 10; at++) {
    const f = fixture(complete()), fetcher = f.options.fetchFn;
    f.options.fetchFn = async (...args) => {const response = await fetcher(...args); if (f.calls.length === at) throw Error("source-token app-secret"); return response;};
    await assert.rejects(read(f.options), error => !/source-token|app-secret/.test(error.message)); assert.equal(f.calls.length, at);
  }
});
test("caller cannot select Ad Set mode on the Ad-level entry point", async () => {
  const c = current(); delete c.authority.ad_id;
  const f = fixture(complete(), [c]);
  await assert.rejects(read({...f.options, referenceLevel: "adset"})); assert.equal(f.calls.length, 0);
});
test("legacy Ad Set entry point cannot be relabeled as Ad proof by caller mode", async () => {
  const c = current(); delete c.authority.campaign_id; delete c.authority.ad_id;
  const parent = {id: "77", account_id: "123", promoted_object: {product_set_id: "88"}};
  const f = fixture([permission, parent, set, {data: []}, parent, set], [c]);
  const result = await readAdSet({...f.options, referenceLevel: "ad"});
  assert.equal(result.relationship_scope, "current_adset_catalog_reference_only");
});
test("cancellation during creative read discards all collected reference data", async () => {
  const f = fixture(complete()), controller = new AbortController(), fetcher = f.options.fetchFn;
  f.options.fetchFn = async (...args) => {assert.equal(args[1].signal, controller.signal); const response = await fetcher(...args);
    if (f.calls.length === 5) controller.abort(); return response;};
  await assert.rejects(read({...f.options, signal: controller.signal}), /ABORTED/); assert.equal(f.calls.length, 5);
});
