import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Session} from "@shopify/shopify-api";
import {
  createSessionEnvelopeCipher,
  readSessionEncryptionKey,
  SHOPIFY_SESSION_KEY_ENVIRONMENT,
} from "../app/lib/shopify/session-envelope.server.js";
import {
  createEncryptedShopifySessionStorage,
} from "../app/lib/shopify/encrypted-session-storage.server.js";
import {
  createShopifySessionRepository,
} from "../app/lib/database/shopify-session-repository.server.js";
import {
  createRuntimePostgresClient,
  readRuntimeDatabaseConfig,
} from "../app/lib/database/runtime-postgres.server.js";
import {
  readVerifiedShopifyAdminIdentity,
} from "../app/lib/shopify/admin-identity.server.js";
import {
  readShopifyAppRuntimeConfig,
} from "../app/lib/shopify/shopify-app-runtime.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function sampleSession() {
  return new Session({
    id: "offline_example-store.myshopify.com",
    shop: "example-store.myshopify.com",
    state: "state-value",
    isOnline: false,
    scope: "read_products",
    accessToken: "shpat_secret-access-token",
    expires: new Date("2026-10-08T18:00:00.000Z"),
    refreshToken: "shprt_secret-refresh-token",
    refreshTokenExpires: new Date("2027-01-06T18:00:00.000Z"),
  });
}

test("session key contract accepts exactly one 256-bit base64url key", () => {
  const encoded = Buffer.alloc(32, 7).toString("base64url");
  assert.equal(SHOPIFY_SESSION_KEY_ENVIRONMENT, "ADSTABLE_SESSION_ENCRYPTION_KEY_V1");
  assert.deepEqual(
    readSessionEncryptionKey({ADSTABLE_SESSION_ENCRYPTION_KEY_V1: encoded}),
    Buffer.alloc(32, 7),
  );
  for (const invalid of ["", "x".repeat(42), "x".repeat(44), "not+base64url".repeat(4)]) {
    assert.throws(
      () => readSessionEncryptionKey({ADSTABLE_SESSION_ENCRYPTION_KEY_V1: invalid}),
      /ADSTABLE_SESSION_ENCRYPTION_KEY_V1_INVALID/,
    );
  }
});

test("Shopify sessions round-trip through authenticated AES-GCM without plaintext token storage", () => {
  const cipher = createSessionEnvelopeCipher({
    key: Buffer.alloc(32, 11),
    randomBytesFn: (length) => Buffer.alloc(length, 19),
  });
  const session = sampleSession();
  const envelope = cipher.encrypt(session);
  const persistedBytes = Buffer.concat([
    envelope.payloadCiphertext,
    envelope.nonce,
    envelope.authTag,
  ]).toString("utf8");

  assert.equal(persistedBytes.includes("shpat_secret-access-token"), false);
  assert.equal(persistedBytes.includes("shprt_secret-refresh-token"), false);
  assert.equal(envelope.sessionId, session.id);
  assert.equal(envelope.shopDomain, session.shop);
  assert.equal(envelope.keyVersion, 1);

  const restored = cipher.decrypt(envelope);
  assert.equal(restored.id, session.id);
  assert.equal(restored.shop, session.shop);
  assert.equal(restored.accessToken, session.accessToken);
  assert.equal(restored.refreshToken, session.refreshToken);
  assert.equal(restored.expires.toISOString(), session.expires.toISOString());

  const tampered = {
    ...envelope,
    payloadCiphertext: Buffer.from(envelope.payloadCiphertext),
  };
  tampered.payloadCiphertext[0] ^= 1;
  assert.throws(() => cipher.decrypt(tampered));
});

