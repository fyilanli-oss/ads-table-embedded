import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createKlaviyoOAuthRuntime} from "../app/lib/oauth/klaviyo-oauth-runtime.server.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const contract = JSON.parse(read("contracts/eo-04d-klaviyo-reauthorization-truth-v1.json"));
const migration = read("supabase/migrations/20261017150000_eo04d_klaviyo_reauthorization_state.sql");
const settings = read("app/routes/_admin.settings.tsx");

const installationAuthority = Object.freeze({
  authority: "shopify_installation_verified",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  installGeneration: 1,
  status: "active",
});

const environment = Object.freeze({
  KLAVIYO_CLIENT_ID: "klaviyo-client",
  KLAVIYO_CLIENT_SECRET: "klaviyo-secret",
  KLAVIYO_OAUTH_REDIRECT_URI: "https://embedded.adstable.app/auth/klaviyo/callback",
});

test("reauthorization_required is a local Settings state without provider access", async () => {
  const queries = [];
  let providerCalled = false;
  const database = {
    async query(sql, values) {
      queries.push({sql, values});
      if (!sql.includes("load_provider_connection_lifecycle_by_owner")) {
        throw new Error("UNEXPECTED_DATABASE_QUERY");
      }
      return {rows: [{
        connection_id: "00000000-0000-4000-8000-000000000011",
        lifecycle_status: "reauthorization_required",
        connection_version: "4",
        credential_id: "00000000-0000-4000-8000-000000000012",
        lifecycle_changed_at: "2026-10-17T14:00:00.000Z",
        disconnected_at: null,
        disconnect_reason: null,
      }]};
    },
  };
  const runtime = createKlaviyoOAuthRuntime({
    database,
    tokenVault: {
      assertReady: async () => undefined,
      store: async () => undefined,
      take: async () => null,
      remove: async () => undefined,
    },
    environment,
    fetchFn: async () => {
      providerCalled = true;
      throw new Error("UNEXPECTED_PROVIDER_REQUEST");
    },
  });

  const inspected = await runtime.inspect({installationAuthority});

  assert.deepEqual(inspected, {state: "reauthorization_required"});
  assert.equal(providerCalled, false);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values, [
    installationAuthority.workspaceId,
    installationAuthority.installGeneration,
    "klaviyo",
  ]);
});

test("owner-scoped lifecycle read cannot grant connected reporting authority", () => {
  assert.match(migration, /load_provider_connection_lifecycle_by_owner/);
  assert.match(migration, /installation\.status = 'active'/);
  assert.match(migration, /connection\.workspace_id = p_workspace_id/);
  assert.match(migration, /connection\.install_generation = p_install_generation/);
  assert.match(migration, /connection\.provider = p_provider/);
  assert.doesNotMatch(migration, /lifecycle_status = 'connected'/);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute[\s\S]*to adstable_runtime/);
});

test("Klaviyo reauthorization can resume setup without deleting historical authority", () => {
  const setupRepository = read("app/lib/database/klaviyo-setup-repository.server.js");
  assert.match(migration, /load_pending_klaviyo_account_selection/);
  assert.match(migration, /connection\.lifecycle_status = 'pending_account_selection'/);
  assert.match(migration, /connection\.provider = 'klaviyo'/);
  assert.doesNotMatch(
    migration,
    /load_pending_klaviyo_account_selection[\s\S]*not exists \([\s\S]*provider_accounts/,
  );
  assert.match(setupRepository, /load_pending_klaviyo_account_selection/);
  assert.doesNotMatch(setupRepository, /load_pending_provider_account_selection/);
  assert.equal(
    contract.invariants.reauthorization_pending_setup_resumable_with_historical_account,
    true,
  );
});

test("Settings maps canonical reauthorization to the existing reconnect surface", () => {
  assert.match(settings, /inspected\.state === "reauthorization_required"/);
  assert.match(settings, /return \{view: "reauthorization"\}/);
  assert.match(settings, /<s-badge tone="warning">Reauthorization required<\/s-badge>/);
  assert.match(settings, /Reconnect Klaviyo/);
  assert.doesNotMatch(settings, /<button[\s>]/i);
});

test("accepted contract preserves truth now and defers recovery semantics to EO-05", () => {
  assert.equal(contract.invariants.connected_only_reporting_authority, true);
  assert.equal(contract.invariants.settings_inspection_provider_call, false);
  assert.equal(contract.invariants.reauthorization_required_visible_as_disconnected, false);
  assert.equal(contract.invariants.reauthorization_required_visible_as_reconnect, true);
  assert.equal(contract.eo05_follow_up.mandatory, true);
  assert.equal(contract.eo05_follow_up.invented_zero_for_missing_interval, false);
  assert.equal(contract.authority.live_database_apply, false);
  assert.equal(contract.authority.provider_call, false);
  assert.equal(contract.authority.deployment, false);
});
