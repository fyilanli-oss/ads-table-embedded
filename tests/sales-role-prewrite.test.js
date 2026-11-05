import test from "node:test";
import assert from "node:assert/strict";
import {reviewSalesRoleCohort as review, salesRoleMetricState as state} from "../app/lib/providers/sales-role-prewrite.server.js";

const cohort = {workspace_id: "workspace", installation_id: "42", installation_generation: 1,
  provider_connection_id: "connection", provider: "google_ads", platform_account_id: "123", business_date: "2026-10-01",
  source_currency: "USD", source_timezone: "Europe/Istanbul", reporting_time_basis: "interaction_date",
  fact_family: "shopping_cart_data_product_sales_daily", conversion_scope: "normal", unit_kind: "product_unit"};
function fact(product = "A", quantity = "2", value = "90071992547409999") {
  return {cohort: structuredClone(cohort), native_identity: {campaign_id: "10", ad_group_id: "20", merchant_id: "50",
    feed_label: "TR", language: null, advertised_item_id: "A", sold_item_id: product}, source_product_id: product,
  sales_role: product === "A" ? "Advertised" : "Cross-sell", metrics: {quantity, value},
  source_reference: {family: cohort.fact_family, native_reference: "page1-row-" + product},
  source_payload: {product, quantity, value}, observed: {product, quantity, value}};
}
const run = rows => review({cohort, rows});

test("A/B/C/D keep independent facts, roles and exact source amounts without extra sales/cost", () => {
  const rows = [fact("A"), fact("B", "0.5", "100"), fact("C", "0", "0"), fact("D", 3, "300")];
  rows[2].sales_role = "Assisted"; rows[3].sales_role = "Unclassified";
  const before = structuredClone(rows), r = run(rows);
  assert.equal(r.complete, true); assert.equal(r.rows.length, 4);
  assert.deepEqual(r.rows.map(x => x.sales_role), ["Advertised", "Cross-sell", "Assisted", "Unclassified"]);
  assert.deepEqual(r.rows.map(x => x.observed.quantity), ["2", "0.5", "0", 3]);
  assert.equal(r.rows[0].observed.value, "90071992547409999");
  assert.equal(r.rows[2].metric_states.quantity, "zero"); assert.equal(r.rows[2].sales_role, "Assisted");
  assert.deepEqual(rows, before); rows[0].observed.value = "changed";
  assert.equal(r.rows[0].observed.value, before[0].observed.value); assert.ok(Object.isFrozen(r.rows[0].observed));
  for (const k of ["totals_computed", "metrics_allocated", "provider_claim_verified", "Shopify_last_touch_used_as_role",
    "order_counts_used_as_product_units", "canonical_scope_ready", "persistable", "publishable", "Dataset_write_performed"]) assert.equal(r[k], false);
});

test("identical native sale across pages is reviewed once and preserves both source references", () => {
  const a = fact(), b = structuredClone(a); b.source_reference.native_reference = "page2-row-A";
  const r = run([a, b]); assert.equal(r.complete, true); assert.equal(r.rows.length, 1);
  assert.equal(r.counts.duplicate_rows, 1); assert.equal(r.rows[0].source_references.length, 2);
  assert.equal(r.rows[0].observed.quantity, "2");
});

for (const change of [r => r.metrics.quantity = "3", r => r.metrics.value = "0", r => r.sales_role = "Unclassified",
  r => r.source_payload.changed = true, r => r.source_product_id = "different"])
test("same native key with changed evidence is conflict, never a new sale: " + change, () => {
  const a = fact(), b = structuredClone(a); change(b);
  const r = run([a, b]); assert.equal(r.complete, false); assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].state, "conflicting"); assert.equal(r.counts.conflicting_rows, 1);
  assert.equal(r.rows[0].conflicting_observations.length, 1); assert.equal(r.rows[0].source_references.length, 2);
});

for (const field of ["workspace_id", "installation_id", "installation_generation", "provider_connection_id", "platform_account_id",
  "business_date", "source_currency", "source_timezone", "reporting_time_basis", "conversion_scope", "fact_family"])
test("different " + field + " cannot enter the same sales cohort", () => {
  const row = fact(); row.cohort[field] = field === "installation_generation" ? 2 : "different";
  assert.throws(() => run([row]), /INPUT_INVALID/);
});

test("Shopify source/last touch and order count cannot replace provider roles/product units", () => {
  assert.throws(() => review({cohort: {...cohort, provider: "shopify"}, rows: []}), /INPUT_INVALID/);
  assert.throws(() => review({cohort: {...cohort, unit_kind: "order_count"}, rows: []}), /INPUT_INVALID/);
  const role = fact(); role.sales_role = "last_touch"; assert.throws(() => run([role]), /INPUT_INVALID/);
  const key = fact(); key.native_identity.sales_role = "Advertised"; assert.throws(() => run([key]), /INPUT_INVALID/);
  assert.throws(() => review({cohort, rows: [fact()], shopifyJourney: {source: "google"}}), /INPUT_INVALID/);
});

test("empty, missing, explicit zero, malformed and unsafe values stay distinct", () => {
  assert.equal(run([]).complete, true); assert.equal(run([]).rows.length, 0);
  for (const value of [null, undefined]) assert.equal(state(value), "absent");
  for (const value of [0, "0", "0.00", "-0.0"]) assert.equal(state(value), "zero");
  for (const value of ["0.25", "90071992547409999", "-1"]) assert.equal(state(value), "present");
  for (const value of ["", [], {}, true, "1e3", Infinity, NaN, 9007199254740992]) assert.equal(state(value), "invalid");
  for (const value of [null, "", "oops", [], 9007199254740992]) {
    const r = run([fact("A", value)]); assert.equal(r.complete, false); assert.equal(r.rows[0].state, "held");
    assert.deepEqual(r.rows[0].observed.quantity, value); assert.notEqual(r.rows[0].metric_states.quantity, "zero");
  }
  const missing = fact(); missing.source_product_id = null;
  assert.ok(run([missing]).rows[0].reasons.includes("native_product_reference_missing_or_invalid"));
});

test("Klaviyo distinct event IDs remain separate even for one product; role refinement is forbidden", () => {
  const c = {...cohort, provider: "klaviyo", platform_account_id: "account1", fact_family: "ordered_product_event",
    reporting_time_basis: "event_time", conversion_scope: "event_attribution"};
  const event = (id, role) => ({...fact(), cohort: c, native_identity: {event_id: id}, sales_role: role,
    source_reference: {family: c.fact_family, native_reference: id}});
  const r = review({cohort: c, rows: [event("one", "Assisted"), event("two", "Triggered")]});
  assert.equal(r.complete, true); assert.equal(r.rows.length, 2);
  for (const role of ["Advertised", "Cross-sell"]) assert.throws(() => review({cohort: c, rows: [event("one", role)]}), /INPUT_INVALID/);
});
