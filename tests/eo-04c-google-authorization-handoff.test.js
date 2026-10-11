import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {
  createProviderAuthorizationHandoffRepository,
} from "../app/lib/database/provider-authorization-handoff-repository.server.js";
import {
  createGoogleAuthorizationHandoff,
} from "../app/lib/oauth/google-authorization-handoff.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20261011120000_eo04c_provider_authorization_handoff.sql",
  ),
  "utf8",
);

const correctiveMigration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20261011180000_eo04c_durable_selection_and_reconnect.sql",
  ),
  "utf8",
);

const workspaceId = "11111111-1111-4111-8111-111111111111";
const transactionId = "22222222-2222-4222-8222-222222222222";
const credentialId = "33333333-3333-4333-8333-333333333333";
const connectionId = "44444444-4444-4444-8444-444444444444";
const fixedNow = () => new Date("2026-10-11T12:00:00.000Z");
const owner = Object.freeze({
  authority: "shopify_installation_verified",
  status: "active",
  workspaceId,
  installGeneration: 3,
});

function claimed() {
  return {
    transactionId,
    workspaceId,
    installGeneration: 3,
    provider: "google_ads",
    authorizationCode: "authorization-code",
    pkceVerifier: "pkce-verifier",
    status: "claimed",
  };
}

function dependencies(overrides = {}) {
  const calls = [];
  const pending = {
    transactionId,
    credentialId,
    status: "awaiting_selection",
    expiresAt: null,
  };
  return {
    calls,
    oauthBoundary: {
      async finalizeExchange(value) {
        calls.push(["finalize", value]);
        return {status: value.success ? "exchanged" : "failed"};
      },
    },
    tokenVault: {
      async storeProviderTokenSet(value) {
        calls.push(["storeToken", value]);
        return {credentialId};
      },
      async loadProviderTokenSet(value) {
        calls.push(["loadToken", value]);
        return {refresh_token: "stored-refresh-token"};
      },
      async deleteProviderTokenSet(value) {
        calls.push(["deleteToken", value]);
        return true;
      },
    },
    repository: {
      async create(value) {
        calls.push(["create", value]);
        return pending;
      },
      async load(value) {
        calls.push(["load", value]);
        return pending;
      },
      async loadCurrent(value) {
        calls.push(["loadCurrent", value]);
        return pending;
      },
      async consume(value) {
        calls.push(["consume", value]);
        return {
          connectionId: value.connectionId,
          connectedAccountCount: value.accounts.length,
          reportingAccountId: value.reportingAccountId,
        };
      },
      async expire(value) {
        calls.push(["expire", value]);
        return 2;
      },
    },
    async exchangeAuthorizationCode(value) {
      calls.push(["exchange", value]);
      return {
        access_token: "ephemeral-access-token",
        refresh_token: "durable-refresh-token",
        token_type: "Bearer",
        scope: "https://www.googleapis.com/auth/adwords",
      };
    },
    async refreshAccessToken(value) {
      calls.push(["refresh", value]);
      return {
        access_token: "fresh-ephemeral-access-token",
        refresh_token: value.refreshToken,
      };
    },
    async discoverAccounts(value) {
      calls.push(["discover", value]);
      return {
        verifiedAt: "2026-10-11T12:00:00.000Z",
        scopes: ["https://www.googleapis.com/auth/adwords"],
        accounts: [
          {
            id: "100",
            name: "Manager",
            kind: "manager",
            reportingEligible: false,
            loginAccountId: "100",
          },
          {
            id: "200",
            name: "Advertiser",
            kind: "advertiser",
            reportingEligible: true,
            status: "ENABLED",
            currency: "USD",
            timezone: "UTC",
            loginAccountId: "100",
          },
        ],
      };
    },
    ...overrides,
  };
}

test("migration creates a private forced-RLS handoff and narrow runtime functions", () => {
  assert.match(migration, /create table integrations\.provider_authorization_handoffs/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /for all to adstable_owner using \(true\) with check \(true\)/);
  assert.match(
    migration,
    /revoke all on table integrations\.provider_authorization_handoffs[\s\S]*adstable_runtime/,
  );
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /limit p_limit/);
  assert.match(migration, /integrations\.establish_provider_account_authority/);
  assert.match(migration, /create index provider_authorization_handoffs_expiry_idx/);
  assert.doesNotMatch(
    migration,
    /access_token|refresh_token|authorization_code|provider_accounts jsonb/i,
  );
});

test("corrective migration separates OAuth expiry from durable selection and supports reconnect", () => {
  assert.match(correctiveMigration, /alter column expires_at drop not null/);
  assert.match(correctiveMigration, /set expires_at = null/);
  assert.match(correctiveMigration, /p_created_at, null/);
  assert.match(correctiveMigration, /integrations[.]reconnect_provider_connection/);
  assert.match(correctiveMigration, /lifecycle_status <> 'disconnected'/);
  assert.match(correctiveMigration, /expires_at is not null/);
  assert.match(
    correctiveMigration,
    /provider_authorization_handoffs_one_pending_idx/,
  );
  assert.match(
    correctiveMigration,
    /SUPERSEDED_BY_NEW_AUTHORIZATION/,
  );
  assert.match(
    correctiveMigration,
    /load_current_provider_authorization_handoff/,
  );
});

