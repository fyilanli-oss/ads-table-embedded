import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  createProviderAccountAuthority,
} from "../app/lib/oauth/provider-account-authority.server.js";
import {
  createProviderAccountAuthorityRepository,
} from "../app/lib/database/provider-account-authority-repository.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read(
  "supabase/migrations/20261009200000_eo03c_connection_account_authority.sql",
);
const correctiveMigration = read(
  "supabase/migrations/20261009203000_eo03c_owner_policies_fk_indexes.sql",
);
const contract = JSON.parse(
  read("contracts/eo-03c-connection-account-authority-v1.json"),
);
const master = JSON.parse(
  read("contracts/a6-eo-implementation-master-v1.json"),
);
const liveAcceptance = JSON.parse(
  read("docs/evidence/EO_03C_LIVE_ACCEPTANCE_2026-10-09.json"),
);

const workspaceId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const credentialId = "33333333-3333-4333-8333-333333333333";
const now = () => new Date("2026-10-09T13:00:00.000Z");

function installationAuthority(overrides = {}) {
  return {
    authority: "shopify_installation_verified",
    status: "active",
    workspaceId,
    installGeneration: 5,
    ...overrides,
  };
}

function account(id, overrides = {}) {
  return {
    id,
    name: "Account " + id,
    kind: "advertiser",
    reportingEligible: true,
    status: "ACTIVE",
    currency: "USD",
    timezone: "UTC",
    ...overrides,
  };
}

function evidence(provider, accounts, overrides = {}) {
  return {
    authority: "provider_account_access_verified",
    provider,
    verifiedAt: "2026-10-09T12:55:00.000Z",
    expiresAt: "2026-10-09T13:05:00.000Z",
    scopes: provider === "meta"
      ? ["ads_read", "business_management"]
      : provider === "google_ads"
        ? ["https://www.googleapis.com/auth/adwords"]
        : ["accounts:read", "campaigns:read", "flows:read"],
    accounts,
    ...overrides,
  };
}

function repository() {
  const calls = [];
  return {
    calls,
    async establish(value) {
      calls.push(["establish", value]);
      return {
        connectionId: value.connectionId,
        connectedAccountCount: value.accounts.length,
        reportingAccountId: value.reportingAccountId,
      };
    },
    async selectReportingAccount(value) {
      calls.push(["select", value]);
      return {
        connectionId: value.connectionId,
        reportingAccountId: value.providerAccountId,
        changed: true,
      };
    },
    async load(value) {
      calls.push(["load", value]);
      return null;
    },
  };
}

test("Meta authority persists only provider-verified selected accounts", async () => {
  const records = repository();
  const authority = createProviderAccountAuthority({
    repository: records,
    now,
    randomUUIDFn: () => connectionId,
  });
  const providerEvidence = evidence("meta", [
    account("act_1"),
    account("act_2"),
    account("act_3"),
    account("act_4"),
  ]);

  const result = await authority.establish({
    installationAuthority: installationAuthority(),
    provider: "meta",
    credentialId,
    providerEvidence,
    selectedAccountIds: ["act_2", "act_4"],
    reportingAccountId: "act_4",
  });

  assert.deepEqual(result, {
    connectionId,
    connectedAccountCount: 2,
    reportingAccountId: "act_4",
  });
  const persisted = records.calls[0][1];
  assert.equal(persisted.workspaceId, workspaceId);
  assert.equal(persisted.installGeneration, 5);
  assert.deepEqual(
    persisted.accounts.map((entry) => entry.id),
    ["act_2", "act_4"],
  );
  assert.equal(persisted.accounts[0].reporting_eligible, true);
  assert.equal("access_token" in persisted, false);
  assert.equal("shop_domain" in persisted, false);
});

