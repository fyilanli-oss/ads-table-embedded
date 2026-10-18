import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const adapterRequire = createRequire(require.resolve("@vercel/react-router/package.json"));
const staticPath = adapterRequire.resolve("@vercel/static-config");
const staticRequire = createRequire(staticPath);
const {Project} = staticRequire("ts-morph");
const fixture = name => fileURLToPath(new URL(`fixtures/security-config/${name}.ts`, import.meta.url));
const expected = {runtime: "nodejs", memory: 1024, maxDuration: 60, regions: ["fra1", "iad1"], supportsCancellation: true, useWebApi: false};

test("remaining-security scope binds exact pins and complete lock graph without hiding advisories", () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const evidence = JSON.parse(read("docs/evidence/A6_TECH_01_REMAINING_SECURITY_REMEDIATION_2026-10-18.json"));
  const manifest = JSON.parse(read("package.json"));
  const registry = JSON.parse(read("contracts/eo-01b-dependency-registry-v1.json"));
  assert.equal(manifest.devDependencies.vite, "7.3.6");
  assert.equal(registry.packages.find(item => item.name === "vite").version, "7.3.6");
  const workspace = read("pnpm-workspace.yaml");
  const overrides = Object.fromEntries([...workspace.matchAll(/^  '([^']+)': '([^']+)'$/gm)].map(([, key, value]) => [key, value]));
  assert.deepEqual(overrides, evidence.scoped_overrides);
  assert.doesNotMatch(workspace, /auditConfig|ignoreCves|ignoreGhsas|ignoredAdvisories|ignoreUnfixable/);
  const lock = read("pnpm-lock.yaml").replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(lock).digest("hex"), evidence.lockfile.sha256_lf);
  assert.doesNotMatch(lock, /(?:braces|micromatch|fast-glob)@/);
  for (const audit of [evidence.production_audit, evidence.complete_audit]) {
    assert.equal(audit.exit_code, 0);
    assert.deepEqual(audit.vulnerabilities, {info: 0, low: 0, moderate: 0, high: 0, critical: 0});
  }
  assert.equal(evidence.removed_advisories.length, 3);
  for (const key of ["audit_ignore_suppression_fork_or_risk_acceptance_used", "historical_evidence_rewritten", "live_deployment_database_provider_or_secret_change", "security_finding_closed", "merge_authorized", "deployment_authorized", "F10_closed", "A6_TECH_01_overall_pass", "EO05_may_start"]) assert.equal(evidence[key], false, key);
});

test("resolved Vercel consumers use exact patched Ajv and the braces-free ts-morph candidate", () => {
  assert.equal(adapterRequire("ts-morph/package.json").version, "24.0.0");
  assert.equal(staticRequire("ts-morph/package.json").version, "24.0.0");
  assert.equal(staticRequire("ajv/package.json").version, "8.18.0");
  const viteRequire = createRequire(require.resolve("vite/package.json"));
  assert.equal(viteRequire("esbuild/package.json").version, "0.28.1");
});

test("real Vercel normal parser extracts literals, rejects invalid config and preserves no-config", () => {
  const {getConfig} = staticRequire(staticPath);
  assert.deepEqual(getConfig(new Project(), fixture("valid")), expected);
  assert.equal(getConfig(new Project(), fixture("missing")), null);
  assert.throws(() => getConfig(new Project(), fixture("invalid")), /Invalid data/);
});

test("real ts-morph fallback preserves config semantics when the native parser is unavailable", () => {
  // Only the native loader fails in this isolated test. Config extraction,
  // ts-morph parsing and Ajv validation are the installed real Vercel code.
  const loaderPath = staticRequire.resolve("./load-oxc");
  const originalLoader = require.cache[loaderPath];
  const originalStatic = require.cache[staticPath];
  const nativeUnavailable = new Error("TEST_ONLY_NATIVE_PARSER_UNAVAILABLE");
  require.cache[loaderPath] = {id: loaderPath, filename: loaderPath, loaded: true, exports: {loadOxcParser() {throw nativeUnavailable;}}};
  delete require.cache[staticPath];
  try {
    const {getConfig} = staticRequire(staticPath);
    const project = new Project();
    let fallbackReads = 0;
    const originalRead = project.addSourceFileAtPath.bind(project);
    project.addSourceFileAtPath = (...args) => {fallbackReads++; return originalRead(...args);};
    assert.deepEqual(getConfig(project, fixture("valid")), expected);
    assert.equal(fallbackReads, 1);
    assert.equal(getConfig(project, fixture("missing")), null);
    assert.throws(() => getConfig(project, fixture("invalid")));
    assert.equal(fallbackReads, 3);
  } finally {
    if (originalLoader) require.cache[loaderPath] = originalLoader;
    else delete require.cache[loaderPath];
    if (originalStatic) require.cache[staticPath] = originalStatic;
    else delete require.cache[staticPath];
  }
});

test("real Vercel preset preserves bundle identity and inherited route configuration", async () => {
  const {vercelPreset} = await import("@vercel/react-router/vite");
  const config = vercelPreset().reactRouterConfig({reactRouterUserConfig: {ssr: true}});
  const sorted = Object.fromEntries(Object.entries(expected).sort(([a], [b]) => a.localeCompare(b)));
  const expectedBundle = `nodejs_${Buffer.from(JSON.stringify(sorted)).toString("base64url")}`;
  assert.equal(config.serverBundles({branch: [{id: "parent", file: fixture("valid")}]}), expectedBundle);
  assert.equal(config.serverBundles({branch: [{id: "parent", file: fixture("valid")}, {id: "child", file: fixture("missing")}]}), expectedBundle);
  assert.throws(() => config.serverBundles({branch: [{id: "invalid", file: fixture("invalid")}]}), /Invalid data/);
});
