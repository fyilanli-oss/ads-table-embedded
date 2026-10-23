import assert from "node:assert/strict";
import test from "node:test";
import {buildMetaSourceLinks} from "../app/lib/providers/meta-source-links.server.js";

const scope = Object.freeze({workspace_id: "workspace-1", install_generation: 2,
  connection_id: "connection-1", reporting_account_id: "act_123"});
const dateWindow = Object.freeze({start: "2026-10-01", end: "2026-10-02"});
const ad = Object.freeze({account_id: "123", campaign_id: "campaign-1", adset_id: "set-1",
  ad_id: "ad-1", date_start: "2026-10-01", date_stop: "2026-10-01", spend: "300",
  actions: [{action_type: "offsite_conversion.fb_pixel_purchase", value: "3"}]});
const product = Object.freeze({...ad, product_id: "shopify_TR_100_200", spend: "18",
  converted_product_quantity: "0", converted_product_value: null});
const build = (channelRows, productRows, overrides = {}) => buildMetaSourceLinks({
  scope, dateWindow, channelRows, productRows, ...overrides,
});

test("04 creates scoped native references without joining metrics or parsing Shopify candidates", () => {
  const channels = [structuredClone(ad)];
  const products = [structuredClone(product), {...product, product_id: "product-2", spend: "9"}];
  const before = JSON.stringify({channels, products});
  const result = build(channels, products);
  assert.deepEqual(result.product_links.map(link => [link.product_row_index, link.pd_row_index]), [[0, 0], [1, 0]]);
  assert.ok(result.product_links.every(link => link.state === "exact_native_ad_reference"));
  assert.deepEqual(result.scope, scope);
  assert.deepEqual(result.product_links[0].native_key, {account_id: "123", ad_id: "ad-1",
    business_date: "2026-10-01", campaign_id: "campaign-1", adset_id: "set-1"});
  assert.equal(result.product_links[0].provider_product_id, product.product_id);
  assert.equal(result.product_links[0].shopify_identity_state, "unresolved_mapping_pending");
  assert.equal(result.publishable, false);
  assert.doesNotMatch(JSON.stringify(result), /spend|actions|quantity|sales_role|shopify_product_id|shopify_variant_id/);
  assert.equal(JSON.stringify({channels, products}), before);
  assert.ok(Object.isFrozen(result.product_links[0].native_key));
  assert.ok(Object.isFrozen(result.scope));
});

test("04 never links across account, day, requested window or absent native identities", () => {
  const variants = [
    {account_id: "999"}, {account_id: "act_123"}, {account_id: undefined},
    {ad_id: undefined}, {ad_id: " ad-1"}, {date_start: undefined},
    {date_stop: "2026-10-02"}, {date_start: "2026-09-30", date_stop: "2026-09-30"},
    {date_start: "2026-02-30", date_stop: "2026-02-30"}, {campaign_id: undefined},
    {adset_id: undefined}, {product_id: undefined}, {product_id: ""},
  ];
  for (const patch of variants) {
    const result = build([ad], [{...product, ...patch}]).product_links[0];
    assert.equal(result.state, "unresolved", JSON.stringify(patch));
    assert.equal(result.pd_row_index, null);
    assert.equal(result.referenced_pd_ad_id, null);
  }
  assert.equal(build([{...ad, account_id: "999"}], [product]).product_links[0].reason, "pd_row_not_observed");
  assert.equal(build([ad], [{...product, date_start: "2026-10-02", date_stop: "2026-10-02"}])
    .product_links[0].reason, "pd_row_not_observed");
});

test("04 does not choose a duplicate, override a conflicting parent or match names", () => {
  const duplicate = build([ad, {...ad}], [product]).product_links[0];
  assert.equal(duplicate.state, "ambiguous");
  assert.equal(duplicate.pd_row_index, null);
  for (const patch of [{campaign_id: "campaign-2"}, {adset_id: "set-2"}]) {
    const link = build([ad], [{...product, ...patch}]).product_links[0];
    assert.equal(link.state, "conflicting");
    assert.equal(link.pd_row_index, null);
  }
  assert.equal(build([{...ad, adset_id: null}], [product]).product_links[0].reason, "pd_hierarchy_identity_missing");
  const renamed = build([{...ad, ad_name: "old name"}], [{...product, ad_name: "new name"}]);
  assert.equal(renamed.product_links[0].state, "exact_native_ad_reference");
  const sameName = build([{...ad, ad_name: "same"}], [{...product, ad_id: "other", ad_name: "same"}]);
  assert.equal(sameName.product_links[0].state, "unresolved");
});

test("04 preserves row indexes, isolated workspace scopes and empty observation without zero facts", () => {
  const result = build([{...ad, ad_id: "other"}, ad], [product, {...product, ad_id: "unknown"}]);
  assert.equal(result.product_links[0].pd_row_index, 1);
  assert.equal(result.product_links[1].product_row_index, 1);
  assert.equal(result.product_links[1].pd_row_index, null);
  const other = build([ad], [product], {scope: {...scope, workspace_id: "workspace-2", install_generation: 3}});
  assert.notDeepEqual(other.scope, result.scope);
  assert.deepEqual(build([ad], []).product_links, []);
  assert.equal(build([], [product]).product_links[0].state, "unresolved");
  assert.equal(build([], [product]).product_links[0].native_key.ad_id, "ad-1");
  assert.equal(build([], [product]).product_links[0].provider_product_id, product.product_id);
  assert.deepEqual(build([], []).product_links, []);
  for (const patch of [{scope: {...scope, reporting_account_id: "123"}},
    {scope: {...scope, install_generation: 0}}, {scope: {...scope, workspace_id: ""}},
    {dateWindow: {start: "2026-02-30", end: "2026-03-01"}}]) {
    assert.throws(() => build([], [], patch), error => error.code === "META_SOURCE_LINK_INPUT_INVALID");
  }
});
