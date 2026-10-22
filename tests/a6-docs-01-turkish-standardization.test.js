import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const contractPath = "contracts/a6-docs-01-turkish-standardization-v1.json";
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

async function markdownFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + "/" + entry.name;
    if (entry.isDirectory()) paths.push(...await markdownFiles(path));
    else if (entry.name.endsWith(".md")) paths.push(path);
  }
  return paths;
}

function assertTechnicalTokens(content, tokens) {
  for (const token of tokens) {
    assert.ok(content.includes(token), "Missing preserved technical token: " + token);
  }
}

test("DOCS-01 preserves its accepted historical inventory and explicitly accounts for later runbooks", async () => {
  const contract = await readJson(contractPath);
  const actual = ["AGENTS.md", "README.md", ...await markdownFiles("docs")].sort();
  // DOCS-01's accepted 19 October translation ledger is not a mutable count of all future docs.
  const laterDocuments = [
    "docs/runbooks/WINDOWS_VM_RECOVERY.md",
    "docs/research/PD_CPD_QUERY_WORKING_TABLE_2026-10-22.md",
  ];
  const baseline = contract.inventory.map((row) => row.path).sort();
  assert.deepEqual(actual, [...baseline, ...laterDocuments].sort());
  assert.equal(new Set(baseline).size, 63);
  assert.equal(new Set(actual).size, 65);
  assert.deepEqual(contract.inventory_counts, {
    total_markdown: 63, human_markdown: 62, excluded_agent_instructions: 1,
    translated_review_pending: 0, pending_language_review: 0,
    translated_product_owner_accepted: 62,
  });
  for (const row of contract.inventory) {
    assert.match(row.baseline_blob, /^[a-f0-9]{40}$/);
    assert.equal(row.classification, row.path === "AGENTS.md"
      ? "agent_instructions_excluded" : "human_markdown");
    assert.equal(row.status, row.path === "AGENTS.md" ? "excluded_unchanged"
      : [...contract.first_batch, ...contract.second_batch, ...contract.third_batch, ...contract.fourth_batch, ...contract.fifth_batch, ...contract.sixth_batch, ...contract.seventh_batch, ...contract.eighth_batch, ...contract.ninth_batch, ...contract.tenth_batch, ...contract.eleventh_batch, ...contract.twelfth_batch, ...contract.thirteenth_batch, ...contract.fourteenth_batch, ...contract.fifteenth_batch, ...contract.sixteenth_batch].includes(row.path) ? "translated_product_owner_accepted"
        : contract.seventeenth_batch.includes(row.path) ? "translated_product_owner_accepted" : "pending_language_review");
  }
});

test("DOCS-01 first batch retains baseline technical tokens and accepted section identities", async () => {
  const contract = await readJson(contractPath);
  const closure = await readJson("contracts/a6-parent-package-analysis-design-closure-v1.json");
  for (const path of contract.first_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    if (path === "README.md") continue;
    assert.match(content, /\*\*Durum:\*\* Kabul edildi/);
    assert.match(content, /kabul edildiği günkü kapsamını/);
    assert.doesNotMatch(content, /^#+ .*Analysis.Design Book|\*\*(?:Status|Parent package|Purpose|Record date):/m);
    for (const section of closure.required_sections) {
      assert.ok(content.split(/\r?\n/).includes("- " + section));
    }
  }
  assert.throws(() => assertTechnicalTokens("removed", ["app/uninstalled"]), /Missing preserved/);
});

test("DOCS-01 foundation briefs retain technical identity, historical scope and exact UI copy", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.second_batch.length, 6);
  for (const path of contract.second_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /Execution Plan/);
    assert.match(content, /tarihsel|tarihindeki|6 Ekim 2026|9 Ekim 2026/);
    assert.doesNotMatch(content, /^#.*(?:Clean repository|Official stack|Three-route|migration foundation|generation authority)/m);
  }
  const shell = await readFile("docs/EO_01C_THREE_ROUTE_PREVIEW_SHELL.md", "utf8");
  for (const copy of [
    "No reporting data is available in this preview. Connections and data loading will be added in later EO packages.",
    "No advertising analysis is available in this preview. No provider data has been requested or inferred.",
    "Connections and configuration are not available in this preview. Existing accounts, tokens, and settings remain unchanged.",
  ]) assert.ok(shell.includes(copy));
  const [accepted, foundation] = contract.deliveries;
  assert.deepEqual(accepted.files, contract.first_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 120);
  assert.equal(accepted.merge_commit, "57d18a1a125de30ca8d86a65034f60fce403dc74");
  assert.deepEqual(foundation.files, contract.second_batch);
  assert.equal(foundation.product_owner_readability_accepted, true);
  assert.equal(foundation.merge_authorized, true);
  assert.equal(foundation.pull_request, 121);
  assert.equal(foundation.merge_commit, "039087456127cd0d936049e75603ed52a2bbb7c4");
});

