import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("EO-04-A start brief freezes truthful common adapter behavior", async () => {
  const contract = await readJson("contracts/eo-04a-common-adapter-start-brief-v1.json");

  assert.equal(contract.status, "Accepted");
  assert.equal(contract.authority.merchant_selectable_reporting_store, false);
  assert.equal(contract.authority.provider_account_can_change_workspace, false);
  assert.equal(contract.zero_rule, "only_explicit_provider_numeric_zero_becomes_zero");
  assert.equal(contract.pagination.partial_publish_as_complete, false);
  assert.equal(contract.pagination.provider_cursor_is_opaque, true);
  assert.equal(contract.retry.retry_only_documented_transient_conditions, true);
  assert.equal(contract.raw_evidence.stored_in_application_logs, false);
  assert.equal(contract.store_scope.silent_cross_store_mix_forbidden, true);
  assert.equal(contract.secret_gate.creates_secret, false);
  assert.equal(contract.mutations_authorized.provider, false);
  assert.equal(contract.mutations_authorized.database, false);
  assert.equal(contract.account_selection.meta.minimum, 1);
  assert.equal(contract.account_selection.meta.maximum, 3);
  assert.equal(contract.account_selection.google_ads.maximum, 3);
  assert.equal(contract.account_selection.google_ads.manager_account_selectable, false);
  assert.equal(contract.account_selection.google_ads.manager_account_reporting_eligible, false);
  assert.equal(contract.account_selection.klaviyo.maximum, 1);
  assert.equal(contract.account_selection.klaviyo.is_ad_account, false);
  assert.equal(contract.canonical_funnel_fact_contract.legacy_user_id_forbidden, true);
  assert.equal(contract.canonical_funnel_fact_contract.raw_metrics.length, 10);
  assert.deepEqual(contract.canonical_funnel_fact_contract.metric_support_values, [
    "supported",
    "unsupported",
    "unknown",
  ]);
  assert.equal(
    contract.canonical_funnel_fact_contract.fallback_synthetic_partial_or_incomplete_publishable,
    false,
  );
  assert.equal(contract.oauth_to_first_data_sequence.length, 17);
  assert.equal(
    contract.oauth_to_first_data_sequence[15],
    "initial_bootstrap_yesterday_then_today_only",
  );

  for (const state of [
    "zero",
    "absent",
    "unsupported",
    "ambiguous_store_scope",
    "partial",
    "failed",
  ]) {
    assert.ok(contract.support_states.includes(state));
  }

  assert.equal(
    contract.provider_baseline.meta.provider_implementation_blocked_until_current_official_docs_readable,
    true,
  );
});

test("EO-04-A exposes complete synthetic acceptance and secret gates", async () => {
  const contract = await readJson("contracts/eo-04a-common-adapter-start-brief-v1.json");

  for (const scenario of [
    "explicit_zero",
    "absent_field",
    "multi_page_complete",
    "cursor_loop",
    "rate_limit_then_success",
    "authentication_failure_no_retry",
    "partial_page_failure_not_publishable",
    "ambiguous_store_scope",
    "secret_redaction",
  ]) {
    assert.ok(contract.synthetic_acceptance_cases.includes(scenario));
  }

  assert.equal(contract.secret_gate.inventory_acceptance_required_before_provider_secret, true);
  assert.equal(contract.secret_gate.provider_key_recovery_required_before_first_real_provider_authorization, true);
  assert.equal(contract.secret_gate.production_credentials_reused_in_nonproduction, false);
  assert.equal(contract.product_owner_start_brief_acceptance.status, "accepted");
  assert.equal(contract.implementation.status, "complete_acceptance_pending");
  assert.equal(contract.acceptance_state.next_provider_child_authorized, false);
});

test("Execution Plan and master contract activate only the EO-04-A brief gate", async () => {
  const plan = await readFile("docs/EXECUTION_PLAN.md", "utf8");
  const master = await readJson("contracts/a6-eo-implementation-master-v1.json");
  const eo04 = master.packages.find((item) => item.id === "A6-EO-04");
  const eo04a = eo04.children.find((item) => item.id === "A6-EO-04-A");

  for (const value of [
    "docs/EO_04A_COMMON_ADAPTER_START_BRIEF.md",
    "contracts/eo-04a-common-adapter-start-brief-v1.json",
    "tests/eo-04a-common-adapter-start-brief.test.js",
    "Only an explicit provider zero becomes zero",
  ]) {
    assert.match(plan, new RegExp(value.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")));
  }

  assert.equal(master.schema_version, "1.23.0");
  assert.equal(master.current_active_parent, "A6-EO-04");
  assert.equal(master.current_active_child, "A6-EO-04-D");
  assert.equal(master.current_gate, "A6-EO-04-D_start_brief_accepted_repository_implementation_pending");
  assert.equal(eo04.status, "Active");
  assert.equal(eo04a.status, "Accepted");
  assert.equal(eo04a.implementation_started, true);
  assert.equal(eo04a.implementation_complete, true);
  assert.equal(eo04a.final_product_owner_acceptance, true);
});
