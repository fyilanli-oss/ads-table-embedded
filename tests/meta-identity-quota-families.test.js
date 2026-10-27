import test from "node:test";
import assert from "node:assert/strict";
import {createQuotaManagedFetch, quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createQuotaScopeResolver, quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {META_CATALOG_IDENTITY_FIELDS} from "../app/lib/providers/meta-catalog-identity-reader.server.js";

const context = () => ({provider: "meta", clientScopeKey: "a".repeat(64), connectionScopeKey: "b".repeat(64),
  connectionEpoch: 1, accountId: "act_123", organizationId: null, apiVersion: "v26.0"});
const shapes = [
  ["identity_ad", "id,account_id,campaign_id,adset_id,creative", ""],
  ["identity_adset", "id,account_id,promoted_object,campaign_id", ""],
  ["identity_adset", "id,account_id,promoted_object", ""],
  ["identity_creative", "id,account_id,product_set_id", ""],
  ["identity_product_set", "id,product_catalog", ""],
  ["catalog_products", META_CATALOG_IDENTITY_FIELDS.join(","), "/products"],
];
function address(fields, suffix = "") {
  const u = new URL(`https://graph.facebook.com/v26.0/456${suffix}`);
  u.searchParams.set("fields", fields); u.searchParams.set("appsecret_proof", "SECRET-PROOF");
  if (suffix) u.searchParams.set("limit", "100");
  return u;
}
function fixture() {
  const metadata = [], lookups = [], loads = [], c = context(); let calls = 0;
  const resolve = createQuotaScopeResolver({loadContext: async input => {loads.push(input); return c;},
    store: {resolveRoute: async identity => {lookups.push(identity); return identity.routeKey;}}});
  const fetch = createQuotaManagedFetch({provider: "meta", lane: "background", resolveOperation: async d => {metadata.push(d); return resolve(d);},
    guard: {execute: async ({run}) => ({status: "returned", value: (await run()).value})},
    fetchFn: async () => {calls++; return new Response("{}");}});
  return {fetch, metadata, lookups, loads, c, calls: () => calls};
}
for (const [family, fields, suffix] of shapes) test(`strict ${family} native read routes by trusted account without object ID or query leakage`, async () => {
  const f = fixture(); await f.fetch(address(fields, suffix));
  assert.equal(f.calls(), 1); assert.equal(f.metadata[0].family, family); assert.equal(f.metadata[0].accountId, null);
  assert.equal(f.metadata[0].version, "v26.0"); assert.deepEqual(f.loads, [{provider: "meta"}]);
  assert.deepEqual(Object.keys(f.lookups[0]).sort(), ["connectionScopeKey", "provider", "routeKey"]);
  assert.doesNotMatch(JSON.stringify([f.metadata, f.lookups]), /SECRET|456|fields|appsecret|retailer_id/);
  const route = quotaRouteIdentity(f.c, f.metadata[0]);
  assert.notEqual(quotaRouteIdentity({...f.c, accountId: "act_124"}, f.metadata[0]).routeKey, route.routeKey);
});
test("field ordering does not change the same approved family, cursor is not resolver metadata", async () => {
  const f = fixture(), a = address(META_CATALOG_IDENTITY_FIELDS.join(","), "/products"), b = address([...META_CATALOG_IDENTITY_FIELDS].reverse().join(","), "/products");
  b.searchParams.set("after", "SECRET-CURSOR"); await f.fetch(a); await f.fetch(b);
  assert.deepEqual(f.metadata[0], f.metadata[1]); assert.equal(f.lookups[0].routeKey, f.lookups[1].routeKey);
});
for (const [name, change, init] of [
  ["unknown field", u => u.searchParams.set("fields", "id,anything")],
  ["expanded field", u => u.searchParams.set("fields", "id,product_catalog{id}")],
  ["duplicate field", u => u.searchParams.set("fields", "id,id,product_catalog")],
  ["duplicate parameter", u => u.searchParams.append("fields", "id")],
  ["extra modifier", u => u.searchParams.set("filtering", "private")],
  ["access token parameter", u => u.searchParams.set("access_token", "SECRET")],
  ["POST", () => {}, {method: "POST"}],
  ["body on GET", () => {}, {body: "private"}],
  ["foreign origin", u => {u.hostname = "example.com";}],
  ["non-numeric object", u => {u.pathname = "/v26.0/alias";}],
  ["fields on wrong edge", u => {u.pathname += "/products"; u.searchParams.set("limit", "100");}],
]) test(`${name} cannot open generic Graph access or bypass configured family`, async () => {
  const f = fixture(), u = address("id,product_catalog"); change(u);
  await assert.rejects(f.fetch(u, init), e => quotaBoundaryControl(e)?.status === "not_configured");
  assert.equal(f.calls(), 0); assert.equal(f.lookups.length, 0);
});
test("catalog field set requires exact current read size and only known paging modifiers", async () => {
  for (const patch of [u => u.searchParams.delete("limit"), u => u.searchParams.set("limit", "500"), u => u.searchParams.append("after", "a")]) {
    const f = fixture(), u = address(META_CATALOG_IDENTITY_FIELDS.join(","), "/products");
    u.searchParams.set("after", "b"); patch(u); await assert.rejects(f.fetch(u)); assert.equal(f.calls(), 0);
  }
});
test("version, provider, fake account-on-path and include mismatch fail before store lookup", () => {
  const c = context(), d = {provider: "meta", family: "identity_ad", accountId: null, organizationId: null, version: "v26.0", includes: []};
  for (const patch of [{version: "v25.0"}, {provider: "google_ads"}, {accountId: "act_123"}, {includes: ["metric"]}]) {
    assert.throws(() => quotaRouteIdentity(c, {...d, ...patch}), /NOT_CONFIGURED/);
  }
});
test("five identity families have separate keys and none reuse Insights key", () => {
  const c = context(), keys = new Set();
  for (const family of ["identity_ad", "identity_adset", "identity_creative", "identity_product_set", "catalog_products", "insights"]) {
    keys.add(quotaRouteIdentity(c, {provider: "meta", family, accountId: family === "insights" ? "act_123" : null,
      organizationId: null, version: "v26.0", includes: []}).routeKey);
  }
  assert.equal(keys.size, 6);
});