test("DOCS-01 billing and privacy translation keeps exact tokens and scoped owner acceptance", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.third_batch.length, 5);
  for (const path of contract.third_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /Execution Plan/);
    assert.match(content, /tarihsel|Tarihsel/);
  }
  const pricing = await readFile("docs/EO_02C_SHOPIFY_APP_PRICING_ENTITLEMENT.md", "utf8");
  assert.match(pricing, /price\.active.*aktiflik bayrağı değildir/);
  assert.match(pricing, /180/);
  const privacy = await readFile("docs/EO_02D_PRIVACY_LIFECYCLE.md", "utf8");
  assert.match(privacy, /bu işlem abonelik iptali değildir/);
  assert.match(privacy, /48 saat/);
  assert.match(privacy, /eski çalışma alanı\/nesil/);
  const worker = await readFile("docs/EO_02D_DURABLE_DELETION_WORKER.md", "utf8");
  assert.match(worker, /320 dakikalık aralık ve 20 deneme sınırı/);
  assert.match(worker, /en az yetki sınırları değişmez/);
  const accepted = contract.deliveries[2];
  assert.deepEqual(accepted.files, contract.third_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 122);
  assert.equal(accepted.merge_commit, "0e8f03ddd1526cc53b8e5e2922211301d512ffef");
});

test("DOCS-01 OAuth lifecycle records preserve technical identity and do not claim live OAuth", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.fourth_batch.length, 4);
  for (const path of contract.fourth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /Execution Plan/);
    assert.match(content, /[Tt]arihsel/);
    assert.doesNotMatch(content, /^##? (?:Analyst result|State machine|Official documentation|Acceptance sequence)/m);
  }
  const oauth = await readFile(contract.fourth_batch[0], "utf8");
  assert.match(oauth, /canlı sağlayıcı bağlamaz/);
  assert.match(oauth, /İşlem ömrü \(TTL\): 10 dakika/);
  const vault = await readFile(contract.fourth_batch[1], "utf8");
  assert.ok(vault.includes("ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1=<32 random bytes, base64url>"));
  assert.match(vault, /HTTP 410 beklenen sonuçtur/);
  assert.match(vault, /32 baytlık/);
  const accounts = await readFile(contract.fourth_batch[2], "utf8");
  assert.match(accounts, /1–3/);
  assert.match(accounts, /En fazla 10 dakika/);
  const lifecycle = await readFile(contract.fourth_batch[3], "utf8");
  assert.match(lifecycle, /Disconnect geçmiş analiz verisini silmez/);
  assert.match(lifecycle, /Sağlayıcı API isteği, canlı OAuth.*yapılmadı/);
  const accepted = contract.deliveries[3];
  assert.deepEqual(accepted.files, contract.fourth_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 123);
  assert.equal(accepted.merge_commit, "a9d03046d3b0fb8561c366fb398e8a1ef4d950d3");
});

test("DOCS-01 common and Meta prose preserves facts, historical correction and pending product validation", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.fifth_batch.length, 4);
  for (const path of contract.fifth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /Execution Plan/);
    assert.match(content, /[Tt]arihsel/);
    assert.doesNotMatch(content, /^##? (?:Analyst result|Authority boundary|Business outcome|Runtime contract|Official sources)/m);
  }
  const common = await readFile(contract.fifth_batch[0], "utf8");
  assert.ok(common.includes("impression\nad_click\nsession\nspend_value\nadd_to_cart\nadd_to_cart_value\ncheckout\ncheckout_value\npurchase\npurchase_value"));
  assert.match(common, /Yalnız sağlayıcının açık sıfırı sıfır olur/);
  const oauth = await readFile(contract.fifth_batch[1], "utf8");
  assert.match(oauth, /13 Ekim tarihsel eşlemesinde/);
  assert.match(oauth, /18 Ekim'de tek başına HTTP 403'ün token geçersizliği olmadığı/);
  const role = await readFile(contract.fifth_batch[2], "utf8");
  assert.match(role, /ilk sağlayıcı hatasında çağrı durur/);
  const reporting = await readFile(contract.fifth_batch[3], "utf8");
  assert.match(reporting, /Meta'nın gerçek Channel'ı Ad'dir/);
  assert.match(reporting, /validation_pending_real_catalog_response/);
  assert.match(reporting, /otomatik tekrar yetkisi değildir/);
  const accepted = contract.deliveries[4];
  assert.deepEqual(accepted.files, contract.fifth_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 124);
  assert.equal(accepted.merge_commit, "1581f749e1fcfbf0ad69cf3bc9f3592d5a719db6");
});

test("DOCS-01 Google language work preserves temporal attribution and the same post-review runtime", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.sixth_batch.length, 4);
  for (const path of contract.sixth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /Execution Plan/);
    assert.match(content, /[Tt]arihsel/);
    assert.doesNotMatch(content, /^##? (?:Business outcome|Exact execution|Corrective decision|Official sources)/m);
  }
  const reporting = await readFile(contract.sixth_batch[0], "utf8");
  assert.match(reporting, /Channel'ı satılan üründen seçme/);
  assert.match(reporting, /tam iş günü raporlama penceresi/);
  assert.match(reporting, /Sentetik testin geçmesi.*kanıtlamaz/);
  const live = await readFile(contract.sixth_batch[1], "utf8");
  assert.match(live, /Review sonrasında aynı çalışma zamanı kalır/);
  assert.match(live, /401 sonrasında token yenileyip tekrar etme yolu yoktur/);
  assert.match(live, /son 30 tamamlanmış iş tarihini/);
  const access = await readFile(contract.sixth_batch[3], "utf8");
  assert.match(access, /kalıcı saklanması henüz yoktur/);
  assert.match(access, /yeni kota\/fiyat\/erişim taahhüdü değildir/);
  const accepted = contract.deliveries[5];
  assert.deepEqual(accepted.files, contract.sixth_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 125);
  assert.equal(accepted.merge_commit, "77ac39cfb9cf373c6595b6b7dfe6df5927140457");
});