test("encrypted storage implements the official five-method SessionStorage contract", async () => {
  const rows = new Map();
  const cipher = createSessionEnvelopeCipher({
    key: Buffer.alloc(32, 23),
    randomBytesFn: (length) => Buffer.alloc(length, 29),
  });
  const repository = {
    async store(envelope) {
      rows.set(envelope.sessionId, envelope);
      return true;
    },
    async load(id) {
      return rows.get(id);
    },
    async delete(id) {
      rows.delete(id);
      return true;
    },
    async deleteMany(ids) {
      ids.forEach((id) => rows.delete(id));
      return true;
    },
    async findByShop(shop) {
      return [...rows.values()].filter((row) => row.shopDomain === shop);
    },
  };
  const storage = createEncryptedShopifySessionStorage({cipher, repository});
  const session = sampleSession();

  assert.equal(await storage.storeSession(session), true);
  assert.equal((await storage.loadSession(session.id)).accessToken, session.accessToken);
  assert.equal((await storage.findSessionsByShop(session.shop)).length, 1);
  assert.equal(await storage.deleteSessions([session.id]), true);
  assert.equal(await storage.loadSession(session.id), undefined);
  assert.equal(await storage.deleteSession("missing"), true);
});

test("session repository uses only approved security-definer functions", async () => {
  const calls = [];
  const encrypted = Buffer.from("ciphertext");
  const nonce = Buffer.alloc(12, 1);
  const tag = Buffer.alloc(16, 2);
  const database = {
    async query(text, values) {
      calls.push({text, values});
      if (text.includes("store_runtime_session")) return {rows: [{stored: true}]};
      if (text.includes("load_runtime_session")) {
        return {rows: [{
          session_id: "offline_example-store.myshopify.com",
          shop_domain: "example-store.myshopify.com",
          payload_ciphertext: encrypted,
          nonce,
          auth_tag: tag,
          key_version: 1,
          expires_at: null,
        }]};
      }
      if (text.includes("find_runtime_sessions_by_shop")) return {rows: []};
      return {rows: [{deleted: true}]};
    },
  };
  const repository = createShopifySessionRepository(database);
  const envelope = {
    sessionId: "offline_example-store.myshopify.com",
    shopDomain: "example-store.myshopify.com",
    payloadCiphertext: encrypted,
    nonce,
    authTag: tag,
    keyVersion: 1,
    expiresAt: null,
  };

  await repository.store(envelope);
  assert.equal((await repository.load(envelope.sessionId)).keyVersion, 1);
  await repository.findByShop(envelope.shopDomain);
  await repository.delete(envelope.sessionId);
  await repository.deleteMany([envelope.sessionId]);

  const sql = calls.map(({text}) => text).join("\n");
  for (const name of [
    "shopify.store_runtime_session",
    "shopify.load_runtime_session",
    "shopify.find_runtime_sessions_by_shop",
    "shopify.delete_runtime_session",
    "shopify.delete_runtime_sessions",
  ]) assert.match(sql, new RegExp(name.replace(".", "\\.")));
  assert.doesNotMatch(sql, /\b(?:insert|update|delete)\s+(?:into|from)?\s*shopify\.runtime_sessions\b/i);
});

test("runtime Postgres uses the official Supabase CA with full TLS verification", async () => {
  const environment = {
    ADSTABLE_RUNTIME_DATABASE_URL:
      "postgresql://adstable_runtime.podpwkrpmjiksskxhwsu:" +
      "x".repeat(48) +
      "@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",
  };
  const config = readRuntimeDatabaseConfig(environment);
  assert.equal(new URL(config.connectionString).search, "");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.match(config.ssl.ca, /^-----BEGIN CERTIFICATE-----/);
  assert.match(config.ssl.ca, /-----END CERTIFICATE-----\n$/);

  let poolConfig;
  const client = createRuntimePostgresClient({
    environment,
    poolFactory(received) {
      poolConfig = received;
      return {
        query: async ({text, values}) => ({rows: [{text, values}]}),
        end: async () => {},
      };
    },
  });
  assert.equal(poolConfig.max, 1);
  assert.equal(poolConfig.ssl.rejectUnauthorized, true);
  assert.equal(new URL(poolConfig.connectionString).search, "");
  assert.deepEqual(await client.query("select $1::text", ["ok"]), {
    rows: [{text: "select $1::text", values: ["ok"]}],
  });
  await client.close();

  for (const invalid of [
    environment.ADSTABLE_RUNTIME_DATABASE_URL.replace("sslmode=require", "sslmode=disable"),
    environment.ADSTABLE_RUNTIME_DATABASE_URL + "&rejectUnauthorized=false",
  ]) {
    assert.throws(
      () => readRuntimeDatabaseConfig({ADSTABLE_RUNTIME_DATABASE_URL: invalid}),
      /ADSTABLE_RUNTIME_DATABASE_URL_INVALID/,
    );
  }
});

