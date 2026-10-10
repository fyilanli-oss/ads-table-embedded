import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {
  OAUTH_CALLBACK_URIS,
  createOAuthTransactionBoundary,
  oauthInstallationAuthority,
} from "../app/lib/oauth/oauth-transaction.server.js";
import {createOAuthTransactionRepository} from "../app/lib/database/oauth-transaction-repository.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read(
  "supabase/migrations/20261009170000_eo03a_oauth_transaction_boundary.sql",
);
const installationIndexMigration = read(
  "supabase/migrations/20261009173000_eo03a_oauth_installation_fk_index.sql",
);
const contract = JSON.parse(
  read("contracts/eo-03a-oauth-transaction-boundary-v1.json"),
);
const liveDatabaseEvidence = JSON.parse(
  read("docs/evidence/EO_03A_DATABASE_ACCEPTANCE_2026-10-09.json"),
);
const implementationMaster = JSON.parse(
  read("contracts/a6-eo-implementation-master-v1.json"),
);

const workspaceId = "11111111-1111-4111-8111-111111111111";
const transactionId = "22222222-2222-4222-8222-222222222222";
const authority = oauthInstallationAuthority({
  workspaceId,
  installGeneration: 3,
  status: "active",
});

function deterministicBytes() {
  let value = 0;
  return (size) => Buffer.alloc(size, ++value);
}

function createVault() {
  const values = new Map();
  return {
    ready: [],
    async assertReady(provider) {
      this.ready.push(provider);
    },
    async store(id, verifier) {
      values.set(id, verifier);
    },
    async take(id) {
      const verifier = values.get(id) ?? null;
      values.delete(id);
      return verifier;
    },
    async remove(id) {
      values.delete(id);
    },
    has(id) {
      return values.has(id);
    },
  };
}

function createRepository(provider = "klaviyo") {
  const calls = [];
  const repository = {
    calls,
    async create(input) {
      calls.push(["create", input]);
      return {
        transactionId,
        callbackUri: OAUTH_CALLBACK_URIS[provider],
        pkceRequired: provider !== "meta",
        expiresAt: "2026-10-09T12:10:00.000Z",
        status: "created",
      };
    },
    async markRedirected(id, at) {
      calls.push(["redirect", {id, at}]);
      return {transactionId: id, status: "redirected"};
    },
    async claim(input) {
      calls.push(["claim", input]);
      return {
        transactionId,
        workspaceId,
        installGeneration: 3,
        provider,
        callbackUri: OAUTH_CALLBACK_URIS[provider],
        pkceRequired: provider !== "meta",
        status: "claimed",
      };
    },
    async complete(input) {
      calls.push(["complete", input]);
      return {transactionId: input.transactionId, status: input.outcome};
    },
    async invalidate(input) {
      calls.push(["invalidate", input]);
      return {transactionId: input.transactionId, status: "invalidated"};
    },
  };
  return repository;
}

test("begin derives exact callback and persists only digest, nonce and challenge", async () => {
  const repository = createRepository("klaviyo");
  const vault = createVault();
  const boundary = createOAuthTransactionBoundary({
    repository,
    verifierVault: vault,
    now: () => new Date("2026-10-09T12:00:00.000Z"),
    randomBytesFn: deterministicBytes(),
  });

  const started = await boundary.begin({
    installationAuthority: authority,
    provider: "klaviyo",
  });
  const persisted = repository.calls[0][1];

  assert.equal(started.callbackUri, OAUTH_CALLBACK_URIS.klaviyo);
  assert.equal(started.pkceMethod, "S256");
  assert.equal(started.state.length, 43);
  assert.equal(started.pkceChallenge.length, 43);
  assert.deepEqual(
    persisted.stateDigest,
    createHash("sha256").update(started.state, "ascii").digest(),
  );
  assert.equal(persisted.transactionNonce.length, 32);
  assert.equal(persisted.pkceChallenge, started.pkceChallenge);
  assert.equal("state" in persisted, false);
  assert.equal("authorizationCode" in persisted, false);
  assert.equal("pkceVerifier" in persisted, false);
  assert.equal(vault.has(transactionId), true);
  assert.deepEqual(vault.ready, ["klaviyo"]);
});

test("callback claims atomically and keeps authorization code in memory only", async () => {
  const repository = createRepository("google_ads");
  const vault = createVault();
  const boundary = createOAuthTransactionBoundary({
    repository,
    verifierVault: vault,
    now: () => new Date("2026-10-09T12:00:00.000Z"),
    randomBytesFn: deterministicBytes(),
  });
  const started = await boundary.begin({
    installationAuthority: authority,
    provider: "google_ads",
  });
  const claimed = await boundary.claimCallback({
    provider: "google_ads",
    state: started.state,
    code: "one-time-provider-code",
  });

  assert.equal(claimed.authorizationCode, "one-time-provider-code");
  assert.equal(typeof claimed.pkceVerifier, "string");
  assert.equal(vault.has(transactionId), false);
  const claimInput = repository.calls.find(([name]) => name === "claim")[1];
  assert.deepEqual(
    claimInput.stateDigest,
    createHash("sha256").update(started.state, "ascii").digest(),
  );
  assert.equal("authorizationCode" in claimInput, false);
  assert.equal(
    repository.calls.some(([, input]) =>
      JSON.stringify(input).includes("one-time-provider-code"),
    ),
    false,
  );
});

