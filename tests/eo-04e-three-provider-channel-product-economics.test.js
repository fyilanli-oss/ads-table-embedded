import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contract = JSON.parse(
  readFileSync(
    new URL("../contracts/eo-04e-three-provider-channel-product-economics-v1.json", import.meta.url),
    "utf8",
  ),
);

test("EO-04-E contract authorizes Meta and Klaviyo repository runtime while live work stays closed", () => {
  assert.equal(contract.status, "accepted_product_owner_meta_and_klaviyo_runtime_started");
  assert.equal(contract.acceptance.runtime_implementation_authorized, true);
  assert.equal(contract.acceptance.runtime_authorized_at, "2026-10-16");
  assert.equal(
    contract.acceptance.runtime_authorization_scope,
    "meta_provider_first_slice_and_klaviyo_repository_reporting_foundation",
  );
  assert.equal(contract.acceptance.klaviyo_runtime_authorized_at, "2026-10-17");
  assert.equal(contract.acceptance.live_provider_calls_authorized, false);
  assert.equal(contract.acceptance.product_owner_acceptance_required, true);
  assert.equal(contract.acceptance.product_owner_contract_acceptance, true);
  assert.equal(contract.acceptance.product_owner_contract_accepted_at, "2026-10-16");
  assert.equal(contract.acceptance.first_provider_error_stops_next_provider, true);
});

test("the three providers preserve their real Channel leaf", () => {
  assert.equal(contract.providers.meta.channel, "ad");
  assert.equal(contract.providers.google_ads.channels.standard_shopping, "ad_group");
  assert.equal(contract.providers.google_ads.channels.performance_max_retail, "asset_group");
  assert.equal(contract.providers.google_ads.channels.search, "ad_group");
  assert.equal(contract.providers.klaviyo.channels.campaign, "campaign_message");
  assert.equal(contract.providers.klaviyo.channels.flow, "flow_message");
  assert.equal(contract.providers.klaviyo.medium.source, "send_channel");
  assert.equal(contract.providers.klaviyo.medium.required, true);
  assert.equal(contract.providers.klaviyo.variation.replaces_channel, false);
});

test("Sales Role, Zero Value and Unclassified Channel are distinct axes", () => {
  assert.deepEqual(contract.common.sales_roles, [
    "Advertised",
    "Cross-sell",
    "Assisted",
    "Triggered",
    "Unclassified",
  ]);
  assert.equal(contract.common.unclassified_rule, "only_for_contradictory_or_ambiguous_evidence");
  assert.equal(contract.common.value_modifier, "Zero Value");
  assert.equal(contract.common.unclassified_channel, "sale_is_proven_but_exact_channel_is_not");
});

test("PMax ambiguity cannot be guessed and Klaviyo preserves Message Channel", () => {
  assert.equal(
    contract.providers.google_ads.pmax.broad_or_overlapping_listing_membership,
    "Unclassified Channel",
  );
  assert.equal(contract.providers.google_ads.pmax.downward_distribution, "forbidden");
  assert.equal(
    contract.providers.klaviyo.campaign_attribution.multiple_variations,
    "message_channel_exact_variation_unresolved_when_not_attributed",
  );
  assert.equal(
    contract.providers.klaviyo.campaign_attribution.event_relationship_includes_campaign_variation,
    false,
  );
});

test("provider product cost is not fabricated or promoted to true cost", () => {
  assert.equal(contract.common.no_product_cost_allocation, true);
  assert.equal(contract.providers.meta.cost.product_allocation, "forbidden");
  assert.equal(contract.providers.google_ads.cost.true_or_blended_cost, "eo05_only");
  assert.equal(contract.providers.klaviyo.estimated_spend_allocation, "A6-EO-05_only");
});

test("Klaviyo campaign daily grain uses bounded daily values windows", () => {
  assert.equal(contract.providers.klaviyo.campaign_daily_grain.series_endpoint, "unavailable");
  assert.equal(
    contract.providers.klaviyo.campaign_daily_grain.method,
    "one_business_day_per_values_timeframe",
  );
  assert.deepEqual(contract.providers.klaviyo.campaign_daily_grain.bootstrap_order, [
    "yesterday",
    "today",
  ]);
  assert.equal(contract.providers.klaviyo.campaign_daily_grain.documented_limit.daily, 225);
});

test("only official Shopify-managed provider identity paths are in scope", () => {
  assert.equal(
    contract.providers.meta.supported_identity_path,
    "official_shopify_facebook_and_instagram_sales_channel",
  );
  assert.equal(
    contract.providers.google_ads.supported_identity_path,
    "official_shopify_google_and_youtube_automatic_product_sync",
  );
  assert.equal(
    contract.providers.klaviyo.supported_identity_path,
    "official_klaviyo_shopify_integration",
  );
  assert.match(contract.providers.meta.identity_validation, /shopify_product_and_variant/);
  assert.match(contract.providers.meta.identity_validation, /shopify_admin_api/);
  assert.match(contract.providers.google_ads.identity_validation, /shopify_admin_api/);
});

test("Ad Cost layers remain explicit, fail-closed and package-owned", () => {
  assert.equal(contract.ad_cost.user_facing_label, "Ad Cost");
  assert.equal(
    contract.ad_cost.technical_layers.channel_ad_cost,
    "exact_provider_cost_at_real_channel_grain",
  );
  assert.equal(contract.ad_cost.technical_layers.allocated_ad_cost, "A6-EO-05_only");
  assert.equal(contract.ad_cost.providers.meta.channel_to_product_distribution, "forbidden_in_EO04");
  assert.equal(contract.ad_cost.providers.meta.validated_exact_product_cost_across_sales_roles, "preserve");
  assert.equal(contract.ad_cost.providers.google_ads.unclassified_channel_redistribution, "forbidden");
  assert.equal(contract.ad_cost.providers.google_ads.exact_product_cost_under_unclassified_channel, "preserve");
  assert.equal(contract.ad_cost.providers.klaviyo.allocation_owner, "A6-EO-05");
  assert.equal(contract.ad_cost.rules.explicit_zero_preserved, true);
  assert.equal(
    contract.ad_cost.rules.missing_null_unsupported_permission_denied_or_validation_pending_becomes_zero,
    false,
  );
  assert.equal(contract.ad_cost.rules.product_cost_rows_reconstruct_channel_total, false);
  assert.equal(contract.ad_cost.rules.missing_product_cost_may_be_ratio_allocated_in_EO04, false);
  assert.equal(contract.ad_cost.rules.unverified_shopify_identity_drops_provider_cost_evidence, false);
  assert.equal(
    contract.ad_cost.rules.sales_role_value_modifier_or_unclassified_channel_erases_exact_provider_product_cost,
    false,
  );
  assert.equal(
    contract.ad_cost.rules
      .exact_provider_product_cost_is_preserved_for_cross_sell_assisted_zero_value_and_unclassified_channel,
    true,
  );
  assert.equal(contract.ad_cost.rules.sales_role_or_value_modifier_may_fabricate_product_cost_in_EO04, false);
  assert.equal(
    contract.ad_cost.rules.klaviyo_triggered_native_product_cost,
    "unavailable_allocation_in_A6_EO_05",
  );
});
