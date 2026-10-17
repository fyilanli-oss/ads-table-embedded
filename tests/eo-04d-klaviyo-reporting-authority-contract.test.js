import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/eo-04d-klaviyo-reporting-authority-v1.json", import.meta.url),
  "utf8",
));
const brief = readFileSync(
  new URL("../docs/EO_04D_KLAVIYO_REPORTING_AUTHORITY_BRIEF.md", import.meta.url),
  "utf8",
);
const runtime = readFileSync(
  new URL("../app/lib/providers/klaviyo-reporting-authority.server.js", import.meta.url),
  "utf8",
);

test("Klaviyo reporting authority contract retains the approved installation, account and scope boundaries", () => {
  assert.equal(contract.api_revision, "2026-10-15");
  assert.equal(contract.authority.shopify_active_installation_required, true);
  assert.equal(contract.authority.connected_klaviyo_account_cardinality, 1);
  assert.deepEqual(contract.authority.required_scopes, [
    "campaigns:read",
    "events:read",
    "flows:read",
    "metrics:read",
  ]);
  assert.match(runtime, /oauthInstallationAuthority/);
  assert.match(runtime, /createKlaviyoCredentialAuthority/);
});

test("pagination is bounded, same-origin and never inferred for Values", () => {
  assert.equal(contract.pagination.cursor_inference_forbidden, true);
  assert.equal(contract.pagination.same_origin_and_endpoint_required, true);
  assert.equal(contract.pagination.maximum_pages_per_family, 100);
  assert.equal(contract.pagination.cursor_loop_fails_closed, true);
  assert.match(brief, /cursor tahmin etmez/);
});

test("publication remains atomic and empty success remains distinct from zero", () => {
  assert.equal(contract.publication.all_families_complete_before_publish, true);
  assert.equal(contract.publication.partial_result_publishable, false);
  assert.equal(contract.publication.empty_success, "not_observed_in_this_execution");
  assert.equal(contract.publication.empty_success_is_numeric_zero, false);
});

test("provider and infrastructure mutations remain outside this repository package", () => {
  assert.equal(contract.authority_limits.live_provider_call_authorized, false);
  assert.equal(contract.authority_limits.database_or_migration_authorized, false);
  assert.equal(contract.authority_limits.dataset_v2_write_authorized, false);
  assert.equal(contract.authority_limits.secret_environment_or_deploy_authorized, false);
  assert.equal(contract.authority_limits.ui_authorized, false);
});
