import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("secret inventory covers every declared Vercel and GitHub Actions key without values", async () => {
  const contract = await readJson("contracts/a6-eo-secret-inventory-recovery-v1.json");
  const envExample = await readFile(".env.example", "utf8");
  const workflow = await readFile(".github/workflows/shopify-app-deploy.yml", "utf8");

  const envKeys = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)]
    .map((match) => match[1])
    .sort();
  const vercelKeys = contract.inventory
    .filter((item) => item.platform === "vercel")
    .map((item) => item.key)
    .sort();
  assert.deepEqual(vercelKeys, envKeys);
  assert.equal(vercelKeys.length, contract.vercel_inventory_count);

  const workflowSecrets = [...workflow.matchAll(/secrets\.([A-Z][A-Z0-9_]*)/g)]
    .map((match) => match[1]);
  const githubKeys = contract.inventory
    .filter((item) => item.platform === "github_actions")
    .map((item) => item.key);
  assert.deepEqual([...new Set(workflowSecrets)].sort(), githubKeys.sort());
  assert.equal(githubKeys.length, contract.github_actions_inventory_count);
  assert.equal(contract.inventory.length, contract.current_inventory_count);

  for (const item of contract.inventory) {
    assert.equal(Object.hasOwn(item, "value"), false, item.key + " must not persist a value");
    assert.ok(item.source_authority);
    assert.ok(item.canonical_store);
    assert.ok(item.recovery_action);
    assert.ok(item.touch_policy);
    assert.ok(item.expiry);
  }
});

test("non-reconstructible secrets require controlled recovery and no blind replacement", async () => {
  const contract = await readJson("contracts/a6-eo-secret-inventory-recovery-v1.json");
  const byKey = new Map(contract.inventory.map((item) => [item.key, item]));

  for (const key of [
    "SHOPIFY_API_SECRET",
    "SHOPIFY_PARTNER_API_ACCESS_TOKEN",
    "ADSTABLE_RUNTIME_DATABASE_URL",
    "ADSTABLE_SESSION_ENCRYPTION_KEY_V1",
    "ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1",
    "SHOPIFY_APP_AUTOMATION_TOKEN",
    "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
  ]) {
    assert.equal(byKey.get(key).product_owner_encrypted_recovery_copy, "required");
    assert.equal(byKey.get(key).plaintext_readback, false);
  }

  assert.equal(byKey.get("ADSTABLE_SESSION_ENCRYPTION_KEY_V1").blind_replacement_forbidden, true);
  assert.equal(byKey.get("ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1").blind_replacement_forbidden, true);
  assert.match(contract.rotation_rules.provider_key, /add_new_version/);
  assert.equal(contract.invariants.secret_values_in_repository, false);
  assert.equal(contract.invariants.production_credentials_reused_in_nonproduction, false);
  assert.equal(contract.invariants.mutation_authorized_by_this_contract, false);
});

test("Execution Plan and master contract expose the EO-04 secret gate", async () => {
  const plan = await readFile("docs/EXECUTION_PLAN.md", "utf8");
  const master = await readJson("contracts/a6-eo-implementation-master-v1.json");
  const gate = master.cross_cutting_decisions.secret_inventory_recovery_v1;

  for (const value of [
    "docs/A6_EO_SECRET_INVENTORY_AND_RECOVERY.md",
    "contracts/a6-eo-secret-inventory-recovery-v1.json",
    "tests/a6-eo-secret-inventory-recovery.test.js",
    "first real provider authorization",
  ]) {
    assert.match(plan, new RegExp(value.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")));
  }

  assert.equal(master.schema_version, "1.24.0");
  assert.equal(gate.status, "Accepted_Google_Production_credentials_present_provider_key_recovery_confirmed");
  assert.equal(gate.inventory_count, 15);
  assert.equal(gate.mutation_authorized, false);
  assert.equal(gate.owner_package_for_future_provider_secrets, "A6-EO-04");
});

test("Google Ads credentials are name-only, production-scoped and keep tokens out of Vercel", async () => {
  const contract = await readJson("contracts/a6-eo-secret-inventory-recovery-v1.json");
  const byKey = new Map(contract.inventory.map((item) => [item.key, item]));
  const google = contract.google_ads_provider_credentials;

  assert.equal(contract.version, "1.2.0");
  assert.equal(contract.status, "Accepted_name_only_inventory_Google_Production_configured");
  assert.equal(contract.current_inventory_count, 15);
  assert.equal(contract.vercel_inventory_count, 14);
  assert.equal(byKey.get("GOOGLE_ADS_OAUTH_CLIENT_ID").storage_type, "sensitive");
  assert.equal(byKey.get("GOOGLE_ADS_OAUTH_CLIENT_SECRET").storage_type, "secret");
  assert.equal(byKey.get("GOOGLE_ADS_OAUTH_REDIRECT_URI").storage_type, "sensitive");
  assert.equal(google.scope, "https://www.googleapis.com/auth/adwords");
  assert.equal(google.developer_token_required, false);
  assert.match(google.refresh_token_storage, /encrypted/);
  assert.equal(google.access_token_storage, "memory_only_with_expiry");
  assert.equal(google.global_refresh_token_forbidden, true);
  assert.equal(google.legacy_secret_values_readable_or_transferable, false);
  assert.equal(google.secret_mutation_authorized, false);
  assert.deepEqual(google.current_new_project_presence, {
    GOOGLE_ADS_OAUTH_CLIENT_ID: true,
    GOOGLE_ADS_OAUTH_CLIENT_SECRET: true,
    GOOGLE_ADS_OAUTH_REDIRECT_URI: true,
    observed_at: "2026-10-11",
    environment: "production_only",
    values_masked: true,
    actual_vercel_type: "sensitive_for_all_three_by_operator_choice",
  });
  assert.equal(google.provider_token_encryption_key_recovery_custody_evidenced, true);
  assert.equal(google.repository_oauth_rest_boundary.ci, "PASS_run_38131663609");
});
