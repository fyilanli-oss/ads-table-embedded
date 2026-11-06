import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {CONTRACT_PATH,REQUIRED_TESTS,protectedPath,collectSnapshot,digest,verifySnapshot,verifyModel,verifyRevision,verifyRepository,parseChangedPaths} from "../tools/check-raw-source-constitution.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=()=>JSON.parse(fs.readFileSync(path.join(root,CONTRACT_PATH),"utf8"));
const nextRevision=(c,paths)=>({...structuredClone(c.revisions.at(-1)),id:"synthetic-approved-revision",changed_paths:paths,scope:{runtime_code:true,live_provider:false,live_database:false,merge:false,deploy:false}});

test("raw constitution validates the real repository without native, token or database calls",()=>{
  assert.ok(verifyRepository(root,process.env.RAW_SOURCE_BASE_SHA??process.env.OAUTH_BASE_SHA).protected_files>500);
});

test("raw guard rejects altered, added, deleted and renamed source or shared dependency files",()=>{
  const c=read(),actual=collectSnapshot(root),key="app/lib/database/source-evidence-store.server.js";
  for(const altered of [
    {...actual,[key]:digest("wrong owner or plaintext")},
    {...actual,"app/lib/new-reader.server.js":digest("unreviewed transport")},
    {...actual,"contracts/new-query-v1.json":digest("new query")},
    Object.fromEntries(Object.entries(actual).filter(([p])=>p!==key)),
    {...Object.fromEntries(Object.entries(actual).filter(([p])=>p!==key)),"app/lib/database/renamed-source.server.js":actual[key]},
  ]) assert.throws(()=>verifySnapshot(c.protection.sha256,altered),/SURFACE_CHANGED/);
});

test("raw guard protects itself, behavior tests, helpers, workflow, dependencies and its human contract",()=>{
  const c=read(),actual=collectSnapshot(root);
  for(const key of ["tools/check-raw-source-constitution.mjs","tests/raw-source-constitution.test.js","tests/fixtures/source-store-fixture.js","tests/source-evidence-store.test.js",".github/workflows/repository-governance.yml","pnpm-lock.yaml","docs/RAW_SOURCE_CONSTITUTION.md"])
    assert.throws(()=>verifySnapshot(c.protection.sha256,{...actual,[key]:digest("bypass")}),/SURFACE_CHANGED/);
  const weakened=read();weakened.required_tests=[];assert.throws(()=>verifyModel(weakened),/PROTECTION_POLICY_CHANGED/);
});

test("raw contract cannot weaken authority, integrity, unknown or mandatory deletion rules",()=>{
  for(const id of ["current_server_authority","owner_bound_encryption","atomic_receipt_readback","unknown_no_replay","mandatory_erasure_first","zero_is_evidence"]){
    const c=read();c.rules.find(r=>r.id===id).mandatory=false;assert.throws(()=>verifyModel(c),/RULE_MISSING/);
  }
  const duplicate=read();duplicate.rules.push(duplicate.rules[0]);assert.throws(()=>verifyModel(duplicate),/RULE_INVALID/);
});

test("raw flow cannot insert success before readback or replay after unknown",()=>{
  for(const mutate of [
    c=>c.flow.transitions.push(["unconfirmed","retry","commit_sent"]),
    c=>c.flow.transitions.find(e=>e[1]==="acknowledge")[2]="verified",
    c=>c.flow.transitions=c.flow.transitions.filter(e=>e[1]!=="readback"),
  ]) {const c=read();mutate(c);assert.throws(()=>verifyModel(c),/FLOW_CHANGED/);}
});

test("raw contract preserves retention, receipt separation and explicitly deferred acceptance gates",()=>{
  for(const mutate of [
    c=>c.retention.source_days=7,
    c=>c.retention.read_extends_expiry=true,
    c=>c.retention.mandatory_erasure_overrides_retention=false,
    c=>c.boundaries.source_receipt_is_consumer_receipt=true,
    c=>c.boundaries.stored_is_mapping_verified=true,
    c=>c.boundaries.stored_is_hourly_activation=true,
    c=>c.open_gates.find(g=>g.id==="backup_restore").accepted=true,
    c=>c.open_gates=c.open_gates.filter(g=>g.id!=="customer_delivery"),
  ]) {const c=read();mutate(c);assert.throws(()=>verifyModel(c),/WEAKENED|OPEN_GATE_MISSING/);}
});

test("raw revision requires append-only history, concrete approval, exact paths and separate live scope",()=>{
  const prior=read(),paths=[CONTRACT_PATH,"app/lib/refresh/google-raw-datasets.server.js"],current=structuredClone(prior);
  assert.throws(()=>verifyRevision(current,prior,paths),/REVISION_APPEND_REQUIRED/);
  current.revisions.push(nextRevision(prior,paths));verifyRevision(current,prior,paths);
  for(const [mutate,error] of [
    [c=>c.revisions[0].rationale="rewrite",/REVISION_APPEND_REQUIRED/],
    [c=>c.revisions.at(-1).owner_approval.explicit=false,/APPROVAL_RECORD_REQUIRED/],
    [c=>c.revisions.at(-1).changed_paths=[CONTRACT_PATH],/CHANGED_PATHS_MISMATCH/],
    [c=>c.revisions.at(-1).scope.runtime_code=false,/RUNTIME_SCOPE_NOT_APPROVED/],
    [c=>c.revisions.at(-1).scope.live_database=true,/SCOPE_GATE_INVALID/],
    [c=>c.revisions.at(-1).scope.deploy=true,/SCOPE_GATE_INVALID/],
    [c=>c.revisions.at(-1).tests=[],/APPROVAL_RECORD_REQUIRED/],
  ]) {const c=structuredClone(current);mutate(c);assert.throws(()=>verifyRevision(c,prior,paths),error);}
});

test("raw provider coverage points to actual runtime entrypoints and existing executable regression tests",()=>{
  const c=read();verifyModel(c);
  for(const provider of Object.values(c.providers))for(const entry of provider.entrypoints)assert.ok(fs.existsSync(path.join(root,entry)),entry);
  for(const file of REQUIRED_TESTS)assert.match(fs.readFileSync(path.join(root,file),"utf8"),/\btest\(/);
  for(const row of c.rules) {assert.ok(row.tests.length>0);for(const file of row.tests)assert.ok(REQUIRED_TESTS.includes(file));}
  const c2=read();c2.providers.klaviyo.tests=[];assert.throws(()=>verifyModel(c2),/PROVIDER_COVERAGE_MISSING/);
});

test("raw path inventory keeps Unicode, whitespace and newlines; CRLF normalization hides no content change",()=>{
  const paths=["app/lib/ürün.js","tests/new\ncase.test.js","contracts/trailing.json "];
  assert.deepEqual(parseChangedPaths(paths.join("\0")+"\0",".codex-remote-attachments/ignored.jpg\0"),paths.sort());
  assert.equal(digest("a\r\nb\r\n"),digest("a\nb\n"));assert.notEqual(digest("a\nb\n"),digest("a\nchanged\n"));
});

test("raw protection includes database code/configuration and excludes local CLI cache",()=>{
  for(const name of ["supabase/migrations/new.sql","supabase/functions/reader/index.ts","supabase/config.toml","supabase/new.sql"])
    assert.equal(protectedPath(name),true,name);
  assert.equal(protectedPath("supabase/.temp/cli-latest"),false);
  assert.ok(!Object.keys(collectSnapshot(root)).some(name=>name.startsWith("supabase/.temp/")));
});
