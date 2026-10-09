import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  createProviderConnectionLifecycle,
} from "../app/lib/oauth/provider-connection-lifecycle.server.js";
import {
  createProviderConnectionLifecycleRepository,
} from "../app/lib/database/provider-connection-lifecycle-repository.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migration = read(
  "supabase/migrations/20261009210000_eo03d_provider_connection_lifecycle.sql",
);
const lifecycleColumnQualificationMigration = read(
  "supabase/migrations/20261009211000_eo03d_qualify_lifecycle_event_columns.sql",
);
const contract = JSON.parse(
  read("contracts/eo-03d-provider-connection-lifecycle-v1.json"),
);

const workspaceId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const oldCredentialId = "33333333-3333-4333-8333-333333333333";
const newCredentialId = "44444444-4444-4444-8444-444444444444";
const eventId = "55555555-5555-4555-8555-555555555555";
const now = () => new Date("2026-10-09T16:00:00.000Z");

const installationAuthority = {
  authority: "shopify_installation_verified",
  status: "active",
  workspaceId,
  installGeneration: 7,
};

function lifecycle(status, version, credentialId = oldCredentialId) {
  return {
    connectionId,
    status,
    version,
    credentialId,
    lifecycleChangedAt: now().toISOString(),
    disconnectedAt: status === "disconnected" ? now().toISOString() : null,
    disconnectReason: null,
  };
}

function repository() {
  const calls = [];
  return {
    calls,
    async load(value) {
      calls.push(["load", value]);
      return lifecycle("connected", 1);
    },
    async transition(value) {
      calls.push(["transition", value]);
      return lifecycle(
        value.eventType === "disconnect_requested"
          ? "disconnect_pending"
          : "reauthorization_required",
        value.expectedVersion + 1,
      );
    },
    async renew(value) {
      calls.push(["renew", value]);
      return lifecycle("connected", value.expectedVersion + 1, newCredentialId);
    },
    async finalizeDisconnect(value) {
      calls.push(["finalize", value]);
      return lifecycle("disconnected", value.expectedVersion + 1, null);
    },
    async reconnect(value) {
      calls.push(["reconnect", value]);
      return lifecycle("connected", value.expectedVersion + 1, newCredentialId);
    },
  };
}

function fresh(provider, authority, overrides = {}) {
  return {
    authority,
    provider,
    verifiedAt: "2026-10-09T15:55:00.000Z",
    expiresAt: "2026-10-09T16:05:00.000Z",
    ...overrides,
  };
}

test("invalid grant becomes truthful reauthorization_required state", async () => {
  const records = repository();
  const service = createProviderConnectionLifecycle({
    repository: records, now,
  });
  const result = await service.markReauthorizationRequired({
    installationAuthority,
    connectionId,
    provider: "google_ads",
    expectedVersion: 3,
    eventId,
    reason: "provider_invalid_grant",
  });
  assert.equal(result.status, "reauthorization_required");
  assert.deepEqual(records.calls[0][1], {
    eventId,
    connectionId,
    workspaceId,
    installGeneration: 7,
    provider: "google_ads",
    expectedVersion: 3,
    eventType: "reauthorization_required",
    reason: "provider_invalid_grant",
    outcome: null,
    occurredAt: "2026-10-09T16:00:00.000Z",
  });
});

test("renewal requires fresh provider evidence and swaps credential authority", async () => {
  const records = repository();
  const service = createProviderConnectionLifecycle({
    repository: records, now,
  });
  const result = await service.renewCredential({
    installationAuthority,
    connectionId,
    provider: "klaviyo",
    expectedVersion: 4,
    eventId,
    expectedCredentialId: oldCredentialId,
    newCredentialId,
    providerEvidence: fresh(
      "klaviyo",
      "provider_credential_renewal_verified",
      {scopes: ["accounts:read", "flows:read"]},
    ),
  });
  assert.equal(result.version, 5);
  assert.equal(records.calls[0][1].expectedCredentialId, oldCredentialId);
  assert.equal(records.calls[0][1].newCredentialId, newCredentialId);

  await assert.rejects(
    service.renewCredential({
      installationAuthority,
      connectionId,
      provider: "klaviyo",
      expectedVersion: 5,
      eventId,
      expectedCredentialId: oldCredentialId,
      newCredentialId,
      providerEvidence: fresh(
        "meta",
        "provider_credential_renewal_verified",
        {scopes: ["ads_read"]},
      ),
    }),
    /VERIFIED_PROVIDER_LIFECYCLE_EVIDENCE_REQUIRED/,
  );
});

test("disconnect is two-phase and transient revoke is never silent success", async () => {
  const records = repository();
  const service = createProviderConnectionLifecycle({
    repository: records, now,
  });
  const pending = await service.requestDisconnect({
    installationAuthority,
    connectionId,
    provider: "meta",
    expectedVersion: 8,
    eventId,
    reason: "merchant_requested",
  });
  assert.equal(pending.status, "disconnect_pending");

  await assert.rejects(
    service.finalizeDisconnect({
      installationAuthority,
      connectionId,
      provider: "meta",
      expectedVersion: 9,
      eventId,
      reason: "merchant_requested",
      providerEvidence: fresh("meta", "provider_disconnect_verified", {
        outcome: "transient_failure",
      }),
    }),
    /VERIFIED_DISCONNECT_OUTCOME_REQUIRED/,
  );

  const disconnected = await service.finalizeDisconnect({
    installationAuthority,
    connectionId,
    provider: "meta",
    expectedVersion: 9,
    eventId,
    reason: "merchant_requested",
    providerEvidence: fresh("meta", "provider_disconnect_verified", {
      outcome: "revoked",
    }),
  });
  assert.equal(disconnected.status, "disconnected");
  assert.equal(disconnected.credentialId, null);
});

