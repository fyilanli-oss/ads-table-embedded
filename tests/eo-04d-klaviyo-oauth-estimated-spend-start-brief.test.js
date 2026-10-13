import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const decision = read("docs/EO_04D_KLAVIYO_OAUTH_ESTIMATED_SPEND_START_BRIEF.md");
const contract = JSON.parse(read("contracts/eo-04d-klaviyo-oauth-estimated-spend-v1.json"));
const databaseEvidence = JSON.parse(read(
  "docs/evidence/EO_04D_KLAVIYO_SPEND_LIVE_DATABASE_ACCEPTANCE_2026-10-13.json",
));

test("EO-04-D records explicit product-owner start-brief acceptance", () => {
  assert.equal(contract.status, "accepted_implementation_in_progress");
  assert.equal(contract.product_owner_start_brief.status, "accepted");
  assert.equal(contract.product_owner_start_brief.accepted_at, "2026-10-13");
  assert.equal(contract.mutations_authorized_by_this_contract.database_schema, false);
  assert.equal(contract.mutations_authorized_by_this_contract.live_oauth, false);
});

test("EO-04-D records the separately approved live database gate", () => {
  assert.equal(contract.repository_implementation.live_database_applied, true);
  assert.equal(contract.repository_implementation.live_database_acceptance, "PASS_2026-10-13");
  assert.equal(databaseEvidence.migration.applied, true);
  assert.equal(databaseEvidence.rollback_scoped_synthetic_acceptance.status, "PASS");
  assert.equal(databaseEvidence.rollback_scoped_synthetic_acceptance.transaction_rolled_back, true);
  assert.deepEqual(databaseEvidence.rollback_scoped_synthetic_acceptance.synthetic_residue, {
    workspaces: 0,
    installations: 0,
    credentials: 0,
    connections: 0,
    accounts: 0,
    lifecycle_events: 0,
    spend_periods: 0,
  });
  assert.equal(databaseEvidence.advisors.security_findings_after, 0);
  assert.equal(databaseEvidence.advisors.new_unindexed_foreign_key_findings, 0);
  assert.equal(databaseEvidence.authorization.new_secret, false);
  assert.equal(databaseEvidence.authorization.provider_oauth, false);
  assert.equal(databaseEvidence.authorization.deployment, false);
});

test("Klaviyo uses the official PKCE and token hosts with one Connected Account", () => {
  assert.equal(contract.provider.pkce_method, "S256");
  assert.equal(contract.provider.authorization_url, "https://www.klaviyo.com/oauth/authorize");
  assert.equal(contract.provider.token_url, "https://a.klaviyo.com/oauth/token");
  assert.equal(contract.provider.revoke_url, "https://a.klaviyo.com/oauth/revoke");
  assert.equal(contract.provider.account_endpoint, "https://a.klaviyo.com/api/accounts/");
  assert.equal(contract.provider.account_cardinality, 1);
  assert.equal(contract.provider.reporting_account_control, false);
  assert.equal(contract.invariants.resume_restarts_oauth, false);
});

test("estimated spend has one private effective-dated authority", () => {
  assert.equal(contract.spend_ledger.table, "integrations.klaviyo_email_spend_periods");
  assert.equal(contract.spend_ledger.access_role, "adstable_runtime");
  assert.equal(contract.spend_ledger.browser_access, false);
  assert.equal(contract.spend_ledger.rls_enabled, true);
  assert.equal(contract.spend_ledger.rls_forced, true);
  assert.equal(contract.spend_ledger.minimum, "0.00");
  assert.equal(contract.spend_ledger.maximum, "99999999.99");
  assert.equal(contract.spend_ledger.second_mutable_current_cost_authority, false);
  assert.deepEqual(contract.spend_ledger.unique_period_key, [
    "connection_id",
    "account_id",
    "effective_from",
  ]);
});

test("Update spend and Change value remain different operations", () => {
  assert.equal(contract.update_spend.creates_new_period, true);
  assert.equal(contract.update_spend.provider_revalidation_required, true);
  assert.equal(contract.update_spend.duplicate_effective_start_error, "DUPLICATE_EFFECTIVE_START");
  assert.equal(contract.change_value.updates_existing_period_only, true);
  assert.equal(contract.change_value.changes_effective_date, false);
  assert.equal(contract.change_value.changes_account_or_currency, false);
  assert.equal(contract.change_value.increments_correction_version, true);
});

test("the start brief excludes reporting and allocation behavior", () => {
  for (const value of [
    "provider_reporting_requests",
    "channel_hierarchy",
    "cost_allocation",
    "formula_engine",
    "reporting_fact_persistence",
    "scheduler_or_backfill",
  ]) assert.ok(contract.out_of_scope.includes(value));

  assert.match(decision, /Campaign, Flow, Message or Variation reporting requests/);
  assert.match(decision, /Channel hierarchy and presentation rules/);
  assert.doesNotMatch(decision, /Dataset V2/);
  assert.doesNotMatch(JSON.stringify(contract), /dataset[_ -]?v2/i);
});

test("Shopify mapping uses only accepted components and user-triggered completion", () => {
  assert.ok(contract.ui.components.includes("s-number-field"));
  assert.ok(contract.ui.components.includes("s-modal"));
  assert.equal(contract.ui.automatic_modal_open_on_page_load, false);
  assert.equal(contract.ui.resume_setup_opens_completion_by_user_interaction, true);
  assert.equal(contract.ui.raw_html_controls, false);
  assert.equal(contract.ui.custom_css, false);
  assert.equal(contract.ui.clickable_action_substitute, false);
});
