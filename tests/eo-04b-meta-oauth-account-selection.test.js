import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  buildMetaAuthorizationUrl,
  discoverMetaAdAccounts,
  exchangeAndValidateMetaAuthorizationCode,
  META_GRAPH_VERSION,
  META_OAUTH_SCOPE,
  readMetaOAuthConfig,
  revokeMetaAuthorization,
} from "../app/lib/providers/meta-graph.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const settings = read("app/routes/_admin.settings.tsx");
const callback = read("app/routes/auth.meta.callback.ts");
const runtime = read("app/lib/oauth/meta-oauth-runtime.server.js");
const decision = read("docs/EO_04B_META_OAUTH_ACCOUNT_SELECTION.md");
const contract = JSON.parse(read("contracts/eo-04b-meta-oauth-account-selection-v1.json"));
const liveEvidence = JSON.parse(read("docs/evidence/EO_04B_META_OAUTH_LIVE_ACCEPTANCE_2026-10-13.json"));

const json = (payload, status = 200, headers = {}) => new Response(
  JSON.stringify(payload),
  {status, headers: {"content-type": "application/json", ...headers}},
);

function config() {
  return {
    appId: "123456789",
    appSecret: "test-secret",
    graphVersion: "v26.0",
    redirectUri: "https://embedded.adstable.app/auth/meta/callback",
  };
}

test("Meta OAuth configuration is exact v26.0 and ads_read only", () => {
  const parsed = readMetaOAuthConfig({
    META_APP_ID: "123456789",
    META_APP_SECRET: "test-secret",
    META_GRAPH_VERSION: "v26.0",
    META_OAUTH_REDIRECT_URI: "https://embedded.adstable.app/auth/meta/callback",
  });
  assert.equal(parsed.graphVersion, META_GRAPH_VERSION);
  const url = new URL(buildMetaAuthorizationUrl({
    config: parsed,
    state: "s".repeat(43),
  }));
  assert.equal(url.origin, "https://www.facebook.com");
  assert.equal(url.pathname, "/v26.0/dialog/oauth");
  assert.equal(url.searchParams.get("scope"), META_OAUTH_SCOPE);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), parsed.redirectUri);
  assert.equal(url.searchParams.has("code_challenge"), false);
  assert.throws(
    () => readMetaOAuthConfig({
      META_APP_ID: "123456789",
      META_APP_SECRET: "test-secret",
      META_GRAPH_VERSION: "v25.0",
      META_OAUTH_REDIRECT_URI: parsed.redirectUri,
    }),
    (error) => error.code === "META_GRAPH_VERSION_MISMATCH",
  );
});

test("short token is exchanged, app-bound and scope/expiry validated", async () => {
  const requests = [];
  const responses = [
    json({access_token: "short-token"}),
    json({access_token: "long-token"}),
    json({data: {
      is_valid: true,
      app_id: "123456789",
      scopes: ["ads_read"],
      expires_at: 1_820_000_000,
      data_access_expires_at: 1_810_000_000,
    }}),
  ];
  const result = await exchangeAndValidateMetaAuthorizationCode({
    config: config(),
    authorizationCode: "authorization-code",
    now: () => new Date("2026-10-13T00:00:00.000Z"),
    fetchFn: async (url, options) => {
      requests.push({url: String(url), options});
      return responses.shift();
    },
  });
  assert.equal(requests.length, 3);
  assert.match(requests[0].url, /v26[.]0[/]oauth[/]access_token/);
  assert.equal(new URL(requests[1].url).searchParams.get("grant_type"), "fb_exchange_token");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[1].options.method, "GET");
  assert.match(requests[2].url, /v26[.]0[/]debug_token/);
  assert.equal(requests[2].options.headers.authorization, "Bearer 123456789|test-secret");
  assert.equal(result.tokenSet.access_token, "long-token");
  assert.deepEqual(result.scopes, ["ads_read"]);
  assert.equal(result.expiresAt, "2027-05-11T01:46:40.000Z");
});

