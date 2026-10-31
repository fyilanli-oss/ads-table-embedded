import assert from "node:assert/strict";
import test from "node:test";
import {discoverGoogleAdsAccounts} from "../app/lib/providers/google-account-discovery.server.js";
import {createGoogleAdsRestClient, GoogleAdsRestError, isGoogleCustomerNotEnabledError, isGoogleAccountDiscoveryExclusionError, googleAdsRestFailureMetadata} from "../app/lib/providers/google-ads-rest.server.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {status});
const failure = (code = "CUSTOMER_NOT_ENABLED") => ({error: {status: "PERMISSION_DENIED",
  details: [{errors: [{errorCode: {authorizationError: code}}]}]}});
const row = (id, manager = false, level = 0) => ({customerClient: {id, manager, level,
  status: "ENABLED", descriptiveName: id, currencyCode: "USD", timeZone: "UTC"}});
function harness(roots, responses) {
  const calls = [];
  return {calls, run: () => discoverGoogleAdsAccounts({accessToken: "synthetic", stopOnFirstError: true,
    fetchFn: async address => {
      if (address.endsWith(":listAccessibleCustomers")) return json({resourceNames: roots.map(id => `customers/${id}`)});
      const id = /customers\/(\d+)\//.exec(address)[1];
      calls.push(id);
      const result = responses[id];
      return json(result.body, result.status ?? 200);
    }})};
}
test("unavailable first root is excluded; next advertiser remains selectable", async () => {
  const h = harness(["111", "222"], {111: {body: failure(), status: 403}, 222: {body: {results: [row("222")]}}});
  const result = await h.run();
  assert.deepEqual(h.calls, ["111", "222"]);
  assert.deepEqual(result.accounts.map(account => account.id), ["222"]);
  assert.equal(result.accounts[0].reportingEligible, true);
});
test("failed root is removed if previously listed by manager and cannot be re-added or retried", async () => {
  const h = harness(["333", "111", "111", "444"], {
    333: {body: {results: [row("333", true), row("111", false, 1)]}},
    111: {body: failure(), status: 403},
    444: {body: {results: [row("444", true), row("111", false, 1), row("222", false, 1)]}},
  });
  const result = await h.run();
  assert.deepEqual(h.calls, ["333", "111", "444"]);
  assert.deepEqual(result.accounts.filter(account => account.reportingEligible).map(account => account.id), ["222"]);
  assert.equal(result.accounts.some(account => account.id === "111"), false);
});
test("all roots unavailable fails instead of returning successful empty evidence", async () => {
  const h = harness(["111", "222"], {111: {body: failure(), status: 403}, 222: {body: failure(), status: 403}});
  await assert.rejects(h.run(), error => isGoogleCustomerNotEnabledError(error));
  assert.deepEqual(h.calls, ["111", "222"]);
});
for (const status of [401, 403, 429, 500, 503]) test(`other ${status} after successful root stops before any next root`, async () => {
  const h = harness(["222", "333", "444"], {222: {body: {results: [row("222")]}},
    333: {body: failure("USER_PERMISSION_DENIED"), status}});
  await assert.rejects(h.run(), error => error.code === "GOOGLE_ADS_REST_REQUEST_FAILED" && !isGoogleCustomerNotEnabledError(error));
  assert.deepEqual(h.calls, ["222", "333"]);
});
for (const [name, body, status] of [
  ["mixed codes", {error: {status: "PERMISSION_DENIED", details: [{errors: [
    ...failure().error.details[0].errors, {errorCode: {authorizationError: "USER_PERMISSION_DENIED"}},
  ]}]}}, 403],
  ["extra error detail", {error: {...failure().error, details: [...failure().error.details, {reason: "other"}]}}, 403],
  ["empty errors", {error: {status: "PERMISSION_DENIED", details: [{errors: []}]}}, 403],
  ["missing details", {error: {status: "PERMISSION_DENIED"}}, 403],
  ["wrong error family", {error: {status: "PERMISSION_DENIED", details: [{errors: [{errorCode: {authenticationError: "CUSTOMER_NOT_ENABLED"}}]}]}}, 403],
  ["extra error family", {error: {status: "PERMISSION_DENIED", details: [{errors: [{errorCode: {authorizationError: "CUSTOMER_NOT_ENABLED", other: "UNKNOWN"}}]}]}}, 403],
  ["wrong provider status", {error: {...failure().error, status: "UNAUTHENTICATED"}}, 403],
  ["HTTP200 error envelope", failure(), 200],
  ["wrong HTTP status", failure(), 401],
]) test(`${name} cannot grant the exclusion exception`, async () => {
  const h = harness(["111", "222"], {111: {body, status}});
  await assert.rejects(h.run(), error => error.code === "GOOGLE_ADS_REST_REQUEST_FAILED" && !isGoogleCustomerNotEnabledError(error));
  assert.deepEqual(h.calls, ["111"]);
});
test("listAccessibleCustomers failure never grants account exclusion", async () => {
  let calls = 0;
  await assert.rejects(discoverGoogleAdsAccounts({accessToken: "synthetic", stopOnFirstError: true,
    fetchFn: async () => {calls++; return json(failure(), 403);}}), error => !isGoogleCustomerNotEnabledError(error));
  assert.equal(calls, 1);
});
test("only original REST evidence grants exclusion; details mutation and forged errors cannot", async () => {
  const client = createGoogleAdsRestClient({accessToken: "synthetic", fetchFn: async () => json(failure(), 403)});
  let original;
  try {await client.search({customerId: "111", query: "SELECT customer.id FROM customer"});} catch (error) {original = error;}
  assert.equal(isGoogleCustomerNotEnabledError(original), true);
  original.details = {};
  assert.equal(isGoogleCustomerNotEnabledError(original), true);
  assert.equal(isGoogleCustomerNotEnabledError(new GoogleAdsRestError("GOOGLE_ADS_REST_REQUEST_FAILED", "", {
    status: 403, provider_error_code: "CUSTOMER_NOT_ENABLED", provider_status: "PERMISSION_DENIED",
  })), false);
  for (const value of [null, undefined, 1, "CUSTOMER_NOT_ENABLED", {}]) assert.equal(isGoogleCustomerNotEnabledError(value), false);
});