test("Google preserves manager access path but manager is not reporting eligible", async () => {
  const records = repository();
  const authority = createProviderAccountAuthority({
    repository: records,
    now,
    randomUUIDFn: () => connectionId,
  });
  const providerEvidence = evidence("google_ads", [
    account("100", {
      kind: "manager",
      reportingEligible: false,
      loginAccountId: "100",
    }),
    account("200", {loginAccountId: "100"}),
  ]);

  await authority.establish({
    installationAuthority: installationAuthority(),
    provider: "google_ads",
    credentialId,
    providerEvidence,
    selectedAccountIds: ["100", "200"],
    reportingAccountId: "200",
  });

  assert.equal(records.calls[0][1].accounts[1].login_account_id, "100");
  await assert.rejects(
    authority.establish({
      installationAuthority: installationAuthority(),
      provider: "google_ads",
      credentialId,
      providerEvidence,
      selectedAccountIds: ["100"],
      reportingAccountId: "100",
    }),
    /REPORTING_ACCOUNT_NOT_VERIFIED_OR_INELIGIBLE/,
  );
});

test("Klaviyo is exactly one Connected Account with no Reporting Account control", async () => {
  const records = repository();
  const authority = createProviderAccountAuthority({
    repository: records,
    now,
    randomUUIDFn: () => connectionId,
  });
  const klaviyoAccount = account("AbC123", {
    kind: "account",
    name: "Klaviyo Account",
  });

  const result = await authority.establish({
    installationAuthority: installationAuthority(),
    provider: "klaviyo",
    credentialId,
    providerEvidence: evidence("klaviyo", [klaviyoAccount]),
  });
  assert.equal(result.connectedAccountCount, 1);
  assert.equal(result.reportingAccountId, null);

  await assert.rejects(
    authority.establish({
      installationAuthority: installationAuthority(),
      provider: "klaviyo",
      credentialId,
      providerEvidence: evidence("klaviyo", [klaviyoAccount]),
      selectedAccountIds: ["AbC123"],
    }),
    /KLAVIYO_REPORTING_ACCOUNT_CONTROL_FORBIDDEN/,
  );
  await assert.rejects(
    authority.establish({
      installationAuthority: installationAuthority(),
      provider: "klaviyo",
      credentialId,
      providerEvidence: evidence("klaviyo", [
        klaviyoAccount,
        {...klaviyoAccount, id: "Def456"},
      ]),
    }),
    /KLAVIYO_SINGLE_CONNECTED_ACCOUNT_REQUIRED/,
  );
});

test("unverified, stale, cross-provider and secret-bearing evidence fail closed", async () => {
  const authority = createProviderAccountAuthority({
    repository: repository(),
    now,
    randomUUIDFn: () => connectionId,
  });
  const base = {
    installationAuthority: installationAuthority(),
    provider: "meta",
    credentialId,
    selectedAccountIds: ["act_1"],
    reportingAccountId: "act_1",
  };

  await assert.rejects(
    authority.establish({
      ...base,
      installationAuthority: {...installationAuthority(), status: "deleted"},
      providerEvidence: evidence("meta", [account("act_1")]),
    }),
    /VERIFIED_ACTIVE_INSTALLATION_REQUIRED/,
  );
  await assert.rejects(
    authority.establish({
      ...base,
      providerEvidence: evidence("google_ads", [account("act_1")]),
    }),
    /VERIFIED_PROVIDER_ACCOUNT_EVIDENCE_REQUIRED/,
  );
  await assert.rejects(
    authority.establish({
      ...base,
      providerEvidence: evidence("meta", [account("act_1")], {
        verifiedAt: "2026-10-09T12:30:00.000Z",
        expiresAt: "2026-10-09T12:40:00.000Z",
      }),
    }),
    /PROVIDER_ACCOUNT_EVIDENCE_STALE/,
  );
  await assert.rejects(
    authority.establish({
      ...base,
      providerEvidence: evidence("meta", [
        {...account("act_1"), access_token: "must-never-cross-boundary"},
      ]),
    }),
    /PROVIDER_ACCOUNT_EVIDENCE_CONTAINS_SECRET_OR_AUTHORITY/,
  );
  await assert.rejects(
    authority.establish({
      ...base,
      selectedAccountIds: ["act_missing"],
      reportingAccountId: "act_missing",
      providerEvidence: evidence("meta", [account("act_1")]),
    }),
    /CONNECTED_ACCOUNT_NOT_PROVIDER_VERIFIED/,
  );
});

