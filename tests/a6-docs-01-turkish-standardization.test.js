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
    translated_review_pending: 4, pending_language_review: 43,
    translated_product_owner_accepted: 15,
  });
  for (const row of contract.inventory) {
    assert.match(row.baseline_blob, /^[a-f0-9]{40}$/);
    assert.equal(row.classification, row.path === "AGENTS.md"
      ? "agent_instructions_excluded" : "human_markdown");
    assert.equal(row.status, row.path === "AGENTS.md" ? "excluded_unchanged"
      : [...contract.first_batch, ...contract.second_batch, ...contract.third_batch].includes(row.path) ? "translated_product_owner_accepted"
        : contract.fourth_batch.includes(row.path)
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
  const prepared = contract.deliveries[3];
  assert.deepEqual(prepared.files, contract.fourth_batch);
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
