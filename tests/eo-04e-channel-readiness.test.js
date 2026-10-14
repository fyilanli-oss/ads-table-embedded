import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) =>
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

const contract = readJson("contracts/eo-04e-channel-readiness-v1.json");
const master = readJson("contracts/a6-eo-implementation-master-v1.json");
const plan = fs.readFileSync(path.join(root, "docs/EXECUTION_PLAN.md"), "utf8");
const document = fs.readFileSync(
  path.join(root, "docs/EO_04E_CHANNEL_READINESS_RAW_DATA_REQUIREMENTS.md"),
  "utf8",
);

test("keeps EO-04-E at evidence preparation and authorizes no runtime or Dataset mutation", () => {
  assert.equal(contract.owner_package, "A6-EO-04-E");
  assert.equal(contract.status, "product_owner_scope_accepted_evidence_pending");
  assert.equal(contract.provider_runtime_authorized, false);
  assert.equal(contract.live_provider_call_authorized, false);
  assert.equal(contract.database_or_dataset_mutation_authorized, false);
  assert.equal(contract.channel_mapping_authorized, false);
  assert.equal(contract.formula_or_UI_authorized, false);
});

test("preserves the EO-04-A binding ten-slot raw fact envelope", () => {
  assert.deepEqual(contract.binding_raw_fact_slots, [
    "impression",
    "ad_click",
    "session",
    "spend_value",
    "add_to_cart",
    "add_to_cart_value",
    "checkout",
    "checkout_value",
    "purchase",
    "purchase_value",
  ]);
  assert.equal(contract.binding_fact_rules.slots_are_not_reopened_by_EO_04_E, true);
  assert.equal(contract.binding_fact_rules.absent_is_zero, false);
  assert.match(document, /These ten slots are not optional Channel candidates/);
});

test("applies the three-provider intersection only to new Channel and product evidence", () => {
  assert.deepEqual(contract.common_product_fields_admitted_as_of_control_date, []);
  assert.equal(contract.channel_candidate_boundary.fabricated_leaf_forbidden, true);
  assert.equal(
    contract.channel_candidate_boundary.metric_allocation_to_unsupported_leaf_forbidden,
    true,
  );
  assert.deepEqual(contract.product_relationship.values, [
    "advertised",
    "cross_sell",
    "unclassified",
  ]);
  assert.ok(contract.product_field_states.includes("provider_extension"));
  assert.equal(
    contract.google_product_grain_boundary.retail_performance_max
      .sold_product_at_asset_group,
    "supported_aggregate_only",
  );
  assert.equal(
    contract.google_product_grain_boundary.retail_performance_max
      .allocation_from_campaign_to_asset_group,
    "forbidden",
  );
});

test("requires the 15 October Klaviyo GA revalidation and separate acceptance gates", () => {
  assert.equal(contract.mandatory_klaviyo_gate.not_before, "2026-10-15");
  assert.equal(contract.mandatory_klaviyo_gate.date_alone_activates_nothing, true);
  assert.ok(
    contract.draft_exit_gates.includes(
      "Klaviyo_2026_10_15_GA_revalidation_complete",
    ),
  );
  assert.ok(
    contract.draft_exit_gates.includes(
      "separate_product_owner_merge_approval",
    ),
  );
});

test("binds the draft through the Execution Plan and EO master without advancing acceptance", () => {
  const eo04 = master.packages.find((item) => item.id === "A6-EO-04");
  const eo04e = eo04.children.find((item) => item.id === "A6-EO-04-E");

  assert.equal(eo04e.status, "product_owner_scope_accepted_evidence_pending");
  assert.equal(eo04e.implementation_started, false);
  assert.equal(eo04e.document, contract.document);
  assert.equal(eo04e.contract, "contracts/eo-04e-channel-readiness-v1.json");
  assert.equal(eo04e.live_mutation_authorized, false);
  assert.match(plan, /EO-04-E Channel-readiness evidence gate/);
  assert.match(plan, /raw_response_evidence/);
  assert.match(plan, /normalized_fact_contracts/);
});
