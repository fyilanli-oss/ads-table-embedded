import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("EO-02-C live acceptance template preserves secret and state boundaries", () => {
  const evidence = JSON.parse(
    read("docs/evidence/EO_02C_LIVE_ACCEPTANCE_TEMPLATE.json"),
  );
  const runbook = read("docs/runbooks/EO_02C_LIVE_ACCEPTANCE_RUNBOOK.md");

  assert.equal(evidence.status, "template_not_executed");
  assert.equal(evidence.secret_policy.token_recorded, false);
  assert.equal(
    evidence.runtime_environment.scopes.SHOPIFY_PARTNER_API_ACCESS_TOKEN,
    "production_secret",
  );
  assert.equal(evidence.runtime_environment.preview_has_production_token, false);
  assert.equal(evidence.runtime_environment.development_has_production_token, false);
  assert.deepEqual(Object.keys(evidence.states), ["null", "trial", "active"]);
  assert.deepEqual(evidence.execution_sequence, [
    "shopify_app_store_registration",
    "vercel_production_environment_activation",
    "new_production_deployment",
    "null",
    "trial",
    "active",
    "leak_and_persistence_acceptance",
  ]);
  assert.equal(evidence.final_result, "pending");
  assert.equal(evidence.explicit_product_owner_acceptance, false);

  assert.match(runbook, /USD 24\.99/);
  assert.match(runbook, /14-day trial/);
  assert.match(runbook, /\$0 private test plan/);
  assert.match(runbook, /Aşama 1 — Shopify App Store registration/);
  assert.match(runbook, /Aşama 2 — Vercel Production aktivasyonu/);
  assert.match(runbook, /Aşama 3 — Null kabulü/);
  assert.match(runbook, /EO-02-D başlamaz/);
  assert.doesNotMatch(runbook, /SHOPIFY_PARTNER_API_ACCESS_TOKEN\s*=\s*\S+/);
});

test("EO-02-C live evidence preserves the provider/runtime boundary", () => {
  const evidence = JSON.parse(
    read("docs/evidence/EO_02C_LIVE_ACCEPTANCE_2026-10-08.json"),
  );

  assert.equal(evidence.installation.shopify_admin_app_handle, "adstable-1");
  assert.equal(evidence.installation.installed_target_verified, true);
  assert.equal(evidence.states.null.provider_result, "pass");

  assert.equal(evidence.states.trial.provider_result, "pass");
  assert.equal(evidence.states.trial.current_billing_cycle_is_null, true);
  assert.equal(evidence.states.trial.price_active, false);
  assert.equal(evidence.states.trial.effective_price.amount, "0.0");

  assert.equal(evidence.states.active.provider_result, "pass");
  assert.equal(evidence.states.active.trial_ends_at_is_null, true);
  assert.equal(evidence.states.active.item_handle, "shopify-test");
  assert.equal(evidence.states.active.price_active, true);
  assert.equal(evidence.states.active.effective_price.amount, "0.0");
  assert.match(evidence.states.active.current_cycle_start, /^2026-10-08T/);
  assert.match(evidence.states.active.current_cycle_end, /^2026-11-07T/);
  assert.equal(
    evidence.states.active.result,
    "provider_pass_runtime_persistence_pending",
  );

  assert.equal(
    evidence.price_active_semantics.must_not_be_used_as_subscription_active_flag,
    true,
  );
  assert.equal(evidence.identity_and_persistence.install_generation_match, null);
  assert.equal(evidence.leak_checks.browser_bundle, "pass");
  assert.equal(evidence.leak_checks.http_responses, "pass");
  assert.equal(evidence.leak_checks.application_logs, "pass");
  assert.equal(evidence.leak_checks.platform_logs, "pass");
  assert.equal(evidence.persistence_preflight.server_database_environment_configured, false);
  assert.equal(evidence.persistence_preflight.runtime_repository_adapter_present, false);
  assert.equal(evidence.persistence_preflight.production_reconciliation_caller_present, false);
  assert.deepEqual(evidence.persistence_preflight.database_counts, {
    workspaces: 0,
    installations: 0,
    workspace_subscriptions: 0,
    workspace_entitlements: 0,
    trial_ledger: 0,
  });
  assert.equal(evidence.final_result, "pending");
  assert.equal(evidence.secret_policy.token_recorded, false);
});