test("DOCS-01 Klaviyo language work preserves ledger, first-error and Message attribution boundaries", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.seventh_batch.length, 4);
  for (const path of contract.seventh_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /EXECUTION_PLAN|Execution Plan/);
    assert.match(content, /[Tt]arihsel/);
    assert.doesNotMatch(content, /^##? (?:Business outcome|Official sources|Analyst outcome|Verification contract)/m);
  }
  const spend = await readFile(contract.seventh_batch[0], "utf8");
  assert.match(spend, /Aynı iş tarihinde tekrar güncelleme yapılabilir/);
  assert.match(spend, /Yalnız tutar değişir; hesap, para birimi ve başlangıç tarihi korunur/);
  assert.match(spend, /aynı tarihi reddetme davranışı tarihsel kanıttır/);
  for (const copy of [
    "Enter the new estimated Klaviyo email cost for the next 30-day period starting today. SMS costs are not included.",
    "Change a previously saved amount. Its original start date will not change.",
    "Update Klaviyo email spend", "Change Klaviyo email spend", "Saved period",
    "Updated 30-Day Klaviyo Email Spend", "Save new value", "Save change",
  ]) assert.ok(spend.includes(copy), copy);
  const hardening = await readFile(contract.seventh_batch[1], "utf8");
  assert.match(hardening, /token yenileyip başarısız isteği tekrar etmez/);
  assert.match(hardening, /Kaynak metin eşleştirme.*çalışma zamanı/s);
  const authority = await readFile(contract.seventh_batch[2], "utf8");
  assert.match(authority, /Medium, `send_channel` alanından zorunlu olarak alınır/);
  const attribution = await readFile(contract.seventh_batch[3], "utf8");
  assert.match(attribution, /yalnız bir kez korunur/);
  assert.match(attribution, /Message ID'si\s+biliniyorsa Channel'ı `Unclassified Channel` yapmaz/);
  assert.match(attribution, /Campaign Variation vermediği için Variation/);
  assert.match(attribution, /Sales Role\s+`Assisted` olur/);
  const accepted = contract.deliveries[6];
  assert.deepEqual(accepted.files, contract.seventh_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 126);
  assert.equal(accepted.merge_commit, "bfc0de411fa89b5d029952d8399c5fd1be8ca5a9");
});

test("DOCS-01 Klaviyo evidence prose retains hierarchy, historical limits and the unbuilt EO-05 recovery gate", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.eighth_batch.length, 4);
  for (const path of contract.eighth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /EXECUTION_PLAN|Execution Plan/);
    assert.match(content, /[Tt]arihsel/);
    assert.doesNotMatch(content, /^##? (?:Analyst outcome|State matrix|Official sources|Acceptance|Repository verification)/m);
  }
  const runtime = await readFile(contract.eighth_batch[0], "utf8");
  assert.ok(runtime.includes("Campaign -> Campaign Audience -> Campaign Message (Channel) -> Variation"));
  assert.match(runtime, /kanonik veri kümesine alınmaz, kullanıcıya ayrı boyut olarak gösterilmez ve\s+satışı bölmez/);
  assert.match(runtime, /Message ID biliniyorsa bu eksikler Channel'ı kaybettirmez/);
  const reauthorization = await readFile(contract.eighth_batch[1], "utf8");
  assert.match(reauthorization, /Settings'i açmak Klaviyo çağrısı,\s+token yenileme veya başarısız sağlayıcı isteğini tekrar etme işlemi yapmaz/);
  assert.match(reauthorization, /takip işi burada tamamlanmış veya yetkilendirilmiş sayılmaz/);
  assert.match(reauthorization, /iki.*privacy yabancı anahtar INFO bulgusu o gün/s);
  assert.ok(reauthorization.includes("A6_TECH_01_F08_CLOSURE_2026-10-18.json"));
  const live = await readFile(contract.eighth_batch[2], "utf8");
  assert.match(live, /custom ecommerce/);
  assert.match(live, /Shopify `Placed Order` veya `Ordered Product` kanıtı değildir/);
  assert.match(live, /Ek canlı çağrı yetkili değildir/);
  assert.match(live, /ortam sınırının giderildiği veya başarılı\s+Shopify ürün satışı cevabı alındığı anlamına gelmez/);
  const capability = await readFile(contract.eighth_batch[3], "utf8");
  assert.match(capability, /Kota değerleri tarihsel kaynak kaydıdır/);
  assert.match(capability, /yeni kota taahhüdü/);
  const accepted = contract.deliveries[7];
  assert.deepEqual(accepted.files, contract.eighth_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 127);
  assert.equal(accepted.merge_commit, "f9780f87eaf29f20ed5520ae47e9b6426f77fa89");
});

