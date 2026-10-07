import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const graph = readJson("contracts/shopify/a6-eo-07-funnel-visualization-reference-v1.json");
const constitution = readJson("contracts/shopify/shopify-embedded-ui-constitution-v1.json");
const freeze = readJson("contracts/shopify/a6-eo-07-three-surface-ui-product-freeze-v1.json");
const master = readJson("contracts/a6-eo-implementation-master-v1.json");
const doc = fs.readFileSync(path.join(root, "docs/A6_EO_07_FUNNEL_VISUALIZATION_REFERENCE.md"), "utf8");
const plan = fs.readFileSync(path.join(root, "docs/EXECUTION_PLAN.md"), "utf8");

test("binds accepted Funnel relationship graphs without advancing implementation", () => {
  assert.equal(graph.owner_package, "A6-EO-07-B");
  assert.equal(graph.creates_new_package, false);
  assert.equal(graph.advances_package_status, false);
  assert.equal(graph.implementation_authorized, false);
  assert.deepEqual(graph.performance.primary_series, ["sales", "revenue", "spend"]);
  assert.deepEqual(graph.intent.primary_count_series, ["add_to_cart", "checkout", "abandoned", "purchase"]);
  assert.equal(graph.canonical_ui_labels.sales_value, "Sales");
});

test("freezes comparison encoding and metric-aware direction", () => {
  assert.equal(graph.compare.current_style, "solid");
  assert.equal(graph.compare.previous_style, "dashed");
  assert.equal(graph.compare.daily_max_days, 31);
  assert.ok(graph.compare.favorable_decrease.includes("cpc"));
  assert.ok(graph.compare.favorable_decrease.includes("cps"));
  assert.ok(graph.compare.favorable_decrease.includes("abandoned"));
  assert.deepEqual(graph.compare.neutral_without_outcome_context, ["spend"]);
});

test("uses one data authority and preserves support states", () => {
  assert.deepEqual(graph.same_data_authority.projections, ["chart", "selected_point_detail", "kpi_summary", "funnel_table"]);
  assert.equal(graph.same_data_authority.mismatch_is_acceptance_failure, true);
  assert.deepEqual(graph.state_semantics, ["zero", "unknown", "unsupported", "partial", "stale", "provisional"]);
  assert.equal(graph.intent.count_and_value_are_distinct, true);
});

test("limits SVG or Canvas to the chart data plane", () => {
  assert.deepEqual(graph.renderer_boundary.allowed_renderers, ["svg", "canvas"]);
  assert.equal(graph.renderer_boundary.allowed_scope, "chart_data_plane_only");
  assert.equal(graph.renderer_boundary.official_polaris_required_outside_data_plane, true);
  assert.equal(constitution.chart_renderer_boundary.allowed_scope, "chart_data_plane_only");
  assert.equal(constitution.chart_renderer_boundary.parity_mismatch_is_acceptance_failure, true);
});

test("keeps Ad Analysis charts blocked and package statuses unchanged", () => {
  assert.equal(graph.ad_analysis.chart_status, "blocked_by_A6-EO-07-C");
  assert.equal(freeze.ad_analysis.visualization.implementation_authorized, false);
  assert.equal(master.cross_cutting_decisions.funnel_visualization_reference_v1.advances_package_status, false);
  assert.equal(master.cross_cutting_decisions.funnel_visualization_reference_v1.authorizes_ui_implementation, false);
  assert.match(doc, /Product intent accepted; implementation and visual acceptance pending/);
  assert.match(plan, /A6-EO-07-B Funnel visualization reference/);
});
