import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  buildProviderLiveEvidenceSafeLog,
  createProviderLiveEvidenceRuntime,
  META_PRODUCT_ACCEPTED_FIELDS,
  PROVIDER_LIVE_EVIDENCE_SAFE_LOG_PREFIX,
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
const liveEvidence = JSON.parse(read(
  "docs/evidence/EO_04_META_PROVIDER_LIVE_EVIDENCE_2026-10-16.json",
));
const route = read("app/routes/settings.provider-live-evidence.ts");
const settings = read("app/routes/_admin.settings.tsx");

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

test("server log keeps the required field evidence and excludes identities and hashes", () => {
  const evidence = summarizeMetaLiveEvidence(metaResult(), "2026-10-15");
  const safeLog = buildProviderLiveEvidenceSafeLog(evidence);

  assert.equal(PROVIDER_LIVE_EVIDENCE_SAFE_LOG_PREFIX,
    "[AdsTable provider live evidence safe]");
  assert.equal(safeLog.channel.row_count, 1);
  assert.equal(safeLog.product.row_count, 1);
  assert.deepEqual(safeLog.product.accepted_fields, META_PRODUCT_ACCEPTED_FIELDS);
  assert.equal(safeLog.product.field_state_counts.product_id.present_string, 1);
  assert.deepEqual(safeLog.product.converted_product_action_types.quantity.values, [
    "purchase",
  ]);
  assert.equal(safeLog.controls.database_write_performed, false);
  assert.equal(safeLog.controls.raw_identifiers_or_hashes_logged, false);
  assert.equal(safeLog.controls.provider_request_id_logged, false);
  assert.equal(safeLog.controls.cursor_or_cursor_hash_logged, false);
  assert.ok(serializedLength(safeLog) < 65_536);

  const serialized = JSON.stringify(safeLog);
  for (const forbidden of [
    "Secret Merchant Name",
    "Secret Campaign",
    "Secret Ad",
    "shopify_123_456",
    "act_123456",
    "22222222-2222-4222-8222-222222222222",
    "trace-channel",
    "trace-product",
    "opaque-channel-cursor",
    evidence.authority.connection_id_sha256,
    evidence.channel.row_identity_sha256[0],
    evidence.product.product_identity_sha256[0],
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden.replaceAll(".", "[.]")));
});

function serializedLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

test("server log redacts provider action types outside the bounded log alphabet", () => {
  const evidence = summarizeMetaLiveEvidence(metaResult(), "2026-10-15");
  const unsafe = structuredClone(evidence);
  unsafe.channel.action_type_inventory.actions.values.push("buyer@example.com\nsecret");
  const safeLog = buildProviderLiveEvidenceSafeLog(unsafe);
  assert.equal(
    safeLog.channel.action_type_inventory.actions.redacted_invalid_action_type_count,
    1,
  );
  assert.doesNotMatch(JSON.stringify(safeLog), /buyer@example[.]com|secret/);
});

test("server log caps valid action-type inventory without inventing zero", () => {
  const evidence = summarizeMetaLiveEvidence(metaResult(), "2026-10-15");
  const oversized = structuredClone(evidence);
  oversized.channel.action_type_inventory.actions.values = Array.from(
    {length: 60},
    (_, index) => `valid_action_${index}`,
  );
  oversized.channel.row_count = "invalid";
  oversized.channel.direct_metric_decisions.secret = "must-not-pass";
  const safeLog = buildProviderLiveEvidenceSafeLog(oversized);
  assert.equal(safeLog.channel.action_type_inventory.actions.values.length, 50);
  assert.equal(
    safeLog.channel.action_type_inventory.actions.truncated_valid_action_type_count,
    10,
  );
  assert.equal(safeLog.channel.row_count, null);
  assert.doesNotMatch(JSON.stringify(safeLog), /must-not-pass|secret/);
});