test("DOCS-01 EO-04 common prose preserves all scenario identities, cost boundaries and retained live proof", async () => {
  const contract = await readJson(contractPath);
  const closure = await readJson("contracts/a6-parent-package-analysis-design-closure-v1.json");
  assert.equal(contract.ninth_batch.length, 3);
  for (const path of contract.ninth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /EXECUTION_PLAN|Execution Plan/);
    assert.match(content, /tarihsel|Tarihsel|kabul edildiği günkü kapsamını/);
    assert.doesNotMatch(content, /^##? (?:Analyst result|Authority and mutation boundary|Safe response|Contract section map)/m);
  }
  const book = await readFile(contract.ninth_batch[0], "utf8");
  assert.match(book, /\*\*Durum:\*\* Kabul edildi — 2026-10-18/);
  for (const section of closure.required_sections) assert.ok(book.split(/\r?\n/).includes("- " + section));
  for (const provider of ["META", "GOOGLE", "KLAVIYO"]) {
    for (let index = 1; index <= 6; index++) {
      assert.ok(book.includes("### " + provider + "-0" + index + " "));
    }
  }
  assert.match(book, /Satışın iş tarihi `1 Ekim`; eldeki ağaç `16 Ekim`/);
  assert.match(book, /PMax Channel'ı satılan ürün seçmez/);
  assert.match(book, /kanonik AdsTable satırına alınmaz/);
  const common = await readFile(contract.ninth_batch[1], "utf8");
  assert.match(common, /Channel toplam maliyeti ürünlere eşit, satış, gelir, tıklama, adet, Sales Role/);
  assert.ok(common.includes("Cross-sell + ₺18"));
  assert.ok(common.includes("Unclassified Channel + ₺18"));
  const live = await readFile(contract.ninth_batch[2], "utf8");
  assert.match(live, /Kanonik Ad Click seçilmedi/);
  assert.match(live, /üçüncü\s+çalıştırma `2026-10-16T15:14:07.104Z`/);
  assert.match(live, /17 Ekim'deki kabul edilmiş App Role tam\s+sayfalama kuralını geri almaz/);
  assert.match(live, /yanıt sözleşmesi, yukarıdaki dar sunucu loguyla aynı şey değildir/);
  const accepted = contract.deliveries[8];
  assert.deepEqual(accepted.files, contract.ninth_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 128);
  assert.equal(accepted.merge_commit, "eaca2c5376dc0cf0b25322f9a0eac7c6aa8719e9");
});

test("DOCS-01 provider research stays historical and cannot revive superseded broad-tree or permission assumptions", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.tenth_batch.length, 2);
  for (const path of contract.tenth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /yerini 16 Ekim 2026 ortak brief'i aldı/);
    assert.match(content, /EXECUTION_PLAN/);
    assert.match(content, /14 Ekim 2026/);
    assert.match(content, /Yürütülebilir sözleşme, kabul kapısı veya uygulama yetkisi değildir/);
    assert.doesNotMatch(content, /supersede edildi|executable contract/);
  }
  const google = await readFile(contract.tenth_batch[0], "utf8");
  assert.match(google, /Eski varsayım: Campaign-ürün kanıtı var/);
  assert.match(google, /Tek uygun `All products` Asset Group kesin\s+Channel olabilir/);
  assert.match(google, /satışın tüm iş günü\s+penceresini kapsayan tarihsel kanıtı gerektirir/);
  assert.match(google, /Satılan ürün,\s+Channel seçmek için kullanılamaz/);
  const meta = await readFile(contract.tenth_batch[1], "utf8");
  assert.match(meta, /Meta Channel her zaman gerçek `Ad`dır/);
  assert.match(meta, /OAuth izin kapsamını genişletmez/);
  assert.match(meta, /tek başına kanonik Ad Click eşlemesi değildir/);
  assert.match(meta, /gerçek katalog\s+yanıtı gerektiren açık doğrulamalar/i);
  const accepted = contract.deliveries[9];
  assert.deepEqual(accepted.files, contract.tenth_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 129);
  assert.equal(accepted.merge_commit, "ec641ea9ea19e330716a503865beaccb924ff2d8");
});

test("DOCS-01 feasibility records retain historical inventory, zero runtime carry and the binding current plan", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.eleventh_batch.length, 2);
  for (const path of contract.eleventh_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /4 Ekim 2026/);
    assert.match(content, /docs\/EXECUTION_PLAN\.md/);
    assert.match(content, /contracts\/a6-eo-implementation-master-v1\.json/);
    assert.match(content, /bugünkü/);
    assert.doesNotMatch(content, /^##? (?:Environment boundary|.*dependency carry allowlist|EO-F1 authority envanteri)/m);
  }
  const boundary = await readFile(contract.eleventh_batch[0], "utf8");
  for (const count of ["2,185", "4,947", "2,392", "10,478", "21/35", "31/35"]) assert.ok(boundary.includes(count));
  assert.match(boundary, /“Taşıma adayı” kesin taşıma onayı değildir/);
  assert.match(boundary, /`SUPABASE_SERVICE_ROLE_KEY`.*yeni çalışma zamanına verilemez/);
  const carry = await readFile(contract.eleventh_batch[1], "utf8");
  for (const label of ["Carry-as-is", "Extract-and-rewrite", "Contract-only", "Retire"]) assert.ok(carry.includes(label));
  assert.match(carry, /kodu için sonuç: \*\*sıfır modül\*\*/);
  assert.match(carry, /“Retire” bugün silme yetkisi vermez/);
  assert.match(carry, /ilk fizibilite taslağının paket eşlemesidir/);
  assert.match(carry, /EO-03 OAuth\/bağlantı\/token kasası, EO-04 sağlayıcı adaptörleri/);
  const accepted = contract.deliveries[10];
  assert.deepEqual(accepted.files, contract.eleventh_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 130);
  assert.equal(accepted.merge_commit, "f0fa17301ad22dc0725a9ff1f313cbdf6d2d3c01");
});