test("provider denial closes truthfully without exposing raw provider error", async () => {
  const repository = createRepository("meta");
  const boundary = createOAuthTransactionBoundary({
    repository,
    verifierVault: createVault(),
    now: () => new Date("2026-10-09T12:00:00.000Z"),
    randomBytesFn: deterministicBytes(),
  });
  const started = await boundary.begin({
    installationAuthority: authority,
    provider: "meta",
  });
  const denied = await boundary.claimCallback({
    provider: "meta",
    state: started.state,
    providerError: "access_denied: user email must never be persisted",
  });

  assert.equal(denied.status, "denied");
  const completion = repository.calls.find(([name]) => name === "complete")[1];
  assert.equal(completion.failureCode, "PROVIDER_CONSENT_DENIED");
  assert.doesNotMatch(JSON.stringify(repository.calls), /user email/i);
});

test("unverified authority and unsupported provider fail before persistence", async () => {
  const repository = createRepository();
  const boundary = createOAuthTransactionBoundary({
    repository,
    verifierVault: createVault(),
    randomBytesFn: deterministicBytes(),
  });

  await assert.rejects(
    boundary.begin({
      installationAuthority: {
        workspaceId,
        installGeneration: 3,
        status: "active",
      },
      provider: "klaviyo",
    }),
    /VERIFIED_ACTIVE_INSTALLATION_REQUIRED/,
  );
  await assert.rejects(
    boundary.begin({
      installationAuthority: authority,
      provider: "unknown",
    }),
    /OAUTH_PROVIDER_UNSUPPORTED/,
  );
  assert.equal(repository.calls.length, 0);
});

test("vault failure invalidates the transaction before any provider redirect", async () => {
  const repository = createRepository("klaviyo");
  const vault = createVault();
  vault.store = async () => {
    throw new Error("VAULT_UNAVAILABLE");
  };
  const boundary = createOAuthTransactionBoundary({
    repository,
    verifierVault: vault,
    now: () => new Date("2026-10-09T12:00:00.000Z"),
    randomBytesFn: deterministicBytes(),
  });

  await assert.rejects(
    boundary.begin({
      installationAuthority: authority,
      provider: "klaviyo",
    }),
    /VAULT_UNAVAILABLE/,
  );
  assert.equal(
    repository.calls.some(([name]) => name === "redirect"),
    false,
  );
  assert.equal(
    repository.calls.find(([name]) => name === "invalidate")[1].failureCode,
    "AUTHORIZATION_START_FAILED",
  );
});

test("repository exposes function-only runtime operations", async () => {
  const queries = [];
  const database = {
    async query(sql, values) {
      queries.push({sql, values});
      if (sql.includes("create_oauth_transaction")) {
        return {rows: [{
          transaction_id: transactionId,
          callback_uri: OAUTH_CALLBACK_URIS.meta,
          pkce_required: false,
          expires_at: "2026-10-09T12:10:00.000Z",
          transaction_status: "created",
        }]};
      }
      return {rows: []};
    },
  };
  const repository = createOAuthTransactionRepository(database);
  const result = await repository.create({
    workspaceId,
    installGeneration: 3,
    provider: "meta",
    stateDigest: Buffer.alloc(32),
    transactionNonce: Buffer.alloc(32, 1),
    pkceChallenge: null,
    createdAt: "2026-10-09T12:00:00.000Z",
  });

  assert.equal(result.status, "created");
  assert.match(queries[0].sql, /integrations\.create_oauth_transaction/);
  assert.equal(queries[0].values.length, 7);
  assert.doesNotMatch(queries[0].sql, /insert\s+into/i);
});

test("migration is private, forced-RLS, exact-callback and generation bound", () => {
  assert.match(migration, /create table integrations\.oauth_transactions/);
  assert.match(migration, /installation_id bigint not null/);
  assert.doesNotMatch(migration, /create schema/i);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(
    migration,
    /revoke all on table integrations\.oauth_transactions[\s\S]*adstable_runtime/,
  );
  assert.match(
    migration,
    /references shopify\.installations\(id\)[\s\S]*on delete cascade/,
  );
  assert.match(migration, /installation\.status = 'active'/);
  assert.match(migration, /for update/);
  assert.match(migration, /OAUTH_STATE_ALREADY_USED/);
  assert.match(migration, /interval '10 minutes'/);
  for (const callback of Object.values(OAUTH_CALLBACK_URIS)) {
    assert.match(migration, new RegExp(callback.replace(/[.*+?^$()|[\]{}]/g, "\\$&")));
  }
  assert.doesNotMatch(
    migration,
    /authorization_code\s+(text|bytea)|access_token\s+(text|bytea)|refresh_token\s+(text|bytea)|pkce_verifier\s+(text|bytea)/i,
  );
});

