import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const contract = JSON.parse(read(
  "contracts/eo-04d-klaviyo-review-safe-foundation-v1.json",
));
const oauthContract = JSON.parse(read(
  "contracts/eo-04d-klaviyo-oauth-estimated-spend-v1.json",
));

test("K-1 is explicitly accepted and cannot mutate provider, deployment or schema", () => {
  assert.equal(contract.status, "accepted_implementation_authorized");
  assert.equal(contract.product_owner_approval.status, "accepted");
  assert.equal(contract.product_owner_approval.accepted_at, "2026-10-17");
  assert.equal(contract.mutations_authorized.repository, true);
  for (const boundary of [
    "provider_console", "live_provider", "database_schema",
    "vercel_environment", "deployment",
  ]) assert.equal(contract.mutations_authorized[boundary], false);
});

test("Klaviyo stable revision and accepted minimum read scopes are exact", () => {
  assert.equal(contract.provider.stable_api_revision, "2026-10-15");
  assert.equal(oauthContract.provider.api_revision, "2026-10-15");
  assert.equal(contract.provider.beta_applications_api_used, false);
  assert.deepEqual(contract.provider.requested_scopes, [
    "accounts:read",
    "campaigns:read",
    "flows:read",
    "events:read",
    "metrics:read",
  ]);
  assert.equal(
    oauthContract.provider.scope_activation["metrics:read"],
    "required_for_explicit_conversion_metric_selection",
  );
});

test("Klaviyo-origin install cannot turn merchant text into store authority", () => {
  assert.equal(contract.installation_entry.public_route, "/auth/klaviyo/install");
  assert.equal(contract.installation_entry.verified_start_route, "/auth/klaviyo/start");
  assert.equal(contract.installation_entry.store_input_is_routing_hint_only, true);
  assert.equal(contract.installation_entry.typed_store_can_create_or_switch_workspace, false);
  assert.equal(
    contract.installation_entry.shopify_admin_authentication_required_before_oauth_transaction,
    true,
  );
  assert.equal(contract.installation_entry.verified_active_installation_owns_transaction, true);
  assert.equal(contract.installation_entry.registered_in_klaviyo_console, false);
});

test("first provider error is terminal and auth and permission errors stay distinct", () => {
  const policy = contract.credential_and_error_policy;
  assert.equal(policy.provider_request_retried_after_error, false);
  assert.equal(policy.accounts_401, "reauthorization_required_no_retry");
  assert.equal(policy.accounts_403, "permission_denied_no_refresh_no_retry");
  assert.equal(policy.refresh_invalid_grant, "reauthorization_required_no_retry");
  assert.equal(policy.authorization_code_invalid_grant, "oauth_session_expired");
  assert.equal(policy.unknown_provider_failure, "stop_first_failure");
});

test("review transport uses Shopify components and exact recovery copy", () => {
  const brief = read("docs/EO_04D_KLAVIYO_REVIEW_SAFE_FOUNDATION_BRIEF.md")
    .replace(/\s+/g, " ");
  assert.equal(contract.ui.raw_html_action_controls, false);
  assert.equal(contract.ui.custom_css, false);
  assert.equal(contract.ui.literal_colors, false);
  assert.equal(contract.ui.clickable_action_substitute, false);
  assert.equal(contract.ui.desktop_and_mobile_acceptance_required, true);
  for (const exact of [
    contract.ui.entry_heading,
    contract.ui.entry_instruction,
    contract.ui.invalid_store_message,
    contract.ui.expired_session_message,
    contract.ui.permission_message,
  ]) assert.equal(brief.includes(exact), true, exact);
});
