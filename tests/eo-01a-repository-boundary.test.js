import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(path.join(root, "contracts/eo-01a-repository-boundary-v1.json"), "utf8"));
const provenance = JSON.parse(fs.readFileSync(path.join(root, "governance/PROVENANCE.json"), "utf8"));

test("EO-01-A accepted evidence records zero legacy runtime carry", () => {
  assert.equal(contract.status, "accepted");
  assert.equal(contract.acceptedAtCommit, "cb02ef7c2e9236ab50da792f21d667fae91cbccd");
  assert.equal(contract.boundaries.applicationRuntimeModulesCarriedAsIs, 0);
});

test("every copied governance file retains exact source provenance", () => {
  assert.equal(provenance.sourceCommit, "3416ee736fc3c53910e5e6571a7b8f445c4ce3cd");
  assert.equal(provenance.applicationRuntimeModulesCarriedAsIs, 0);
  assert.equal(provenance.files.length, 18);
  for (const item of provenance.files) {
    assert.match(item.sourceBlobSha, /^[0-9a-f]{40}$/);
    assert.equal(fs.existsSync(path.join(root, item.path)), true, `missing governed file: ${item.path}`);
  }
});