test("server log rejects incomplete, non-Meta, and invalid-date evidence", () => {
  const evidence = summarizeMetaLiveEvidence(metaResult(), "2026-10-15");
  for (const [invalid, expectedCode] of [
    [{...evidence, status: "failed"}, "LIVE_EVIDENCE_SAFE_LOG_RESULT_INVALID"],
    [{...evidence, provider: "google_ads"}, "LIVE_EVIDENCE_SAFE_LOG_RESULT_INVALID"],
    [{...evidence, business_date: "2026-02-30"}, "LIVE_EVIDENCE_SAFE_LOG_DATE_INVALID"],
  ]) {
    assert.throws(
      () => buildProviderLiveEvidenceSafeLog(invalid),
      (error) => error?.code === expectedCode,
    );
  }
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
  assert.equal(contract.http_trigger.temporary_settings_button, true);
  assert.equal(
    contract.http_trigger.temporary_settings_button_business_date,
    "2026-10-01",
  );
  assert.equal(
    contract.http_trigger.temporary_settings_button_single_attempt_per_page_load,
    true,
  );
  assert.equal(contract.http_trigger.route, "/settings/provider-live-evidence");
  assert.equal(contract.mutations.database_write, false);
  assert.equal(contract.product_owner_authorization.live_provider_call, true);
  assert.equal(contract.product_owner_authorization.deployment, true);
  assert.equal(contract.product_owner_authorization.merge, true);
  assert.equal(contract.product_owner_authorization.safe_server_log_merge, true);
  assert.equal(contract.product_owner_authorization.safe_server_log_deployment, true);
  assert.equal(contract.product_owner_authorization.next_live_provider_call, false);
  assert.equal(contract.product_owner_authorization.evidence_closure_merge, false);
  assert.equal(contract.repository_implementation.successful_live_route_executions_observed, 3);
  assert.equal(contract.repository_implementation.safe_response_payload_retained, true);
  assert.equal(contract.repository_implementation.safe_server_log_deployed, true);
  assert.match(route, /resolveReadOnlyShopifyRouteAuthority/);
  assert.match(route, /authenticate\.admin/);
  assert.match(route, /PROVIDER_LIVE_EVIDENCE_SAFE_LOG_PREFIX/);
  assert.match(route, /JSON[.]stringify\(buildProviderLiveEvidenceSafeLog\(result\)\)/);
  assert.equal(route.match(/console[.]info/g)?.length, 1);
  assert.doesNotMatch(route, /console[.]info\([^\n]*result[^\n]*\)/);
  assert.doesNotMatch(route, /<s-|useSubmit|useFetcher|Form/);
  assert.match(brief, /separate product-owner decision/i);
  assert.match(brief, /does not expose provider rows/i);
});

test("retained Meta live evidence preserves empty product semantics and mapping boundaries", () => {
  assert.equal(liveEvidence.execution.status, "complete");
  assert.equal(liveEvidence.execution.provider_retry_performed, false);
  assert.equal(liveEvidence.execution.database_write_performed, false);
  assert.equal(liveEvidence.channel.row_count, 1);
  assert.deepEqual(liveEvidence.channel.field_state_counts.impressions, {present_numeric: 1});
  assert.deepEqual(liveEvidence.channel.field_state_counts.outbound_clicks, {array: 1});
  assert.ok(liveEvidence.channel.action_types.includes("landing_page_view"));
  assert.ok(!liveEvidence.channel.action_types.some(
    (type) => /purchase|checkout|add_to_cart/.test(type),
  ));
  assert.equal(liveEvidence.product.request_completed, true);
  assert.equal(liveEvidence.product.response_state, "empty_success");
  assert.equal(liveEvidence.product.row_count, 0);
  assert.equal(liveEvidence.product.canonical_support_state, "not_observed_in_this_execution");
  assert.equal(liveEvidence.product.real_zero, false);
  assert.equal(liveEvidence.product.globally_unsupported, false);
  assert.equal(liveEvidence.analyst_decisions.session,
    "not_mapped_from_landing_page_view_without_separate_acceptance");
  assert.equal(liveEvidence.user_supplied_context.provider_authored_evidence, false);
  assert.equal(liveEvidence.next_product_evidence_gate.current_authorization, false);
  assert.equal(liveEvidence.retention_boundary.numeric_commercial_values_retained, false);
  assert.equal(liveEvidence.retention_boundary.raw_names_or_identifiers_retained, false);
});

test("connected Meta exposes only the approved one-attempt evidence button", () => {
  assert.match(settings, /"Run Meta evidence"/);
  assert.match(settings, /fetch\("\/settings\/provider-live-evidence"/);
  assert.match(settings, /provider: "meta"/);
  assert.match(settings, /business_date: "2026-10-01"/);
  assert.match(settings, /if \(metaEvidenceAttempted[.]current\) return/);
  assert.match(settings, /metaEvidenceAttempted[.]current = true/);
  assert.match(settings, /loading=\{metaEvidenceStatus === "loading"\}/);
  assert.match(settings, /disabled=\{metaEvidenceStatus === "complete" \|\| metaEvidenceStatus === "failed"\}/);
  assert.doesNotMatch(settings, /console[.](?:info|error)\("\[AdsTable Meta evidence\]/);
  assert.doesNotMatch(settings, /Meta evidence date|meta-evidence-modal/);
  assert.match(brief, /no modal, date input, new section or custom styling/i);
});
