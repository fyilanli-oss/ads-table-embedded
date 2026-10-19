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

test("DOCS-01 inventories human Markdown without translating agent instructions or evidence", async () => {
  const contract = await readJson(contractPath);
  const actual = ["AGENTS.md", "README.md", ...await markdownFiles("docs")].sort();
  assert.deepEqual(contract.inventory.map((row) => row.path).sort(), actual);
  assert.equal(new Set(actual).size, 63);
  assert.deepEqual(contract.inventory_counts, {
    total_markdown: 63, human_markdown: 62, excluded_agent_instructions: 1,
    translated_review_pending: 4, pending_language_review: 31,
    translated_product_owner_accepted: 27,
  });
  for (const row of contract.inventory) {
    assert.match(row.baseline_blob, /^[a-f0-9]{40}$/);
    assert.equal(row.classification, row.path === "AGENTS.md"
      ? "agent_instructions_excluded" : "human_markdown");
    assert.equal(row.status, row.path === "AGENTS.md" ? "excluded_unchanged"
      : [...contract.first_batch, ...contract.second_batch, ...contract.third_batch, ...contract.fourth_batch, ...contract.fifth_batch, ...contract.sixth_batch].includes(row.path) ? "translated_product_owner_accepted"
        : contract.seventh_batch.includes(row.path)
          ? "translated_product_owner_review_pending" : "pending_language_review");
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
  const prepared = contract.deliveries[6];
  assert.deepEqual(prepared.files, contract.seventh_batch);
  assert.equal(prepared.product_owner_readability_accepted, false);
  assert.equal(prepared.merge_authorized, false);
});

test("DOCS-01 language work does not authorize runtime work, closure, merge or EO-05", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.user_start_authorized, true);
  for (const key of ["accepted_semantics_may_change", "bulk_machine_contract_translation",
    "immutable_evidence_translation", "runtime_code_change", "live_mutation"]) {
    assert.equal(contract.scope[key], false, key);
  }
  for (const key of ["package_complete", "product_owner_readability_accepted",
    "merge_authorized", "EO05_may_start"]) assert.equal(contract[key], false, key);
  const master = await readFile("contracts/a6-eo-implementation-master-v1.json", "utf8");
  const quality = await readFile("contracts/a6-quality-and-assurance-gates-v1.json", "utf8");
  assert.ok(master.includes(contractPath));
  assert.ok(quality.includes(contractPath));
  for (const path of ["docs/EXECUTION_PLAN.md", contract.brief]) {
    assert.ok((await readFile(path, "utf8")).includes(contractPath));
  }
});
