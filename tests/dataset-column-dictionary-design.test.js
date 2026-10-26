import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const text = await readFile("docs/research/PD_CPD_QUERY_WORKING_TABLE_2026-10-22.md", "utf8");
const dictionary = text.split("## Beş tablo kolon sözlüğü — 26 Ekim 2026 inceleme taslağı")[1]
  ?.split("## Önceki sorgu matrisi ve karar kayıtları")[0];

test("Dataset dictionary documents exactly five candidate families, not implemented schema", () => {
  assert.ok(dictionary);
  assert.deepEqual([...dictionary.matchAll(/^### \d\. [^\r\n`]*`([^`\r\n]+)`/gm)].map(match => match[1]), [
    "pd_facts", "cpd_product_performance_facts", "cpd_product_sales_facts",
    "product_identity_mappings", "fx_rates",
  ]);
  assert.match(dictionary, /uygulanmış şema değildir/);
  assert.match(dictionary, /altıncı bir kalıcı toplam tablosu önerilmez/);
  assert.match(dictionary, /yeni kolon sözlüğünü içerdiği iddia edilmez/);
});

test("Dataset dictionary preserves native facts, metric states and unresolved links", () => {
  for (const column of ["workspace_id", "installation_id", "source_identity", "reporting_scope",
    "metric_support", "observation_state", "native_sold_product_id", "native_advertised_product_id",
    "sales_role_evidence", "native_sales_metrics", "product_mapping_id"]) {
    assert.ok(dictionary.includes(`\`${column}\``), column);
  }
  assert.match(dictionary, /NULL ile gözlenen 0 aynı değildir/);
  assert.match(dictionary, /PD fact ID'sine zorunlu FK değildir/);
  assert.match(dictionary, /ikinci satış satırı üretilmez/);
  assert.match(dictionary, /tahmini kabul edilmiş fact üretilmez/);
});

test("Dataset dictionary records existing adapter type mismatches without fixing or hiding them", () => {
  assert.match(dictionary, /installations.id` bigint/);
  assert.match(dictionary, /identity.installation_id` UUID ister/);
  assert.match(dictionary, /Klaviyo'da mevcut NULL zorunluluğu korunur/);
  assert.match(dictionary, /FX alanları zorunludur/);
  assert.match(dictionary, /mevcut doğrulayıcıyı gevşetmez veya düzeltmez/);
});

test("Dataset dictionary does not select unproven keys, FX policy or provider role acceptance", () => {
  assert.match(dictionary, /serialize\/hash\/null\/eksik ayrımı ve çakışma politikası uygulanmadı/);
  assert.match(dictionary, /Frankfurter veya başka sağlayıcı bu taslakla seçilmez/);
  assert.match(dictionary, /aynı para birimi dönüşümü/);
  assert.match(dictionary, /05, 10\/11, 15 açık/);
  assert.match(dictionary, /17–19 tamamlanmadı/);
  assert.match(dictionary, /Cross-workspace/);
  assert.match(dictionary, /alternatif rota denenmedi/);
});
