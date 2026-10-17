import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/eo-04d-klaviyo-oauth-hardening-v1.json", import.meta.url),
  "utf8",
));

test("Klaviyo OAuth hardening is repository-only and uses the current revision", () => {
  assert.equal(contract.provider.api_revision, "2026-10-15");
  assert.equal(contract.authority.repository_mutation_authorized, true);
  for (const boundary of [
    "live_provider_call_authorized",
    "provider_console_mutation_authorized",
    "secret_or_environment_mutation_authorized",
    "database_or_migration_authorized",
    "deployment_authorized",
    "ui_mutation_authorized",
  ]) assert.equal(contract.authority[boundary], false, boundary);
});

test("credential renewal occurs before provider work and legacy tokens fail safe", () => {
  assert.equal(contract.token_policy.expires_at_inside_encrypted_token_set, true);
  assert.equal(contract.token_policy.minimum_validity_ms, 60000);
  assert.equal(contract.token_policy.expired_or_near_expiry_refreshes_before_provider_request, true);
  assert.equal(contract.token_policy.legacy_token_without_expiry_refreshes_before_provider_request, true);
  assert.equal(contract.token_policy.successful_refresh_persisted_before_provider_request, true);
});

test("first provider failure never becomes refresh-and-retry", () => {
  assert.equal(contract.failure_policy.refresh_after_failed_provider_request, false);
  assert.equal(contract.failure_policy.retry_failed_provider_request, false);
  assert.equal(contract.failure_policy.partial_success_from_failure, false);
  assert.equal(contract.failure_policy.accounts_401, "reauthorization_required");
  assert.equal(contract.failure_policy.accounts_403, "permission_denied");
  assert.equal(contract.failure_policy.refresh_invalid_grant, "reauthorization_required");
  assert.equal(contract.failure_policy.authorization_code_invalid_grant, "oauth_session_expired");
});

test("Settings stays local and behavior requires executable tests", () => {
  assert.equal(contract.settings_policy.connected_inspection_calls_provider, false);
  assert.equal(contract.test_policy.token_and_accounts_http_behavior_executed_with_fakes, true);
  assert.equal(contract.test_policy.source_text_matching_is_sufficient_for_runtime_behavior, false);
});

test("Klaviyo-origin installation stays outside this backend package", () => {
  assert.equal(contract.deferred.klaviyo_origin_installation_route, true);
  assert.equal(contract.deferred.source_pr, 91);
  assert.equal(contract.deferred.source_pr_mergeable_as_is, false);
});
