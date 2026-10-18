import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const evidence = JSON.parse(read("docs/evidence/A6_TECH_01_VITE_SECURITY_PATCH_2026-10-18.json"));

function lockFingerprint(source) {
  const version = evidence.dependency_change.to;
  const normalized = source.replaceAll("\r\n", "\n")
    .replaceAll("vite@" + version, "vite@APPROVED")
    .replaceAll("specifier: " + version, "specifier: APPROVED")
    .replaceAll("version: " + version + "(", "version: APPROVED(")
    .replaceAll("vite: " + version + "(", "vite: APPROVED(")
    .replace(/(  vite@APPROVED:\n    resolution: \{integrity: )[^}]+/, (_, prefix) => prefix + "APPROVED");
  return createHash("sha256").update(normalized).digest("hex");
}

test("Vite security patch changes only the approved lock version, integrity and peer references", () => {
  const manifest = JSON.parse(read("package.json"));
  const registry = JSON.parse(read("contracts/eo-01b-dependency-registry-v1.json"));
  assert.equal(manifest.devDependencies.vite, "7.3.5");
  assert.equal(registry.packages.find(item => item.name === "vite").version, "7.3.5");
  assert.equal(lockFingerprint(read("pnpm-lock.yaml")), evidence.lockfile.normalized_sha256_before_and_after);
  assert.notEqual(lockFingerprint(read("pnpm-lock.yaml").replace("esbuild: 0.27.7", "esbuild: 0.28.1")), evidence.lockfile.normalized_sha256_before_and_after);
});

test("removing five Vite advisories does not silently accept the three remaining risks", () => {
  assert.equal(evidence.removed_advisories.length, 5);
  assert.equal(evidence.remaining_advisories.length, 3);
  assert.deepEqual(evidence.complete_audit.vulnerabilities, {info: 0, low: 1, moderate: 1, high: 1, critical: 0});
  assert.equal(evidence.production_audit.exit_code, 0);
  assert.equal(evidence.complete_audit.exit_code, 1);
  for (const key of ["security_finding_closed", "remaining_remediation_authorized", "deployment_authorized", "A6_TECH_01_overall_pass", "EO05_may_start"]) assert.equal(evidence[key], false, key);
  assert.equal(evidence.assessment_limits.residual_risk_acceptance_or_suppression_authorized, false);
  for (const changed of Object.values(evidence.scope)) assert.equal(changed, false);
});
