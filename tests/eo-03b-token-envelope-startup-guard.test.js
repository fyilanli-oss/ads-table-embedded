import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  createTokenEnvelopeCipher,
  readProviderTokenKeyring,
  TOKEN_VAULT_CONTRACT_VERSION,
} from "../app/lib/oauth/token-envelope.server.js";
import {createTokenVault} from "../app/lib/oauth/token-vault.server.js";
import {createTokenVaultRepository} from "../app/lib/database/token-vault-repository.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/20261009180000_eo03b_token_vault.sql");
const workspaceIndexMigration = read(
  "supabase/migrations/20261009190000_eo03b_pkce_workspace_fk_index.sql",
);
const contract = JSON.parse(
  read("contracts/eo-03b-token-envelope-startup-guard-v1.json"),
);
const master = JSON.parse(read("contracts/a6-eo-implementation-master-v1.json"));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const transactionId = "22222222-2222-4222-8222-222222222222";
const credentialId = "33333333-3333-4333-8333-333333333333";
const keyV1 = Buffer.alloc(32, 11).toString("base64url");
const keyV2 = Buffer.alloc(32, 22).toString("base64url");
const sessionKey = Buffer.alloc(32, 33).toString("base64url");

function environment(overrides = {}) {
  return {
    ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION: "2",
    ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1: keyV1,
    ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V2: keyV2,
    ADSTABLE_SESSION_ENCRYPTION_KEY_V1: sessionKey,
    ...overrides,
  };
}

function identity(overrides = {}) {
  return {
    recordId: transactionId,
    workspaceId,
    installGeneration: 4,
    provider: "klaviyo",
    purpose: "pkce_verifier",
    ...overrides,
  };
}

function installationAuthority(overrides = {}) {
  return {
    authority: "shopify_installation_verified",
    status: "active",
    workspaceId,
    installGeneration: 4,
    ...overrides,
  };
}

test("keyring requires an active, versioned, distinct provider key family", () => {
  const keyring = readProviderTokenKeyring(environment());
  assert.equal(keyring.activeVersion, 2);
  assert.deepEqual(keyring.versions, [1, 2]);
  assert.deepEqual(keyring.get(1), Buffer.alloc(32, 11));

  assert.throws(
    () => readProviderTokenKeyring(environment({
      ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION: "3",
    })),
    /PROVIDER_TOKEN_ACTIVE_KEY_UNAVAILABLE/,
  );
  assert.throws(
    () => readProviderTokenKeyring(environment({
      ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V2: keyV1,
    })),
    /PROVIDER_TOKEN_KEY_REUSED_ACROSS_VERSIONS/,
  );
  assert.throws(
    () => readProviderTokenKeyring(environment({
      ADSTABLE_SESSION_ENCRYPTION_KEY_V1: keyV2,
    })),
    /PROVIDER_TOKEN_KEY_MUST_DIFFER_FROM_SESSION_KEY/,
  );
});

test("AES-256-GCM envelope roundtrips without persisting plaintext", () => {
  const keyring = readProviderTokenKeyring(environment());
  const cipher = createTokenEnvelopeCipher({
    keyring,
    randomBytesFn: (size) => Buffer.alloc(size, 7),
  });
  const secret = "pkce-secret-that-must-not-be-readable";
  const sealed = cipher.seal({identity: identity(), secret});

  assert.equal(sealed.keyVersion, 2);
  assert.equal(sealed.nonce.length, 12);
  assert.equal(sealed.authTag.length, 16);
  assert.equal(sealed.ciphertext.includes(Buffer.from(secret)), false);
  assert.equal(cipher.open(sealed), secret);
});

