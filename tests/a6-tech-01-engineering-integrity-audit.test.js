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

test("A6-TECH-01 records accepted PASS separately from its historical audited starting baseline", () => {
  assert.equal(audit.status, "pass_product_owner_accepted_2026-10-18");
  assert.match(audit.audited_starting_baseline_commit, /^[0-9a-f]{40}$/);
  assert.equal(audit.pass_baseline_commit, "bd243fff7200ae6bdb3900ebb7417b3beba53010");
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
  assert.equal(audit.a6_docs_01_may_start, true);
  assert.equal(audit.a6_eo_05_may_start, false);
});

test("quality and master ledgers expose the same active remediation gate", () => {
  assert.equal(
    quality.engineering_integrity.status,
    "pass_product_owner_accepted_2026-10-18",
  );
  assert.equal(master.current_gate, "A6-EO-05_REPOSITORY_IMPLEMENTATION_IN_PROGRESS");

  const packageRecord = master.independent_packages.find(
    (item) => item.id === "A6-TECH-01",
  );
  assert.equal(packageRecord.status, "Accepted; scoped integrity baseline recorded");
  assert.equal(packageRecord.audit_contract, "contracts/a6-tech-01-engineering-integrity-audit-v1.json");
  assert.equal(packageRecord.audited_starting_baseline_commit, audit.audited_starting_baseline_commit);
  assert.equal(packageRecord.pass_baseline_commit, audit.pass_baseline_commit);
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

test("historical security retest stays intact while accepted repository remediation closes only its own finding", () => {
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
  assert.equal(finding.closed, true);
  assert.equal(finding.eo05_blocker, false);
  assert.equal(finding.authorized_repository_change, "vite_7.3.6_scoped_esbuild_0.28.1_ajv_8.18.0_ts_morph_24.0.0_repository_only");
  assert.equal(finding.remaining_remediation_execution_authorized, false);
  assert.equal(evidence.A6_TECH_01_overall_pass, false);
  assert.equal(evidence.A6_DOCS_01_may_start, false);
  assert.equal(evidence.EO05_may_start, false);
  assert.equal(evidence.reused_database_evidence.fresh_database_replay_performed, false);
  const packageRecord = master.independent_packages.find(item => item.id === "A6-TECH-01");
  assert.equal(packageRecord.open_retest_security_finding, null);
  assert.equal(packageRecord.closed_retest_security_finding, finding.id);
  assert.equal(packageRecord.retest_security_closure_evidence, finding.closure_evidence);
  assert.equal(packageRecord.latest_retest_evidence, audit.latest_retest_evidence);
  assert.equal(packageRecord.retest_remediation_execution_authorized, false);
  assert.equal(packageRecord.authorized_retest_repository_change, finding.authorized_repository_change);
  assert.equal(packageRecord.latest_security_remediation_evidence, finding.remediation_evidence);
});

test("historical security closure did not itself grant the later overall audit acceptance", () => {
  const finding = audit.retest_findings.find(item => item.id === "TECH01-RETEST-SEC01");
  const closure = JSON.parse(readFileSync(new URL(finding.closure_evidence, root), "utf8"));
  const remediation = JSON.parse(readFileSync(new URL(closure.remediation_evidence, root), "utf8"));
  assert.equal(closure.finding, finding.id);
  assert.equal(closure.product_owner_closure_accepted, true);
  assert.equal(closure.security_finding_closed, true);
  assert.equal(closure.verified_main_merge_commit, "aa32e03b57f84b7b5a950a9c9be67826135c2536");
  assert.equal(closure.source_and_merge_tree, "f5a4bc34c54cef43e0c52aad32a19b6c76788b2b");
  assert.equal(closure.github_ci.conclusion, "success");
  assert.equal(closure.github_ci.tests_passed, remediation.fresh_local_checks.pnpm_test.passed);
  assert.equal(closure.github_ci.tests_failed, 0);
  assert.equal(closure.remaining_general_audit_gates.length, 3);
  for (const key of ["security_finding_alone_blocks_EO05", "F10_closed", "deployment_authorized", "live_mutation_performed", "A6_TECH_01_overall_pass", "A6_DOCS_01_may_start", "EO05_may_start"]) assert.equal(closure[key], false, key);
  for (const result of [remediation.production_audit, remediation.complete_audit]) {
    assert.equal(result.exit_code, 0);
    assert.deepEqual(result.vulnerabilities, {info: 0, low: 0, moderate: 0, high: 0, critical: 0});
  }
  assert.equal(audit.pass_baseline_commit, "bd243fff7200ae6bdb3900ebb7417b3beba53010");
  assert.equal(audit.eo05_gate, "blocked");
});
