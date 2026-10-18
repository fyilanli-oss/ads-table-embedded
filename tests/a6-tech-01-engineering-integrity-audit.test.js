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
  assert.deepEqual(closed.map(finding => finding.id), ["TECH01-F01", "TECH01-F02", "TECH01-F03", "TECH01-F04", "TECH01-F05", "TECH01-F06", "TECH01-F07", "TECH01-F08"]);
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

test("F10 accepted deferral remains open and cannot authorize an upgrade or EO-05", () => {
  const finding = audit.findings.find(item => item.id === "TECH01-F10");
  const evidence = JSON.parse(readFileSync(new URL(finding.remediation_evidence, root), "utf8"));
  const packageRecord = master.independent_packages.find(item => item.id === "A6-TECH-01");
  assert.equal(finding.remediation_status, "deferred_separate_compatibility_work_product_owner_accepted");
  assert.equal(finding.closed, false);
  assert.equal(finding.eo05_blocker, false);
  assert.equal(finding.upgrade_execution_authorized, false);
  assert.equal(evidence.product_owner_deferral_accepted, true);
  for (const key of ["F10_closed", "F10_fixed", "F10_upgrade_execution_authorized", "F10_alone_blocks_EO05", "A6_TECH_01_overall_pass", "EO05_may_start"]) {
    assert.equal(evidence[key], false, key);
  }
  assert.equal(packageRecord.last_closed_finding, "TECH01-F09");
  assert.equal(packageRecord.next_finding, finding.id);
  assert.equal(packageRecord.next_finding_disposition, finding.remediation_status);
  assert.equal(packageRecord.next_finding_disposition_evidence, finding.remediation_evidence);
  assert.equal(packageRecord.next_finding_execution_authorized, false);
});

test("F10 deferral preserves pinned dependencies, config and documentation limitations", () => {
  const finding = audit.findings.find(item => item.id === "TECH01-F10");
  const evidence = JSON.parse(readFileSync(new URL(finding.remediation_evidence, root), "utf8"));
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(manifest.dependencies["react-router"], evidence.versions_observed.react_router);
  assert.equal(manifest.devDependencies["@vercel/react-router"], evidence.versions_observed.vercel_adapter_installed);
  assert.equal(evidence.documentation_access.complete_migration_or_flag_compatibility_proven, false);
  assert.equal(evidence.major_upgrade_required_to_remove_all_warnings_proven, false);
  assert.equal(evidence.future_warning_flags_observed_in_installed_dev_source.length, 5);
  for (const changed of Object.values(evidence.scope)) assert.equal(changed, false);
  const config = readFileSync(new URL("react-router.config.ts", root), "utf8");
  assert.doesNotMatch(config, /\bfuture\s*:/);
  assert.ok(evidence.follow_up.required_gates.length >= 5);
});

test("successful repository checks cannot hide an open full-graph security retest finding", () => {
  const evidence = JSON.parse(readFileSync(new URL(audit.latest_retest_evidence, root), "utf8"));
  assert.equal(evidence.fresh_local_checks.pnpm_test.failed, 0);
  assert.equal(evidence.fresh_local_checks.production_audit.exit_code, 0);
  assert.equal(evidence.fresh_local_checks.complete_audit.exit_code, 1);
  const counts = evidence.fresh_local_checks.complete_audit.vulnerabilities;
  assert.deepEqual(counts, {info: 0, low: 1, moderate: 3, high: 4, critical: 0});
  for (const severity of ["low", "moderate", "high"]) {
    assert.equal(evidence.advisories_observed.filter(item => item.severity === severity).length, counts[severity]);
  }
  const finding = audit.retest_findings.find(item => item.id === evidence.security_finding.id);
  assert.equal(finding.closed, false);
  assert.equal(finding.eo05_blocker, true);
  assert.equal(finding.authorized_repository_change, "vite_7.3.6_scoped_esbuild_0.28.1_ajv_8.18.0_ts_morph_24.0.0_repository_only");
  assert.equal(finding.remaining_remediation_execution_authorized, true);
  assert.equal(evidence.A6_TECH_01_overall_pass, false);
  assert.equal(evidence.A6_DOCS_01_may_start, false);
  assert.equal(evidence.EO05_may_start, false);
  assert.equal(evidence.reused_database_evidence.fresh_database_replay_performed, false);
  const packageRecord = master.independent_packages.find(item => item.id === "A6-TECH-01");
  assert.equal(packageRecord.open_retest_security_finding, finding.id);
  assert.equal(packageRecord.latest_retest_evidence, audit.latest_retest_evidence);
  assert.equal(packageRecord.retest_remediation_execution_authorized, true);
  assert.equal(packageRecord.authorized_retest_repository_change, finding.authorized_repository_change);
  assert.equal(packageRecord.latest_security_remediation_evidence, finding.remediation_evidence);
});
