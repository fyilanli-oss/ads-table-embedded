import test from "node:test";
import assert from "node:assert/strict";
import {readMetaAdSetCatalogReference as reference, readReferencedMetaCatalogIdentitySnapshot as read} from "../app/lib/providers/meta-adset-catalog-reference.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";

const instant = new Date("2026-10-27T10:00:00.000Z"), seconds = instant.valueOf() / 1000;
const scopes = [...oauthPermissionScopes("meta", "identity_v1")];
const authority = {workspace_id: "11111111-1111-4111-8111-111111111111", installation_id: "12", installation_generation: 2,
  provider_connection_id: "22222222-2222-4222-8222-222222222222", platform: "meta", platform_account_id: "act_123",
  catalog_id: "456", adset_id: "77", granted_scopes: scopes};
const config = {appId: "123", appSecret: "app-secret", graphVersion: "v26.0"};
const permission = {data: {app_id: "123", is_valid: true, scopes, expires_at: seconds + 3600, data_access_expires_at: seconds + 7200}};
const adSet = {id: "77", account_id: "123", promoted_object: {product_set_id: "88"}};
const productSet = {id: "88", product_catalog: {id: "456"}};
const product = {id: "900", retailer_id: "shopify_US_10_20", product_catalog: {id: "456"}, product_feed: {id: "99"}};
function current() {return {authority: structuredClone(authority), status: "connected", connectionVersion: 3,
  credentialId: "33333333-3333-4333-8333-333333333333", tokenSet: {permission_profile: "identity_v1", access_token: "source-token"}};}
