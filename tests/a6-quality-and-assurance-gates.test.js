import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const contract = JSON.parse(readFileSync(
  new URL("contracts/a6-quality-and-assurance-gates-v1.json", root),
  "utf8",
));
const master = JSON.parse(readFileSync(
  new URL("contracts/a6-eo-implementation-master-v1.json", root),
  "utf8",
));

test("engineering integrity runs before EO-05 and is not reduced to review readiness", () => {
  assert.equal(
    contract.engineering_integrity.status,
    "pass_product_owner_accepted_2026-10-18",
  );
  assert.equal(contract.engineering_integrity.timing, "immediately_after_EO-04_before_EO-05");
  assert.equal(contract.engineering_integrity.review_readiness_program, false);
  assert.equal(contract.engineering_integrity.test_pass_alone_is_sufficient, false);
  assert.ok(contract.engineering_integrity.scope.includes("supabase_schema_security_performance_and_recovery"));
  assert.ok(contract.engineering_integrity.scope.includes("vercel_environment_deployment_runtime_and_rollback"));
  assert.ok(contract.engineering_integrity.scope.includes("github_lineage_pr_ci_and_local_only_inventory"));
  assert.equal(master.current_active_parent, null);
  assert.equal(master.current_active_child, null);
  assert.equal(master.current_gate, "A6-EO-05_START_BRIEF_PENDING");
  assert.equal(master.packages.find((item) => item.id === "A6-EO-04").status, "Accepted");
});

test("every remaining review-critical parent receives a delta integrity gate", () => {
  assert.deepEqual(contract.delta_integrity.required_after, [
    "A6-EO-05",
    "A6-EO-06",
    "A6-EO-07",
    "A6-EO-08",
  ]);
  assert.equal(contract.delta_integrity.next_package_blocked_on_regression, true);
});

test("pre-review assurance is final verification, not the first code audit", () => {
  assert.equal(contract.pre_review_assurance.first_code_integrity_audit, false);
  assert.equal(contract.pre_review_assurance.review_affecting_P0_P1_P2_blocks_pass, true);
  assert.deepEqual(contract.pre_review_assurance.review_submission_requires, [
    "A6-ASSURE-01_PASS",
    "product_owner_GO",
  ]);
  assert.equal(contract.external_mutation_authorized, false);
});
