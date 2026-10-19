import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const masterPath = "contracts/a6-eo-implementation-master-v1.json";
const closurePath = "contracts/a6-parent-package-analysis-design-closure-v1.json";

test("every closed parent has an accepted Analysis-Design Book", async () => {
  const master = await readJson(masterPath);
  const closure = await readJson(closurePath);
  const closed = master.packages.filter((item) =>
    closure.closed_parent_statuses.includes(item.status),
  );

  assert.deepEqual(
    closed.map((item) => item.id),
    ["A6-EO-01", "A6-EO-02", "A6-EO-03", "A6-EO-04"],
  );
  assert.equal(closure.application_ledger.length, closed.length);
  assert.equal(
    master.parent_package_analysis_design_closure.next_required_parent,
    "A6-EO-05",
  );

  for (const item of closed) {
    const ledger = closure.application_ledger.find(
      (entry) => entry.parent === item.id,
    );
    assert.ok(ledger, item.id + " is missing from the closure ledger");
    assert.equal(ledger.status, "PASS_parent_closed");
    assert.equal(item.analysis_design_document, ledger.artifact);
    assert.match(item.analysis_design_status, /^Accepted_/);

    const book = await readFile(ledger.artifact, "utf8");
    assert.match(book, new RegExp(item.id));
    // Accepted machine ledger remains authoritative; prose may be localized.
    assert.match(book, /(?:Status:\*\* Accepted|Durum:\*\* Kabul edildi)/);
    for (const requiredSection of closure.required_sections) {
      assert.match(
        book,
        new RegExp("^\\s*- " + requiredSection + "\\s*$", "m"),
        ledger.artifact + " is missing contract section " + requiredSection,
      );
    }
  }
});

test("EO-04 closure preserves deferred provider evidence and the next integrity gate", async () => {
  const master = await readJson(masterPath);
  const eo04 = master.packages.find((item) => item.id === "A6-EO-04");
  const record = eo04.closure_record;

  assert.equal(eo04.explicit_product_owner_closure, "PASS_2026-10-18");
  assert.deepEqual(record.reference_obligations_satisfied_or_open.open_and_deferred, [
    "meta_real_app_role_catalog_product_validation",
    "google_explorer_or_higher_production_evidence",
    "klaviyo_shopify_integration_live_reporting_evidence",
    "EO-05_versioned_historical_pmax_listing_tree_persistence",
  ]);
  assert.equal(record.temporary_evidence_transport.meta_button, "removed_route_retained");
  assert.match(record.temporary_evidence_transport.google_button, /^retained_/);
  assert.match(record.temporary_evidence_transport.klaviyo_button, /^retained_/);
  assert.deepEqual(record.intervening_required_gates, ["A6-TECH-01", "A6-DOCS-01"]);
  assert.equal(record.repository_verification.github_ci_required_before_merge, true);
});

test("Execution Plan exposes the capacity ladder and safe demo-fixture boundary", async () => {
  const plan = await readFile("docs/EXECUTION_PLAN.md", "utf8");

  for (const value of [
    "docs/EO_01_ANALYSIS_DESIGN_BOOK.md",
    "docs/EO_02_ANALYSIS_DESIGN_BOOK.md",
    "docs/EO_03_ANALYSIS_DESIGN_BOOK.md",
    "iş yükü bütçesi ve indeks/sorgu planı başlangıç ölçümü",
    "2,000 çalışma alanlı saatlik zamanlayıcı",
    "4,000 çalışma alanlı sıkıştırılmış stres",
    "24 saatlik 2,000 çalışma alanlı dayanıklılık",
    "Summary/Daily/Compare/Table sorgu ölçümü",
    "canlıya benzer geri yükleme/yük provası",
    "Supabase kapasite koşuları ham HTML'i çalıştırmaz",
  ]) {
    const escaped = value.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
    assert.match(plan, new RegExp(escaped));
  }
});
