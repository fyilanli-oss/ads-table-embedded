import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/eo-04d-klaviyo-reporting-runtime-v1.json", import.meta.url),
  "utf8",
));
const analysisBook = readFileSync(
  new URL("../docs/EO_04_ANALYSIS_DESIGN_BOOK.md", import.meta.url),
  "utf8",
);

test("Klaviyo reporting runtime is repository-only and uses the GA revision", () => {
  assert.equal(contract.api_revision, "2026-10-15");
  assert.equal(contract.authority.repository_runtime_authorized, true);
  assert.equal(contract.authority.live_provider_call_authorized, false);
  assert.equal(contract.authority.database_or_migration_authorized, false);
  assert.equal(contract.authority.secret_environment_or_deploy_authorized, false);
});

test("Message is Channel, Medium is mandatory and Variation remains subordinate", () => {
  assert.equal(contract.hierarchy.campaign_channel_entity, "campaign_message");
  assert.equal(contract.hierarchy.flow_channel_entity, "flow_message");
  assert.equal(contract.hierarchy.variation_replaces_channel, false);
  assert.equal(contract.hierarchy.medium_source, "send_channel");
  assert.equal(contract.hierarchy.medium_required, true);
  assert.deepEqual(contract.hierarchy.supported_media, ["Email", "SMS", "WhatsApp", "Push"]);
});

test("Campaign Audience is navigation-only and never becomes an AdsTable reporting dimension", () => {
  assert.deepEqual(
    contract.hierarchy.campaign,
    ["campaign", "campaign_audience", "campaign_message", "variation"],
  );
  assert.equal(contract.hierarchy.campaign_audience_is_channel, false);
  assert.equal(contract.hierarchy.campaign_audience_role, "provider_navigation_only");
  assert.equal(contract.hierarchy.campaign_audience_persisted_in_canonical_dataset, false);
  assert.equal(contract.hierarchy.campaign_audience_exposed_to_user, false);
  assert.equal(contract.hierarchy.campaign_audience_splits_sales, false);
  assert.equal(contract.hierarchy.campaign_content_traversal_must_follow_audience_parentage, true);
  assert.match(analysisBook, /\*\*Audience:\*\* `Son 90 Günde Alışveriş Yapanlar`/);
  assert.match(analysisBook, /\*\*Audience sonucu:\*\* kanonik AdsTable satırına alınmaz/);
});

test("known Message with unresolved Variation is not Unclassified Channel", () => {
  assert.equal(contract.sales_role.campaign_exact_sold_in_content_product_set, "Assisted");
  assert.equal(contract.sales_role.campaign_exact_sold_outside_content_product_set, "Assisted");
  assert.equal(contract.sales_role.content_product_set_proves_interaction_product, false);
  assert.equal(
    contract.channel_resolution.message_known_multiple_variations,
    "message_channel_exact_variation_unresolved",
  );
  assert.equal(contract.channel_resolution.message_missing_or_conflicting, "Unclassified Channel");
  assert.equal(contract.channel_resolution.multi_channel_synthetic_bucket, false);
});

test("Shopify order metrics have separate performance and product responsibilities", () => {
  assert.equal(contract.metrics.conversion_metric, "Placed Order");
  assert.equal(contract.metrics.product_sale_metric, "Ordered Product");
  assert.equal(contract.metrics.both_metrics_must_resolve_exactly_once, true);
  assert.equal(contract.metrics.placed_order_and_ordered_product_may_both_be_counted_as_sales, false);
  assert.equal(contract.events.include_profile, false);
  assert.equal(contract.events.standardized_product_id, "deferred");
});

test("first error and empty-success states remain fail-closed", () => {
  assert.equal(contract.failure_boundary.first_provider_error_stops_all_remaining_families, true);
  assert.equal(contract.failure_boundary.automatic_retry, false);
  assert.equal(contract.failure_boundary.partial_result_publishable, false);
  assert.equal(contract.failure_boundary.empty_success_means_numeric_zero, false);
});
