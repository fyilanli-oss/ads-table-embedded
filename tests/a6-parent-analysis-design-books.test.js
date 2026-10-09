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
    ["A6-EO-01", "A6-EO-02", "A6-EO-03"],
  );
  assert.equal(closure.application_ledger.length, closed.length);
  assert.equal(
    master.parent_package_analysis_design_closure.next_required_parent,
    "A6-EO-04",
  );

  for (const item of closed) {
    const ledger = closure.application_ledger.find(
      (entry) => entry.parent === item.id,
    );
    assert.ok(ledger, `${item.id} is missing from the closure ledger`);
    assert.equal(ledger.status, "PASS_parent_closed");
    assert.equal(item.analysis_design_document, ledger.artifact);
    assert.match(item.analysis_design_status, /^Accepted_/);

    const book = await readFile(ledger.artifact, "utf8");
    assert.match(book, new RegExp(item.id));
    assert.match(book, /Status:\*\* Accepted/);
    for (const marker of [
      /İş amacı|business purpose/i,
      /Aktörler ve otoriteler|actors and authorities/i,
      /normal akış|happy path/i,
      /Negatif ve hata yolları|negative and failure/i,
      /Kalıcı durum ve veri sahipliği|persistent state and data ownership/i,
      /Secret ve güvenlik sınırları|secret and security/i,
      /Operasyon.*gözlemlenebilirlik|operations.*observability/i,
      /Rollback.*kurtarma|rollback.*recovery/i,
      /Kabul kanıtı ve bilinen sınırlar|accepted evidence and known limits/i,
      /Tek sonraki parent|single next parent/i,
    ]) {
      assert.match(book, marker, `${ledger.artifact} is missing ${marker}`);
    }
  }
});

test("Execution Plan exposes the capacity ladder and safe demo-fixture boundary", async () => {
  const plan = await readFile("docs/EXECUTION_PLAN.md", "utf8");

  for (const value of [
    "docs/EO_01_ANALYSIS_DESIGN_BOOK.md",
    "docs/EO_02_ANALYSIS_DESIGN_BOOK.md",
    "docs/EO_03_ANALYSIS_DESIGN_BOOK.md",
    "workload budget + index/query-plan baseline",
    "2,000-workspace hourly scheduler",
    "4,000-workspace compressed stress",
    "24 saatlik 2,000-workspace soak",
    "Summary/Daily/Compare/Table sorgu karakterizasyonu",
    "production-shape restore/load provası",
    "Supabase kapasite koşuları raw HTML'i çalıştırmaz",
  ]) {
    assert.match(plan, new RegExp(value.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")));
  }
});