test("contract binds implementation and keeps live authorization disabled", () => {
  assert.equal(contract.status, "Accepted");
  assert.equal(contract.implementation.schema, "integrations.oauth_transactions");
  assert.equal(contract.implementation.runtime_table_access, false);
  assert.equal(contract.implementation.installation_delete_cascade, true);
  assert.equal(contract.live_effect.live_oauth, false);
  assert.equal(
    contract.eo03b_dependency.live_authorization_enabled_before_vault_guard,
    false,
  );
});


test("corrective migration covers the installation foreign key", () => {
  assert.match(
    installationIndexMigration,
    /create index oauth_transactions_installation_fk_idx[\s\S]*on integrations\.oauth_transactions \(installation_id\)/,
  );
  assert.doesNotMatch(installationIndexMigration, /drop|delete|update|insert/i);
});

test("live database evidence closes the technical acceptance gate without product-owner closure", () => {
  assert.equal(contract.status, "Accepted");
  assert.equal(contract.acceptance_evidence.live_database, "PASS_2026-10-09");
  assert.equal(contract.acceptance_evidence.product_owner_closure, "PASS_2026-10-09");
  assert.equal(liveDatabaseEvidence.table.rows, 0);
  assert.equal(liveDatabaseEvidence.table.rls_enabled, true);
  assert.equal(liveDatabaseEvidence.table.rls_forced, true);
  assert.equal(liveDatabaseEvidence.index.valid, true);
  assert.equal(liveDatabaseEvidence.index.ready, true);
  assert.equal(liveDatabaseEvidence.index.advisor_unindexed_fk_finding, false);
  assert.equal(liveDatabaseEvidence.advisors.security_findings, 0);
  assert.equal(liveDatabaseEvidence.advisors.eo03a_new_performance_findings, 0);
  assert.equal(liveDatabaseEvidence.synthetic_oauth_rows_created, false);
  assert.equal(liveDatabaseEvidence.secrets_tokens_codes_or_pii_recorded, false);
});

test("master plan keeps EO-03 closed after EO-04-A acceptance", () => {
  const eo03 = implementationMaster.packages.find(
    (entry) => entry.id === "A6-EO-03",
  );
  const eo04 = implementationMaster.packages.find(
    (entry) => entry.id === "A6-EO-04",
  );
  const eo03a = eo03.children.find((entry) => entry.id === "A6-EO-03-A");
  const eo03b = eo03.children.find((entry) => entry.id === "A6-EO-03-B");
  const eo03c = eo03.children.find((entry) => entry.id === "A6-EO-03-C");
  const eo03d = eo03.children.find((entry) => entry.id === "A6-EO-03-D");

  assert.equal(implementationMaster.status, "EO-04_active_EO-04-C_start_brief_accepted_implementation_pending_EO-04-D_official_docs_active");
  assert.equal(eo03.status, "Accepted");
  assert.equal(eo03a.status, "Accepted");
  assert.equal(eo03a.explicit_product_owner_closure, "PASS_2026-10-09");
  assert.equal(eo03a.single_next_child, "A6-EO-03-B");
  assert.equal(eo03b.status, "Accepted");
  assert.equal(eo03b.start_gate, "PASS_A6-EO-03-A_accepted_2026-10-09");
  assert.equal(eo03b.explicit_product_owner_closure, "PASS_2026-10-09");
  assert.equal(eo03b.single_next_child, "A6-EO-03-C");
  assert.equal(eo03c.status, "Accepted");
  assert.equal(eo03c.start_gate, "PASS_A6-EO-03-B_accepted_2026-10-09");
  assert.equal(eo03c.explicit_product_owner_closure, "PASS_2026-10-09");
  assert.equal(eo03c.single_next_child, "A6-EO-03-D");
  assert.equal(eo03d.status, "Accepted");
  assert.equal(eo03d.start_gate, "PASS_A6-EO-03-C_accepted_2026-10-09");
  assert.equal(eo04.status, "Active");
  assert.equal(implementationMaster.current_active_parent, "A6-EO-04");
  assert.equal(implementationMaster.current_active_child, "A6-EO-04-D");
  assert.equal(implementationMaster.next_ready_child, null);
  assert.equal(contract.next_child.live_authorization_remains_disabled, true);
});
