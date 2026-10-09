import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(path.join(root, "contracts/a6-eo-demo-fixture-export-reference-v1.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(root, "contracts/a6-eo-implementation-master-v1.json"), "utf8"));
const plan = fs.readFileSync(path.join(root, "docs/EXECUTION_PLAN.md"), "utf8");

test("pins the remote legacy source as reference material without carrying runtime code", () => {
  assert.equal(contract.source_evidence.repository, "fyilanli-oss/ads-table-dev");
  assert.equal(contract.source_evidence.ref, "main");
  assert.equal(contract.source_evidence.git_blob_sha, "87413af1318cbdb3efbe1104e283d7294bc0c219");
  assert.equal(contract.source_evidence.source_code_carry_as_is, false);
  assert.equal(contract.source_evidence.html_runtime_dependency_allowed, false);
});

test("records the inspected fixture inventory", () => {
  assert.equal(contract.inspected_inventory.source_rows, 1000);
  assert.equal(contract.inspected_inventory.calendar_days, 50);
  assert.equal(contract.inspected_inventory.first_date, "2026-06-01");
  assert.equal(contract.inspected_inventory.last_date, "2026-07-20");
  assert.equal(contract.inspected_inventory.platform_row_counts.Meta, 250);
  assert.equal(contract.inspected_inventory.platform_row_counts.Klaviyo, 150);
});

test("keeps synthetic data visibly separate from provider truth", () => {
  assert.equal(contract.extraction_and_normalization.synthetic_labels.data_origin, "synthetic_demo");
  assert.equal(contract.extraction_and_normalization.synthetic_labels.provider_truth, false);
  assert.equal(contract.extraction_and_normalization.synthetic_labels.workspace_kind, "demo");
  assert.ok(contract.forbidden_uses.includes("provider_native_capability_acceptance"));
  assert.ok(contract.forbidden_uses.includes("real_zero_evidence"));
  assert.equal(contract.extraction_and_normalization.universal_campaign_adgroup_ad_mapping_forbidden, true);
  assert.ok(contract.extraction_and_normalization.required_canonical_fields.includes("installed_shop_id"));
  assert.ok(contract.extraction_and_normalization.required_canonical_fields.includes("installed_shop_timezone"));
});

test("separates immutable golden and rolling demo fixture modes", () => {
  assert.equal(contract.fixture_modes.golden.deterministic, true);
  assert.equal(contract.fixture_modes.golden.date_mutation, false);
  assert.equal(contract.fixture_modes.rolling_demo.never_changes_golden_fixture, true);
  assert.equal(contract.fixture_modes.rolling_demo.visible_demo_label_required, true);
});

test("captures export reference without moving export into first review", () => {
  assert.equal(contract.export_reference.first_review_implementation_in_scope, false);
  assert.equal(contract.export_reference.reference_capture_in_scope, true);
  assert.equal(contract.export_reference.legacy_code_reuse, false);
  assert.equal(contract.export_reference.final_schema_not_frozen_by_this_contract, true);
  assert.equal(contract.authorizes_export_implementation, false);
});

test("uses an isolated truthful Shopify dev-store workspace", () => {
  assert.equal(contract.shopify_dev_store.dedicated_demo_shop_and_workspace_required, true);
  assert.equal(contract.shopify_dev_store.real_provider_tokens_required, false);
  assert.equal(contract.shopify_dev_store.fake_connected_provider_state_forbidden, true);
  assert.equal(contract.shopify_dev_store.UI_must_label_synthetic_demo_data, true);
  assert.equal(contract.authorizes_dev_store_creation_or_install, false);
});

test("does not let the source fixture prove products or cross-sell", () => {
  assert.equal(contract.product_and_cross_sell.source_fixture_contains_product_identity, false);
  assert.equal(contract.product_and_cross_sell.source_fixture_proves_cross_sell, false);
  assert.equal(contract.product_and_cross_sell.owner_package, "A6-EO-07-C");
  assert.equal(contract.product_and_cross_sell.provider_native_acceptance_still_requires_live_redacted_raw_evidence, true);
});

test("routes deterministic capacity generation under the existing capacity authority", () => {
  assert.equal(contract.capacity_generation.source_fixture_is_seed_not_full_capacity_test, true);
  assert.equal(contract.capacity_generation.target_workspaces, 2000);
  assert.equal(contract.capacity_generation.stress_workspaces, 4000);
  assert.equal(contract.capacity_generation.cross_tenant_identifier_collision_allowed, false);
  const decision = master.cross_cutting_decisions.demo_fixture_export_reference_v1;
  assert.equal(decision.export_first_review_in_scope, false);
  assert.equal(decision.advances_package_status, false);
  assert.match(plan, /Demo fixture, export reference and Shopify dev-store boundary/);
});