test("Meta token validation fails closed on app, scope or expiry mismatch", async () => {
  const cases = [
    [{is_valid: true, app_id: "other", scopes: ["ads_read"], expires_at: 1_800_000_000}, "META_TOKEN_APP_MISMATCH"],
    [{is_valid: true, app_id: "123456789", scopes: [], expires_at: 1_800_000_000}, "META_ADS_READ_SCOPE_MISSING"],
    [{is_valid: true, app_id: "123456789", scopes: ["ads_read"], expires_at: 1}, "META_REAUTHORIZATION_REQUIRED"],
  ];
  for (const [data, code] of cases) {
    const responses = [
      json({access_token: "short-token"}),
      json({access_token: "long-token"}),
      json({data}),
    ];
    await assert.rejects(
      exchangeAndValidateMetaAuthorizationCode({
        config: config(),
        authorizationCode: "authorization-code",
        now: () => new Date("2026-10-13T00:00:00.000Z"),
        fetchFn: async () => responses.shift(),
      }),
      (error) => error.code === code,
    );
  }
});

test("Meta advertiser discovery follows bounded opaque cursor pages", async () => {
  const requests = [];
  const responses = [
    json({
      data: [{id: "act_2", name: "Second", account_status: 1, currency: "USD", timezone_name: "UTC"}],
      paging: {cursors: {after: "opaque-next"}, next: "https://graph.facebook.com/next"},
    }),
    json({
      data: [{id: "act_1", name: "First", account_status: 1, currency: "TRY", timezone_name: "Europe/Istanbul"}],
      paging: {},
    }),
  ];
  const evidence = await discoverMetaAdAccounts({
    accessToken: "long-token",
    fetchFn: async (url, options) => {
      requests.push({url: String(url), options});
      return responses.shift();
    },
    now: () => new Date("2026-10-13T00:00:00.000Z"),
  });
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url).searchParams.get("after"), "opaque-next");
  assert.equal(requests[0].options.headers.authorization, "Bearer long-token");
  assert.deepEqual(evidence.accounts.map((account) => account.id), ["act_1", "act_2"]);
  assert.ok(evidence.accounts.every((account) => account.kind === "advertiser"));
});

test("Meta discovery treats invalid authorization as reauthorization, not empty", async () => {
  await assert.rejects(
    discoverMetaAdAccounts({
      accessToken: "invalid-token",
      fetchFn: async () => json({error: {code: 190}}, 400),
    }),
    (error) => error.code === "META_REAUTHORIZATION_REQUIRED",
  );
  await assert.rejects(
    discoverMetaAdAccounts({
      accessToken: "valid-token",
      fetchFn: async () => json({data: [], paging: {}}),
    }),
    (error) => error.code === "META_AD_ACCOUNTS_EMPTY",
  );
});

test("Meta disconnect is revoke-first and already-invalid remains idempotent", async () => {
  const requests = [];
  const revoked = await revokeMetaAuthorization({
    accessToken: "long-token",
    fetchFn: async (url, options) => {
      requests.push({url: String(url), options});
      return json({success: true});
    },
  });
  assert.deepEqual(revoked, {outcome: "revoked"});
  assert.equal(requests[0].options.method, "DELETE");
  assert.match(requests[0].url, /v26[.]0[/]me[/]permissions$/);

  const invalid = await revokeMetaAuthorization({
    accessToken: "expired-token",
    fetchFn: async () => json({error: {code: 190}}, 400),
  });
  assert.deepEqual(invalid, {outcome: "already_invalid"});
  await assert.rejects(
    revokeMetaAuthorization({
      accessToken: "live-token",
      fetchFn: async () => json({error: {code: 2}}, 503),
    }),
    (error) => error.code === "META_OAUTH_REVOKE_FAILED",
  );

  const revoke = runtime.indexOf("await revokeMetaAuthorization");
  const request = runtime.indexOf("await lifecycle.requestDisconnect");
  const finalize = runtime.indexOf("return lifecycle.finalizeDisconnect");
  assert.ok(revoke >= 0 && request > revoke && finalize > request);
});

