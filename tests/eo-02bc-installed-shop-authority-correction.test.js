import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const contract = JSON.parse(read("contracts/eo-02bc-installed-shop-authority-correction-v1.json"));
const migration = read(contract.database_correction.forward_only_migration).toLowerCase();

test("binds workspace and subscription to the verified installed Shopify shop", () => {
  assert.equal(contract.authority_invariant.merchant_selectable_store, false);
  assert.equal(contract.authority_invariant.provider_account_can_replace_shop, false);
  assert.equal(contract.authority_invariant.second_shop_requires_separate_installation_workspace_and_subscription, true);
  assert.equal(contract.commerce_boundary.shopify_organic_source, "installed_shop_only");
});

test("fails closed when provider scope cannot be proven", () => {
  assert.equal(contract.provider_scope.deterministic_installed_shop_scope_required_before_activation, true);
  assert.equal(contract.provider_scope.dataset_write_when_scope_unproven, false);
  assert.equal(contract.provider_scope.snapshot_job_when_scope_unproven, false);
});

test("removes obsolete entitlement metadata through a forward-only migration", () => {
  for (const column of contract.database_correction.removed_legacy_entitlement_columns) {
    assert.match(migration, new RegExp(`drop column if exists ${column}`));
  }
  assert.match(migration, /set local lock_timeout = '5s'/);
  assert.match(migration, /grant execute on function billing\.apply_shopify_app_pricing_snapshot/);
  assert.equal(contract.database_correction.historical_migrations_mutated, false);
  assert.equal(contract.database_correction.live_application_requires_separate_explicit_approval, true);
});

test("active runtime and product contracts expose no selectable store model", () => {
  const activeFiles = [
    "app/lib/database/shopify-runtime-repositories.server.js",
    "app/lib/shopify/app-pricing-entitlement.server.js",
    "contracts/eo-02c-shopify-app-pricing-entitlement-v1.json",
    "contracts/a6-eo-implementation-master-v1.json",
    "contracts/shopify/a6-eo-07-three-surface-ui-product-freeze-v1.json",
    "docs/A6_EO_IMPLEMENTATION_MASTER_TABLE.md",
    "docs/A6_EO_07_THREE_SURFACE_UI_PRODUCT_FREEZE.md",
    "docs/EXECUTION_PLAN.md",
  ];
  const activeText = activeFiles.map(read).join("\n");
  assert.doesNotMatch(activeText, /Reporting Store/i);
  assert.doesNotMatch(activeText, /reporting_store_entitlement|active_reporting_stores|reportingStoreLimit/);
});
