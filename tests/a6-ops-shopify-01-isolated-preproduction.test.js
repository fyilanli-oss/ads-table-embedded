import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const contract = readJson("contracts/a6-ops-shopify-01-isolated-preproduction-v1.json");
const master = readJson("contracts/a6-eo-implementation-master-v1.json");
const plan = fs.readFileSync(path.join(root, "docs/EXECUTION_PLAN.md"), "utf8");

test("plans the isolated Shopify package without opening implementation", () => {
  assert.equal(contract.type, "independent_prerequisite_operational_package");
  assert.match(contract.status, /implementation_not_started/);
  assert.equal(contract.advances_eo_status, false);
  assert.equal(contract.planning_authorizes.deployment, false);
  assert.equal(contract.planning_authorizes.shopify_app_or_store_creation, false);
  assert.equal(contract.planning_authorizes.provider_mutation_or_live_call, false);
  assert.equal(master.current_active_parent, null);
  assert.equal(master.current_gate, "A6-EO-05_START_BRIEF_PENDING");
});

test("blocks real-store migration or external users until isolation exists", () => {
  assert.equal(contract.activation_deadline.rule, "before_first_of");
  assert.deepEqual(contract.activation_deadline.events, [
    "real_merchant_store_migrated_to_shopify_for_adstable_use",
    "first_external_or_non_team_user_invited",
  ]);
  assert.equal(contract.boundaries.dedicated_shopify_development_app_required, true);
  assert.equal(contract.boundaries.shopify_dev_store_required, true);
  assert.equal(contract.boundaries.merchant_production_store_may_substitute_for_dev_store, false);
});

test("keeps Preview credentials and data outside Production", () => {
  assert.equal(contract.boundaries.preview_specific_shopify_credentials_required, true);
  assert.equal(contract.boundaries.production_credentials_may_be_copied, false);
  assert.equal(contract.boundaries.nonproduction_persistence_isolated_from_production, true);
  assert.equal(contract.boundaries.preview_may_write_production_business_data, false);
  assert.equal(
    contract.boundaries.provider_real_account_use,
    "separately_approved_read_only_exact_account_bound_only",
  );
});

test("retains first-provider-error stop and EO-08-D handoff", () => {
  const provisioning = contract.steps.find((step) => step.id === "A6-OPS-SHOPIFY-01-C");
  assert.equal(provisioning.first_provider_error_stops, true);
  assert.equal(provisioning.retry_or_alternate_route_requires_new_approval, true);
  assert.equal(contract.declares_review_ready, false);
  assert.equal(contract.handoff_target, "A6-EO-08-D");
  assert.match(plan, /A6-OPS-SHOPIFY-01 — İzole Shopify gömülü ön üretim ortamı/);
});
