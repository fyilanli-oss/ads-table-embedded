import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {CONTRACT_PATH, PREFIXES, EXACT, CRITICAL_TESTS, digest, collectSnapshot, verifySnapshot, verifyModel, verifyRevision, verifyRepository, parseChangedPaths} from "../tools/check-oauth-constitution.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=()=>JSON.parse(fs.readFileSync(path.join(root,CONTRACT_PATH),"utf8"));
const copy=value=>structuredClone(value);

test("OAuth constitution protects the real approved repository without invoking a provider or SQL",()=>{
  const result=verifyRepository(root,process.env.OAUTH_BASE_SHA);
  assert.ok(result.protected_files>100);
});

test("snapshot rejects byte changes, additions, deletions and renamed protected files",()=>{
  const c=read(),actual=collectSnapshot(root);verifySnapshot(c.protection.sha256,actual);
  const key="app/components/use-permission-settings.tsx";
  for(const mutated of [
    {...actual,[key]:digest("unapproved code")},
    {...actual,"app/lib/oauth/new-unapproved.server.js":digest("new native flow")},
    Object.fromEntries(Object.entries(actual).filter(([name])=>name!==key)),
    {...Object.fromEntries(Object.entries(actual).filter(([name])=>name!==key)),"app/components/renamed.tsx":actual[key]},
  ])assert.throws(()=>verifySnapshot(c.protection.sha256,mutated),/SURFACE_CHANGED/);
});

test("critical test, workflow and guard tampering cannot silently pass the frozen inventory",()=>{
  const c=read(),actual=collectSnapshot(root);
  for(const key of ["tests/google-meta-settings-flow.test.js","tests/step07-settings-corrections.test.js",".github/workflows/repository-governance.yml","tools/check-oauth-constitution.mjs"]){
    assert.throws(()=>verifySnapshot(c.protection.sha256,{...actual,[key]:digest("disabled")}),/SURFACE_CHANGED/);
  }
  const weakened=copy(c);weakened.required_tests=[];
  assert.throws(()=>verifyModel(weakened),/PROTECTION_POLICY_CHANGED/);
});

test("line ending normalization does not hide meaningful content differences",()=>{
  assert.equal(digest("first\r\nsecond\r\n"),digest("first\nsecond\n"));
  assert.notEqual(digest("scope\n"),digest("scope changed\n"));
});

test("state machine rejects Cancel I/O, unknown write replay and an asset-selection effect",()=>{
  for(const mutation of [
    c=>c.flows.meta.transitions.find(r=>r.event==="cancel").effects.push("native_authorization"),
    c=>c.flows.google_ads.transitions.find(r=>r.from==="unknown").effects.push("save_selection"),
    c=>c.flows.klaviyo.transitions[0].effects.push("asset_selection"),
  ]){const c=read();mutation(c);assert.throws(()=>verifyModel(c),/FORBIDDEN_TRANSITION/);}
});

test("required transitions, explicit dispatch intent, separate Klaviyo modals and zero cannot be weakened",()=>{
  for(const mutation of [
    c=>c.flows.meta.transitions=c.flows.meta.transitions.filter(r=>!(r.from==="disconnect_confirm"&&r.event==="cancel")),
    c=>c.flows.google_ads.transitions.find(r=>r.effects.includes("save_selection")).requires=[],
    c=>c.flows.klaviyo.separate_spend_modal=false,
    c=>c.flows.klaviyo.zero_is_valid=false,
    c=>c.flows.shopify_orders.products_prerequisite=false,
  ]){const c=read();mutation(c);assert.throws(()=>verifyModel(c),/MISSING|WEAKENED/);}
});

test("revision cannot refresh hashes without a new exact approval record or rewrite older approvals",()=>{
  const previous=read(),current=copy(previous);const paths=[CONTRACT_PATH,"app/components/use-permission-settings.tsx"];
  assert.throws(()=>verifyRevision(current,previous,paths),/REVISION_APPEND_REQUIRED/);
  const next={...copy(previous.revisions.at(-1)),id:"owner-approved-test-revision",rationale:"synthetic negative-control fixture",changed_paths:paths,scope:{runtime_code:true,live_provider:false,merge:false,deploy:false}};
  current.revisions.push(next);verifyRevision(current,previous,paths);
  const edited=copy(current);edited.revisions[0].rationale="history rewritten";
  assert.throws(()=>verifyRevision(edited,previous,paths),/REVISION_APPEND_REQUIRED/);
  const unlisted=copy(current);unlisted.revisions.at(-1).changed_paths=[CONTRACT_PATH];
  assert.throws(()=>verifyRevision(unlisted,previous,paths),/CHANGED_PATHS_MISMATCH/);
  const missingApproval=copy(current);missingApproval.revisions.at(-1).owner_approval.explicit=false;
  assert.throws(()=>verifyRevision(missingApproval,previous,paths),/APPROVAL_RECORD_REQUIRED/);
  const runtimeDenied=copy(current);runtimeDenied.revisions.at(-1).scope.runtime_code=false;
  assert.throws(()=>verifyRevision(runtimeDenied,previous,paths),/RUNTIME_SCOPE_NOT_APPROVED/);
  const liveDenied=copy(current);liveDenied.revisions.at(-1).scope.deploy=true;
  assert.throws(()=>verifyRevision(liveDenied,previous,paths),/SCOPE_GATE_INVALID/);
});

test("all documented safety families map to existing behavior tests executed by the required governance job",()=>{
  const c=read();verifyModel(c);
  for(const paths of Object.values(c.coverage))for(const name of paths){assert.ok(CRITICAL_TESTS.includes(name));assert.match(fs.readFileSync(path.join(root,name),"utf8"),/test\(/);}
  const workflow=fs.readFileSync(path.join(root,".github/workflows/repository-governance.yml"),"utf8");
  assert.match(workflow,/fetch-depth: 0/);assert.match(workflow,/run: node tools\/check-oauth-constitution\.mjs/);assert.match(workflow,/run: pnpm test/);
  assert.doesNotMatch(workflow,/continue-on-error/);
  assert.doesNotMatch(workflow,/github.event.before/); // A draft push is reviewed against main, not its previous unmerged draft.
  const agents=fs.readFileSync(path.join(root,"AGENTS.md"),"utf8");assert.ok(agents.includes(c.document));assert.ok(agents.includes(CONTRACT_PATH));
  assert.deepEqual(c.protection.prefixes,PREFIXES);assert.deepEqual(c.protection.exact,EXACT);
});

test("Git path inventory preserves Unicode, embedded newlines and whitespace instead of hiding a runtime change",()=>{
  const names=["app/lib/oauth/izin-şartı.server.js","app/lib/oauth/line\nbreak.server.js","app/lib/oauth/trailing-space.js "];
  assert.deepEqual(parseChangedPaths(names.join("\0")+"\0",".codex-remote-attachments/ignored.jpg\0"),[...names].sort());
  const previous=read(),current=copy(previous);current.revisions.push({...copy(previous.revisions.at(-1)),id:"unicode-path-negative-test",changed_paths:[CONTRACT_PATH,...names],scope:{runtime_code:false,live_provider:false,merge:false,deploy:false}});
  assert.throws(()=>verifyRevision(current,previous,[CONTRACT_PATH,...names]),/RUNTIME_SCOPE_NOT_APPROVED/);
});
