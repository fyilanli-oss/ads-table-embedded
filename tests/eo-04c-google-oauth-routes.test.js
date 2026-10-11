import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {
  installedShopifySettingsUrl,
  SHOPIFY_APP_HANDLE,
} from "../app/lib/shopify/installed-app-return.server.js";
import {
  createOAuthTransactionBoundary,
  oauthInstallationAuthority,
} from "../app/lib/oauth/oauth-transaction.server.js";

test("installed-shop return URL is exact and rejects browser-defined parameters", () => {
  assert.equal(SHOPIFY_APP_HANDLE, "adstable-1");
  assert.equal(
    installedShopifySettingsUrl("adstable-development.myshopify.com", {
      google_setup: "22222222-2222-4222-8222-222222222222",
    }),
    "https://admin.shopify.com/store/adstable-development/apps/adstable-1/settings?google_setup=22222222-2222-4222-8222-222222222222",
  );
  assert.throws(
    () => installedShopifySettingsUrl("attacker.example", {}),
    /canonical myshopify/,
  );
  assert.throws(
    () => installedShopifySettingsUrl("safe.myshopify.com", {
      shop: "attacker.myshopify.com",
    }),
    /PARAMETER_FORBIDDEN/,
  );
});

test("provider denial retains claimed server authority for a safe installed-shop return", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const transactionId = "22222222-2222-4222-8222-222222222222";
  const vault = {
    async assertReady() {},
    async store() {},
    async take() { return null; },
    async remove() {},
  };
  const repository = {
    async create() {
      return {
        transactionId,
        callbackUri: "https://embedded.adstable.app/auth/google-ads/callback",
        pkceRequired: true,
        expiresAt: "2026-10-11T18:10:00.000Z",
        status: "created",
      };
    },
    async markRedirected() { return {transactionId, status: "redirected"}; },
    async claim() {
      return {
        transactionId,
        workspaceId,
        installGeneration: 3,
        provider: "google_ads",
        callbackUri: "https://embedded.adstable.app/auth/google-ads/callback",
        pkceRequired: true,
        status: "claimed",
      };
    },
    async complete(value) { return {transactionId, status: value.outcome}; },
    async invalidate() { return {transactionId, status: "invalidated"}; },
  };
  const boundary = createOAuthTransactionBoundary({
    repository,
    verifierVault: vault,
    now: () => new Date("2026-10-11T18:00:00.000Z"),
  });
  const denied = await boundary.claimCallback({
    provider: "google_ads",
    state: "a".repeat(43),
    providerError: "access_denied raw provider text",
  });
  assert.deepEqual(denied, {
    transactionId,
    workspaceId,
    installGeneration: 3,
    provider: "google_ads",
    status: "denied",
  });
  assert.deepEqual(
    oauthInstallationAuthority({
      workspaceId: denied.workspaceId,
      installGeneration: denied.installGeneration,
      status: "active",
    }),
    {
      authority: "shopify_installation_verified",
      workspaceId,
      installGeneration: 3,
      status: "active",
    },
  );
});

test("Settings and callback routes preserve the accepted Shopify UI and authority boundary", async () => {
  const settings = await readFile("app/routes/_admin.settings.tsx", "utf8");
  const callback = await readFile("app/routes/auth.google-ads.callback.ts", "utf8");

  for (const component of [
    "s-page", "s-section", "s-choice-list", "s-choice", "s-button", "s-banner",
  ]) {
    assert.match(settings, new RegExp("<" + component));
  }
  assert.doesNotMatch(settings, /<(?:form|button|input|select|style)\b/i);
  assert.doesNotMatch(settings, /style=|className=|#[0-9a-f]{3,8}/i);
  assert.match(settings, /authenticateAdmin: authenticate[.]admin/);
  assert.match(settings, /getAll\("connectedAccountIds"\)/);
  assert.match(settings, /reportingAccountId/);
  assert.match(callback, /claimCallback/);
  assert.match(callback, /installedShopifySettingsUrl/);
  assert.doesNotMatch(callback, /searchParams[.]get\("(?:shop|workspace|credential)/);
});
