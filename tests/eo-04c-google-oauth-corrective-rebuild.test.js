import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  buildGoogleAdsAuthorizationUrl,
  GOOGLE_ADS_OAUTH_SCOPE,
} from "../app/lib/providers/google-ads-rest.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const settings = read("app/routes/_admin.settings.tsx");
const callback = read("app/routes/auth.google-ads.callback.ts");
const runtime = read("app/lib/oauth/google-oauth-runtime.server.js");
const migration = read(
  "supabase/migrations/20261011190000_eo04c_canonical_google_account_selection.sql",
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
  assert.match(migration, /cancel_pending_provider_account_selection/);
  assert.match(migration, /Only connected grants reporting authority/);
  assert.match(runtime, /state: "pending_account_selection"/);
});

test("Settings exposes only advertiser selection and clean disconnect", () => {
  assert.match(settings, /Select advertiser accounts/);
  assert.match(settings, /Manager accounts are never selectable/);
  assert.doesNotMatch(settings, /Connected advertiser account/);
  assert.doesNotMatch(settings, /Reporting account/);
  assert.match(settings, /send\("disconnect"\)/);
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
