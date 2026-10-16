import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contract = JSON.parse(
  readFileSync(
    new URL("../contracts/eo-04e-three-provider-channel-product-economics-v1.json", import.meta.url),
    "utf8",
  ),
);

test("EO-04-E remains an acceptance contract and does not authorize runtime or live provider work", () => {
  assert.equal(contract.status, "ready_for_product_owner_acceptance");
  assert.equal(contract.acceptance.runtime_implementation_authorized, false);
  assert.equal(contract.acceptance.live_provider_calls_authorized, false);
  assert.equal(contract.acceptance.product_owner_acceptance_required, true);
  assert.equal(contract.acceptance.first_provider_error_stops_next_provider, true);
});

test("the three providers preserve their real Channel leaf", () => {
  assert.equal(contract.providers.meta.channel, "ad");
  assert.equal(contract.providers.google_ads.channels.standard_shopping, "ad_group");
  assert.equal(contract.providers.google_ads.channels.performance_max_retail, "asset_group");
  assert.equal(contract.providers.google_ads.channels.search, "ad_group");
  assert.equal(contract.providers.klaviyo.channels.campaign, "campaign_variation");
  assert.equal(
    contract.providers.klaviyo.channels.flow_with_variation_attribution,
    "flow_message_variation",
  );
});

test("Sales Role, Zero Value and Unknown Channel are distinct axes", () => {
  assert.deepEqual(contract.common.sales_roles, [
    "Advertised",
    "Cross-sell",
    "Assisted",
    "Triggered",
    "Unclassified",
  ]);
  assert.equal(contract.common.unclassified_rule, "only_for_contradictory_or_ambiguous_evidence");
  assert.equal(contract.common.value_modifier, "Zero Value");
  assert.equal(contract.common.unknown_channel, "sale_is_proven_but_exact_channel_is_not");
});

test("PMax ambiguity and Klaviyo multi-variation attribution cannot be guessed", () => {
  assert.equal(
    contract.providers.google_ads.pmax.broad_or_overlapping_listing_membership,
    "Unknown Channel",
  );
  assert.equal(contract.providers.google_ads.pmax.downward_distribution, "forbidden");
  assert.equal(
    contract.providers.klaviyo.campaign_attribution.multiple_variations,
    "product_stays_under_unknown_channel_with_message_context",
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
});