test("Meta Settings reproduces the accepted resumable Reporting Account flow", () => {
  for (const value of [
    "meta-account-modal",
    "meta-reporting-modal",
    "Save and connect",
    "Save and finish",
    "Reporting Account",
    "Resume setup",
    "Continue to Meta",
  ]) assert.match(settings, new RegExp(value));
  assert.match(settings, /globalThis[.]open\(target[.]toString\(\), "_top"\)/);
  assert.match(settings, /metaResumeRequested[.]current = true/);
  assert.match(settings, /revalidator[.]revalidate\(\)/);
  assert.doesNotMatch(settings, /send\("cancel", "meta"\)/);
  assert.doesNotMatch(runtime, /async cancel\(/);
  assert.match(runtime, /state: "pending_reporting_account_selection"/);
  assert.match(runtime, /async finishReporting\(/);
  assert.match(runtime, /async changeReporting\(/);
  assert.match(callback, /provider: "meta"/);
});

test("Meta callback status and provider fragment are consumed from the URL", () => {
  assert.match(settings, /searchParams[.]delete\("meta_status"\)/);
  assert.match(settings, /searchParams[.]delete\("meta_error"\)/);
  assert.match(settings, /url[.]hash === "#_=_"/);
  assert.match(settings, /history[.]replaceState\(/);
  assert.doesNotMatch(settings, /searchParams[.]delete\("google_status"\)/);
});

test("Meta OAuth cannot write Dataset V2 or start scheduling", () => {
  for (const source of [settings, callback, runtime]) {
    assert.doesNotMatch(source, /dataset[_ -]?v2|snapshotjob|backfill|scheduler/i);
  }
  assert.equal(contract.invariants.oauth_writes_dataset_v2, false);
  assert.equal(contract.invariants.oauth_starts_backfill_or_scheduler, false);
  assert.match(decision, /do not\s+write Dataset V2, start backfill or schedule data jobs/);
});

test("Meta implementation leaves Google provider behavior isolated", () => {
  assert.equal(contract.invariants.google_behavior_changed_by_this_contract, false);
  assert.match(settings, /provider: Provider = "google_ads"/);
  assert.match(settings, /actionData[.]provider === "google_ads"/);
  assert.match(settings, /actionData[.]provider === "meta"/);
});

test("Meta credentials are name-only inventory entries with no committed values", () => {
  const inventory = JSON.parse(read("contracts/a6-eo-secret-inventory-recovery-v1.json"));
  const byKey = new Map(inventory.inventory.map((item) => [item.key, item]));
  for (const key of [
    "META_APP_ID",
    "META_APP_SECRET",
    "META_GRAPH_VERSION",
    "META_OAUTH_REDIRECT_URI",
  ]) {
    assert.ok(byKey.has(key));
    assert.equal(Object.hasOwn(byKey.get(key), "value"), false);
  }
  assert.equal(byKey.get("META_APP_SECRET").plaintext_readback, false);
  assert.equal(contract.mutations_authorized_by_this_contract.vercel_environment, false);
  assert.equal(contract.mutations_authorized_by_this_contract.live_oauth, false);
});

test("Meta live evidence records Windows and iOS scope without falsely closing merge", () => {
  assert.equal(liveEvidence.desktop_shopify_admin.status, "PASS");
  assert.equal(liveEvidence.mobile_shopify_admin.ios.status, "PASS_OAUTH_ENTRY");
  assert.equal(liveEvidence.mobile_shopify_admin.ios.callback_observed, false);
  assert.equal(liveEvidence.mobile_shopify_admin.android.status, "FOLLOW_UP_NON_BLOCKING");
  assert.equal(
    liveEvidence.mobile_shopify_admin.android.classification,
    "EXTERNAL_BROWSER_IDENTITY_NOT_APPLICATION_CODE_FAILURE",
  );
  assert.equal(liveEvidence.data_side_effects.dataset_v2_writes, 0);
  assert.equal(liveEvidence.closure.oauth_final_acceptance, true);
  assert.equal(liveEvidence.closure.package_final_acceptance, false);
  assert.equal(liveEvidence.closure.merge_authorized, false);
  assert.equal(liveEvidence.closure.android_retest_blocks_progress, false);
  assert.equal(contract.live_execution.desktop_shopify_admin, "PASS");
  assert.equal(contract.live_execution.mobile_shopify_admin, "PASS_IOS_OAUTH_ENTRY");
  assert.equal(contract.live_execution.android_shopify_admin, "FOLLOW_UP_NON_BLOCKING");
  assert.equal(contract.live_execution.oauth_final_acceptance, true);
});



