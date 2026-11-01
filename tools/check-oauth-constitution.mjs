import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

export const CONTRACT_PATH = "contracts/oauth/oauth-flow-constitution-v1.json";
export const BOOTSTRAP_BASE = "dcdf2d79473655c39a9e6bc38b3003ee38a262b5";
export const PREFIXES = ["app/lib/oauth/", "app/lib/providers/", "app/lib/shopify/", "app/lib/database/", "app/lib/refresh/", "app/lib/ui/", "app/components/", "app/routes/", "supabase/migrations/", "tools/", ".github/workflows/"];
export const EXACT = ["AGENTS.md", "app/shopify.server.ts", "app/root.tsx", "app/lib/server-error-log.server.js", "app/lib/server-error-log.server.d.ts", "package.json", "pnpm-lock.yaml", ".github/workflows/repository-governance.yml", "tools/check-oauth-constitution.mjs", "tests/oauth-flow-constitution.test.js", "tests/a6-docs-01-turkish-standardization.test.js", "docs/OAUTH_FLOW_CONSTITUTION.md", "docs/EXECUTION_PLAN.md", "docs/EO_05_STEP07_SETTINGS_CORRECTIONS_BRIEF.md", "docs/templates/SHOPIFY_EMBEDDED_UI_TASK_TEMPLATE.md", "contracts/a6-eo-implementation-master-v1.json", "contracts/eo-05-permission-explanation-design-v1.json", "contracts/eo-05-oauth-setup-permission-policy-v1.json", "contracts/shopify/shopify-embedded-ui-constitution-v1.json"];
export const CRITICAL_TESTS = ["tests/permission-explanation-flow.test.js", "tests/permission-settings.test.js", "tests/permission-setup-selection.test.js", "tests/permission-error-log.test.js", "tests/permission-release.test.js", "tests/google-meta-settings-flow.test.js", "tests/google-partial-permission-return.test.js", "tests/step07-settings-corrections.test.js", "tests/shopify-products-completion.test.js", "tests/shopify-progressive-permissions.test.js", "tests/oauth-identity-scope-binding.test.js", "tests/identity-oauth-start-binding.test.js", "tests/identity-oauth-atomic-stage.test.js", "tests/eo-03a-oauth-transaction-boundary.test.js", "tests/eo-03c-connection-account-authority.test.js", "tests/eo-03d-provider-connection-lifecycle.test.js", "tests/eo-01c-preview-shell.test.js"];
const fail = code => {throw new Error("OAUTH_CONSTITUTION_" + code);};
export const digest = value => createHash("sha256").update(String(value).replace(/\r\n/g, "\n")).digest("hex");
export const protectedPath = name => PREFIXES.some(prefix => name.startsWith(prefix)) || EXACT.includes(name) || CRITICAL_TESTS.includes(name) || /^tests\/.*(?:oauth|permission|scope|settings|token|connection).*\.test\.js$/.test(name) || /^shopify\.app(?:\.[^.]+)?\.toml$/.test(name);
const runtimePath = name => name.startsWith("app/") || name.startsWith("supabase/migrations/") || ["package.json", "pnpm-lock.yaml"].includes(name) || /^shopify\.app.*\.toml$/.test(name);
function git(root, args) {return execFileSync("git", args, {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();}
export function collectSnapshot(root) {
  const result = {};
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), {withFileTypes: true})) {
      const name = relative ? relative + "/" + entry.name : entry.name;
      if ([".git", "node_modules", "build", ".react-router", ".codex-remote-attachments"].includes(entry.name)) continue;
      if (entry.isSymbolicLink()) {if (protectedPath(name) || PREFIXES.some(prefix => prefix.startsWith(name + "/"))) fail("SYMLINK_FORBIDDEN"); continue;}
      if (entry.isDirectory()) {if (!relative || ["app", "supabase", "tests", "tools", "docs", "contracts", ".github"].some(top => name === top || name.startsWith(top + "/"))) walk(name);}
      else if (protectedPath(name)) result[name] = digest(fs.readFileSync(path.join(root, name), "utf8"));
    }
  }
  walk("");
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, "en")));
}
export function verifySnapshot(expected, actual) {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) fail("SNAPSHOT_REQUIRED");
  const names = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const name of names) {
    if (!protectedPath(name) || name.includes("..") || !/^[a-f0-9]{64}$/.test(expected[name] ?? "") || expected[name] !== actual[name]) fail("SURFACE_CHANGED:" + name);
  }
  for (const name of [...EXACT, ...CRITICAL_TESTS]) if (!(name in actual)) fail("PROTECTION_MISSING:" + name);
}
export function verifyModel(contract) {
  if (contract?.id !== "oauth-flow-constitution-v1" || contract.version !== 1 || contract.baseline_main !== BOOTSTRAP_BASE) fail("IDENTITY_INVALID");
  if (JSON.stringify(contract.protection.prefixes) !== JSON.stringify(PREFIXES) || JSON.stringify(contract.protection.exact) !== JSON.stringify(EXACT) || JSON.stringify(contract.required_tests) !== JSON.stringify(CRITICAL_TESTS)) fail("PROTECTION_POLICY_CHANGED");
  const ids = new Set(contract.states);
  for (const state of ["not_connected", "explaining", "explanation_hiding", "native_authorization", "verifying", "permissions_incomplete", "account_required", "reporting_required", "spend_required", "saving", "connected", "disconnect_confirm", "disconnecting", "unknown", "unavailable"]) if (!ids.has(state)) fail("STATE_MISSING:" + state);
  if (ids.size !== contract.states.length) fail("STATE_DUPLICATE");
  for (const rule of ["explicit_owner_approval", "server_authority", "one_operation", "native_afterhide", "no_replay", "no_secrets", "no_asset_selector", "first_provider_error_stop", "separate_release", "native_visual_acceptance"]) if (!contract.red_lines.some(row => row.id === rule && row.mandatory === true)) fail("RED_LINE_MISSING:" + rule);
  for (const provider of ["shopify_products", "shopify_orders", "google_ads", "meta", "klaviyo"]) {
    const flow = contract.flows[provider];
    if (!flow || !flow.transitions.length) fail("FLOW_MISSING:" + provider);
    const edges = new Set();
    for (const row of flow.transitions) {
      if (!ids.has(row.from) || !ids.has(row.to) || typeof row.event !== "string" || !row.event || !Array.isArray(row.effects)) fail("TRANSITION_INVALID");
      const key = row.from + ":" + row.event;
      if (edges.has(key)) fail("TRANSITION_DUPLICATE"); edges.add(key);
      if (row.event === "cancel" && row.effects.length || row.from === "unknown" && row.effects.some(effect => !["read_current_status"].includes(effect)) || row.effects.includes("asset_selection")) fail("FORBIDDEN_TRANSITION");
      if (row.effects.some(effect => ["prepare_connect", "save_selection", "save_reporting", ...(provider === "klaviyo" ? [] : ["revoke_connection"])].includes(effect)) && !row.requires?.includes("explicit_intent_and_native_afterhide")) fail("INTENT_GATE_MISSING");
    }
    for (const edge of ["not_connected:connect_click", "explaining:cancel", "explaining:confirm", "explanation_hiding:native_afterhide", "connected:disconnect_click", "disconnect_confirm:cancel", (provider === "klaviyo" ? "disconnect_confirm:confirm" : "disconnect_confirm:confirm_afterhide"), "disconnecting:verified_success", "unknown:resume"]) if (!edges.has(edge)) fail("REQUIRED_TRANSITION_MISSING:" + provider + ":" + edge);
  }
  const klaviyoDisconnect = contract.flows.klaviyo.transitions.find(row => row.from === "disconnect_confirm" && row.event === "confirm");
  if (!klaviyoDisconnect?.requires?.includes("explicit_intent")) fail("INTENT_GATE_MISSING");
  if (contract.flows.klaviyo.explicit_account_even_if_one !== true || contract.flows.klaviyo.separate_spend_modal !== true || contract.flows.klaviyo.zero_is_valid !== true) fail("KLAVIYO_RULE_WEAKENED");
  if (contract.flows.shopify_orders.optional !== true || contract.flows.shopify_orders.products_prerequisite !== true) fail("SHOPIFY_RULE_WEAKENED");
  if (contract.authority.ci_proves_owner_approval !== false || contract.authority.native_visual_acceptance_complete !== false) fail("FALSE_ACCEPTANCE");
}
export function verifyRevision(current, previous, changedPaths) {
  const rows = current.revisions;
  const last = rows?.at(-1);
  if (!last || !/^[a-z0-9-]+$/.test(last.id) || !last.owner_approval?.source || last.owner_approval.explicit !== true || !last.rationale || !last.acceptance_required?.includes("native_desktop_mobile_owner_review")) fail("APPROVAL_RECORD_REQUIRED");
  if (!changedPaths.length) return;
  if (previous && (rows.length !== previous.revisions.length + 1 || JSON.stringify(rows.slice(0, -1)) !== JSON.stringify(previous.revisions))) fail("REVISION_APPEND_REQUIRED");
  const expected = [...new Set(changedPaths)].sort();
  if (JSON.stringify([...last.changed_paths].sort()) !== JSON.stringify(expected)) fail("CHANGED_PATHS_MISMATCH");
  if (changedPaths.some(runtimePath) && last.scope.runtime_code !== true) fail("RUNTIME_SCOPE_NOT_APPROVED");
  if (last.scope.live_provider !== false || last.scope.merge !== false || last.scope.deploy !== false) fail("SCOPE_GATE_INVALID");
}
function readGit(root, ref, file) {
  try {return execFileSync("git", ["show", ref + ":" + file], {cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]});} catch {return null;}
}
export function verifyRepository(root, baseSha) {
  const contract = JSON.parse(fs.readFileSync(path.join(root, CONTRACT_PATH), "utf8"));
  verifyModel(contract); const actual = collectSnapshot(root); verifySnapshot(contract.protection.sha256, actual);
  let base = baseSha;
  if (!base || /^0+$/.test(base)) base = git(root, ["merge-base", "HEAD", "origin/main"]);
  if (!/^[a-f0-9]{40}$/.test(base)) fail("BASE_INVALID");
  git(root, ["cat-file", "-e", base + "^{commit}"]);
  const prior = readGit(root, base, CONTRACT_PATH);
  const changed = [...new Set([...git(root, ["diff", "--name-only", base, "--"]).split("\n"), ...git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n")].filter(name => name === CONTRACT_PATH || protectedPath(name)))].filter(Boolean).sort();
  if (!prior) {
    if (base !== BOOTSTRAP_BASE || contract.revisions.length !== 1 || contract.revisions[0].scope.runtime_code !== false) fail("BOOTSTRAP_INVALID");
    // The constitution package may not silently change runtime, dependencies or SQL.
    for (const name of Object.keys(actual).filter(runtimePath)) {
      const old = readGit(root, base, name);
      if (old === null || digest(old) !== actual[name]) fail("BOOTSTRAP_RUNTIME_CHANGED:" + name);
    }
  }
  verifyRevision(contract, prior ? JSON.parse(prior) : null, changed);
  return {protected_files:Object.keys(actual).length, base, changed:changed.length};
}
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {console.log("OAuth constitution verified", verifyRepository(root, process.env.OAUTH_BASE_SHA));}
  catch (error) {console.error(error.message); process.exitCode = 1;}
}
