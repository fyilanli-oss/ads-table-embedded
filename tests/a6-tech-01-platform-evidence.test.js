import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const evidencePath = "docs/evidence/A6_TECH_01_GITHUB_META_EVIDENCE_2026-10-18.json";
const evidence = read(evidencePath);

test("GitHub main protection evidence binds active exact target, Actions check and no bypass", () => {
  const ruleset = evidence.github.observed_ruleset;
  assert.equal(evidence.github.branch_protected, true);
  assert.equal(ruleset.id, 25357172);
  assert.equal(ruleset.enforcement, "active");
  assert.deepEqual(ruleset.conditions.ref_name, {exclude: [], include: ["refs/heads/main"]});
  assert.deepEqual(ruleset.bypass_actors, []);
  assert.equal(ruleset.current_user_can_bypass, "never");
  assert.deepEqual(ruleset.rules.map(item => item.type).sort(), ["deletion", "non_fast_forward", "pull_request", "required_status_checks"]);
  const checks = ruleset.rules.find(item => item.type === "required_status_checks").parameters;
  assert.deepEqual(checks.required_status_checks, [{context: "governance", integration_id: 15368}]);
  assert.equal(checks.strict_required_status_checks_policy, false);
  assert.equal(ruleset.rules.find(item => item.type === "pull_request").parameters.required_approving_review_count, 0);
});

test("user-supplied Meta docs and prepared fixes never masquerade as direct fetch or live acceptance", () => {
  const audit = read("contracts/a6-tech-01-engineering-integrity-audit-v1.json");
  const master = read("contracts/a6-eo-implementation-master-v1.json");
  const meta = read("contracts/eo-04b-meta-reporting-runtime-v1.json").error_classification_correction;
  assert.equal(audit.latest_platform_evidence, evidencePath);
  assert.equal(master.independent_packages.find(item => item.id === "A6-TECH-01").latest_platform_evidence, evidencePath);
  assert.equal(meta.evidence, evidencePath);
  assert.equal(meta.repository_authorized, true);
  assert.deepEqual(meta.buc_rate_limit_codes, [80000, 80004]);
  assert.equal(meta.bare_403_proves_invalid_token, false);
  assert.equal(meta.automatic_retry, false);
  assert.equal(evidence.meta_documentation.agent_rate_limit_fetch, "HTTP_429_stop_no_retry_no_alternative");
  assert.equal(evidence.meta_documentation.agent_error_handling_fetch_after_429, "not_attempted");
  assert.equal(evidence.approved_remediation.new_real_provider_calls, 0);
  assert.deepEqual(audit.open_evidence, []);
  const closure = read(audit.closure_evidence);
  assert.equal(closure.meta_two_error_fixes_merged_and_released, true);
  assert.equal(closure.product_owner_closure_accepted, true);
  for (const key of ["historical_evidence_rewritten", "F01_through_F09_reopened", "F10_closed", "new_backup_work_authorized", "A6_TECH_01_overall_pass", "A6_DOCS_01_may_start", "EO05_may_start"]) assert.equal(evidence[key], false, key);
  for (const changed of Object.values(evidence.scope)) assert.equal(changed, false);
});