test("verified Admin identity binds ID-token destination to Admin GraphQL shop", async () => {
  const identity = await readVerifiedShopifyAdminIdentity({
    sessionToken: {dest: "https://example-store.myshopify.com/"},
    admin: {
      graphql: async () => ({
        json: async () => ({
          data: {
            shop: {
              id: "gid://shopify/Shop/123456789",
              myshopifyDomain: "example-store.myshopify.com",
            },
          },
        }),
      }),
    },
  });
  assert.equal(identity.session.authority, "shopify_id_token_verified");
  assert.equal(identity.shop.authority, "shopify_admin_verified");

  await assert.rejects(
    readVerifiedShopifyAdminIdentity({
      sessionToken: {dest: "https://other-store.myshopify.com/"},
      admin: {
        graphql: async () => ({
          json: async () => ({
            data: {
              shop: {
                id: "gid://shopify/Shop/123456789",
                myshopifyDomain: "example-store.myshopify.com",
              },
            },
          }),
        }),
      },
    }),
    /SHOP_ID_TOKEN_ADMIN_IDENTITY_MISMATCH/,
  );
});

test("Shopify runtime configuration is exact and fail-closed", () => {
  const environment = {
    SHOPIFY_API_KEY: "a".repeat(32),
    SHOPIFY_API_SECRET: "s".repeat(32),
    SHOPIFY_APP_URL: "https://embedded.adstable.app",
    SCOPES: "read_products,read_orders",
  };
  assert.deepEqual(readShopifyAppRuntimeConfig(environment), {
    apiKey: environment.SHOPIFY_API_KEY,
    apiSecretKey: environment.SHOPIFY_API_SECRET,
    appUrl: environment.SHOPIFY_APP_URL,
    scopes: ["read_products", "read_orders"],
  });
  for (const [field, value] of [
    ["SHOPIFY_API_KEY", "bad"],
    ["SHOPIFY_API_SECRET", "short"],
    ["SHOPIFY_APP_URL", "https://attacker.example"],
    ["SCOPES", "read_products, BAD"],
  ]) {
    assert.throws(
      () => readShopifyAppRuntimeConfig({...environment, [field]: value}),
      /SHOPIFY_APP_RUNTIME_/,
    );
  }
});

test("pathless Admin layout preserves product URLs and uses official boundaries", () => {
  const layout = read("app/routes/_admin.tsx");
  const auth = read("app/routes/auth.$.tsx");
  const root = read("app/root.tsx");
  const entry = read("app/entry.server.tsx");
  const routes = [
    ["app/routes/_admin._index.tsx", "Funnel"],
    ["app/routes/_admin.ad-analysis.tsx", "Ad Analysis"],
    ["app/routes/_admin.settings.tsx", "Settings"],
  ];

  assert.match(layout, /authenticate\.admin\(request\)/);
  assert.match(layout, /<AppProvider apiKey=\{apiKey\} polarisUrl=\{polarisUrl\}>/);
  assert.match(layout, /createProductionShopifyEntitlementRuntime/);
  assert.match(auth, /authenticate\.admin\(request\)/);
  assert.match(entry, /addDocumentResponseHeaders\(request, responseHeaders\)/);
  assert.doesNotMatch(root, /polaris-2\.0-rc\.js/);
  for (const [file, heading] of routes) assert.match(read(file), new RegExp(heading));
  for (const removed of [
    "app/routes/_index.tsx",
    "app/routes/ad-analysis.tsx",
    "app/routes/settings.tsx",
  ]) assert.equal(fs.existsSync(path.join(root, removed)), false);
});

test("migration persists no plaintext token fields and grants only function execution", () => {
  const migration = read(
    "supabase/migrations/20261008143000_eo02c_encrypted_shopify_runtime_sessions.sql",
  );
  assert.match(migration, /payload_ciphertext bytea not null/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table shopify\.runtime_sessions/);
  assert.match(migration, /grant execute on function shopify\.store_runtime_session/);
  assert.doesNotMatch(migration, /\b(?:access_token|refresh_token|session_json)\b/i);
  assert.doesNotMatch(
    migration,
    /grant\s+(?:select|insert|update|delete).*adstable_runtime/i,
  );
});