const productionCode = "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION";
for (const roots of [["111", "222", "333"], ["222", "111", "333"], ["222", "333", "111"]]) {
  test(`production refusal preserves readable accounts in root order ${roots.join(",")}`, async () => {
    const h = harness(roots, {111: {body: failure(productionCode), status: 403},
      222: {body: {results: [row("222")]}}, 333: {body: {results: [row("333")]}}});
    const result = await h.run();
    assert.deepEqual(result.accounts.map(account => account.id), ["222", "333"]);
    assert.deepEqual(h.calls, roots);
  });
}
test("production-refused account is removed from prior manager candidates, not retried or re-added", async () => {
  const h = harness(["333", "111", "111", "444"], {
    333: {body: {results: [row("333", true), row("111", false, 1)]}},
    111: {body: failure(productionCode), status: 403},
    444: {body: {results: [row("444", true), row("111", false, 1), row("222", false, 1)]}},
  });
  const result = await h.run();
  assert.deepEqual(h.calls, ["333", "111", "444"]);
  assert.equal(result.accounts.some(account => account.id === "111"), false);
  assert.deepEqual(result.accounts.filter(account => account.reportingEligible).map(account => account.id), ["222"]);
});
test("separate known refusals preserve the readable account without any retry", async () => {
  const h = harness(["111", "333", "222"], {111: {body: failure(), status: 403},
    333: {body: failure(productionCode), status: 403}, 222: {body: {results: [row("222")]}}});
  assert.deepEqual((await h.run()).accounts.map(account => account.id), ["222"]);
  assert.deepEqual(h.calls, ["111", "333", "222"]);
});
test("all production-refused roots fail, never successful empty evidence", async () => {
  const h = harness(["111", "222"], {111: {body: failure(productionCode), status: 403},
    222: {body: failure(productionCode), status: 403}});
  await assert.rejects(h.run(), error => isGoogleAccountDiscoveryExclusionError(error)
    && !isGoogleCustomerNotEnabledError(error));
  assert.deepEqual(h.calls, ["111", "222"]);
});
for (const status of [401, 403, 429, 500, 503]) test(`other ${status} still stops after readable and production-refused roots`, async () => {
  const h = harness(["222", "111", "333", "444"], {222: {body: {results: [row("222")]}},
    111: {body: failure(productionCode), status: 403}, 333: {body: failure("USER_PERMISSION_DENIED"), status}});
  await assert.rejects(h.run(), error => error.code === "GOOGLE_ADS_REST_REQUEST_FAILED"
    && !isGoogleAccountDiscoveryExclusionError(error));
  assert.deepEqual(h.calls, ["222", "111", "333"]);
});
for (const [name, body, status] of [
  ["mixed approved codes", {error: {status: "PERMISSION_DENIED", details: [{errors: [
    ...failure().error.details[0].errors, ...failure(productionCode).error.details[0].errors,
  ]}]}}, 403],
  ["mixed unapproved codes", {error: {status: "PERMISSION_DENIED", details: [{errors: [
    ...failure(productionCode).error.details[0].errors, {errorCode: {authorizationError: "PROJECT_DISABLED"}},
  ]}]}}, 403],
  ["extra detail", {error: {...failure(productionCode).error, details: [...failure(productionCode).error.details, {}]}}, 403],
  ["wrong family", {error: {status: "PERMISSION_DENIED", details: [{errors: [{errorCode: {authenticationError: productionCode}}]}]}}, 403],
  ["extra family", {error: {status: "PERMISSION_DENIED", details: [{errors: [{errorCode: {authorizationError: productionCode, other: "UNKNOWN"}}]}]}}, 403],
  ["wrong provider status", {error: {...failure(productionCode).error, status: "UNAUTHENTICATED"}}, 403],
  ["HTTP200 envelope", failure(productionCode), 200],
  ["wrong HTTP status", failure(productionCode), 401],
]) test(`production exclusion rejects ${name} without querying another root`, async () => {
  const h = harness(["111", "222"], {111: {body, status}});
  await assert.rejects(h.run(), error => !isGoogleAccountDiscoveryExclusionError(error));
  assert.deepEqual(h.calls, ["111"]);
});
test("production refusal at listAccessibleCustomers is fatal, not an account exclusion", async () => {
  let calls = 0;
  await assert.rejects(discoverGoogleAdsAccounts({accessToken: "synthetic", stopOnFirstError: true,
    fetchFn: async () => {calls++; return json(failure(productionCode), 403);}}), error => !isGoogleAccountDiscoveryExclusionError(error));
  assert.equal(calls, 1);
});
test("production exclusion uses original evidence, preserves safe metadata and rejects forged errors", async () => {
  const body = failure(productionCode);
  body.error.details.push(...failure(productionCode).error.details);
  const client = createGoogleAdsRestClient({accessToken: "synthetic", fetchFn: async () => json(body, 403)});
  let original;
  try {await client.search({customerId: "111", query: "SELECT customer.id FROM customer"});} catch (error) {original = error;}
  assert.equal(isGoogleAccountDiscoveryExclusionError(original), true);
  assert.equal(isGoogleCustomerNotEnabledError(original), false, "old predicate retains its precise meaning");
  original.details = {};
  assert.equal(isGoogleAccountDiscoveryExclusionError(original), true);
  assert.deepEqual(googleAdsRestFailureMetadata(original), {operation: "search", http_status: 403,
    provider_status: "PERMISSION_DENIED", provider_error_code: productionCode});
  assert.equal(isGoogleAccountDiscoveryExclusionError(new GoogleAdsRestError("GOOGLE_ADS_REST_REQUEST_FAILED", "", {
    status: 403, provider_status: "PERMISSION_DENIED", provider_error_code: productionCode,
  })), false);
  for (const value of [null, undefined, 1, productionCode, {}]) assert.equal(isGoogleAccountDiscoveryExclusionError(value), false);
});
