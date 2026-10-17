import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Meta App Role readiness contract keeps restricted and production stages separate", async () => {
  const contract = JSON.parse(
    await readFile(new URL("contracts/eo-04b-meta-app-role-readiness-v1.json", root), "utf8"),
  );

  assert.equal(contract.stage_1_restricted_acceptance.app_role, "tester");
  assert.deepEqual(contract.stage_1_restricted_acceptance.oauth_scopes, ["ads_read"]);
  assert.equal(contract.stage_1_restricted_acceptance.public_customer_access, false);
  assert.equal(contract.stage_2_production_access.advanced_access_or_app_review, "later_gate");
  assert.equal(contract.mutations.live_provider_call, false);
  assert.equal(contract.mutations.preview_deployment, true);
  assert.equal(contract.mutations.production_deployment, false);
  assert.equal(contract.provider_dependent_gates.sales_role, "pending_separate_slice");
});
test("connected Settings does not expose the temporary Meta evidence action", async () => {
  const settings = await readFile(new URL("app/routes/_admin.settings.tsx", root), "utf8");

  assert.doesNotMatch(settings, /Run Meta evidence/);
  assert.doesNotMatch(settings, /runMetaEvidence/);
  assert.doesNotMatch(settings, /metaEvidenceStatus/);
  assert.match(settings, /settings\/provider-live-evidence|Reporting Account/);
});
