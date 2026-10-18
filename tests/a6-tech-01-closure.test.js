import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const audit = read("contracts/a6-tech-01-engineering-integrity-audit-v1.json");
const closure = read(audit.closure_evidence);
const master = read("contracts/a6-eo-implementation-master-v1.json");
const quality = read("contracts/a6-quality-and-assurance-gates-v1.json");

test("accepted integrity closure binds the tested and live-accepted baseline across ledgers", () => {
  const packageRecord = master.independent_packages.find(item => item.id === "A6-TECH-01");
  assert.equal(closure.product_owner_closure_accepted, true);
  assert.equal(closure.merge_authorized_after_required_CI, true);
  assert.equal(closure.A6_TECH_01_overall_pass, true);
  for (const record of [audit, packageRecord, quality.engineering_integrity]) {
    assert.equal(record.pass_baseline_commit, closure.pass_baseline_commit);
    assert.equal(record.closure_evidence, audit.closure_evidence);
  }
  assert.equal(closure.deployment.source_commit, closure.pass_baseline_commit);
  assert.equal(closure.deployment.state, "READY");
  assert.equal(closure.deployment.alias_error, null);
  assert.equal(closure.source_governance.source_tree_equals_pass_baseline_tree, true);
  assert.equal(closure.source_governance.conclusion, "success");
  assert.equal(closure.live_acceptance.desktop_real_shopify_admin, "accepted_normal");
  assert.equal(closure.live_acceptance.mobile_real_shopify_admin, "accepted_normal");
  assert.equal(closure.live_acceptance.agent_direct_browser_observation, false);
});

test("PASS leaves only accepted F10 debt open and cannot start EO05 or final review", () => {
  const open = [...audit.findings, ...audit.retest_findings].filter(item => !item.closed);
  assert.deepEqual(open.map(item => item.id), ["TECH01-F10"]);
  assert.equal(open[0].eo05_blocker, false);
  assert.equal(open[0].upgrade_execution_authorized, false);
  const counts = Object.fromEntries(["P0", "P1", "P2", "P3"].map(priority => [priority, open.filter(item => item.priority === priority).length]));
  assert.deepEqual(counts, audit.current_open_finding_counts);
  assert.deepEqual(counts, closure.current_open_findings);
  assert.equal(master.current_gate, "A6-DOCS-01");
  assert.equal(closure.A6_DOCS_01_implementation_started, false);
  assert.equal(closure.EO05_may_start, false);
  assert.equal(closure.review_or_cutover_authorized, false);
  assert.equal(audit.a6_eo_05_may_start, false);
  assert.equal(master.current_active_parent, null);
  assert.equal(master.current_active_child, null);
  for (const changed of Object.values(closure.closure_record_scope)) assert.equal(changed, false);
  assert.equal(closure.closure_record_requires_fresh_CI_before_merge, true);
  assert.equal(closure.accepted_limits.length, 6);
});
