import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("Google route brief refuses browser and manager authority", async () => {
  const contract = await readJson("contracts/eo-04c-google-oauth-route-wiring-v1.json");

  assert.equal(
    contract.status,
    "Proposed_product_owner_acceptance_required_before_UI_implementation",
  );
  assert.equal(contract.callback_return_authority.browser_shop_input_trusted, false);
  assert.equal(contract.callback_return_authority.cookie_as_shop_authority, false);
  assert.equal(contract.selection.manager_reporting_eligible, false);
  assert.equal(contract.selection.minimum_advertisers, 1);
  assert.equal(contract.selection.maximum_advertisers, 3);
  assert.ok(contract.browser_forbidden.includes("credential_id"));
  assert.ok(contract.browser_forbidden.includes("provider_account_evidence"));
});

test("Google route brief preserves Polaris 2 RC constitution", async () => {
  const contract = await readJson("contracts/eo-04c-google-oauth-route-wiring-v1.json");

  assert.equal(contract.ui.runtime, "polaris-2.0-rc.js");
  assert.equal(contract.ui.types, "2.0.0-rc.2");
  assert.equal(contract.ui.raw_html_action_or_form_controls, false);
  assert.equal(contract.ui.custom_css, false);
  assert.equal(contract.ui.clickable_as_button, false);
  for (const component of [
    "s-page",
    "s-section",
    "s-choice-list",
    "s-choice",
    "s-button",
    "s-banner",
  ]) {
    assert.ok(contract.ui.components.includes(component));
  }
});

test("route implementation remains blocked until explicit acceptance", async () => {
  const contract = await readJson("contracts/eo-04c-google-oauth-route-wiring-v1.json");
  const brief = await readFile(
    "docs/EO_04C_GOOGLE_OAUTH_ROUTE_WIRING_BRIEF.md",
    "utf8",
  );

  assert.equal(contract.mutation_authority.repository_brief_and_contract, true);
  assert.equal(contract.mutation_authority.route_or_UI_implementation, false);
  assert.equal(contract.mutation_authority.live_supabase, false);
  assert.equal(contract.mutation_authority.vercel_deploy, false);
  assert.equal(contract.mutation_authority.live_google_oauth, false);
  assert.equal(contract.mutation_authority.live_google_api, false);
  assert.match(brief, /transaction ID in the return URL is correlation only/i);
  assert.match(brief, /React 18/);
  assert.match(brief, /minimum 320 px/i);
});
