import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  createProviderLiveEvidenceRuntime,
  META_PRODUCT_ACCEPTED_FIELDS,
  summarizeMetaLiveEvidence,
  validateProviderLiveEvidenceInput,
} from "../app/lib/providers/provider-live-evidence.server.js";
import {
  resolveReadOnlyShopifyRouteAuthority,
} from "../app/lib/shopify/shopify-route-authority.server.js";
import {
  META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS,
} from "../app/lib/providers/meta-reporting.server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const contract = JSON.parse(read("contracts/eo-04-provider-live-acceptance-v1.json"));
const brief = read("docs/EO_04_PROVIDER_LIVE_ACCEPTANCE_START_BRIEF.md");
const route = read("app/routes/settings.provider-live-evidence.ts");

const installationAuthority = Object.freeze({
  authority: "shopify_installation_verified",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  installGeneration: 3,
  status: "active",
});

function metaResult() {
  return {
    provider: "meta",
    authority: {
      connection_id: "22222222-2222-4222-8222-222222222222",
      reporting_account_id: "act_123456",
    },
    channel: {
      rows: [{
        account_name: "Secret Merchant Name",
        campaign_name: "Secret Campaign",
        ad_name: "Secret Ad",
        date_start: "2026-10-15",
        ad_id: "ad-1",
        impressions: "100",
        spend: "12.50",
        clicks: "7",
        inline_link_clicks: "5",
        outbound_clicks: "4",
        actions: [
          {action_type: "offsite_conversion.fb_pixel_add_to_cart", value: "3"},
          {action_type: "offsite_conversion.fb_pixel_purchase", value: "1"},
        ],
        action_values: [
          {action_type: "offsite_conversion.fb_pixel_purchase", value: "85.00"},
        ],
      }],
      next_cursor: "opaque-channel-cursor",
      provider_request_id: "trace-channel",
    },
    product: {
      rows: [{
        account_name: "Secret Merchant Name",
        ad_name: "Secret Ad",
        date_start: "2026-10-15",
        ad_id: "ad-1",
        product_id: "shopify_123_456",
        impressions: "80",
        clicks: "6",
        spend: "10.00",
        converted_product_quantity: [{action_type: "purchase", value: "1"}],
        converted_product_value: [{action_type: "purchase", value: "85.00"}],
      }],
      next_cursor: null,
      provider_request_id: "trace-product",
    },
  };
}

test("accepted trigger input is exactly Meta plus one business date", () => {
  assert.deepEqual(
    validateProviderLiveEvidenceInput({provider: "meta", business_date: "2026-10-15"}),
    {provider: "meta", businessDate: "2026-10-15"},
  );
  for (const input of [
    {provider: "google_ads", business_date: "2026-10-15"},
    {provider: "meta", business_date: "15-10-2026"},
    {provider: "meta", business_date: "2026-02-31"},
    {provider: "meta", business_date: "2026-10-15", account_id: "act_999"},
    {provider: "meta", business_date: "2026-10-15", cursor: "operator-value"},
  ]) assert.throws(() => validateProviderLiveEvidenceInput(input));
});

test("evidence fails closed when runtime authority identity is missing", () => {
  const result = metaResult();
  result.authority.connection_id = "";
  assert.throws(
    () => summarizeMetaLiveEvidence(result, "2026-10-15"),
    (error) => error.code === "LIVE_EVIDENCE_AUTHORITY_RESULT_INVALID",
  );
});

test("Meta acceptance emits shape evidence without raw commercial or authority values", () => {
  const result = summarizeMetaLiveEvidence(metaResult(), "2026-10-15");
  assert.equal(result.publishable_to_dataset_v2, false);
  assert.equal(result.channel.grain, "ad");
  assert.equal(result.channel.row_count, 1);
  assert.deepEqual(result.channel.action_type_inventory.actions.values, [
    "offsite_conversion.fb_pixel_add_to_cart",
    "offsite_conversion.fb_pixel_purchase",
  ]);
  assert.equal(
    result.channel.direct_metric_decisions.ad_click,
    "mapping_pending_live_click_field_review",
  );
  assert.equal(result.product.status, "raw_provider_evidence_pending_standardization");
  assert.deepEqual(result.product.accepted_fields, META_PRODUCT_ACCEPTED_FIELDS);
  assert.equal(result.controls.provider_retry_performed, false);
  assert.equal(result.controls.database_write_performed, false);

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "Secret Merchant Name",
    "Secret Campaign",
    "Secret Ad",
    "shopify_123_456",
    "act_123456",
    "22222222-2222-4222-8222-222222222222",
    "12.50",
    "85.00",
    "opaque-channel-cursor",
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden.replaceAll(".", "[.]")));
});

