import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
  buildKlaviyoLiveEvidenceSafeFailureLog,
  buildKlaviyoLiveEvidenceSafeLog,
  classifyKlaviyoLiveEvidenceError,
  createKlaviyoLiveEvidenceRuntime,
  KlaviyoLiveEvidenceError,
  summarizeKlaviyoLiveEvidence,
  validateKlaviyoLiveEvidenceInput,
} from "../app/lib/providers/klaviyo-live-evidence.server.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const settings = read("app/routes/_admin.settings.tsx");
const route = read("app/routes/settings.klaviyo-live-evidence.ts");
const contract = JSON.parse(read("contracts/eo-04d-klaviyo-live-evidence-trigger-v1.json"));

function productProperty(state, value = null) {
  return {state, value};
}

function completedRuntimeResult() {
  const campaign = {
    source: "campaign",
    source_entity_id: "campaign-secret",
    channel_id: "message-secret",
    channel_name: "Sonbahar Takıları",
    medium: "Email",
    variation_resolution: "unresolved",
  };
  const event = {
    provider_event_id: "event-secret",
    product_identity_state: "provider_native_observed",
    provider_attributions: [{attribution_id: "attribution-secret"}],
    provider_product_properties: {
      ProductID: productProperty("present", "product-secret"),
      VariantID: productProperty("present", "variant-secret"),
      SKU: productProperty("present", "sku-secret"),
      ProductName: productProperty("present", "İnci Kolye"),
      Name: productProperty("absent"),
      "Variant Name": productProperty("absent"),
      Quantity: productProperty("present", 2),
      "$value": productProperty("present", 450),
    },
  };
  return {
    provider: "klaviyo",
    status: "completed",
    publishable: true,
    business_date: "2026-10-18",
    completed_families: [
      "metrics",
      "campaign_values",
      "flow_values",
      "ordered_product_events",
      "resolved_product_sales",
    ],
    results: {
      metrics: {placed_order_metric_id: "placed-secret", ordered_product_metric_id: "product-secret"},
      campaign_values: {rows: [campaign], page_count: 1},
      flow_values: {rows: [], page_count: 1},
      ordered_product_events: {rows: [event], page_count: 1},
      resolved_product_sales: {
        rows: [{
          ...event,
          attribution_resolution: {
            channel_type: "campaign_message",
            channel_id: "message-secret",
            channel_name: "Sonbahar Takıları",
            medium_resolution: "exact",
            variation_resolution: "unresolved",
            sales_role: "Assisted",
          },
        }],
      },
    },
  };
}

test("Klaviyo evidence input accepts only the fixed provider selector", () => {
  assert.deepEqual(validateKlaviyoLiveEvidenceInput({provider: "klaviyo"}), {
    provider: "klaviyo",
  });
  assert.throws(
    () => validateKlaviyoLiveEvidenceInput({provider: "klaviyo", business_date: "2026-10-18"}),
    (error) => error.code === "KLAVIYO_LIVE_EVIDENCE_INPUT_FIELDS_INVALID",
  );
  assert.throws(
    () => validateKlaviyoLiveEvidenceInput({provider: "meta"}),
    (error) => error.code === "KLAVIYO_LIVE_EVIDENCE_PROVIDER_INVALID",
  );
});

test("completed evidence exposes only bounded counts and categorical states", () => {
  const evidence = summarizeKlaviyoLiveEvidence(completedRuntimeResult());
  assert.equal(evidence.campaign_messages.row_count, 1);
  assert.equal(evidence.flow_messages.observation_state, "not_observed_in_this_execution");
  assert.equal(evidence.ordered_product_events.property_presence_counts.ProductID.present, 1);
  assert.equal(evidence.resolved_product_sales.channel_resolution_counts.exact, 1);
  assert.equal(evidence.resolved_product_sales.sales_role_counts.Assisted, 1);
  assert.equal(evidence.controls.synthetic_custom_ecommerce_is_shopify_evidence, false);

  const serialized = JSON.stringify(evidence);
  for (const forbidden of [
    "campaign-secret",
    "message-secret",
    "event-secret",
    "attribution-secret",
    "product-secret",
    "variant-secret",
    "sku-secret",
    "İnci Kolye",
    "Sonbahar Takıları",
    "450",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden));
});

