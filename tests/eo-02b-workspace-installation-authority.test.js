import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {bootstrapWorkspaceInstallation, normalizeShopDomain} from "../app/lib/shopify/installation-authority.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const contract = JSON.parse(read("contracts/eo-02b-workspace-installation-authority-v1.json"));
const migration = contract.database.migration_chain.map(read).join("\n").toLowerCase();

const session = {
  authority: "shopify_id_token_verified",
  shopDomain: "example-store.myshopify.com",
};
const shop = {
  authority: "shopify_admin_verified",
  shopId: "gid://shopify/Shop/123456789",
  myshopifyDomain: "example-store.myshopify.com",
};
const workspaceId = "018f3dd8-8b6f-7cc8-9d4b-7d2f7ae51a9a";

test("canonical Shopify domain normalization is strict", () => {
  assert.equal(normalizeShopDomain(" Example-Store.MyShopify.com. "), "example-store.myshopify.com");
  assert.throws(() => normalizeShopDomain("shop.example.com"), /canonical myshopify/);
});

test("verified ID-token and Admin shop identity must agree before persistence", async () => {
  let called = false;
  await assert.rejects(
    bootstrapWorkspaceInstallation({
      session,
      shop: {...shop, myshopifyDomain: "other-store.myshopify.com"},
      verifiedAt: new Date("2026-10-06T15:20:00.000Z"),
      repository: {bootstrap: async () => { called = true; }},
    }),
    /SHOP_ID_TOKEN_ADMIN_IDENTITY_MISMATCH/,
  );
  assert.equal(called, false);
});

test("bootstrap forwards only verified shop facts and accepts generation authority", async () => {
  let command;
  const result = await bootstrapWorkspaceInstallation({
    session,
    shop,
    verifiedAt: new Date("2026-10-06T15:20:00.000Z"),
    repository: {
      bootstrap: async (value) => {
        command = value;
        return {
          ...value,
          workspaceId,
          installGeneration: 1,
          status: "active",
          disposition: "created",
        };
      },
    },
  });

  assert.deepEqual(command, {
    shopId: shop.shopId,
    shopDomain: shop.myshopifyDomain,
    shopIdentitySha256: Buffer.from(
      "27ef8e9390b47591c8531afc02d8e654a2b6ddcf76d708647e96442a212180bd",
      "hex",
    ),
    verifiedAt: "2026-10-06T15:20:00.000Z",
  });
  assert.deepEqual(result, {
    workspaceId,
    installGeneration: 1,
    status: "active",
    disposition: "created",
  });
  assert.equal("workspaceId" in session, false);
});

test("repository response cannot switch verified shop identity", async () => {
  await assert.rejects(
    bootstrapWorkspaceInstallation({
      session,
      shop,
      verifiedAt: new Date("2026-10-06T15:20:00.000Z"),
      repository: {
        bootstrap: async () => ({
          shopId: "gid://shopify/Shop/999",
          shopDomain: shop.myshopifyDomain,
          workspaceId,
          installGeneration: 1,
          status: "active",
          disposition: "existing",
        }),
      },
    }),
    /INSTALLATION_PERSISTENCE_MISMATCH/,
  );
});

test("migration creates private forced-RLS authority with no runtime table DML", () => {
  for (const table of ["app.workspaces", "shopify.installations", "shopify.installation_domain_history"]) {
    assert.match(migration, new RegExp("alter table " + table.replace(".", "\\.") + " enable row level security"));
    assert.match(migration, new RegExp("alter table " + table.replace(".", "\\.") + " force row level security"));
  }
  assert.match(migration, /grant execute on function shopify\.bootstrap_installation/);
  assert.match(migration, /grant execute on function shopify\.resolve_active_installation/);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all)[^;]*to\s+adstable_runtime/);
  assert.doesNotMatch(migration, /grant[^;]*to\s+(?:anon|authenticated|service_role)/);
});

test("generation creation is serialized and lifecycle transitions fail closed", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /installations_single_live_shop_idx/);
  assert.match(migration, /installation_lifecycle_requires_eo02d/);
  assert.match(migration, /new_generation_requires_eo02d/);
  assert.match(migration, /eo02b_idempotency_assertion_failed/);
  assert.match(migration, /eo02b_acceptance_probe_cleanup_failed/);
  assert.match(migration, /drop index if exists shopify\.installations_shop_domain_idx/);
  assert.match(migration, /drop index if exists shopify\.installation_domain_history_installation_idx/);
  assert.equal(contract.lifecycle_boundary.deferred_to_eo02d.includes("terminal deletion"), true);
});

test("EO-02-B persists no token material", () => {
  assert.equal(contract.token_boundary.plaintext_storage, false);
  assert.equal(contract.token_boundary.token_columns_in_this_package, false);
  assert.doesNotMatch(migration, /access_token|refresh_token|token_envelope|ciphertext/);
});
