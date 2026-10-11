import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("Google OAuth selection handoff gate blocks unsafe cross-request shortcuts", async () => {
  const contract = await readJson("contracts/eo-04c-google-oauth-selection-handoff-gate-v1.json");
  assert.equal(contract.status, "Proposed_product_owner_acceptance_required_before_route_or_database_implementation");
  assert.equal(contract.finding.severity, "critical_fail_closed");
  assert.match(contract.finding.current_gap, /pending authorization/);
  assert.ok(contract.finding.forbidden_shortcuts.includes("credential_id_in_URL_query_or_browser_form_as_authority"));
  assert.equal(contract.mutation_authority.repository_migration, false);
  assert.equal(contract.mutation_authority.live_supabase, false);
  assert.equal(contract.mutation_authority.live_google_oauth, false);
});

test("handoff design keeps Shopify installation and fresh provider evidence authoritative", async () => {
  const contract = await readJson("contracts/eo-04c-google-oauth-selection-handoff-gate-v1.json");
  assert.equal(contract.database_design.provider_account_payload_persisted, false);
  assert.equal(contract.database_design.browser_access, false);
  assert.equal(contract.database_design.rls, "enabled_and_forced_defense_in_depth");
  assert.equal(contract.database_design.expiry_minutes, 10);
  assert.deepEqual(contract.runtime_design.selection_cardinality, {minimum: 1, maximum: 3});
  assert.equal(contract.runtime_design.manager_reporting_eligible, false);
  assert.equal(contract.runtime_design.credential_storage, "encrypted_database_ciphertext_only");
  assert.equal(contract.runtime_design.access_token_storage, "memory_only");
});

test("Execution Plan and Google brief expose the handoff gate before route wiring", async () => {
  const plan = await readFile("docs/EXECUTION_PLAN.md", "utf8");
  const brief = await readFile("docs/EO_04C_GOOGLE_ADS_ADAPTER_START_BRIEF.md", "utf8");
  for (const value of [
    "docs/EO_04C_GOOGLE_OAUTH_SELECTION_HANDOFF_GATE.md",
    "contracts/eo-04c-google-oauth-selection-handoff-gate-v1.json",
    "credential UUID through a URL",
  ]) {
    assert.match(plan + "\n" + brief, new RegExp(value.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, "\\$&")));
  }
});