test("DOCS-01 F4-F7 translation keeps exact carry, logical routes, historical estimates and limited GO", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.twelfth_batch.length, 4);
  for (const path of contract.twelfth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /4 Ekim 2026/);
    assert.match(content, /docs\/EXECUTION_PLAN\.md/);
    assert.match(content, /contracts\/a6-eo-implementation-master-v1\.json/);
    assert.match(content, /[Tt]arihsel/);
    assert.doesNotMatch(content, /^##? (?:Exact carry map|Runtime grants|Authenticated BFF|Internal runtime|.*route haritası)/m);
  }
  const carryContract = await readJson("contracts/a6-eo-f4-schema-data-carry-map-v1.json");
  assert.equal(carryContract.exact_carry.reduce((sum, row) => sum + row.rows, 0), 10);
  const carry = await readFile(contract.twelfth_batch[0], "utf8");
  assert.match(carry, /“14” ifadesi.*10 satırlık açık listeyle uyuşmaz/);
  assert.match(carry, /birebir iş satırı taşıması: \*\*10 satır\*\*/);
  assert.match(carry, /Beş Dataset V2 satırı.*kopyalanmaz/);
  assert.match(carry, /Bu protokol burada yürütülmez; canlı işlem için ayrı yetki gerekir/);
  assert.match(carry, /ilk taslak eşlemesidir/);
  const routes = await readFile(contract.twelfth_batch[1], "utf8");
  assert.match(routes, /bugünkü uygulanmış endpoint envanteri değildir/);
  assert.match(routes, /gösterilen App Nav bağlantısı: 2/);
  assert.match(routes, /Sayfa veya grafik paneli açılması.*yenileme üretmez/);
  assert.match(routes, /kabul edilmiş Shopify gömülü kimlik doğrulama sözleşmesini.*kaldırmaz/);
  const effort = await readFile(contract.twelfth_batch[2], "utf8");
  for (const value of ["59–92", "42–63", "17–29", "%29–32", "49–74", "45/100", "88/100", "8.4–12.6", "11.8–18.4"]) assert.ok(effort.includes(value));
  assert.match(effort, /bugünkü kalan süre tahmini değildir/);
  assert.match(effort, /15 Ekim.*Klaviyo/);
  const go = await readFile(contract.twelfth_batch[3], "utf8");
  assert.match(go, /yeni GO talebi veya bugünkü sınırsız uygulama yetkisi değildir/);
  assert.match(go, /EO-01 ürün verisi çekmez, canlı token taşımaz/);
  assert.match(go, /A6-ASSURE-01 kapıları ayrıca geçerlidir/);
  const accepted = contract.deliveries[11];
  assert.deepEqual(accepted.files, contract.twelfth_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 131);
  assert.equal(accepted.merge_commit, "52335cc6fbcecde15f664beae591264e234c1909");
});

test("DOCS-01 product, graph and demo prose retains UI copy, evidence boundaries and deferred implementation", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.thirteenth_batch.length, 3);
  for (const path of contract.thirteenth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /7 Ekim 2026/);
    assert.match(content, /docs\/EXECUTION_PLAN\.md/);
    assert.doesNotMatch(content, /^##? (?:Product intent|Purpose and non-effect|Analyst brief|Mandatory repair boundary|Export reference|Acceptance gates)/m);
  }
  const product = await readFile(contract.thirteenth_batch[0], "utf8");
  assert.match(product, /`Funnel\/Table` ve `Summary\/Daily` bağımsız boyutlardır/);
  for (const copy of ["Time range", "Compare time range", "Filters", "Presentation", "Summary", "Daily", "View", "Funnel", "Table", "Analysis item", "Ad name", "View intent metrics", "View performance metrics", "Analysis details", "Reporting Currency", "Provider Connections and Reporting Accounts", "Subscription", "Data & Privacy", "Manage subscription", "Delete my data", "$24.99/month"]) assert.ok(product.includes(copy), copy);
  assert.match(product, /Aynı anda tek modal/);
  assert.match(product, /önerilen hesap bağlı kalabilir/i);
  assert.match(product, /Variation'ın Channel'ın yerini aldığı anlamına gelmez/);
  assert.match(product, /görsel attribution oluşturmaz/);
  const graph = await readFile(contract.thirteenth_batch[1], "utf8");
  assert.match(graph, /Mevcut dönem düz, karşılaştırma dönemi kesik çizgiyle/);
  assert.match(graph, /Spend değişimi sonuç bağlamı olmadan nötrdür/);
  assert.match(graph, /aynı BFF\/sorgu sonucu ve formül otoritesinin/);
  assert.match(graph, /SVG veya Canvas yalnız grafik veri düzleminde/);
  const demo = await readFile(contract.thirteenth_batch[2], "utf8");
  for (const value of ["1,000", "458,500", "751,960", "2,000", "4,000", "data_origin = synthetic_demo", "provider_truth = false", "workspace_kind = demo"]) assert.ok(demo.includes(value));
  assert.match(demo, /sağlayıcı kanıtı değildir/);
  assert.match(demo, /sahte biçimde bağlı göstermez/);
  assert.match(demo, /Tarihleri asla kaydırılmaz/);
  assert.match(demo, /ilk Shopify review uygulama kapsamının dışındadır/);
  assert.match(demo, /küpe\/cross-sell senaryosunu karşılayamaz/i);
  const accepted = contract.deliveries[12];
  assert.deepEqual(accepted.files, contract.thirteenth_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 133);
  assert.equal(accepted.merge_commit, "164175d47420dc37f551860658c8ec44b8916092");
});

