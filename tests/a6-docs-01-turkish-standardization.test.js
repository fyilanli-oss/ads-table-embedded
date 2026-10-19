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
    translated_review_pending: 4, pending_language_review: 58,
  });
  for (const row of contract.inventory) {
    assert.match(row.baseline_blob, /^[a-f0-9]{40}$/);
    assert.equal(row.classification, row.path === "AGENTS.md"
      ? "agent_instructions_excluded" : "human_markdown");
    assert.equal(row.status, row.path === "AGENTS.md" ? "excluded_unchanged"
      : contract.first_batch.includes(row.path)
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
