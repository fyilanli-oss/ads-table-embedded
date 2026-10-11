import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  buildGoogleAdsAuthorizationUrl,
  GOOGLE_ADS_OAUTH_SCOPE,
  GOOGLE_ADS_REVOCATION_ENDPOINT,
  revokeGoogleAdsAuthorization,
} from "../app/lib/providers/google-ads-rest.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const settings = read("app/routes/_admin.settings.tsx");
const callback = read("app/routes/auth.google-ads.callback.ts");
const runtime = read("app/lib/oauth/google-oauth-runtime.server.js");
const migration = read(
  "supabase/migrations/20261011190000_eo04c_canonical_google_account_selection.sql",
);
const ambiguityFix = read(
  "supabase/migrations/20261011191000_eo04c_qualify_account_selection_columns.sql",
);
const decision = read(
  "docs/decisions/A6_EO_04_C_GOOGLE_OAUTH_CORRECTIVE_REBUILD.md",
);

test("Google setup has no browser handoff or setup reference", () => {
  for (const source of [settings, callback, runtime]) {
    assert.doesNotMatch(source, /searchParams[.](?:get|set)[(]["']google_setup["']/i);
    assert.doesNotMatch(source, /authorization[_-]handoff/i);
    assert.doesNotMatch(source, /transactionId.*form|form.*transactionId/i);
  }
  assert.match(decision, /MUST NOT depend on a Google setup reference/);
});

test("canonical pending selection is resumable and fails closed", () => {
  assert.match(migration, /pending_account_selection/);
  assert.match(migration, /stage_provider_account_selection/);
  assert.match(migration, /complete_pending_provider_account_selection/);
  assert.match(migration, /Only connected grants reporting authority/);
  assert.match(runtime, /state: "pending_account_selection"/);
});

test("Settings exposes only advertiser selection and clean disconnect", () => {
  assert.match(settings, />Resume setup</);\n  assert.doesNotMatch(settings, /Select advertiser accounts/);
  assert.match(settings, /Manager accounts are never selectable/);
  assert.doesNotMatch(settings, /Connected advertiser account/);
  assert.doesNotMatch(settings, /Reporting account/);
  assert.doesNotMatch(runtime, /reportingAccountId/);
  assert.doesNotMatch(migration, /p_reporting_account_id/);
  assert.match(settings, /send\("disconnect"\)/);
});

test("pending Google setup auto-opens selection and Cancel preserves Resume setup", () => {
  assert.match(settings, /const accountModal = useRef<any>\(null\)/);
  assert.match(settings, /accountModal[.]current[?][.]showOverlay[?][.]\(\)/);
  assert.match(settings, /const resumeAccountSelection = \(\) =>/);
  assert.match(settings, /revalidator[.]revalidate\(\)/);
  assert.match(
    settings,
    /commandFor="google-account-modal"[\s\S]*command="--hide"[\s\S]*>\s*Cancel/,
  );
  assert.doesNotMatch(settings, /send\("cancel"\)/);
  assert.doesNotMatch(runtime, /async cancel\(/);
});

test("Resume setup cannot restart Google OAuth", () => {
  const resumeStart = settings.indexOf("const resumeAccountSelection");
  const resumeEnd = settings.indexOf("\n  };", resumeStart);
  assert.ok(resumeStart >= 0 && resumeEnd > resumeStart);
  const resumeSource = settings.slice(resumeStart, resumeEnd);
  assert.match(resumeSource, /revalidator[.]revalidate\(\)/);
  assert.doesNotMatch(resumeSource, /send\("begin"\)|oauthBoundary[.]begin/);
});

test("callback errors remain visible and account-loading retry does not restart OAuth", () => {
  assert.match(settings, /google_error/);
  assert.match(settings, /retry: "oauth"/);
  assert.match(settings, /retry: "reload"/);
  assert.match(settings, /revalidator[.]revalidate/);
});

test("Google authorization URL is offline, consented and PKCE-bound", () => {
  const url = new URL(buildGoogleAdsAuthorizationUrl({
    config: {
      clientId: "client.apps.googleusercontent.com",
      redirectUri: "https://embedded.adstable.app/auth/google-ads/callback",
    },
    state: "s".repeat(43),
    pkceChallenge: "p".repeat(43),
  }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), GOOGLE_ADS_OAUTH_SCOPE);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("manager accounts are access paths, never selected evidence", () => {
  assert.match(
    read("app/lib/providers/google-account-discovery.server.js"),
    /kind: manager \? "manager" : "advertiser"/,
  );
  assert.match(runtime, /account.kind === "advertiser"/);
  assert.match(migration, /item.value ->> 'kind' <> 'advertiser'/);
});

test("provider account selection SQL qualifies output-column collisions", () => {
  assert.match(
    ambiguityFix,
    /connection_version = target_connection[.]connection_version [+] 1/,
  );
  assert.match(
    ambiguityFix,
    /where binding[.]connection_id = p_connection_id/,
  );
  assert.match(
    ambiguityFix,
    /where account[.]connection_id = p_connection_id/,
  );
  assert.match(
    ambiguityFix,
    /on conflict on constraint provider_accounts_connection_account_unique/,
  );
  assert.doesNotMatch(
    ambiguityFix,
    /connection_version = connection_version [+] 1/,
  );
});


test("Google disconnect revokes the provider grant with the refresh token", async () => {
  const requests = [];
  const result = await revokeGoogleAdsAuthorization({
    token: "refresh-secret",
    fetchFn: async (url, options) => {
      requests.push({url, options});
      return {
        ok: true,
        status: 200,
        headers: {get: () => null},
        json: async () => null,
      };
    },
  });
  assert.deepEqual(result, {outcome: "revoked"});
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, GOOGLE_ADS_REVOCATION_ENDPOINT);
  assert.equal(requests[0].options.method, "POST");
  assert.equal(
    requests[0].options.headers["content-type"],
    "application/x-www-form-urlencoded",
  );
  assert.equal(
    new URLSearchParams(requests[0].options.body).get("token"),
    "refresh-secret",
  );
});

test("already invalid Google authorization remains idempotently disconnectable", async () => {
  const result = await revokeGoogleAdsAuthorization({
    token: "already-invalid-secret",
    fetchFn: async () => ({
      ok: false,
      status: 400,
      headers: {get: () => null},
      json: async () => ({error: "invalid_token"}),
    }),
  });
  assert.deepEqual(result, {outcome: "already_invalid"});
});

test("failed Google revoke fails closed before local disconnect", async () => {
  await assert.rejects(
    revokeGoogleAdsAuthorization({
      token: "live-secret",
      fetchFn: async () => ({
        ok: false,
        status: 503,
        headers: {get: () => "provider-request"},
        json: async () => ({error: "temporarily_unavailable"}),
      }),
    }),
    (error) => error.code === "GOOGLE_ADS_OAUTH_REVOKE_FAILED",
  );
  const revoke = runtime.indexOf("await revokeGoogleAdsAuthorization");
  const request = runtime.indexOf("await lifecycle.requestDisconnect");
  const finalize = runtime.indexOf("return lifecycle.finalizeDisconnect");
  assert.ok(revoke >= 0 && request > revoke && finalize > request);
  assert.doesNotMatch(runtime, /outcome: "local_authority_removed"/);
});
