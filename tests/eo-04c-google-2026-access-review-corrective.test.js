import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Google 2026 access contract separates Explorer, OAuth review and runtime compatibility", async () => {
  const contract = JSON.parse(await readFile(
    new URL("contracts/eo-04c-google-2026-access-review-corrective-v1.json", root),
    "utf8",
  ));

  assert.equal(contract.official_access_model.access_authority, "oauth_client_google_cloud_project");
  assert.equal(contract.official_access_model.stage_1_target, "explorer");
  assert.equal(contract.official_access_model.oauth_public_verification_is_separate, true);
  assert.equal(contract.runtime.developer_token_environment_required, false);
  assert.equal(contract.runtime.developer_token_sent_only_when_configured, true);
  assert.equal(contract.runtime.first_provider_error_stops, true);
  assert.equal(contract.runtime.automatic_retry, false);
  assert.equal(contract.runtime.automatic_cloud_project_fallback, false);
  assert.equal(contract.review_readiness.first_production_call_requires_separate_product_owner_approval, true);
  assert.equal(contract.mutations.provider, false);
  assert.equal(contract.mutations.secret_or_environment, false);
  assert.equal(contract.mutations.deployment, false);
});

test("Google corrective keeps access, account security, permission and OAuth failures distinct", async () => {
  const contract = JSON.parse(await readFile(
    new URL("contracts/eo-04c-google-2026-access-review-corrective-v1.json", root),
    "utf8",
  ));

  assert.deepEqual(contract.error_semantics, {
    http_401: "reauthorization_required",
    CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION: "provider_access_level_required",
    TWO_STEP_VERIFICATION_NOT_ENROLLED: "account_security_action_required",
    http_403_other: "permission_or_scope_missing",
    AUTHORIZATION_ERROR: "provider_access_incident",
  });
});

test("Google corrective preserves the historical listing-tree safety boundary", async () => {
  const contract = JSON.parse(await readFile(
    new URL("contracts/eo-04c-google-2026-access-review-corrective-v1.json", root),
    "utf8",
  ));

  assert.equal(contract.listing_tree_boundary.current_tree_may_resolve_historical_sale, false);
  assert.equal(contract.listing_tree_boundary.historical_exact_requires_complete_business_day_snapshot, true);
  assert.equal(contract.listing_tree_boundary.missing_snapshot_result, "Unknown Channel");
  assert.equal(contract.listing_tree_boundary.sales_and_sales_role_preserved, true);
  assert.equal(contract.listing_tree_boundary.versioned_snapshot_persistence_owner, "A6-EO-05");
  assert.equal(contract.listing_tree_boundary.versioned_snapshot_persistence_implemented, false);
});
