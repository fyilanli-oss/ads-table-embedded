import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const contract = JSON.parse(read("contracts/eo-01c-three-route-preview-shell-v1.json"));
const routeFiles = ["app/routes/_index.tsx", "app/routes/ad-analysis.tsx", "app/routes/settings.tsx"];

test("EO-01-C exposes exactly the three canonical truthful routes", () => {
  assert.deepEqual(contract.routes.map(({path: routePath}) => routePath), ["/", "/ad-analysis", "/settings"]);
  for (const {heading, state} of contract.routes) {
    assert.equal(state, "truthful_empty_preview");
    assert.ok(routeFiles.some((file) => read(file).includes(`heading=\"${heading}\"`)), heading);
  }
  for (const copy of Object.values(contract.exactCopy)) {
    assert.ok(routeFiles.some((file) => read(file).includes(copy)), copy);
  }
});

test("preview UI uses only approved Shopify components without custom styling", () => {
  const source = ["app/root.tsx", "app/components/preview-shell.tsx", ...routeFiles].map(read).join("\n");
  assert.match(source, /<s-page\b/);
  assert.match(source, /<s-section\b/);
  assert.match(source, /<s-paragraph\b/);
  assert.match(source, /<s-link\b/);
  assert.doesNotMatch(source, /<(?:button|input|select|form|dialog)\b/i);
  assert.doesNotMatch(source, /\bstyle=|<style\b|#[0-9a-f]{3,8}\b|\brgb\(|\bhsl\(/i);
  assert.doesNotMatch(source, /className=|<s-clickable\b/i);
});

test("Vercel preset is preview-capable and production remains unauthorized", () => {
  const config = read("react-router.config.ts");
  assert.match(config, /vercelPreset\(\)/);
  assert.equal(contract.deployment.target, "preview_only");
  assert.equal(contract.deployment.productionDeploymentAuthorized, false);
  assert.equal(contract.deployment.productionDomainAuthorized, false);
});