test("tamper and cross-authority substitution fail authentication", () => {
  const keyring = readProviderTokenKeyring(environment());
  const cipher = createTokenEnvelopeCipher({
    keyring,
    randomBytesFn: (size) => Buffer.alloc(size, 9),
  });
  const sealed = cipher.seal({identity: identity(), secret: "one-use-secret"});

  const tampered = {
    ...sealed,
    ciphertext: Buffer.from(sealed.ciphertext),
  };
  tampered.ciphertext[0] ^= 1;
  assert.throws(() => cipher.open(tampered), /TOKEN_ENVELOPE_AUTHENTICATION_FAILED/);

  for (const changed of [
    {workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
    {installGeneration: 5},
    {provider: "google_ads"},
    {purpose: "provider_token_set"},
    {recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
  ]) {
    assert.throws(
      () => cipher.open({...sealed, ...changed}),
      /TOKEN_ENVELOPE_AUTHENTICATION_FAILED/,
    );
  }
});

test("startup guard checks database contract and every stored key version", async () => {
  const keyring = readProviderTokenKeyring(environment());
  const calls = [];
  const repository = {
    async assertContract(version) {
      calls.push(version);
      return {contractVersion: 1, usedKeyVersions: [1, 2]};
    },
  };
  for (const name of [
    "storePkce", "takePkce", "deletePkce",
    "storeCredential", "loadCredential", "deleteCredential",
  ]) repository[name] = async () => null;

  const vault = createTokenVault({repository, keyring});
  const first = await vault.assertRuntimeReady();
  const second = await vault.assertReady("klaviyo");
  assert.equal(first.contractVersion, TOKEN_VAULT_CONTRACT_VERSION);
  assert.equal(first.activeKeyVersion, 2);
  assert.equal(second, first);
  assert.deepEqual(calls, [1]);

  const missingKeyRepository = {
    ...repository,
    async assertContract() {
      return {contractVersion: 1, usedKeyVersions: [3]};
    },
  };
  await assert.rejects(
    createTokenVault({repository: missingKeyRepository, keyring}).assertReady("meta"),
    /PROVIDER_TOKEN_KEY_VERSION_UNAVAILABLE/,
  );

  const wrongContractRepository = {
    ...repository,
    async assertContract() {
      return {contractVersion: 2, usedKeyVersions: []};
    },
  };
  await assert.rejects(
    createTokenVault({repository: wrongContractRepository, keyring}).assertReady("meta"),
    /TOKEN_VAULT_CONTRACT_VERSION_MISMATCH/,
  );
});

test("PKCE persistence carries only ciphertext and exact authority context", async () => {
  const keyring = readProviderTokenKeyring(environment());
  const cipher = createTokenEnvelopeCipher({
    keyring,
    randomBytesFn: (size) => Buffer.alloc(size, 4),
    randomUUIDFn: () => credentialId,
  });
  const stored = [];
  let taken;
  const repository = {
    async assertContract() {
      return {contractVersion: 1, usedKeyVersions: []};
    },
    async storePkce(value) {
      stored.push(value);
      taken = value;
      return true;
    },
    async takePkce(request) {
      assert.deepEqual(request, {
        transactionId,
        workspaceId,
        installGeneration: 4,
        provider: "klaviyo",
        takenAt: "2026-10-09T16:00:00.000Z",
      });
      const result = taken;
      taken = null;
      return result;
    },
    async deletePkce() {
      return false;
    },
    async storeCredential() {
      throw new Error("not expected");
    },
    async loadCredential() {
      return null;
    },
    async deleteCredential() {
      return false;
    },
  };
  const vault = createTokenVault({
    repository,
    keyring,
    cipher,
    now: () => new Date("2026-10-09T16:00:00.000Z"),
  });
  const verifier = "plain-verifier-never-written";
  await vault.store(transactionId, verifier, {
    workspaceId,
    installGeneration: 4,
    provider: "klaviyo",
    expiresAt: "2026-10-09T16:10:00.000Z",
  });

  assert.equal(stored.length, 1);
  assert.equal("secret" in stored[0], false);
  assert.equal("verifier" in stored[0], false);
  assert.equal(JSON.stringify(stored[0]).includes(verifier), false);
  assert.equal(
    await vault.take(transactionId, {
      workspaceId,
      installGeneration: 4,
      provider: "klaviyo",
    }),
    verifier,
  );
  assert.equal(
    await vault.take(transactionId, {
      workspaceId,
      installGeneration: 4,
      provider: "klaviyo",
    }),
    null,
  );
});

test("provider token set is bound to verified active installation authority", async () => {
  const keyring = readProviderTokenKeyring(environment());
  const cipher = createTokenEnvelopeCipher({
    keyring,
    randomBytesFn: (size) => Buffer.alloc(size, 5),
    randomUUIDFn: () => credentialId,
  });
  let persisted;
  const repository = {
    async assertContract() {
      return {contractVersion: 1, usedKeyVersions: []};
    },
    async storeCredential(value) {
      persisted = value;
      return value.recordId;
    },
    async loadCredential(request) {
      assert.equal(request.workspaceId, workspaceId);
      assert.equal(request.installGeneration, 4);
      assert.equal(request.provider, "meta");
      return persisted;
    },
    async deleteCredential() {
      return true;
    },
    async storePkce() {
      return false;
    },
    async takePkce() {
      return null;
    },
    async deletePkce() {
      return false;
    },
  };
  const vault = createTokenVault({repository, keyring, cipher});
  const result = await vault.storeProviderTokenSet({
    installationAuthority: installationAuthority(),
    provider: "meta",
    tokenSet: {access_token: "secret-access", expires_in: 3600},
  });
  assert.equal(result.credentialId, credentialId);
  assert.equal(JSON.stringify(persisted).includes("secret-access"), false);

  const loaded = await vault.loadProviderTokenSet({
    credentialId,
    installationAuthority: installationAuthority(),
    provider: "meta",
  });
  assert.deepEqual(loaded, {access_token: "secret-access", expires_in: 3600});

  await assert.rejects(
    vault.loadProviderTokenSet({
      credentialId,
      installationAuthority: installationAuthority({status: "inactive"}),
      provider: "meta",
    }),
    /TOKEN_VAULT_VERIFIED_INSTALLATION_REQUIRED/,
  );
});

test("repository exposes function-only operations", async () => {
  const queries = [];
  const database = {
    async query(sql, values) {
      queries.push({sql, values});
      if (sql.includes("token_vault_runtime_guard")) {
        return {rows: [{contract_version: 1, used_key_versions: [1, 2]}]};
      }
      if (sql.includes("delete_oauth_pkce_envelope")) {
        return {rows: [{deleted: true}]};
      }
      return {rows: []};
    },
  };
  const repository = createTokenVaultRepository(database);
  const result = await repository.assertContract(1);
  assert.equal(result.contractVersion, 1);
  assert.deepEqual(result.usedKeyVersions, [1, 2]);
  assert.match(queries[0].sql, /integrations\.token_vault_runtime_guard/);
  assert.doesNotMatch(queries[0].sql, /insert\s+into|update\s+|delete\s+from/i);

  assert.equal(await repository.deletePkce({
    transactionId,
    workspaceId,
    installGeneration: 4,
    provider: "klaviyo",
  }), true);
  assert.match(queries[1].sql, /integrations\.delete_oauth_pkce_envelope/);
  assert.deepEqual(queries[1].values, [
    transactionId,
    workspaceId,
    4,
    "klaviyo",
  ]);
});

test("migration is ciphertext-only, forced-RLS, function-only and cascade-bound", () => {
  for (const table of [
    "oauth_pkce_envelopes",
    "provider_credential_envelopes",
  ]) {
    assert.match(migration, new RegExp(`create table integrations\\.${table}`));
    assert.match(migration, new RegExp(`alter table integrations\\.${table} force row level security`));
    assert.match(
      migration,
      new RegExp(`revoke all on table integrations\\.${table}[\\s\\S]*adstable_runtime`),
    );
  }
  assert.match(migration, /payload_ciphertext bytea not null/);
  assert.match(migration, /octet_length\(nonce\) = 12/);
  assert.match(migration, /octet_length\(auth_tag\) = 16/);
  assert.match(migration, /key_version smallint not null/);
  assert.match(migration, /references shopify\.installations\(id\)[\s\S]*on delete cascade/);
  assert.match(migration, /delete from integrations\.oauth_pkce_envelopes[\s\S]*returning envelope\.\*/);
  assert.match(migration, /transaction\.status = 'claimed'/);
  assert.match(
    migration,
    /delete_oauth_pkce_envelope\([\s\S]*p_workspace_id uuid[\s\S]*p_install_generation bigint[\s\S]*p_provider text/,
  );
  assert.match(migration, /installation\.status = 'active'/);
  assert.match(
    workspaceIndexMigration,
    /create index oauth_pkce_envelopes_workspace_fk_idx[\s\S]*workspace_id/,
  );
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.doesNotMatch(
    migration,
    /\b(pkce_verifier|access_token|refresh_token)\s+(text|bytea|json|jsonb)\b/i,
  );
});

test("Shopify server cold start awaits the provider-independent vault guard", () => {
  const runtime = read("app/lib/shopify/shopify-app-runtime.server.js");
  const server = read("app/shopify.server.ts");

  assert.match(runtime, /createTokenVault/);
  assert.match(runtime, /export async function createShopifyAppRuntime/);
  assert.match(runtime, /await tokenVault\.assertRuntimeReady\(\)/);
  assert.match(runtime, /tokenVaultStartup/);
  assert.match(server, /const runtime = await createShopifyAppRuntime\(\)/);
});

test("contract keeps EO-03-B accepted after EO-03 closure", () => {
  const eo03 = master.packages.find((entry) => entry.id === "A6-EO-03");
  const eo03b = eo03.children.find((entry) => entry.id === "A6-EO-03-B");

  assert.equal(contract.status, "Accepted");
  assert.equal(contract.decision.algorithm, "AES-256-GCM");
  assert.equal(contract.decision.database_stores_root_key, false);
  assert.equal(contract.runtime_boundary.direct_table_access, false);
  assert.equal(contract.live_effect.production_database_mutation, true);
  assert.equal(contract.live_effect.vercel_secret_mutation, true);
  assert.equal(contract.implementation.startup_guard_wired_to_shopify_runtime, true);
  assert.equal(contract.live_evidence.synthetic_runtime_acceptance, true);
  assert.equal(eo03b.status, "Accepted");
  assert.equal(eo03.status, "Accepted");
  assert.equal(master.current_active_parent, "A6-EO-04");
  assert.equal(master.current_active_child, "A6-EO-04-D");
  assert.equal(master.next_ready_child, null);
});
