import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

export const CONTRACT_PATH = "contracts/raw-source/raw-source-constitution-v1.json";
export const BOOTSTRAP_BASE = "07c2708e1efafeaeb6a1f2b95ed8548489ffdf7b";
// Shared authority, transports, dependencies and test helpers can change source behavior.
// Protect their full directories, including newly introduced files, rather than names alone.
export const PREFIXES = ["app/", "supabase/migrations/", "supabase/functions/", "contracts/", "tests/", "tools/", ".github/workflows/", "patches/"];
export const EXACT = ["AGENTS.md", "package.json", "pnpm-lock.yaml", "vite.config.ts", "react-router.config.ts", "docs/EXECUTION_PLAN.md", "docs/RAW_SOURCE_CONSTITUTION.md"];
export const REQUIRED_TESTS = ["tests/raw-source-constitution.test.js", "tests/source-evidence-store.test.js", "tests/source-rule-store.test.js", "tests/verified-mapping-store.test.js", "tests/source-retention.test.js", "tests/source-retention-policy-permission.test.js", "tests/customer-source-privacy.test.js", "tests/customer-source-worker.test.js", "tests/shopify-order-source-write.test.js", "tests/google-raw-datasets-permission.test.js", "tests/google-raw-duration-permission.test.js", "tests/google-raw-request-permission.test.js", "tests/google-raw-server-permission.test.js", "tests/google-source-server.test.js", "tests/google-source-links.test.js", "tests/meta-raw-datasets-permission.test.js", "tests/meta-raw-request-permission.test.js", "tests/meta-source-links.test.js", "tests/klaviyo-raw-datasets-permission.test.js", "tests/klaviyo-raw-request-permission.test.js", "tests/pd-source-reader.test.js", "tests/google-pmax-history.test.js", "tests/sales-role-prewrite.test.js", "tests/pd-cpd-query-standard.test.js"];
export const REQUIRED_RULES = ["owner_approval", "current_server_authority", "fixed_query_projection", "bounded_single_execution", "secrets_excluded", "owner_bound_encryption", "atomic_receipt_readback", "unknown_no_replay", "zero_is_evidence", "native_identity_only", "mandatory_erasure_first", "finite_retention", "consumer_receipt_required", "separate_release", "preserve_open_gates"];
export const STATES = ["planned", "authorized", "reading", "projected", "prepared", "commit_sent", "committed", "verified", "stopped", "unconfirmed", "partial", "unavailable"];
export const EDGES = [["planned","authorize","authorized"],["authorized","read","reading"],["reading","project","projected"],["projected","prepare","prepared"],["prepared","commit","commit_sent"],["commit_sent","acknowledge","committed"],["committed","readback","verified"],["commit_sent","lost_acknowledgement","unconfirmed"],["reading","failure","stopped"],["reading","missing_source","unavailable"],["verified","incomplete_coverage","partial"]];
const fail = code => {throw Error("RAW_SOURCE_CONSTITUTION_" + code);};
export const digest = value => createHash("sha256").update(String(value).replace(/\r\n/g,"\n")).digest("hex");
export const protectedPath = name => name !== CONTRACT_PATH && (PREFIXES.some(prefix => name.startsWith(prefix)) || EXACT.includes(name) || /^supabase\/[^/]+\.(?:toml|json|sql)$/.test(name) || /^shopify\.app(?:\.[^.]+)?\.toml$/.test(name));
const runtimePath = name => /^(app\/|supabase\/|patches\/)/.test(name) || ["package.json","pnpm-lock.yaml","vite.config.ts","react-router.config.ts"].includes(name) || /^shopify\.app(?:\.[^.]+)?\.toml$/.test(name);
const validPath = name => typeof name === "string" && name.length > 0 && !name.startsWith("/") && !name.includes("\\") && !name.split("/").some(p => p === ".." || p === "." || p === "");
function git(root,args) {return execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]});}
function readGit(root,ref,name) {try{return git(root,["show",ref+":"+name]);}catch{return null;}}
export function verifyBootstrapRuntime(root,base,names) {
  // Read the committed blobs in one Git process. Per-file git show makes the
  // first verification needlessly slow on Windows; the comparison stays exact.
  const tree=git(root,["ls-tree","-r","-z",base]),objects=new Map();
  for(const record of tree.split("\0").filter(Boolean)) {
    const tab=record.indexOf("\t"),header=record.slice(0,tab).split(" ");
    if(header[1]==="blob")objects.set(record.slice(tab+1),header[2]);
  }
  for(const name of names)if(!objects.has(name))fail("BOOTSTRAP_RUNTIME_CHANGED:"+name);
  const ids=[...new Set(names.map(name=>objects.get(name)))];
  if(!ids.length)return;
  const bytes=execFileSync("git",["cat-file","--batch"],{cwd:root,input:ids.join("\n")+"\n",maxBuffer:64*1024*1024,stdio:["pipe","pipe","pipe"]});
  const hashes=new Map();let offset=0;
  for(const id of ids) {
    const end=bytes.indexOf(10,offset);if(end<0)fail("BASE_BLOB_INVALID");
    const fields=bytes.subarray(offset,end).toString("utf8").split(" "),size=Number(fields[2]);
    if(fields[0]!==id||fields[1]!=="blob"||!Number.isSafeInteger(size)||size<0||end+1+size>=bytes.length)fail("BASE_BLOB_INVALID");
    const start=end+1;hashes.set(id,digest(bytes.subarray(start,start+size).toString("utf8")));offset=start+size;
    if(bytes[offset++]!==10)fail("BASE_BLOB_INVALID");
  }
  if(offset!==bytes.length)fail("BASE_BLOB_INVALID");
  for(const name of names)if(digest(fs.readFileSync(path.join(root,name),"utf8"))!==hashes.get(objects.get(name)))fail("BOOTSTRAP_RUNTIME_CHANGED:"+name);
}
export function collectSnapshot(root) {
  const result = {};
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})) {
      const name = relative ? relative+"/"+entry.name : entry.name;
      if ([".git","node_modules","build",".react-router",".codex-remote-attachments"].includes(entry.name) && !relative) continue;
      if (entry.isSymbolicLink()) {if(name===CONTRACT_PATH||protectedPath(name)||PREFIXES.some(p=>p.startsWith(name+"/")))fail("SYMLINK_FORBIDDEN:"+name);continue;}
      if (entry.isDirectory()) {if (!relative || PREFIXES.some(p => p.startsWith(name+"/") || name.startsWith(p)) || name==="docs" || name===".github") walk(name);}
      else if (protectedPath(name)) result[name]=digest(fs.readFileSync(path.join(root,name),"utf8"));
    }
  }
  walk("");return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b,"en")));
}
export function verifySnapshot(expected,actual) {
  if (!expected || typeof expected!=="object" || Array.isArray(expected)) fail("SNAPSHOT_REQUIRED");
  for (const name of new Set([...Object.keys(expected),...Object.keys(actual)])) {
    if(!validPath(name)||!protectedPath(name)||!/^[a-f0-9]{64}$/.test(expected[name]??"")||expected[name]!==actual[name])fail("SURFACE_CHANGED:"+name);
  }
  for(const name of [...EXACT,...REQUIRED_TESTS,"tools/check-raw-source-constitution.mjs",".github/workflows/repository-governance.yml"])if(!(name in actual))fail("PROTECTION_MISSING:"+name);
}
export function verifyModel(c) {
  if(c?.id!=="raw-source-constitution-v1"||c.version!==1||c.baseline_main!==BOOTSTRAP_BASE)fail("IDENTITY_INVALID");
  if(JSON.stringify(c.protection?.prefixes)!==JSON.stringify(PREFIXES)||JSON.stringify(c.protection?.exact)!==JSON.stringify(EXACT)||JSON.stringify(c.required_tests)!==JSON.stringify(REQUIRED_TESTS))fail("PROTECTION_POLICY_CHANGED");
  if(c.authority?.ci_proves_owner_approval!==false||c.authority?.platform_bypass_prevented_by_code!==false)fail("FALSE_ACCEPTANCE");
  if(JSON.stringify(c.flow?.states)!==JSON.stringify(STATES)||JSON.stringify(c.flow?.transitions)!==JSON.stringify(EDGES))fail("FLOW_CHANGED");
  if(!Array.isArray(c.rules)||new Set(c.rules.map(r=>r.id)).size!==c.rules.length)fail("RULE_INVALID");
  for(const id of REQUIRED_RULES)if(!c.rules.some(r=>r.id===id&&r.mandatory===true&&typeof r.text==="string"&&r.text.length>20))fail("RULE_MISSING:"+id);
  for(const id of ["google_ads","meta","klaviyo","shopify_orders"]) {
    const p=c.providers?.[id];if(!p||!Array.isArray(p.entrypoints)||!p.entrypoints.length||!Array.isArray(p.tests)||!p.tests.length||p.tests.some(t=>!REQUIRED_TESTS.includes(t)))fail("PROVIDER_COVERAGE_MISSING:"+id);
  }
  if(c.retention?.source_days!==90||c.retention?.metadata_days!==365||c.retention?.mandatory_erasure_overrides_retention!==true||c.retention?.read_extends_expiry!==false)fail("RETENTION_WEAKENED");
  if(c.boundaries?.source_receipt_is_consumer_receipt!==false||c.boundaries?.stored_is_mapping_verified!==false||c.boundaries?.stored_is_hourly_activation!==false)fail("BOUNDARY_WEAKENED");
  for(const id of ["backup_restore","customer_delivery","meta_roles","pmax_historical_channel","native_mapping","combined_reporting_policy"])if(!c.open_gates?.some(g=>g.id===id&&g.accepted!==true&&g.destination))fail("OPEN_GATE_MISSING:"+id);
}
export function parseChangedPaths(...values) {
  return [...new Set(values.flatMap(v=>v.split("\0")).filter(n=>n===CONTRACT_PATH||protectedPath(n)))].sort();
}
export function verifyRevision(current,previous,changed) {
  const rows=current.revisions,last=rows?.at(-1);
  if(!last||!/^[a-z0-9-]+$/.test(last.id)||!/^\d{4}-\d\d-\d\d$/.test(last.date??"")||last.owner_approval?.explicit!==true||!last.owner_approval?.source||!last.rationale||!Array.isArray(last.changed_paths)||!Array.isArray(last.tests)||!last.tests.length||!last.acceptance_required?.includes("required_CI")||!last.acceptance_required?.includes("separate_merge_approval"))fail("APPROVAL_RECORD_REQUIRED");
  if(new Set(rows.map(r=>r.id)).size!==rows.length)fail("REVISION_DUPLICATE");
  if(!changed.length)return;
  if(previous&&(rows.length!==previous.revisions.length+1||JSON.stringify(rows.slice(0,-1))!==JSON.stringify(previous.revisions)))fail("REVISION_APPEND_REQUIRED");
  const paths=[...new Set(changed)].sort();
  if(last.changed_paths.length!==paths.length||last.changed_paths.some(n=>!validPath(n))||JSON.stringify([...last.changed_paths].sort())!==JSON.stringify(paths))fail("CHANGED_PATHS_MISMATCH");
  if(paths.some(runtimePath)&&last.scope?.runtime_code!==true)fail("RUNTIME_SCOPE_NOT_APPROVED");
  if(last.scope?.live_provider!==false||last.scope?.live_database!==false||last.scope?.merge!==false||last.scope?.deploy!==false)fail("SCOPE_GATE_INVALID");
}
export function verifyRepository(root,baseSha) {
  if(fs.lstatSync(path.join(root,CONTRACT_PATH)).isSymbolicLink())fail("SYMLINK_FORBIDDEN:"+CONTRACT_PATH);
  const contract=JSON.parse(fs.readFileSync(path.join(root,CONTRACT_PATH),"utf8"));verifyModel(contract);
  const actual=collectSnapshot(root);verifySnapshot(contract.protection.sha256,actual);
  const base=baseSha&&!/^0+$/.test(baseSha)?baseSha:git(root,["merge-base","HEAD","origin/main"]).trim();
  if(!/^[a-f0-9]{40}$/.test(base))fail("BASE_INVALID");git(root,["cat-file","-e",base+"^{commit}"]);
  const priorText=readGit(root,base,CONTRACT_PATH),prior=priorText?JSON.parse(priorText):null;
  const changed=parseChangedPaths(git(root,["diff","--name-only","-z",base,"--"]),git(root,["ls-files","--others","--exclude-standard","-z"]));
  if(!prior) {
    if(base!==BOOTSTRAP_BASE||contract.revisions.length!==1||contract.revisions[0].scope.runtime_code!==false)fail("BOOTSTRAP_INVALID");
    for(const name of changed.filter(runtimePath))fail("BOOTSTRAP_RUNTIME_CHANGED:"+name);
    verifyBootstrapRuntime(root,base,Object.keys(actual).filter(runtimePath));
  }
  verifyRevision(contract,prior,changed);
  for(const name of REQUIRED_TESTS)if(!/\btest\(/.test(fs.readFileSync(path.join(root,name),"utf8")))fail("TEST_MISSING:"+name);
  const workflow=fs.readFileSync(path.join(root,".github/workflows/repository-governance.yml"),"utf8");
  if(!/^\s+run: node tools\/check-raw-source-constitution\.mjs\s*$/m.test(workflow)||!/^\s+run: pnpm test\s*$/m.test(workflow)||/continue-on-error/.test(workflow))fail("CI_GATE_MISSING");
  const agents=fs.readFileSync(path.join(root,"AGENTS.md"),"utf8");
  if(!agents.includes(contract.document)||!agents.includes(CONTRACT_PATH))fail("AGENT_GATE_MISSING");
  return {protected_files:Object.keys(actual).length,base,changed:changed.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  try{console.log("Raw source constitution verified",verifyRepository(root,process.env.RAW_SOURCE_BASE_SHA??process.env.OAUTH_BASE_SHA));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
