import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const evidence = JSON.parse(readFileSync(new URL(
  "docs/evidence/A6_TECH_01_F05_ACTION_PINS_2026-10-18.json", root,
), "utf8"));
const approved = new Set(evidence.pins.map(pin => `${pin.action}@${pin.sha}`));

// Repository workflows use block YAML; reject flow-style uses instead of silently skipping it.
function checkPins(source) {
  assert.doesNotMatch(source, /[\{,]\s*["']?uses["']?\s*:/);
  const refs = [...source.matchAll(/^[\t ]*(?:-[\t ]*)?(?:uses|"uses"|'uses')[\t ]*:[\t ]*([^\r\n]*)/gm)]
    .map(match => match[1].split(/\s+#/)[0].trim().replace(/^(["'])(.*)\1$/, "$2"));
  for (const ref of refs) {
    assert.match(ref, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/, `immutable SHA required: ${ref}`);
    assert.ok(approved.has(ref), `official release verification required: ${ref}`);
  }
  return refs;
}

test("all repository workflows use verified full action commit SHAs", () => {
  const files = readdirSync(new URL(".github/workflows/", root)).filter(name => /\.ya?ml$/.test(name));
  assert.ok(files.length >= 3);
  const refs = files.flatMap(name => checkPins(readFileSync(new URL(`.github/workflows/${name}`, root), "utf8")));
  assert.ok(refs.length >= 7);
  assert.deepEqual(new Set(refs), approved);
  for (const pin of evidence.pins) {
    assert.match(pin.release, /^v\d+\.\d+\.\d+$/);
    assert.match(pin.sha, /^[a-f0-9]{40}$/);
  }
  assert.equal(evidence.scope.shopify_deploy_workflow_dispatched, false);
  assert.match(evidence.update_policy, /official_release_and_commit_verification_CI_and_product_owner_merge_approval_no_auto_merge/);
});

test("mutable, short, unverified and inline action references are rejected", () => {
  for (const ref of ["actions/checkout@v6", "actions/checkout@main", "actions/checkout@d23441a", `actions/checkout@${"0".repeat(40)}`, `unverified/checkout@${evidence.pins[0].sha}`]) {
    assert.throws(() => checkPins(`      - uses: ${ref}\n`));
    assert.throws(() => checkPins(`        "uses": '${ref}'\n`));
  }
  assert.throws(() => checkPins("      - {uses: actions/checkout@v6}"));
  assert.throws(() => checkPins("      - uses:\n          actions/checkout@v6\n"));
  assert.equal(checkPins(`      - uses: "${evidence.pins[0].action}@${evidence.pins[0].sha}" # release\n`).length, 1);
});
