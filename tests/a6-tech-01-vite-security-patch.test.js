import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const evidence = JSON.parse(read("docs/evidence/A6_TECH_01_VITE_SECURITY_PATCH_2026-10-18.json"));

test("historical PR115 Vite patch evidence remains immutable after separately approved remediation", () => {
  assert.deepEqual(evidence.dependency_change, {package: "vite", from: "7.3.1", to: "7.3.5", other_package_versions_changed: false});
  assert.equal(evidence.lockfile.normalized_sha256_before_and_after, "5133e2267d9ab50a93a1a89f8c98640f9b05346c01afdb5d799a7de3fb3ca5aa");
});

test("historical removal of five Vite advisories did not silently accept the three remaining risks", () => {
  assert.equal(evidence.removed_advisories.length, 5);
  assert.equal(evidence.remaining_advisories.length, 3);
  assert.deepEqual(evidence.complete_audit.vulnerabilities, {info: 0, low: 1, moderate: 1, high: 1, critical: 0});
  assert.equal(evidence.production_audit.exit_code, 0);
  assert.equal(evidence.complete_audit.exit_code, 1);
  for (const key of ["security_finding_closed", "remaining_remediation_authorized", "deployment_authorized", "A6_TECH_01_overall_pass", "EO05_may_start"]) assert.equal(evidence[key], false, key);
  assert.equal(evidence.assessment_limits.residual_risk_acceptance_or_suppression_authorized, false);
  for (const changed of Object.values(evidence.scope)) assert.equal(changed, false);
});
