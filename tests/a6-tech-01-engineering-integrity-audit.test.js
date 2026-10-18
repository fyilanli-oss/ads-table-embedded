import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const audit = JSON.parse(readFileSync(
  new URL("contracts/a6-tech-01-engineering-integrity-audit-v1.json", root),
  "utf8",
));
const quality = JSON.parse(readFileSync(
  new URL("contracts/a6-quality-and-assurance-gates-v1.json", root),
  "utf8",
));
const master = JSON.parse(readFileSync(
  new URL("contracts/a6-eo-implementation-master-v1.json", root),
  "utf8",
));

test("A6-TECH-01 records the audited starting baseline without declaring PASS", () => {
  assert.equal(audit.status, "audit_findings_recorded_critical_remediation_required");
  assert.match(audit.audited_starting_baseline_commit, /^[0-9a-f]{40}$/);
  assert.equal(audit.pass_baseline_commit, null);
  assert.equal(audit.production_changed_by_audit, false);
  assert.equal(audit.external_mutation_authorized, false);
});

test("open critical findings block EO-05 and accepted closure removes only its own blocker", () => {
  const critical = audit.findings.filter((finding) =>
    finding.priority === "P1" || finding.priority === "P2"
  );

  assert.deepEqual(audit.finding_counts, {P0: 0, P1: 3, P2: 5, P3: 2});
  assert.equal(critical.length, 8);
  assert.ok(critical.filter(finding => finding.closed !== true).every(finding => finding.eo05_blocker === true));
  const closed = critical.filter(finding => finding.closed === true);
  assert.deepEqual(closed.map(finding => finding.id), ["TECH01-F01", "TECH01-F02", "TECH01-F03", "TECH01-F04", "TECH01-F05"]);
  for (const finding of closed) {
    assert.equal(finding.eo05_blocker, false);
    const closure = JSON.parse(readFileSync(new URL(finding.closure_evidence, root), "utf8"));
    assert.equal(closure.product_owner_closure_accepted, true);
    assert.equal(closure.finding, finding.id);
  }
  assert.equal(audit.eo05_gate, "blocked");
  assert.equal(audit.a6_docs_01_may_start, false);
  assert.equal(audit.a6_eo_05_may_start, false);
});

test("quality and master ledgers expose the same active remediation gate", () => {
  assert.equal(
    quality.engineering_integrity.status,
    "audit_findings_recorded_critical_remediation_required",
  );
  assert.equal(master.current_gate, "A6-TECH-01_critical_remediation_and_retest");

  const packageRecord = master.independent_packages.find(
    (item) => item.id === "A6-TECH-01",
  );
  assert.equal(packageRecord.status, "Findings recorded; critical remediation and retest required");
  assert.equal(packageRecord.audit_contract, "contracts/a6-tech-01-engineering-integrity-audit-v1.json");
  assert.equal(packageRecord.audited_starting_baseline_commit, audit.audited_starting_baseline_commit);
  assert.equal(packageRecord.pass_baseline_commit, null);
});
