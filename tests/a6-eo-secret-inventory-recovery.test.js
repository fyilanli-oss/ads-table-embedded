import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

function assertNameParity(inventoryKeys, exampleKeys, observedKeys) {
  for (const keys of [inventoryKeys, exampleKeys, observedKeys]) {
    assert.equal(new Set(keys).size, keys.length, "duplicate environment variable name");
  }
  assert.deepEqual([...inventoryKeys].sort(), [...exampleKeys].sort());
  assert.deepEqual([...inventoryKeys].sort(), [...observedKeys].sort());
}

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
  const observed = await readJson(contract.observed_inventory_evidence);
  assertNameParity(vercelKeys, envKeys, observed.entries.map(item => item.key));
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
    "META_APP_SECRET",
    "KLAVIYO_CLIENT_SECRET",
    "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "SHOPIFY_APP_AUTOMATION_TOKEN",
  ]) {
    assert.equal(byKey.get(key).product_owner_encrypted_recovery_copy, "required");
    assert.equal(byKey.get(key).plaintext_readback, false);
  }

  assert.equal(byKey.get("ADSTABLE_SESSION_ENCRYPTION_KEY_V1").blind_replacement_forbidden, true);
  assert.equal(byKey.get("ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1").blind_replacement_forbidden, true);
  assert.equal(byKey.get("META_APP_SECRET").blind_replacement_forbidden, true);
  assert.equal(byKey.get("KLAVIYO_CLIENT_SECRET").blind_replacement_forbidden, true);
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
    "İlk gerçek sağlayıcı yetkilendirmesinden önce",
  ]) {
    assert.match(plan, new RegExp(value.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")));
  }

  assert.equal(master.schema_version, "1.29.0");
  assert.equal(gate.status, "Ready_for_product_owner_acceptance");
  const inventory = await readJson(gate.contract);
  assert.equal(gate.inventory_count, inventory.current_inventory_count);
  assert.equal(gate.current_vercel_entries, inventory.vercel_inventory_count);
  assert.equal(gate.current_github_actions_secrets, inventory.github_actions_inventory_count);
  assert.equal(gate.mutation_authorized, false);
  assert.equal(gate.owner_package_for_future_provider_secrets, "A6-EO-04");
});

test("self-consistent but incomplete files cannot hide the four Google keys or duplicate names", async () => {
  const contract = await readJson("contracts/a6-eo-secret-inventory-recovery-v1.json");
  const observed = await readJson(contract.observed_inventory_evidence);
  const keys = observed.entries.map(item => item.key);
  const google = keys.filter(key => key.startsWith("GOOGLE_ADS_"));
  assert.equal(google.length, 4);
  for (const omitted of google) {
    const incomplete = keys.filter(key => key !== omitted);
    assert.throws(() => assertNameParity(incomplete, incomplete, keys));
  }
  assert.throws(() => assertNameParity([...keys, keys[0]], keys, keys));
});

test("observed storage is value-free Production metadata, not permission to reclassify or decrypt", async () => {
  const contract = await readJson("contracts/a6-eo-secret-inventory-recovery-v1.json");
  const observed = await readJson(contract.observed_inventory_evidence);
  assert.equal(observed.secret_decryption_requested, false);
  assert.equal(observed.live_mutation, false);
  assert.equal(observed.production_entries, observed.entries.length);
  for (const entry of observed.entries) {
    assert.deepEqual(Object.keys(entry).sort(), [...observed.persisted_fields].sort());
    assert.deepEqual(entry.target, ["production"]);
    assert.equal(entry.gitBranch, null);
    assert.deepEqual(entry.customEnvironmentIds, []);
    const item = contract.inventory.find(item => item.key === entry.key);
    assert.equal(item.observed_storage_type, entry.type === "sensitive" ? "secret" : "config");
  }
  assert.equal(observed.entries.filter(item => item.type === "sensitive").length, observed.production_secret_storage_entries);
  assert.equal(observed.entries.filter(item => item.type === "plain").length, observed.production_config_storage_entries);
  assert.equal(contract.inventory.find(item => item.key === "GOOGLE_ADS_DEVELOPER_TOKEN").required_by_current_runtime, false);
});
