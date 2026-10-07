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
