import test from "node:test";
import assert from "node:assert/strict";
import {createQuotaManagedFetch, quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createQuotaScopeResolver, quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {googleQuotaObservation} from "../app/lib/refresh/google-quota-observation.server.js";

const context = () => ({provider: "google_ads", clientScopeKey: "a".repeat(64), connectionScopeKey: "b".repeat(64),
  connectionEpoch: 1, accountId: "123", organizationId: null, apiVersion: "v25",
  merchant: {targetAccountId: "99", quotaAccountId: "98", apiVersion: "products/v1", bindingEpoch: 1}});
const descriptor = () => ({provider: "google_ads", family: "merchant_products", accountId: "99", organizationId: null,
  version: "products/v1", includes: []});
function fixture() {
  const c = context(), descriptors = [], loads = [], lookups = []; let calls = 0;
  const resolve = createQuotaScopeResolver({loadContext: async input => {loads.push(input); return c;},
    store: {resolveRoute: async identity => {lookups.push(identity); return identity.routeKey;}}});
  const fetch = createQuotaManagedFetch({provider: "google_ads", lane: "background", resolveOperation: async d => {descriptors.push(d); return resolve(d);},
    guard: {execute: async ({run}) => ({status: "returned", value: (await run()).value})},
    fetchFn: async () => {calls++; return new Response("{}");}});
  return {c, descriptors, loads, lookups, fetch, calls: () => calls};
}
const address = () => new URL("https://merchantapi.googleapis.com/products/v1/accounts/99/products?pageSize=1000");
test("Merchant native target/version descriptor is distinct from Ads account/version and quota pool", async () => {
  const f = fixture(); await f.fetch(address(), {headers: {Authorization: "Bearer SECRET"}});
  assert.equal(f.calls(), 1); assert.deepEqual(f.descriptors, [descriptor()]); assert.deepEqual(f.loads, [{provider: "google_ads"}]);
  assert.deepEqual(Object.keys(f.lookups[0]).sort(), ["connectionScopeKey", "provider", "routeKey"]);
  assert.doesNotMatch(JSON.stringify(f.lookups), /"(?:99|98)"|SECRET|products/);
});
test("every target, quota pool, binding epoch, Ads account and connection/client change gets a different route", () => {
  const c = context(), original = quotaRouteIdentity(c, descriptor()).routeKey;
  for (const change of [x => {x.merchant.quotaAccountId = "97";}, x => {x.merchant.bindingEpoch++;},
    x => {x.accountId = "124";}, x => {x.connectionEpoch++;}, x => {x.clientScopeKey = "c".repeat(64);},
    x => {x.connectionScopeKey = "d".repeat(64);}]) {
    const copy = structuredClone(c); change(copy); assert.notEqual(quotaRouteIdentity(copy, descriptor()).routeKey, original);
  }
  const other = structuredClone(c); other.merchant.targetAccountId = "100";
  assert.notEqual(quotaRouteIdentity(other, {...descriptor(), accountId: "100"}).routeKey, original);
});
test("Ads and OAuth route identities remain byte-for-byte compatible when trusted Merchant context is present", () => {
  const withMerchant = context(), previous = context(); delete previous.merchant;
  for (const d of [{...descriptor(), family: "reporting_query", accountId: "123", version: "v25"},
    {...descriptor(), family: "token", accountId: null, version: null}]) {
    assert.equal(quotaRouteIdentity(withMerchant, d).routeKey, quotaRouteIdentity(previous, d).routeKey);
  }
});
for (const [name, change] of [["missing Merchant context", c => {delete c.merchant;}],
  ["wrong target", c => {c.merchant.targetAccountId = "100";}], ["missing quota pool", c => {delete c.merchant.quotaAccountId;}],
  ["missing epoch", c => {delete c.merchant.bindingEpoch;}], ["wrong API", c => {c.merchant.apiVersion = "v25";}],
  ["zero epoch", c => {c.merchant.bindingEpoch = 0;}], ["zero quota ID", c => {c.merchant.quotaAccountId = "0";}],
  ["numeric quota ID", c => {c.merchant.quotaAccountId = 98;}], ["secret context", c => {c.merchant.token = "SECRET";}]]) {
  test(`${name} blocks Merchant before store lookup or HTTP`, async () => {
    const f = fixture(); change(f.c);
    await assert.rejects(f.fetch(address()), e => quotaBoundaryControl(e)?.status === "not_configured");
    assert.equal(f.lookups.length, 0); assert.equal(f.calls(), 0);
  });
}
test("same numeric Ads/Merchant target is not permission to infer missing Merchant binding", () => {
  const c = context(); c.accountId = "99"; delete c.merchant;
  assert.throws(() => quotaRouteIdentity(c, descriptor()), /NOT_CONFIGURED/);
});
test("Merchant context cannot be attached to another provider or accept wrong descriptor account/version/include", () => {
  for (const patch of [{accountId: "123"}, {accountId: null}, {version: "v25"}, {version: "products/v1beta"}, {includes: ["metric"]}]) {
    assert.throws(() => quotaRouteIdentity(context(), {...descriptor(), ...patch}), /NOT_CONFIGURED/);
  }
  assert.throws(() => quotaRouteIdentity({...context(), provider: "meta", accountId: "act_123", apiVersion: "v26.0"},
    {provider: "meta", family: "token_debug", accountId: null, organizationId: null, version: "v26.0", includes: []}), /NOT_CONFIGURED/);
});
for (const [name, change, init] of [["wrong host", u => {u.hostname = "shoppingcontent.googleapis.com";}],
  ["wrong sub-API", u => {u.pathname = "/accounts/v1/accounts/99/products";}],
  ["beta version", u => {u.pathname = u.pathname.replace("v1", "v1beta");}],
  ["item GET", u => {u.pathname += "/offer";}], ["POST", () => {}, {method: "POST"}],
  ["request body", () => {}, {body: "SECRET"}], ["missing size", u => u.searchParams.delete("pageSize")],
  ["different size", u => u.searchParams.set("pageSize", "25")], ["extra selector", u => u.searchParams.set("fields", "offerId")],
  ["duplicate token", u => {u.searchParams.append("pageToken", "a"); u.searchParams.append("pageToken", "b");}]]) {
  test(`${name} cannot silently expand the Merchant identity read family`, async () => {
    const f = fixture(), u = address(); change(u);
    await assert.rejects(f.fetch(u, init), e => quotaBoundaryControl(e)?.status === "not_configured");
    assert.equal(f.calls(), 0); assert.equal(f.lookups.length, 0);
  });
}
test("page token is opaque and excluded from quota metadata while preserving the same operation route", async () => {
  const f = fixture(), next = address(); next.searchParams.set("pageToken", "SECRET-CURSOR");
  await f.fetch(address()); await f.fetch(next); assert.deepEqual(f.descriptors[0], f.descriptors[1]);
  assert.equal(f.lookups[0].routeKey, f.lookups[1].routeKey); assert.doesNotMatch(JSON.stringify(f.descriptors), /SECRET|pageToken|pageSize/);
});
test("Merchant 429 cannot be interpreted as Google Ads account/developer shared-quota evidence", () => {
  assert.equal(googleQuotaObservation(descriptor(), 429, {error: {code: 429, status: "RESOURCE_EXHAUSTED"}}), null);
});