test("repository maps create, load, atomic consume and legacy bounded expiry compatibility", async () => {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push([sql, values]);
      if (sql.includes("create_provider_authorization_handoff")) {
        return {rows: [{
          oauth_transaction_id: transactionId,
          credential_id: credentialId,
          handoff_status: "awaiting_selection",
          expires_at: null,
        }]};
      }
      if (sql.includes("load_provider_authorization_handoff")) {
        return {rows: []};
      }
      if (sql.includes("consume_provider_authorization_handoff")) {
        return {rows: [{
          connection_id: connectionId,
          connected_account_count: "1",
          reporting_account_id: "200",
        }]};
      }
      return {rows: [{expired_count: "2"}]};
    },
  };
  const repository = createProviderAuthorizationHandoffRepository(database);
  const created = await repository.create({
    transactionId,
    workspaceId,
    installGeneration: 3,
    provider: "google_ads",
    credentialId,
    createdAt: "2026-10-11T12:00:00.000Z",
  });
  assert.equal(created.credentialId, credentialId);
  assert.equal(await repository.load({
    transactionId,
    workspaceId,
    installGeneration: 3,
    provider: "google_ads",
    observedAt: "2026-10-11T12:01:00.000Z",
  }), null);
  const consumed = await repository.consume({
    transactionId,
    connectionId,
    workspaceId,
    installGeneration: 3,
    provider: "google_ads",
    grantedScopes: ["scope"],
    accounts: [{id: "200"}],
    reportingAccountId: "200",
    verifiedAt: "2026-10-11T12:00:00.000Z",
    consumedAt: "2026-10-11T12:01:00.000Z",
  });
  assert.equal(consumed.connectedAccountCount, 1);
  assert.equal(await repository.expire({
    observedAt: "2026-10-11T12:20:00.000Z",
    limit: 100,
  }), 2);
  assert.equal(calls.length, 4);
});

test("callback stores refresh token only and exposes transaction correlation only", async () => {
  const deps = dependencies();
  const handoff = createGoogleAuthorizationHandoff({
    ...deps,
    now: fixedNow,
    randomUUIDFn: () => connectionId,
  });
  const result = await handoff.completeCallback({
    claimed: claimed(),
    installationAuthority: owner,
  });
  assert.deepEqual(result, {
    transactionId,
    status: "awaiting_selection",
    expiresAt: null,
  });
  assert.equal("credentialId" in result, false);
  const stored = deps.calls.find(([name]) => name === "storeToken")[1].tokenSet;
  assert.equal(stored.refresh_token, "durable-refresh-token");
  assert.equal("access_token" in stored, false);
  assert.equal(
    deps.calls.find(([name]) => name === "finalize")[1].success,
    true,
  );
});

test("discovery reloads encrypted credential and never returns token material", async () => {
  const deps = dependencies();
  const handoff = createGoogleAuthorizationHandoff({
    ...deps,
    now: fixedNow,
    randomUUIDFn: () => connectionId,
  });
  const result = await handoff.discover({
    transactionId,
    installationAuthority: owner,
  });
  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts[0].kind, "manager");
  assert.equal("credentialId" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /stored-refresh-token|fresh-ephemeral/);
  assert.equal(
    deps.calls.find(([name]) => name === "refresh")[1].refreshToken,
    "stored-refresh-token",
  );
});

test("resume discovers the canonical pending setup without restarting OAuth", async () => {
  const deps = dependencies();
  const handoff = createGoogleAuthorizationHandoff({
    ...deps,
    now: fixedNow,
    randomUUIDFn: () => connectionId,
  });
  const result = await handoff.resume({
    installationAuthority: owner,
  });
  assert.equal(result.transactionId, transactionId);
  assert.equal(result.expiresAt, null);
  assert.equal(result.accounts[1].id, "200");
  assert.ok(deps.calls.some(([name]) => name === "loadCurrent"));
  assert.equal(deps.calls.some(([name]) => name === "exchange"), false);
});

test("selection uses fresh provider evidence and atomically consumes only advertisers", async () => {
  const deps = dependencies();
  const handoff = createGoogleAuthorizationHandoff({
    ...deps,
    now: fixedNow,
    randomUUIDFn: () => connectionId,
  });
  const result = await handoff.select({
    transactionId,
    installationAuthority: owner,
    selectedAccountIds: ["200"],
    reportingAccountId: "200",
  });
  assert.equal(result.connectionId, connectionId);
  const consume = deps.calls.find(([name]) => name === "consume")[1];
  assert.equal(consume.accounts[0].id, "200");
  assert.equal(consume.accounts[0].login_account_id, "100");
  assert.equal(consume.credentialId, undefined);
  await assert.rejects(
    handoff.select({
      transactionId,
      installationAuthority: owner,
      selectedAccountIds: ["100"],
      reportingAccountId: "100",
    }),
    /NOT_VERIFIED_OR_INELIGIBLE/,
  );
});

test("failed handoff creation deletes the orphan credential ciphertext", async () => {
  const deps = dependencies({
    repository: {
      async create() {
        throw new Error("database unavailable");
      },
      async load() {
        return null;
      },
      async loadCurrent() {
        return null;
      },
      async consume() {
        throw new Error("not called");
      },
      async expire() {
        return 0;
      },
    },
  });
  const handoff = createGoogleAuthorizationHandoff({
    ...deps,
    now: fixedNow,
    randomUUIDFn: () => connectionId,
  });
  await assert.rejects(
    handoff.completeCallback({
      claimed: claimed(),
      installationAuthority: owner,
    }),
    /database unavailable/,
  );
  assert.ok(deps.calls.some(([name]) => name === "deleteToken"));
});

test("expiry delegates to the bounded server-side cleanup function", async () => {
  const deps = dependencies();
  const handoff = createGoogleAuthorizationHandoff({
    ...deps,
    now: fixedNow,
    randomUUIDFn: () => connectionId,
  });
  assert.equal(await handoff.expire({limit: 25}), 2);
  assert.deepEqual(
    deps.calls.find(([name]) => name === "expire")[1],
    {observedAt: "2026-10-11T12:00:00.000Z", limit: 25},
  );
});
