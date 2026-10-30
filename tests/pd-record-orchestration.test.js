import test from "node:test";
import assert from "node:assert/strict";
import {bridgePdReadSnapshot as bridge} from "../app/lib/providers/pd-record-orchestration.server.js";
import {recordMetadata} from "./helpers/pd-record-metadata.js";
import {mapMetaPdMetrics} from "../app/lib/providers/meta-reporting.server.js";

const uuid = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const sourceContext = {workspace_id: uuid, installation_id: "42", installation_generation: 1, provider: "meta",
    provider_connection_id: uuid, connection_version: 2, reporting_selection_epoch: "71", platform_account_id: "act_123",
    canonical_reporting_account_id: "act_123", business_date: "2026-10-01", source_timezone: "UTC", source_currency: "USD",
    job_or_run_id: "job-1", claim_fence: 1, reporting_time_basis: null};
  const row = {account_id: "123", ad_id: "30", ad_name: "Leaf", adset_id: "20", adset_name: "Parent", campaign_id: "10", campaign_name: "Root",
    date_start: "2026-10-01", date_stop: "2026-10-01", impressions: "100", spend: "300", clicks: "999",
    outbound_clicks: [{action_type: "outbound_click", value: "0"}], actions: [{action_type: "offsite_conversion.fb_pixel_purchase", value: "2"}],
    action_values: [{action_type: "offsite_conversion.fb_pixel_purchase", value: "3900"}]};
  const scope = {...sourceContext, flow: "ads", entity_type: "ad", entity_id: "30",
    ancestors: [{entity_type: "campaign", entity_id: "10"}, {entity_type: "adset", entity_id: "20"}],
    reporting_time_basis: "impression_date", conversion_scope: "normal", completeness: "complete", bounded: true,
    snapshot_id: "synthetic-snapshot", composition_attempt_id: uuid, attribution_fingerprint: "a".repeat(64), metric_units_fingerprint: "b".repeat(64)};
  const fact = {scope, source_execution: {metadata_references: {attribution: "synthetic-native-attribution", metric_units: "synthetic-native-units"}}};
  return {sourceContext, metadata: recordMetadata(sourceContext, [fact]), evidence: {provider: "meta",
    authority: {connection_id: uuid, reporting_account_id: "act_123"},
    channel: {fact_family: "ad_channel_daily_insights", next_cursor: null, rows: [row]},
    product: {rows: [{product_id: "preserved-separately", converted_promoted_product_value: [{value: "100"}]}]}}};
}

test("Meta projects one native Ad row without aggregation or product sales substitution", () => {
  const f = fixture(), before = structuredClone(f), result = bridge(f);
  assert.equal(result.status, "validated"); assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].raw_metrics, mapMetaPdMetrics(f.evidence.channel.rows[0]).raw_metrics);
  assert.equal(result.rows[0].raw_metrics.ad_click, 0);
  assert.equal(result.rows[0].observation_state.ad_click, "zero");
  assert.equal(result.rows[0].raw_metrics.add_to_cart, null);
  assert.equal(result.rows[0].raw_metrics.purchase_value, 3900);
  assert.equal(result.rows[0].provenance.raw_reference.source_fact.source_execution.slices[0].native_row_indices[0], 0);
  assert.equal(result.publishable, false); assert.equal(result.persistable, false); assert.equal(result.canonical_scope_ready, false);
  assert.deepEqual(f, before); assert.ok(Object.isFrozen(result.rows[0]));
});

for (const [key, value] of Object.entries({workspace_id: "other", installation_id: "43", installation_generation: 2,
  provider: "google_ads", provider_connection_id: "other", connection_version: 3, reporting_selection_epoch: "72",
  platform_account_id: "act_999", canonical_reporting_account_id: "act_999", business_date: "2026-10-02",
  source_timezone: "Europe/Istanbul", source_currency: "TRY", job_or_run_id: "other", claim_fence: 2})) {
  test(`record metadata for another execution is blocked: ${key}`, () => {
    const f = fixture(); f.metadata.binding[key] = value;
    assert.equal(bridge(f).reason, "record_metadata_binding_mismatch");
  });
}

for (const [label, change, reason] of [
  ["missing metadata", f => delete f.metadata, "record_metadata_required"],
  ["missing entity", f => f.metadata.entries = [], "entity_metadata_required"],
  ["duplicate entity metadata", f => f.metadata.entries.push(structuredClone(f.metadata.entries[0])), "duplicate_or_invalid_entity_metadata"],
  ["duplicate native Ad", f => f.evidence.channel.rows.push(structuredClone(f.evidence.channel.rows[0])), "meta_native_identity_or_duplicate"],
  ["product grain", f => f.evidence.channel.rows[0].product_id = "product", "meta_native_identity_or_duplicate"],
  ["wrong account", f => f.evidence.channel.rows[0].account_id = "999", "meta_native_identity_or_duplicate"],
  ["wrong native date", f => f.evidence.channel.rows[0].date_start = "2026-10-02", "meta_native_identity_or_duplicate"],
  ["wrong hierarchy", f => f.metadata.entries[0].scope.ancestors[1].entity_id = "999", "meta_scope_metadata_invalid"],
  ["missing attribution fingerprint", f => delete f.metadata.entries[0].scope.attribution_fingerprint, "meta_scope_metadata_invalid"],
  ["all scope", f => f.metadata.entries[0].scope.conversion_scope = "all", "meta_scope_metadata_invalid"],
  ["unknown time basis", f => f.metadata.entries[0].scope.reporting_time_basis = null, "meta_scope_metadata_invalid"],
  ["native name conflict", f => f.evidence.channel.rows[0].ad_name = "Other", "native_entity_name_conflict"],
  ["partial native page", f => f.evidence.channel.next_cursor = "next", "meta_source_incomplete_or_mismatched"],
  ["missing source metadata reference", f => delete f.metadata.entries[0].metadata_references.attribution, "native_lineage_mismatch"],
]) test(`blocks ${label} without canonical rows`, () => {
  const f = fixture(); change(f); const result = bridge(f);
  assert.equal(result.status, "blocked"); assert.equal(result.reason, reason); assert.deepEqual(result.rows, []);
});

test("one invalid entity withholds the whole batch but preserves all source facts and decisions", () => {
  const f = fixture();
  f.evidence.channel.rows.push({...structuredClone(f.evidence.channel.rows[0]), ad_id: "31"});
  const second = structuredClone(f.metadata.entries[0]); second.scope.entity_id = "31";
  second.enrichment.scope.entity_id = "31"; second.enrichment.entity.entity_id = "31";
  delete second.enrichment.currency.fx_rate; f.metadata.entries.push(second);
  const result = bridge(f);
  assert.equal(result.status, "blocked"); assert.deepEqual(result.rows, []);
  assert.equal(result.decisions[0].status, "validated");
  assert.equal(result.decisions[1].reason, "fx_metadata_missing_or_conflicting");
  assert.equal(result.source_facts.length, 2);
});

test("same currency never invents rate one and empty native response is not zero", () => {
  const f = fixture(); f.metadata.expected_target_currency = "USD";
  f.metadata.entries[0].enrichment.currency.target_currency = "USD";
  delete f.metadata.entries[0].enrichment.currency.fx_rate;
  assert.equal(bridge(f).decisions[0].reason, "fx_metadata_missing_or_conflicting");
  f.evidence.channel.rows = []; f.metadata.entries = [];
  assert.equal(bridge(f).status, "not_observed"); assert.deepEqual(bridge(f).rows, []);
});
