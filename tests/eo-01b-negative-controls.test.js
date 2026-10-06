import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const manifest = readJson("package.json");
const registry = readJson("contracts/eo-01b-dependency-registry-v1.json");
const dependencyAddenda = [readJson("contracts/eo-01c-dependency-addendum-v1.json")];
const controls = readJson("contracts/eo-01b-negative-controls-v1.json");

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

test("direct dependencies exactly match the approved registry", () => {
  const actual = {...manifest.dependencies, ...manifest.devDependencies};
  const decisions = [registry, ...dependencyAddenda].flatMap(({packages}) => packages);
  const approved = Object.fromEntries(decisions.map(({name, version}) => [name, version]));
  assert.equal(registry.packages.length, 16);
  assert.equal(decisions.length, 17);
  assert.deepEqual(actual, approved);
  for (const blocked of controls.forbiddenDirectDependencies) assert.equal(actual[blocked], undefined, blocked);
  for (const version of Object.values(actual)) assert.match(version, /^\d+\.\d+\.\d+$/);
});

test("every direct dependency decision has all mandatory fields", () => {
  const required = ["name", "version", "ownedCapability", "nativeAlternativeRationale", "scope", "execution", "secretAndTenantEffect", "license", "maintenance", "removalAndRollback"];
  for (const decision of [registry, ...dependencyAddenda].flatMap(({packages}) => packages)) {
    for (const field of required) assert.ok(decision[field], `${decision.name}: missing ${field}`);
  }
});

test("clean pnpm lockfile and package manager are pinned", () => {
  assert.equal(manifest.packageManager, "pnpm@11.25.0");
  const lock = fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  const workspace = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
  assert.match(lock, /^lockfileVersion:/m);
  assert.doesNotMatch(lock, /ads-table-dev|file:\.\.\/|link:\.\.\//i);
  assert.match(workspace, /^allowBuilds:\s*\n\s+esbuild:\s+true\s*$/m);
  assert.doesNotMatch(workspace, /dangerouslyAllowAllBuilds/);
});

test("legacy runtime, unknown env and RC Polaris references are rejected", () => {
  for (const forbiddenPath of controls.forbiddenPaths) assert.equal(fs.existsSync(path.join(root, forbiddenPath)), false, forbiddenPath);
  const files = controls.scanRoots.flatMap((scanRoot) => walk(path.join(root, scanRoot))).filter((file) => /\.(?:[cm]?[jt]sx?|json|toml|ya?ml)$/i.test(file));
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8").toLowerCase();
    for (const token of controls.forbiddenRuntimeTokens) assert.equal(source.includes(token.toLowerCase()), false, `${file}: ${token}`);
    for (const token of controls.forbiddenRouteTokens) assert.equal(source.includes(token.toLowerCase()), false, `${file}: route ${token}`);
    assert.equal(source.includes(controls.forbiddenActivePolarisRuntime), false, `${file}: RC Polaris`);
    for (const match of source.matchAll(/process\.env\.([a-z0-9_]+)/gi)) {
      assert.equal(controls.allowedEnvironmentKeys.includes(match[1].toUpperCase()), true, `${file}: unknown env ${match[1]}`);
    }
  }
});

test("stable Polaris contract is the only active baseline", () => {
  const stack = readJson("contracts/eo-01b-official-stack-manifest-ci-v1.json").stack;
  const ui = readJson("contracts/shopify/shopify-embedded-ui-constitution-v1.json");
  assert.equal(stack.polaris2RcSelected, false);
  assert.equal(stack.polarisTypes, "1.1.0");
  assert.equal(ui.approved_runtime.polaris_script, "https://cdn.shopify.com/shopifycloud/polaris-1.js");
  assert.equal(ui.approved_runtime.polaris_types, "1.1.0");
});