test("runtime performs one Meta attempt and never starts another provider", async () => {
  const calls = [];
  const runtime = createProviderLiveEvidenceRuntime({
    metaRuntime: {
      async readDailyEvidencePages(input) {
        calls.push(input);
        return metaResult();
      },
    },
  });
  const result = await runtime.execute({
    installationAuthority,
    input: {provider: "meta", business_date: "2026-10-15"},
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    installationAuthority,
    dateWindow: {start: "2026-10-15", end: "2026-10-15"},
  });
  assert.equal(result.controls.next_provider_started, false);
});

test("first provider failure is returned without retry", async () => {
  let calls = 0;
  const failure = new Error("opaque-provider-failure");
  const runtime = createProviderLiveEvidenceRuntime({
    metaRuntime: {
      async readDailyEvidencePages() {
        calls += 1;
        throw failure;
      },
    },
  });
  await assert.rejects(
    runtime.execute({
      installationAuthority,
      input: {provider: "meta", business_date: "2026-10-15"},
    }),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
});

test("read-only Shopify authority resolves an existing generation without bootstrap", async () => {
  const queries = [];
  const authority = await resolveReadOnlyShopifyRouteAuthority({
    request: new Request("https://embedded.adstable.app/settings/provider-live-evidence"),
    authenticateAdmin: async () => ({
      sessionToken: {dest: "https://merchant.myshopify.com/"},
      admin: {
        async graphql() {
          return new Response(JSON.stringify({
            data: {shop: {
              id: "gid://shopify/Shop/123",
              myshopifyDomain: "merchant.myshopify.com",
            }},
          }));
        },
      },
    }),
    database: {
      async query(sql, values) {
        queries.push({sql, values});
        return {rows: [{
          workspace_id: installationAuthority.workspaceId,
          install_generation: 3,
          installation_status: "active",
        }]};
      },
    },
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /shopify[.]resolve_active_installation/);
  assert.doesNotMatch(queries[0].sql, /bootstrap_installation/);
  assert.deepEqual(queries[0].values, [
    "gid://shopify/Shop/123",
    "merchant.myshopify.com",
  ]);
  assert.deepEqual(authority.installationAuthority, installationAuthority);
});

test("contract keeps product fields raw and the temporary route non-visual", () => {
  assert.deepEqual(
    contract.meta.product_breakdown.accepted_fields,
    META_PRODUCT_ACCEPTED_FIELDS,
  );
  assert.equal(META_PRODUCT_ACCEPTED_FIELDS[0], "product_id");
  assert.equal(contract.meta.product_breakdown.breakdown, "product_id");
  assert.ok(META_PRODUCT_ACCEPTED_FIELDS.slice(1).every(
    (field) => META_PRODUCT_BREAKDOWN_INSIGHTS_FIELDS.includes(field),
  ));
  assert.equal(contract.http_trigger.visual_product_surface, false);
  assert.equal(contract.http_trigger.route, "/settings/provider-live-evidence");
  assert.equal(contract.mutations.database_write, false);
  assert.equal(contract.product_owner_authorization.live_provider_call, false);
  assert.equal(contract.product_owner_authorization.deployment, false);
  assert.match(route, /resolveReadOnlyShopifyRouteAuthority/);
  assert.match(route, /authenticate\.admin/);
  assert.doesNotMatch(route, /<s-|useSubmit|useFetcher|Form/);
  assert.match(brief, /separate product-owner decision/i);
  assert.match(brief, /does not expose provider rows/i);
});