test("Reporting Account change requires fresh provider re-verification", async () => {
  const records = repository();
  const authority = createProviderAccountAuthority({
    repository: records,
    now,
  });

  const selected = await authority.selectReportingAccount({
    installationAuthority: installationAuthority(),
    connectionId,
    provider: "meta",
    providerAccountId: "act_2",
    providerEvidence: evidence("meta", [
      account("act_1"),
      account("act_2"),
    ]),
  });
  assert.equal(selected.reportingAccountId, "act_2");
  assert.deepEqual(records.calls[0][1], {
    connectionId,
    workspaceId,
    installGeneration: 5,
    provider: "meta",
    providerAccountId: "act_2",
    verifiedAt: "2026-10-09T12:55:00.000Z",
  });

  await assert.rejects(
    authority.selectReportingAccount({
      installationAuthority: installationAuthority(),
      connectionId,
      provider: "meta",
      providerAccountId: "act_3",
      providerEvidence: evidence("meta", [account("act_1")]),
    }),
    /REPORTING_ACCOUNT_NOT_PROVIDER_REVERIFIED/,
  );
  await assert.rejects(
    authority.selectReportingAccount({
      installationAuthority: installationAuthority(),
      connectionId,
      provider: "klaviyo",
      providerAccountId: "AbC123",
      providerEvidence: evidence("klaviyo", [
        account("AbC123", {kind: "account"}),
      ]),
    }),
    /KLAVIYO_REPORTING_ACCOUNT_CONTROL_FORBIDDEN/,
  );
});

test("repository uses only exact private database functions", async () => {
  const queries = [];
  const database = {
    async query(sql, values) {
      queries.push({sql, values});
      if (sql.includes("establish_provider_account_authority")) {
        return {rows: [{
          connection_id: connectionId,
          connected_account_count: 2,
          reporting_account_id: "act_2",
        }]};
      }
      if (sql.includes("select_reporting_account")) {
        return {rows: [{
          connection_id: connectionId,
          reporting_account_id: "act_1",
          changed: true,
        }]};
      }
      return {rows: []};
    },
  };
  const records = createProviderAccountAuthorityRepository(database);
  const established = await records.establish({
    connectionId,
    workspaceId,
    installGeneration: 5,
    provider: "meta",
    credentialId,
    grantedScopes: ["ads_read"],
    accounts: [
      {id: "act_1", name: "One"},
      {id: "act_2", name: "Two"},
    ],
    reportingAccountId: "act_2",
    verifiedAt: "2026-10-09T12:55:00.000Z",
  });
  assert.equal(established.connectedAccountCount, 2);
  assert.match(queries[0].sql, /integrations\.establish_provider_account_authority/);
  assert.doesNotMatch(
    queries[0].sql,
    /insert\s+into|update\s+|delete\s+from/i,
  );
  assert.equal(typeof queries[0].values[6], "string");

  await records.selectReportingAccount({
    connectionId,
    workspaceId,
    installGeneration: 5,
    provider: "meta",
    providerAccountId: "act_1",
    verifiedAt: "2026-10-09T12:56:00.000Z",
  });
  assert.match(queries[1].sql, /integrations\.select_reporting_account/);
});

