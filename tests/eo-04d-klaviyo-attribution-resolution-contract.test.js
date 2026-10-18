import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/eo-04d-klaviyo-attribution-resolution-v1.json", import.meta.url),
  "utf8",
));
const brief = readFileSync(
  new URL("../docs/EO_04D_KLAVIYO_ATTRIBUTION_RESOLUTION_BRIEF.md", import.meta.url),
  "utf8",
);
const runtime = readFileSync(
  new URL("../app/lib/providers/klaviyo-attribution-resolution.server.js", import.meta.url),
  "utf8",
);

test("Ordered Product is the only product-sale fact and Placed Order cannot double count it", () => {
  assert.equal(contract.sale_grain.source, "Ordered Product");
  assert.equal(contract.sale_grain.one_provider_event_is_one_sale_fact, true);
  assert.equal(contract.sale_grain.duplicate_event_id_counted_more_than_once, false);
  assert.equal(contract.sale_grain.placed_order_counted_as_product_sale, false);
  assert.match(runtime, /reporting_conversions_counted_as_product_sales: false/);
});

test("known Message remains exact when catalog, Medium or Variation is unresolved", () => {
  assert.equal(contract.message_resolution.known_campaign_message_is_exact_channel, true);
  assert.equal(contract.message_resolution.known_flow_message_is_exact_channel, true);
  assert.equal(contract.message_resolution.catalog_name_missing_changes_known_message_to_unknown, false);
  assert.equal(contract.medium.unresolved_medium_changes_known_message_to_unknown, false);
  assert.equal(contract.variation.multiple_flow_variations_same_message, "unresolved");
  assert.match(brief, /Channel'ı `Unclassified Channel` yapmaz/);
});

test("Sales Role requires the accepted evidence level", () => {
  assert.equal(contract.sales_role.flow_message_attributed, "Triggered");
  assert.equal(contract.sales_role.campaign_content_unavailable, "Assisted");
  assert.equal(contract.sales_role.campaign_exact_content_contains_sold_product, "Advertised");
  assert.equal(contract.sales_role.campaign_exact_content_excludes_sold_product, "Cross-sell");
  assert.equal(contract.sales_role.advertised_or_cross_sell_without_exact_content_evidence, false);
});

test("resolver is repository-only and preserves fail-closed publication", () => {
  assert.equal(contract.publication.resolution_failure_publishable, false);
  assert.equal(contract.publication.partial_provider_rows_publishable, false);
  assert.equal(contract.publication.empty_success_is_numeric_zero, false);
  assert.equal(contract.authority_limits.live_provider_call_authorized, false);
  assert.equal(contract.authority_limits.database_or_migration_authorized, false);
  assert.equal(contract.authority_limits.secret_environment_or_deploy_authorized, false);
  assert.equal(contract.authority_limits.ui_authorized, false);
});
