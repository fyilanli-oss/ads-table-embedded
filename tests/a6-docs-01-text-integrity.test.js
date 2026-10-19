import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ledgerPath = "contracts/a6-docs-01-turkish-standardization-v1.json";
const normalize = (text) => text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");

function checkedText(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.doesNotMatch(text, /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  return text;
}

test("DOCS-01 human Markdown rejects invalid UTF-8, replacement characters and binary controls", async () => {
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  const rows = ledger.inventory.filter((row) => row.classification === "human_markdown");
  assert.equal(rows.length, 62);
  for (const row of rows) {
    const bytes = await readFile(row.path);
    assert.doesNotThrow(() => checkedText(bytes), row.path);
  }
  assert.throws(() => checkedText(new Uint8Array([0xC3, 0x28])));
  assert.throws(() => checkedText(Buffer.from("bozuk \uFFFD metin")));
  assert.throws(() => checkedText(Buffer.from("binary\u0000control")));
  assert.equal(checkedText(Buffer.from("Türkçe: ıİşŞğĞüÜöÖçÇ\n\t")), "Türkçe: ıİşŞğĞüÜöÖçÇ\n\t");
});

test("master source archive preserves the verified restoration while its translation cannot revive historical authority", async () => {
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  const repair = ledger.text_integrity_repairs[0];
  assert.equal(repair.path, "docs/A6_EO_IMPLEMENTATION_MASTER_TABLE.md");
  assert.equal(repair.last_good_source_commit, "6e95ba9c7134d56e6cf11eba03be149c502e9672");
  assert.equal(repair.last_good_source_blob, "e601d036afe990cfcd71242674d9c5fe390d2d06");
  assert.equal(repair.last_good_source_sha256, "7ab58381b0b42b883ce3f34ec94fd5fdc5bc2c7a71755c912e1d9df4a860a498");
  assert.equal(repair.damaged_blob, "7c2b3da4cbf0f94caa487d0c71eafb0832a4fb01");
  assert.equal(ledger.inventory.find((row) => row.path === repair.path).baseline_blob, repair.damaged_blob);
  const text = normalize(checkedText(await readFile(repair.path)));
  const heading = "# A6 EO — Tek Hat Yürütme Kuralı ve Bütünleşik İş Paketleri Ana Tablosu";
  assert.ok(text.startsWith(heading + "\n"));
  const bodyStart = text.indexOf("**Tarih:** 4 Ekim 2026");
  assert.ok(bodyStart > 0);
  const archivePath = "docs/evidence/A6_DOCS_01_MASTER_RESTORED_SOURCE_2026-10-19.txt";
  assert.equal(repair.restored_body_archive, archivePath);
  const restoredBody = normalize(checkedText(await readFile(archivePath)));
  assert.ok(restoredBody.startsWith(heading + "\n\n**Tarih:** 4 Ekim 2026"));
  assert.equal(createHash("sha256").update(restoredBody).digest("hex"), "3f767043b5a529fffb80859824316d197fec782fc31e6896202046810f4d89f9");
  assert.equal(repair.restored_body_normalized_sha256, "3f767043b5a529fffb80859824316d197fec782fc31e6896202046810f4d89f9");
  const notice = text.slice(heading.length, bodyStart);
  assert.ok(notice.includes(archivePath));
  for (const authority of ["docs/EXECUTION_PLAN.md", "contracts/a6-eo-implementation-master-v1.json", "docs/EO_04_ANALYSIS_DESIGN_BOOK.md"]) assert.ok(notice.includes(authority));
  assert.match(notice, /bugünkü durum veya kural değildir/);
  assert.match(notice, /EO-01–04 ve A6-TECH-01 kabulleri korunur/);
  assert.match(notice, /EO-05 başlamaz/);
  assert.equal(repair.later_damaged_prose_reconstructed_by_guess, false);
  assert.equal(repair.accepted_decisions_or_runtime_changed, false);
  assert.equal(repair.counts_as_completed_translation, false);
  assert.equal(ledger.inventory.find((row) => row.path === repair.path).status, "translated_product_owner_accepted");
  assert.equal(repair.product_owner_repair_accepted, true);
  assert.equal(repair.merge_authorized, true);
  assert.equal(repair.pull_request, 132);
  assert.equal(repair.merge_commit, "526c07a5415b70a21a6ddf20970e6207a33f0200");
});