test("reconnect reuses canonical connection and fresh provider account evidence", async () => {
  const records = repository();
  const service = createProviderConnectionLifecycle({
    repository: records, now,
  });
  const result = await service.reconnect({
    installationAuthority,
    connectionId,
    provider: "meta",
    expectedVersion: 10,
    eventId,
    credentialId: newCredentialId,
    providerEvidence: fresh("meta", "provider_account_access_verified", {
      scopes: ["ads_read"],
      accounts: [{
        id: "act_123",
        name: "Primary",
        kind: "advertiser",
        reportingEligible: true,
        status: "ACTIVE",
        currency: "USD",
        timezone: "UTC",
      }],
      reportingAccountId: "act_123",
    }),
  });
  assert.equal(result.connectionId, connectionId);
  assert.equal(result.status, "connected");
  assert.equal(records.calls[0][1].accounts[0].id, "act_123");
  assert.equal(records.calls[0][1].reportingAccountId, "act_123");
});

test("repository calls only exact function boundaries", async () => {
  const queries = [];
  const database = {
    async query(sql, values) {
      queries.push({sql, values});
      return {rows: [{
        connection_id: connectionId,
        lifecycle_status: "connected",
        connection_version: "2",
        credential_id: newCredentialId,
        lifecycle_changed_at: "2026-10-09T16:00:00.000Z",
      }]};
    },
  };
  const records = createProviderConnectionLifecycleRepository(database);
  await records.renew({
    eventId,
    connectionId,
    workspaceId,
    installGeneration: 7,
    provider: "meta",
    expectedVersion: 1,
    expectedCredentialId: oldCredentialId,
    newCredentialId,
    grantedScopes: ["ads_read"],
    verifiedAt: "2026-10-09T15:55:00.000Z",
  });
  assert.match(
    queries[0].sql,
    /integrations\.renew_provider_connection_credential/,
  );
  assert.doesNotMatch(queries[0].sql, /insert\s+into|update\s+|delete\s+from/i);
});

test("migration enforces fail-closed, idempotent and secret-free lifecycle", () => {
  assert.match(
    migration,
    /lifecycle_status = 'connected'[\s\S]*credential_id is not null/,
  );
  assert.match(
    migration,
    /connection_version bigint not null default 1/,
  );
  assert.match(
    migration,
    /create table integrations\.provider_connection_lifecycle_events/,
  );
  assert.match(migration, /event_id uuid primary key/);
  assert.match(migration, /LIFECYCLE_EVENT_ID_REUSE_MISMATCH/);
  assert.match(migration, /PROVIDER_CONNECTION_VERSION_CONFLICT/);
  assert.match(migration, /disconnect_pending/);
  assert.match(migration, /reauthorization_required/);
  assert.match(migration, /reconnect_provider_connection/);
  assert.match(migration, /delete from integrations\.provider_credential_envelopes/);
  assert.match(
    migration,
    /alter table integrations\.provider_connection_lifecycle_events[\s\S]*force row level security/,
  );
  assert.doesNotMatch(
    migration,
    /\b(access_token|refresh_token|token)\s+(text|bytea|json|jsonb)\b/i,
  );
});

test("corrective migration qualifies lifecycle event columns against output variables", () => {
  assert.equal(
    (
      lifecycleColumnQualificationMigration.match(
        /provider_connection_lifecycle_events as event/g,
      ) ?? []
    ).length,
    8,
  );
  assert.doesNotMatch(
    lifecycleColumnQualificationMigration,
    /^\s+connection_id <> p_connection_id/m,
  );
  assert.match(
    lifecycleColumnQualificationMigration,
    /event\.connection_id <> p_connection_id/,
  );
  assert.match(
    lifecycleColumnQualificationMigration,
    /event\.event_id = p_event_id/,
  );
  assert.doesNotMatch(
    lifecycleColumnQualificationMigration,
    /^\s+or\s+(workspace_id|install_generation|provider|event_type)\s*<>/m,
  );
});

test("contract preserves provider differences and no live mutation authorization", () => {
  assert.equal(contract.status, "Implementation");
  assert.equal(contract.invariants.connected_only_reporting_authority, true);
  assert.equal(contract.live_effect.production_database_mutation, true);
  assert.equal(contract.implementation.live_migration_applied, true);
  assert.equal(contract.live_acceptance.schema_privilege_rls_advisor, "PASS");
  assert.equal(contract.live_acceptance.synthetic_runtime_acceptance, "FAILED");
  assert.equal(contract.live_acceptance.synthetic_rows_persisted, 0);
  assert.equal(contract.live_effect.provider_api_call, false);
  assert.equal(
    contract.provider_rules.google_ads.invalid_grant_requires_reauthorization,
    true,
  );
  assert.equal(
    contract.provider_rules.klaviyo.token_host,
    "a.klaviyo.com",
  );
  assert.equal(
    contract.provider_rules.meta.refresh_grant_invented,
    false,
  );
});