function fixture(bodies = [permission, adSet, productSet, {data: [product]}, adSet, productSet], contexts) {
  const calls = []; let loads = 0;
  const options = {config, now: () => new Date(instant),
    loadCurrent: async () => {const result = contexts ? contexts[Math.min(loads, contexts.length - 1)] : current(); loads++; return result;},
    fetchFn: async (...args) => {calls.push(args); return new Response(JSON.stringify(bodies[calls.length - 1]), {status: 200});}};
  return {calls, options, get loads() {return loads;}};
}
function primitive(bodies) {
  const f = fixture(bodies);
  return {...f, options: {authority: structuredClone(authority), accessToken: "source-token", appSecret: "app-secret", fetchFn: f.options.fetchFn}};
}
test("Ad Set account and Product Set catalog are checked through exact native nodes", async () => {
  const f = primitive([adSet, productSet]), result = await reference(f.options);
  assert.equal(result.state, "confirmed"); assert.equal(result.observed_catalog_id, "456");
  assert.equal(new URL(f.calls[0][0]).pathname, "/v26.0/77");
  assert.equal(new URL(f.calls[0][0]).searchParams.get("fields"), "id,account_id,promoted_object");
  assert.equal(new URL(f.calls[1][0]).pathname, "/v26.0/88");
  assert.equal(new URL(f.calls[1][0]).searchParams.get("fields"), "id,product_catalog");
  assert.ok(Object.isFrozen(result.evidence.product_set_reference.product_catalog));
  assert.equal(result.proves_product_delivery_or_Insights_namespace, false);
});
test("explicit direct catalog reference needs no Product Set call and excludes unrelated signals", async () => {
  const f = primitive([{...adSet, promoted_object: {product_catalog_id: "456", pixel_id: "private-pixel", whatsapp_phone_number: "private-phone"}}]);
  const result = await reference(f.options);
  assert.equal(result.state, "confirmed"); assert.equal(f.calls.length, 1);
  assert.deepEqual(result.evidence.adset_reference, {adset_id: "77", account_id: "123", product_catalog_id: "456"});
  assert.equal(JSON.stringify(result).includes("private-"), false);
});
test("no observed catalog or a different catalog does not invent a link", async () => {
  assert.equal((await reference(primitive([{...adSet, promoted_object: {pixel_id: "1"}}]).options)).state, "not_observed");
  assert.equal((await reference(primitive([{...adSet, promoted_object: {product_catalog_id: "999"}}]).options)).state, "different_catalog");
});
for (const [label, bodies, code] of [
  ["wrong adset", [{...adSet, id: "other"}], "ACCOUNT_MISMATCH"],
  ["wrong account", [{...adSet, account_id: "999"}], "ACCOUNT_MISMATCH"],
  ["missing promoted object", [{id: "77", account_id: "123"}], "SCHEMA_INVALID"],
  ["null promoted object", [{...adSet, promoted_object: null}], "SCHEMA_INVALID"],
  ["null catalog", [{...adSet, promoted_object: {product_catalog_id: null}}], "ID_INVALID"],
  ["wrong product set", [adSet, {...productSet, id: "999"}], "PRODUCT_SET_MISMATCH"],
  ["missing set catalog", [adSet, {id: "88"}], "ID_INVALID"],
  ["conflicting direct and set references", [{...adSet, promoted_object: {product_catalog_id: "999", product_set_id: "88"}}, productSet], "CONFLICTING"],
  ["Graph error", [{error: {message: "source-token"}}], "RESPONSE_INVALID"],
]) test(`rejects ${label} safely`, async () => {
  const f = primitive(bodies); await assert.rejects(reference(f.options), new RegExp(code));
  assert.equal(f.calls.length, bodies.length);
});
test("full composition inspects token and rechecks native reference with the same context", async () => {
  const f = fixture(), result = await read(f.options);
  assert.equal(f.loads, 5); assert.equal(f.calls.length, 6);
  assert.equal(new URL(f.calls[0][0]).pathname, "/v26.0/debug_token");
  assert.equal(f.calls[0][1].headers.authorization, "Bearer 123|app-secret");
  assert.equal(f.calls[1][1].headers.authorization, "Bearer source-token");
  assert.equal(result.provider_link_verified, true); assert.equal(result.relationship_scope, "current_adset_catalog_reference_only");
  assert.equal(result.shopify_mapping_state, "not_resolved"); assert.equal(result.authorizes_activation, false);
  assert.equal(result.proves_product_delivery_or_Insights_namespace, false);
  assert.equal(result.snapshot.records[0].catalog_product_id, "900");
  for (const [, options] of f.calls) {assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");}
  for (const secret of ["source-token", "app-secret", "input_token"]) assert.equal(JSON.stringify(result).includes(secret), false);
});
for (const [label, change] of [
  ["workspace", c => {c.authority.workspace_id = "44444444-4444-4444-8444-444444444444";}],
  ["installation", c => {c.authority.installation_id = "13";}],
  ["generation", c => {c.authority.installation_generation++;}],
  ["connection", c => {c.authority.provider_connection_id = "44444444-4444-4444-8444-444444444444";}],
  ["version", c => {c.connectionVersion++;}],
  ["credential", c => {c.credentialId = "44444444-4444-4444-8444-444444444444";}],
  ["token", c => {c.tokenSet.access_token = "changed";}],
  ["Ads account", c => {c.authority.platform_account_id = "act_999";}],
  ["catalog", c => {c.authority.catalog_id = "999";}],
  ["Ad Set", c => {c.authority.adset_id = "99";}],
]) test(`changing ${label} discards product read`, async () => {
  const changed = current(); change(changed);
  const f = fixture(undefined, [current(), current(), current(), changed]);
  await assert.rejects(read(f.options), /AUTHORITY_CHANGED/); assert.equal(f.calls.length, 4);
});
test("post-inspection change prevents reference call and final change still discards collection", async () => {
  const changed = current(); changed.connectionVersion++;
  const early = fixture(undefined, [current(), changed]);
  await assert.rejects(read(early.options), /AUTHORITY_CHANGED/); assert.equal(early.calls.length, 1);
  const late = fixture(undefined, [current(), current(), current(), current(), changed]);
  await assert.rejects(read(late.options), /AUTHORITY_CHANGED/); assert.equal(late.calls.length, 6);
});
test("lost or changed native reference discards products", async () => {
  for (const last of [{...adSet, promoted_object: {}}, {...adSet, promoted_object: {product_catalog_id: "456"}}]) {
    const f = fixture([permission, adSet, productSet, {data: [product]}, last]);
    await assert.rejects(read(f.options), /REFERENCE_CHANGED/); assert.equal(f.calls.length, 5);
  }
});
test("initial no-reference prevents product enumeration", async () => {
  const f = fixture([permission, {...adSet, promoted_object: {}}]);
  await assert.rejects(read(f.options), /NOT_CONFIRMED/); assert.equal(f.calls.length, 2);
});
for (const [label, change] of [
  ["invalid token", {is_valid: false}], ["wrong app", {app_id: "999"}],
  ["missing scope", {scopes: ["ads_read"]}], ["expired token", {expires_at: seconds - 1}],
]) test(`${label} inspection stops before reference call`, async () => {
  const f = fixture([{data: {...permission.data, ...change}}]);
  await assert.rejects(read(f.options), /TOKEN_INSPECTION_FAILED/); assert.equal(f.calls.length, 1);
});
test("current token scope response is used, never padded from stored scope list", async () => {
  const f = fixture([{data: {...permission.data, scopes: [...scopes, "native_extra"]}}, adSet, productSet, {data: []}, adSet, productSet]);
  const result = await read(f.options);
  assert.equal(result.link_evidence.permission.scopes.includes("native_extra"), true);
});
test("first error at every native stage stops safely without retry or alternate route", async () => {
  for (const failure of [1, 2, 3, 4, 5, 6]) {
    const f = fixture(), fetcher = f.options.fetchFn;
    f.options.fetchFn = async (...args) => {
      const response = await fetcher(...args);
      if (f.calls.length === failure) throw Error("source-token app-secret");
      return response;
    };
    await assert.rejects(read(f.options), e => !/source-token|app-secret/.test(e.message)); assert.equal(f.calls.length, failure);
  }
});
test("invalid limits, reporting-only credential and inactive context make no provider call", async () => {
  const f = fixture(); await assert.rejects(read({...f.options, maxRows: 0})); assert.equal(f.loads, 0);
  for (const change of [c => {c.status = "disconnected";}, c => {c.tokenSet.permission_profile = "reporting_v1";}]) {
    const c = current(); change(c); const g = fixture(undefined, [c]);
    await assert.rejects(read(g.options)); assert.equal(g.calls.length, 0);
  }
});
test("cancellation is forwarded to inspection and no completed result survives", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(read({...f.options, signal: controller.signal}), /ABORTED/); assert.equal(f.calls.length, 0);
  const during = new AbortController();
  f.options.fetchFn = async (_, options) => {assert.equal(options.signal, during.signal); during.abort(); throw Error("stopped");};
  await assert.rejects(read({...f.options, signal: during.signal}), /ABORTED/);
});
test("native expiry and observation window are checked after slow product responses", async () => {
  for (const [delta, expected] of [[120001, /OBSERVATION_STALE/], [60000, /CREDENTIAL_EXPIRED/]]) {
    const expires = {data: {...permission.data, expires_at: seconds + 30}};
    const f = fixture([expires, adSet, productSet, {data: [product]}, adSet, productSet]);
    let clock = instant.valueOf(); f.options.now = () => new Date(clock);
    const fetcher = f.options.fetchFn;
    f.options.fetchFn = async (...args) => {const response = await fetcher(...args); if (f.calls.length === 4) clock += delta; return response;};
    await assert.rejects(read(f.options), expected); assert.equal(f.calls.length, 4);
  }
});
