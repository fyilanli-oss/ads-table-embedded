const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const contract = JSON.parse(fs.readFileSync(path.join(root, "contracts/eo-01a-repository-boundary-v1.json"), "utf8"));
const provenance = JSON.parse(fs.readFileSync(path.join(root, "governance/PROVENANCE.json"), "utf8"));

test("EO-01-A carries zero legacy application/runtime modules", () => {
  assert.equal(contract.boundaries.applicationRuntimeModulesCarriedAsIs, 0);
  for (const rel of contract.forbiddenAtThisGate) {
    assert.equal(fs.existsSync(path.join(root, rel)), false, `forbidden at EO-01-A: ${rel}`);
  }
});

test("repository root contains governance only", () => {
  const allowed = new Set([...contract.allowedRoots, ...contract.allowedRootFiles, "governance", ".git"]);
  for (const name of fs.readdirSync(root)) {
    assert.equal(allowed.has(name), true, `unexpected root entry: ${name}`);
  }
});

test("every copied governance file has exact source provenance", () => {
  assert.equal(provenance.sourceCommit, "3416ee736fc3c53910e5e6571a7b8f445c4ce3cd");
  assert.equal(provenance.applicationRuntimeModulesCarriedAsIs, 0);
  assert.equal(provenance.files.length, 18);
  for (const item of provenance.files) {
    assert.match(item.sourceBlobSha, /^[0-9a-f]{40}$/);
    assert.equal(fs.existsSync(path.join(root, item.path)), true, `missing governed file: ${item.path}`);
  }
});