test("DOCS-01 safety and operations translation preserves future gates without starting recovery or provisioning", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.fourteenth_batch.length, 4);
  for (const path of contract.fourteenth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /docs\/EXECUTION_PLAN\.md/);
    assert.doesNotMatch(content, /^##? (?:Analyst conclusion|Current inventory|Touch policy|Recovery playbooks|Purpose|Scope|Business outcome|Mandatory scope|Closure rule)/m);
  }
  const capacity = await readFile(contract.fourteenth_batch[0], "utf8");
  for (const value of ["2,000", "4,000", "144,000", "0.556", "1.667", "45", "15", "240", "PITR", "EO-08-D"]) assert.ok(capacity.includes(value), value);
  assert.match(capacity, /hedefleridir; sağlayıcı garantisi veya bugün tamamlanmış kurtarma kanıtı değildir/);
  assert.match(capacity, /eski erişilemeyen tarihler yapay sıfır sayılmaz/);
  assert.match(capacity, /ilk hata sonrası durma ve yeniden onay alma kapısını kaldırmaz/);
  const secrets = await readFile(contract.fourteenth_batch[1], "utf8");
  assert.match(secrets, /toplam envanter 23/);
  assert.match(secrets, /GitHub secret deposu bu işte yeniden sorgulanmadı/);
  assert.match(secrets, /17 girdi\s+Secret, 5 girdi Config/);
  assert.match(secrets, /saklama\/kurtarma koşullarının tamamlandığını göstermez/);
  assert.match(secrets, /Yeni açıklama ve açık onay olmadan tekrar denenmez/);
  assert.match(secrets, /Yeni üretilen değer, kaybolmuş değerle şifrelenen veriyi çözemez/);
  const cleanup = await readFile(contract.fourteenth_batch[2], "utf8");
  assert.match(cleanup, /Silme yetkisi:\*\* Paket açılışında yok/);
  assert.match(cleanup, /temizlik veya arşivleme başlatma onayı değildir/);
  assert.match(cleanup, /Güncel envanter ve ayrıca açık kullanıcı onayı/);
  const preproduction = await readFile(contract.fourteenth_batch[3], "utf8");
  assert.match(preproduction, /Planlandı; tetikleyiciye ulaşılmadı; uygulama başlamadı/);
  assert.match(preproduction, /hangisi önceyse ondan önce/);
  assert.match(preproduction, /Production kimlik bilgisi değerleri Preview veya Development'a kopyalanamaz/);
  assert.match(preproduction, /İlk açık veya açıklamasız sağlayıcı hatasında durulur/);
  const accepted = contract.deliveries[13];
  assert.deepEqual(accepted.files, contract.fourteenth_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 134);
  assert.equal(accepted.merge_commit, "93756a705ac84c5bb0a16e0fb08b18fb45b4158e");
});