test("a missing completed family is not rewritten as a successful empty result", () => {
  const invalid = completedRuntimeResult();
  delete invalid.results.flow_values;
  assert.throws(
    () => summarizeKlaviyoLiveEvidence(invalid),
    (error) => error.code === "KLAVIYO_LIVE_EVIDENCE_FAMILY_INVALID",
  );
});

test("runtime invokes the permanent reporting path exactly once and performs no retry", async () => {
  let calls = 0;
  const runtime = createKlaviyoLiveEvidenceRuntime({
    klaviyoRuntime: {
      readDailyEvidenceSnapshot: async (input) => {
        calls += 1;
        assert.equal(input.installationAuthority.workspaceId, "workspace-1");
        assert.equal(Object.hasOwn(input, "businessDate"), false);
        return completedRuntimeResult();
      },
    },
  });
  const evidence = await runtime.execute({
    installationAuthority: {workspaceId: "workspace-1"},
    input: {provider: "klaviyo"},
  });
  assert.equal(calls, 1);
  assert.equal(evidence.status, "complete");
});

test("the first stopped reporting family remains terminal and safely classified", () => {
  const stopped = {
    provider: "klaviyo",
    status: "failed",
    publishable: false,
    completed_families: ["metrics"],
    results: null,
    error: {code: "KLAVIYO_PERMISSION_DENIED"},
  };
  assert.throws(
    () => summarizeKlaviyoLiveEvidence(stopped),
    (error) => {
      const failure = classifyKlaviyoLiveEvidenceError(error);
      assert.equal(failure.status, 403);
      assert.equal(failure.class, "permission_or_scope_missing");
      assert.deepEqual(failure.completed_families, ["metrics"]);
      const log = buildKlaviyoLiveEvidenceSafeFailureLog(failure, "execution");
      assert.equal(log.provider_retry_performed, false);
      assert.equal(log.next_query_family_started, false);
      return true;
    },
  );
});

test("safe logs reject incomplete results and contain no raw evidence", () => {
  const safe = buildKlaviyoLiveEvidenceSafeLog(
    summarizeKlaviyoLiveEvidence(completedRuntimeResult()),
  );
  assert.equal(safe.event, "klaviyo_live_evidence_safe");
  assert.equal(safe.controls.raw_provider_rows_exposed, false);
  assert.throws(
    () => buildKlaviyoLiveEvidenceSafeLog({status: "failed", provider: "klaviyo"}),
    (error) => error instanceof KlaviyoLiveEvidenceError,
  );
});

test("Settings exposes one native one-attempt Klaviyo evidence action", () => {
  assert.match(settings, /"Run Klaviyo evidence"/);
  assert.match(settings, /fetch\("\/settings\/klaviyo-live-evidence"/);
  assert.match(settings, /klaviyoEvidenceAttempted[.]current = true/);
  assert.match(settings, /loading=\{klaviyoEvidenceStatus === "loading"\}/);
  assert.match(settings, /Klaviyo evidence stopped[.] No retry was performed/);
  assert.doesNotMatch(settings, /klaviyo-evidence-modal|Klaviyo evidence date/);
});

test("the resource route is authenticated, read-only and logs bounded success or failure", () => {
  assert.match(route, /resolveReadOnlyShopifyRouteAuthority/);
  assert.match(route, /createKlaviyoReportingAuthorityRuntime/);
  assert.match(route, /buildKlaviyoLiveEvidenceSafeLog/);
  assert.match(route, /buildKlaviyoLiveEvidenceSafeFailureLog/);
  assert.doesNotMatch(route, /INSERT|UPDATE|DELETE|upsert/i);
});

test("the executable contract authorizes deployment while live call and sample generation stay closed", () => {
  assert.equal(contract.authority.repository_implementation, true);
  assert.equal(contract.authority.deployment, true);
  assert.equal(contract.authority.live_provider_call, false);
  assert.equal(contract.authority.sample_data_generation, false);
  assert.equal(contract.safety.first_provider_error_stops_execution, true);
  assert.equal(contract.safety.automatic_retry, false);
  assert.equal(contract.sample_data.custom_ecommerce_is_shopify_metric_evidence, false);
});
