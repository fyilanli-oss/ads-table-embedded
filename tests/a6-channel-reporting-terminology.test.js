import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("Channel is a derived native path and never a provider or Dataset entity", async () => {
  const contract = await readJson("contracts/a6-channel-reporting-terminology-v1.json");

  assert.equal(contract.status, "Boundary_accepted_reporting_sheet_design_pending");
  assert.equal(contract.user_facing_term.label, "Channel");
  assert.equal(contract.user_facing_term.provider_entity, false);
  assert.equal(contract.user_facing_term.canonical_dataset_entity_type, false);
  assert.equal(contract.user_facing_term.synthetic_id_allowed, false);
  assert.equal(contract.collision_prevention.delivery_medium_key, "delivery_channel");
  assert.equal(contract.collision_prevention.canonical_identity_field_named_channel_forbidden, true);
  assert.equal(contract.source_path_contract.every_node_requires_provider_native_type_id_and_name, true);
  assert.equal(contract.source_path_contract.unsupported_or_missing_node_must_not_be_created, true);
  assert.equal(contract.non_effect.dataset_migration_authorized, false);
  assert.equal(contract.non_effect.UI_implementation_authorized, false);
});

test("Channel decision is durable in the master plan, Execution Plan and UI freeze", async () => {
  const master = await readJson("contracts/a6-eo-implementation-master-v1.json");
  const plan = await readFile("docs/EXECUTION_PLAN.md", "utf8");
  const ui = await readFile("docs/A6_EO_07_THREE_SURFACE_UI_PRODUCT_FREEZE.md", "utf8");
  const decision = master.cross_cutting_decisions.channel_reporting_terminology_v1;

  assert.equal(decision.user_facing_label, "Channel");
  assert.equal(decision.technical_delivery_medium_key, "delivery_channel");
  assert.equal(decision.channel_is_provider_or_dataset_entity, false);
  assert.equal(decision.synthetic_leaf_forbidden, true);
  assert.match(plan, /Google extraction is split into four non-interchangeable request families/);
  assert.match(ui, /Final Channel columns, filters, ranking and product-cost\/basket layout remain pending/);
});
