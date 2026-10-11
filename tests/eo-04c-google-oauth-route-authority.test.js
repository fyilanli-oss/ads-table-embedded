import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {createProviderAuthorizationHandoffRepository} from "../app/lib/database/provider-authorization-handoff-repository.server.js";
import {createGoogleAuthorizationHandoff} from "../app/lib/oauth/google-authorization-handoff.server.js";

const migrationPath =
  "supabase/migrations/20261011143000_eo04c_callback_return_and_handoff_cancel.sql";

test("callback return and cancel migration keeps runtime behind narrow functions", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(
    migration,
    /create or replace function shopify[.]resolve_active_installation_callback_return/,
  );
  assert.match(
    migration,
    /create or replace function integrations[.]cancel_provider_authorization_handoff/,
  );
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /for update of handoff/);
  assert.match(migration, /installation[.]status = 'active'/);
  assert.match(migration, /USER_CANCELLED_SELECTION/);
  assert.match(migration, /delete from integrations[.]provider_credential_envelopes/);
  assert.match(
    migration,
    /revoke all on function shopify[.]resolve_active_installation_callback_return[\s\S]*public, anon, authenticated, service_role, adstable_runtime/,
  );
  assert.match(
    migration,
    /grant execute on function integrations[.]cancel_provider_authorization_handoff[\s\S]*to adstable_runtime/,
  );
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete) on/i);
});

test("repository resolves server callback domain and cancels without exposing a credential", async () => {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push([sql, values]);
      if (sql.includes("resolve_active_installation_callback_return")) {
        return {rows: [{shop_domain: "adstable-development.myshopify.com"}]};
      }
      if (sql.includes("cancel_provider_authorization_handoff")) {
        return {rows: [{cancelled: true}]};
      }
      throw new Error("unexpected query");
    },
  };
  const repository = createProviderAuthorizationHandoffRepository(database);
  const callbackReturn = await repository.resolveCallbackReturn({
    workspaceId: "00000000-0000-4000-8000-000000000001",
    installGeneration: 2,
  });
  assert.deepEqual(callbackReturn, {
    shopDomain: "adstable-development.myshopify.com",
  });

  const cancelled = await repository.cancel({
    transactionId: "00000000-0000-4000-8000-000000000002",
    workspaceId: "00000000-0000-4000-8000-000000000001",
    installGeneration: 2,
    provider: "google_ads",
    cancelledAt: "2026-10-11T14:30:00.000Z",
  });
  assert.deepEqual(cancelled, {cancelled: true});
  assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify({callbackReturn, cancelled}), /credential|token/i);
});

test("repository rejects a non-canonical callback domain", async () => {
  const repository = createProviderAuthorizationHandoffRepository({
    async query() {
      return {rows: [{shop_domain: "attacker.example"}]};
    },
  });
  await assert.rejects(
    repository.resolveCallbackReturn({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      installGeneration: 2,
    }),
    /CALLBACK_RETURN_RESULT_INVALID/,
  );
});

test("handoff orchestration binds return and cancel to verified installation authority", async () => {
  const calls = [];
  const authority = {
    authority: "shopify_installation_verified",
    status: "active",
    workspaceId: "00000000-0000-4000-8000-000000000001",
    installGeneration: 2,
  };
  const repository = {
    async create() { return {}; },
    async load() { return null; },
    async consume() { return {}; },
    async expire() { return 0; },
    async resolveCallbackReturn(value) {
      calls.push(["resolve", value]);
      return {shopDomain: "adstable-development.myshopify.com"};
    },
    async cancel(value) {
      calls.push(["cancel", value]);
      return {cancelled: true};
    },
  };
  const handoff = createGoogleAuthorizationHandoff({
    oauthBoundary: {async finalizeExchange() { return {status: "exchanged"}; }},
    tokenVault: {
      async storeProviderTokenSet() { return {credentialId: "unused"}; },
      async loadProviderTokenSet() { return null; },
      async deleteProviderTokenSet() { return true; },
    },
    repository,
    async exchangeAuthorizationCode() { return {}; },
    async refreshAccessToken() { return {}; },
    async discoverAccounts() { return {accounts: []}; },
    now: () => new Date("2026-10-11T14:30:00.000Z"),
  });

  assert.deepEqual(
    await handoff.resolveCallbackReturn({installationAuthority: authority}),
    {shopDomain: "adstable-development.myshopify.com"},
  );
  assert.deepEqual(
    await handoff.cancel({
      transactionId: "00000000-0000-4000-8000-000000000002",
      installationAuthority: authority,
    }),
    {cancelled: true},
  );
  assert.deepEqual(calls[0][1], {
    workspaceId: authority.workspaceId,
    installGeneration: authority.installGeneration,
  });
  assert.deepEqual(calls[1][1], {
    transactionId: "00000000-0000-4000-8000-000000000002",
    workspaceId: authority.workspaceId,
    installGeneration: authority.installGeneration,
    provider: "google_ads",
    cancelledAt: "2026-10-11T14:30:00.000Z",
  });
});