test("DOCS-01 integrity audit and F01 history retain scoped closure, failed runs and immutable SQL references", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.fifteenth_batch.length, 4);
  for (const path of contract.fifteenth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find((item) => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /18 Ekim 2026/);
    assert.match(content, /docs\/EXECUTION_PLAN\.md/);
    assert.match(content, /tarihsel/);
    assert.match(content, /yeni (?:denetim, )?prova veya canlı işlem yetkisi vermez|yeni denetim, prova,\s+yedekleme, yükseltme veya canlı işlem yetkisi vermez/);
  }
  const audit = await readFile(contract.fifteenth_batch[0], "utf8");
  assert.match(audit, /İlk denetimde 0 P0, 3 P1, 5 engelleyici P2 ve 2 P3/);
  assert.match(audit, /kapalı; açık P0\/P1\/P2 yoktur/);
  assert.match(audit, /İlk denetimin kontrol matrisi — tarihsel sonuçlar/);
  assert.match(audit, /İlk düzeltme taslağı — tarihsel, uygulanacak güncel sıra değil/);
  assert.match(audit, /Son bağlayıcı karar — 18 Ekim 2026/);
  assert.ok(audit.includes("bd243fff7200ae6bdb3900ebb7417b3beba53010"));
  const lineage = await readFile(contract.fifteenth_batch[1], "utf8");
  assert.match(lineage, /ilk 38 kayıt değiştirilmedi/);
  assert.match(lineage, /Yalnız F01 için test edilmiş\s+dar şema kurtarma alternatifi açıkça kabul edildi/);
  assert.match(lineage, /yeni kullanıcı\s+onayından sonra çalıştırıldı/);
  const replay = await readFile(contract.fifteenth_batch[2], "utf8");
  for (const id of ["39135603458", "39134192984", "39133172317", "39132400862", "127.0.0.1:54322"]) assert.ok(replay.includes(id));
  assert.match(replay, /Katalog güvenlik testleri Supabase Cloud Advisor servisini çalıştırmış sayılmaz/);
  assert.match(replay, /aşağıdaki “yeni üyelik üretilmez” ifadesi o ara kapsamdır/);
  const recovery = await readFile(contract.fifteenth_batch[3], "utf8");
  assert.match(recovery, /Tam veri yedeği\/PITR kanıtı \*\*yoktur\*\*/);
  assert.match(recovery, /Yedi fonksiyon geri kuruldu; eski altı fonksiyonun runtime EXECUTE yetkisi kapalı kaldı/);
  assert.match(recovery, /kurtarma SQL'i\s+tek başına hiçbir iş verisi satırına INSERT\/UPDATE\/DELETE uygulamaz/);
  assert.ok(recovery.includes("954dc40d045601e2cc2600b76b65ecf05b2e284972e4d63ac183f5288706acec"));
  const accepted = contract.deliveries[14];
  assert.deepEqual(accepted.files, contract.fifteenth_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 135);
  assert.equal(accepted.merge_commit, "38c3da3c2272320b58247497de7c099c0c9f36bf");
});

test("DOCS-01 Shopify governance preserves RC, real user acceptance and the chart-only exception", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.sixteenth_batch.length, 2);
  for (const path of contract.sixteenth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find(item => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /docs\/EXECUTION_PLAN\.md/);
    assert.match(content, /320 px/);
    assert.doesNotMatch(content, /component mapping|Constitution guard|Exact Shopify|Primary action|Secondary action|Destructive action/);
  }
  const constitution = await readFile(contract.sixteenth_batch[0], "utf8");
  assert.match(constitution, /Güncel üst otorite/);
  assert.match(constitution, /Taşınmış kaynağın tarihsel üst otorite kaydı/);
  assert.match(constitution, /otomatik olarak stable 1\.x'e geri çevrilemez/);
  assert.match(constitution, /Eski Settings tespiti — tarihsel kayıt/);
  assert.match(constitution, /Eski R7-B6 için yeni kabul üretmez/);
  assert.match(constitution, /yalnız veri çizim düzleminde SVG veya Canvas/);
  assert.match(constitution, /Sayısal veya durum anlamındaki fark kabul hatasıdır/);
  assert.match(constitution, /A6-EO-07-C kanıtı ve ayrı kabul edilmiş grafik özeti/);
  const template = await readFile(contract.sixteenth_batch[1], "utf8");
  for (const state of ["Loading", "Empty / Not connected", "Resume required", "Connected", "Error / Reauthorization", "Cancel"]) assert.ok(template.includes("`" + state + "`"));
  assert.match(template, /yeni arayüz işi başlatmaz veya kabul üretmez/);
  assert.match(template, /Ürün sahibi açık kabul verdi/);
  const accepted = contract.deliveries[15];
  assert.deepEqual(accepted.files, contract.sixteenth_batch);
  assert.equal(accepted.product_owner_readability_accepted, true);
  assert.equal(accepted.merge_authorized, true);
  assert.equal(accepted.pull_request, 136);
  assert.equal(accepted.merge_commit, "ed47adf7bc19a9206b1baebda995838021ad3585");
});

test("DOCS-01 final language delivery covers all human documents without self-acceptance or advancing EO-05", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.seventeenth_batch.length, 3);
  assert.equal(contract.final_delivery.all_62_human_documents_language_prepared, true);
  assert.equal(contract.inventory.filter(row => row.status === "pending_language_review").length, 0);
  assert.equal(contract.final_delivery.package_closure_acceptance_pending, false);
  assert.equal(contract.final_delivery.last_three_readability_acceptance_pending, false);
  const prepared = contract.deliveries[16];
  assert.deepEqual(prepared.files, contract.seventeenth_batch);
  assert.equal(prepared.product_owner_readability_accepted, true);
  assert.equal(prepared.merge_authorized, true);
  for (const path of contract.seventeenth_batch) {
    const content = await readFile(path, "utf8");
    const row = contract.inventory.find(item => item.path === path);
    assertTechnicalTokens(content, row.preserved_technical_tokens);
    assert.match(content, /tarihsel/);
    assert.doesNotMatch(content, /^#{1,3} (?:Authority|Product boundary|Ordered program|Current|Closed packages|Secret inventory|Demo fixture|EO-05 mandatory|Parent package)/m);
  }
  const plan = await readFile(contract.seventeenth_batch[0], "utf8");
  assert.match(plan, /## Güncel durum — 19 Ekim 2026/);
  assert.match(plan, /EO-05 otomatik başlamaz/);
  assert.match(plan, /Satılan ürün Channel seçemez/);
  assert.match(plan, /satışın tüm sağlayıcı iş günü penceresini kapsıyor/);
  const master = await readFile(contract.seventeenth_batch[1], "utf8");
  assert.match(master, /10 ana paket, 43 sabit alt paket/);
  assert.match(master, /Kaynak kaydındaki aktif iş — tarihsel/);
  assert.match(master, /bugünkü durum veya kural değildir/);
  const quality = await readFile(contract.seventeenth_batch[2], "utf8");
  assert.match(quality, /A6-ASSURE-01 — Pre-Review Assurance Programı/);
  assert.match(quality, /review başvurusu veya EO-05 başlangıç onayı değildir/);
});