test("migration is private, forced-RLS, function-only and installation bound", () => {
  for (const table of [
    "provider_connections",
    "provider_accounts",
    "reporting_account_bindings",
  ]) {
    assert.match(
      migration,
      new RegExp(`create table integrations\\.${table}`),
    );
    assert.match(
      migration,
      new RegExp(`alter table integrations\\.${table} force row level security`),
    );
    assert.match(
      migration,
      new RegExp(`revoke all on table integrations\\.${table}[\\s\\S]*adstable_runtime`),
    );
  }
  assert.match(
    migration,
    /references shopify\.installations\(id\)[\s\S]*on delete cascade/,
  );
  assert.match(
    migration,
    /provider_connections_authority_unique[\s\S]*workspace_id, install_generation, provider/,
  );
  assert.match(
    migration,
    /reporting_account_bindings_one_active_idx[\s\S]*where effective_to is null/,
  );
  assert.match(migration, /installation\.status = 'active'/);
  assert.match(migration, /PROVIDER_CREDENTIAL_AUTHORITY_MISMATCH/);
  assert.match(migration, /KLAVIYO_SINGLE_CONNECTED_ACCOUNT_REQUIRED/);
  assert.match(migration, /REPORTING_ACCOUNT_NOT_VERIFIED_OR_INELIGIBLE/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /set local role adstable_owner;/);
  assert.doesNotMatch(migration, /ads_table_owner/);
  assert.doesNotMatch(
    migration,
    /\b(access_token|refresh_token|token)\s+(text|bytea|json|jsonb)\b/i,
  );
});

test("corrective migration restores owner-only forced-RLS execution and covers composite foreign keys", () => {
  for (const table of [
    "provider_connections",
    "provider_accounts",
    "reporting_account_bindings",
  ]) {
    assert.match(
      correctiveMigration,
      new RegExp(`create policy ${table}_owner_all[\\s\\S]*on integrations\\.${table}[\\s\\S]*to adstable_owner[\\s\\S]*using \\(true\\)[\\s\\S]*with check \\(true\\)`),
    );
  }
  assert.match(
    correctiveMigration,
    /provider_accounts_connection_authority_fk_idx[\s\S]*connection_id, workspace_id, install_generation, provider/,
  );
  assert.match(
    correctiveMigration,
    /reporting_account_bindings_account_authority_fk_idx[\s\S]*account_id, connection_id, workspace_id, install_generation, provider/,
  );
  assert.doesNotMatch(
    correctiveMigration,
    /grant\s+(select|insert|update|delete|all)[\s\S]*adstable_runtime/i,
  );
});

test("contract keeps installed Shopify shop authoritative after EO-03 closure", () => {
  const eo03 = master.packages.find((entry) => entry.id === "A6-EO-03");
  const eo03c = eo03.children.find((entry) => entry.id === "A6-EO-03-C");

  assert.equal(contract.status, "Accepted");
  assert.equal(contract.installed_shop_authority.mutable_by_provider, false);
  assert.equal(contract.reporting_store_control_exists, false);
  assert.equal(contract.provider_rules.meta.reporting_account_cardinality, 1);
  assert.equal(contract.provider_rules.google_ads.reporting_account_cardinality, 1);
  assert.equal(contract.provider_rules.klaviyo.reporting_account_control, false);
  assert.equal(contract.live_effect.provider_api_call, false);
  assert.equal(contract.live_effect.production_database_mutation, true);
  assert.equal(contract.implementation.live_migration_applied, true);
  assert.equal(contract.acceptance_evidence.live_database, "PASS_2026-10-09");
  assert.equal(contract.acceptance_evidence.product_owner_closure, "PASS_2026-10-09");
  assert.equal(liveAcceptance.status, "ACCEPTED");
  assert.equal(liveAcceptance.product_owner_closure, "PASS_2026-10-09");
  assert.equal(liveAcceptance.synthetic_runtime_probe.status, "PASS");
  assert.equal(liveAcceptance.cleanup.provider_connection_rows, 0);
  assert.equal(liveAcceptance.cleanup.provider_account_rows, 0);
  assert.equal(liveAcceptance.cleanup.reporting_binding_rows, 0);
  assert.equal(liveAcceptance.advisors.security_findings, 0);
  assert.equal(liveAcceptance.advisors.eo03c_new_unindexed_foreign_key_findings, 0);
  assert.equal(eo03.status, "Accepted");
  assert.equal(eo03c.status, "Accepted");
  assert.equal(master.current_active_parent, "A6-EO-04");
  assert.equal(master.current_active_child, "A6-EO-04-A");
  assert.equal(master.next_ready_child, null);
  assert.equal(master.current_gate, "A6-EO-04-A_implementation_CI_and_product_owner_acceptance");
});
