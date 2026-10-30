import test from "node:test";
import assert from "node:assert/strict";
import {preparePdNativeMetadata as prepare, bindNativePdRecordMetadata} from "../app/lib/providers/pd-native-metadata.server.js";
import {readGooglePdNativeMetadata, GOOGLE_PD_METADATA_QUERIES} from "../app/lib/providers/google-pd-native-metadata.server.js";
const id = "11111111-1111-4111-8111-111111111111";
function fixture(provider = "google_ads") {
  const sourceContext = {workspace_id: id, installation_id: "42", installation_generation: 1, provider,
    provider_connection_id: id, connection_version: 2, reporting_selection_epoch: provider === "klaviyo" ? null : "71",
    platform_account_id: provider === "meta" ? "act_123" : "123", canonical_reporting_account_id: provider === "klaviyo" ? null : provider === "meta" ? "act_123" : "123",
    business_date: "2026-10-01", source_timezone: "UTC", source_currency: "USD", job_or_run_id: "job1", claim_fence: 1};
  const settings = {account: {rows: [{customer: {id: "123", currencyCode: "USD", timeZone: "UTC"}}]},
    actions: {rows: [{conversionAction: {resourceName: "customers/123/conversionActions/1", ownerCustomer: "customers/123", category: "PURCHASE",
      attributionModelSettings: {attributionModel: "GOOGLE_ADS_LAST_CLICK"}, countingType: "MANY_PER_CLICK",
      clickThroughLookbackWindowDays: "30", viewThroughLookbackWindowDays: "1"}}]}};
  const evidence = {provider, flow: "search", native_metadata: {before: structuredClone(settings), after: structuredClone(settings)},
    results: {conversions: {rows: [{segments: {conversionAction: "customers/123/conversionActions/1", conversionActionCategory: "PURCHASE"}}]}}};
  if (provider === "meta") evidence.channel = {rows: [{ad_id: "3", adset_id: "2", campaign_id: "1", ad_name: "Leaf", adset_name: "Parent",
    campaign_name: "Root", account_currency: "USD", attribution_setting: "7d_click,1d_view"}],
    evidence: {action_report_time: "impression", use_unified_attribution_setting: true, requested_fields: ["account_currency", "attribution_setting"]}};
  if (provider === "klaviyo") evidence.native_metadata = {before: {account: {id: "123", currency: "USD", timezone: "UTC"}},
    after: {account: {id: "123", currency: "USD", timezone: "UTC"}}};
  return {sourceContext, evidence};
}
test("Google fingerprints contain actual account/action settings and declared units, no guessed default", () => {
  const f = fixture(), before = structuredClone(f), result = prepare(f);
  assert.equal(result.status, "prepared");
  assert.equal(result.attribution.settings.actions[0].click_days, 30);
  assert.equal(result.units.fields.cost_divisor, 1000000);
  assert.match(result.composition_context.attribution_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.composition_context.references.attribution.startsWith("sha256:"), true);
  assert.deepEqual(f, before); assert.ok(Object.isFrozen(result.attribution.settings));
  assert.equal(result.publishable, false);
});
for (const [label, change, reason] of [
  ["unknown model", f => f.evidence.native_metadata.before.actions.rows[0].conversionAction.attributionModelSettings.attributionModel = "UNKNOWN", "native_conversion_settings_or_account_missing"],
  ["missing window", f => delete f.evidence.native_metadata.before.actions.rows[0].conversionAction.viewThroughLookbackWindowDays, "native_conversion_settings_or_account_missing"],
  ["wrong native currency", f => f.evidence.native_metadata.before.account.rows[0].customer.currencyCode = "TRY", "native_conversion_settings_or_account_missing"],
  ["changed model", f => f.evidence.native_metadata.after.actions.rows[0].conversionAction.attributionModelSettings.attributionModel = "GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN", "native_settings_changed_during_read"],
  ["uncovered action", f => f.evidence.results.conversions.rows[0].segments.conversionAction = "customers/999/conversionActions/9", "conversion_action_metadata_coverage_missing"],
  ["category conflict", f => f.evidence.results.conversions.rows[0].segments.conversionActionCategory = "ADD_TO_CART", "conversion_action_metadata_coverage_missing"],
]) test(`Google blocks ${label}`, () => {const f = fixture(); change(f); assert.equal(prepare(f).reason, reason);});
test("Meta derives a separate scope per native Ad/attribution setting and explicit report time", () => {
  const f = fixture("meta"), first = prepare(f);
  f.evidence.channel.rows.push({...f.evidence.channel.rows[0], ad_id: "4", attribution_setting: "1d_click"});
  const r = prepare(f);
  assert.equal(r.status, "prepared"); assert.equal(r.entries.length, 2);
  assert.notEqual(r.entries[0].scope.attribution_fingerprint, r.entries[1].scope.attribution_fingerprint);
  assert.equal(r.entries[0].scope.attribution_fingerprint, first.entries[0].scope.attribution_fingerprint);
  assert.equal(r.entries[0].scope.reporting_time_basis, "impression_date");
  assert.equal(r.entries[0].scope.entity_id, "3");
});
for (const [label, change, reason] of [
  ["implicit request", f => delete f.evidence.channel.evidence.action_report_time, "native_report_settings_not_explicit"],
  ["absent native setting", f => delete f.evidence.channel.rows[0].attribution_setting, "native_attribution_setting_not_returned"],
  ["unknown native setting", f => f.evidence.channel.rows[0].attribution_setting = "Unknown", "native_attribution_setting_not_returned"],
  ["native currency mismatch", f => f.evidence.channel.rows[0].account_currency = "EUR", "native_account_currency_mismatch"],
]) test(`Meta blocks ${label}`, () => {const f = fixture("meta"); change(f); assert.equal(prepare(f).reason, reason);});
test("Klaviyo reports verified account currency/units but cannot invent attribution settings", () => {
  const r = prepare(fixture("klaviyo"));
  assert.equal(r.reason, "attribution_settings_read_not_documented");
  assert.equal(r.units.source_currency, "USD"); assert.equal(r.composition_context, null);
});
test("native metadata never invents target currency, FX, or a display name", () => {
  const f = fixture("meta"), prepared = prepare(f);
  const r = bindNativePdRecordMetadata({...f, prepared});
  assert.equal(r.expected_target_currency, null); assert.equal(r.entries[0].enrichment.currency, null);
  assert.equal(r.entries[0].enrichment.entity.entity_name, "Leaf");
});
test("Google metadata follows exact reporting account pagination with bounded evidence", async () => {
  const calls = [], limits = {maxPages: 3, maxRows: 10, maxBytes: 10000};
  const r = await readGooglePdNativeMetadata({accountId: "123", currency: "USD", timezone: "UTC", limits,
    client: {search: async v => {calls.push(v);return {results: v.query === GOOGLE_PD_METADATA_QUERIES.account
      ? [{customer: {id: "123", currencyCode: "USD", timeZone: "UTC", email: "private@example.com"}}] : [], next_page_token: null, request_id: "req"};}}});
  assert.equal(calls.length, 2); assert.ok(calls.every(v => v.customerId === "123"));
  assert.equal(r.account.request_ids[0], "req"); assert.equal(r.actions.rows.length, 0);
  assert.doesNotMatch(JSON.stringify(r), /private@example/);
});
test("first metadata failure and wrong account stop before another query", async () => {
  for (const rejected of [true, false]) {
    let calls = 0;
    await assert.rejects(readGooglePdNativeMetadata({accountId: "123", currency: "USD", timezone: "UTC",
      limits: {maxPages: 3, maxRows: 10, maxBytes: 10000}, client: {search: async () => {
        calls++; if (rejected) throw Error("provider failure");
        return {results: [{customer: {id: "999", currencyCode: "USD", timeZone: "UTC"}}], next_page_token: null};
      }}})); assert.equal(calls, 1);
  }
});