test("DOCS-01 explicit closure acceptance authorizes only the approved merge, not runtime work or EO-05", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.user_start_authorized, true);
  for (const key of ["accepted_semantics_may_change", "bulk_machine_contract_translation",
    "immutable_evidence_translation", "runtime_code_change", "live_mutation"]) {
    assert.equal(contract.scope[key], false, key);
  }
  for (const key of ["package_complete", "product_owner_readability_accepted",
    "merge_authorized"]) assert.equal(contract[key], true, key);
  assert.equal(contract.EO05_may_start, false);
  const master = await readFile("contracts/a6-eo-implementation-master-v1.json", "utf8");
  const quality = await readFile("contracts/a6-quality-and-assurance-gates-v1.json", "utf8");
  assert.ok(master.includes(contractPath));
  assert.ok(quality.includes(contractPath));
  for (const path of ["docs/EXECUTION_PLAN.md", contract.brief]) {
    assert.ok((await readFile(path, "utf8")).includes(contractPath));
  }
});


test("PD CPD working table preserves query scope and the pending owner Ad Channel decision", async () => {
  const content = await readFile("docs/research/PD_CPD_QUERY_WORKING_TABLE_2026-10-22.md", "utf8");
  const rows = content.split(/\r?\n/).filter((line) => /^\| (Meta|Google Ads|Klaviyo) \|/.test(line));
  assert.equal(rows.length, 23);
  for (const row of rows) assert.equal(row.split("|").length - 2, 13);
  assert.match(content, /henüz ürün sahibi tarafından kabul edilmedi/);
  assert.match(content, /Google incelemesinden sonra kabul edecek veya itiraz edecek/);
  assert.match(content, /Ad kayıtlarından hiyerarşik toplam/);
  assert.match(content, /Var¹: `converted_promoted_product_quantity`/);
  assert.match(content, /Var²: `converted_promoted_product_value`/);
  assert.match(content, /hata alınmadı; dolu ürün yanıtıyla reel test bekleniyor/);
  assert.match(content, /Var³: `actions`/);
  assert.match(content, /Var³: `action_values`/);
  assert.match(content, /Tam ham yanıt saklanmadı/);
  assert.match(content, /Bu çalışma referansı yürütülebilir sözleşmeleri değiştirmez/);
  assert.doesNotMatch(rows.filter((row) => row.startsWith("| Meta |")).join("\n"), /Ürün satış ilişkisi — ayrı sorgu/);
});


test("Google working table freezes real leaf levels and product-based Channel totals", async () => {
  const content = await readFile("docs/research/PD_CPD_QUERY_WORKING_TABLE_2026-10-22.md", "utf8");
  const rows = content.split(/\r?\n/).filter(line => line.startsWith("| Google Ads |"))
    .map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
  assert.equal(rows.length, 12);
  const pd = rows.filter(row => row[1] === "PD");
  assert.deepEqual(pd.map(row => [row[2], row[3]]), [
    ["Search", "Campaign"], ["Search", "Ad Group"], ["Search", "Ad"],
    ["Shopping", "Campaign"], ["Shopping", "Ad Group"],
    ["Retail PMax", "Campaign"], ["Retail PMax", "Asset Group"],
  ]);
  for (const row of pd.filter(row => row[3] === "Campaign" || row[2] === "Search" && row[3] === "Ad Group")) {
    assert.deepEqual(row.slice(4), Array(9).fill("Alt kayıtlardan hiyerarşik toplam"));
  }
  assert.deepEqual(pd.find(row => row[2] === "Search" && row[3] === "Ad").slice(4), Array(9).fill("Yok⁴"));
  const channels = rows.filter(row => row[1] === "CPD" && row[2].includes("Channel performansı"));
  assert.deepEqual(channels.map(row => row[3]), ["Ad", "Ad Group", "Asset Group"]);
  for (const row of channels) {
    assert.equal(row[4], "Ürün kayıtlarından toplam⁶");
    assert.equal(row[11], "Ürün satış adetleri toplamı⁶");
    assert.equal(row[12], "Ürün satış değerleri toplamı⁶");
  }
  assert.match(content, /Önce Klaviyo sorgu tablosu tamamlanacak/);
  assert.match(content, /PD Purchase, sağlayıcının satın alma dönüşümü sayısıdır/);
  assert.match(content, /CPD satılan adet, ürün satış miktarıdır/);
  assert.match(content, /çalışan toplam veya tamamlanmış ürün→Channel bağlantısı değildir/);
});
