import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {buildLiveReadinessPlan,readinessEvidencePath} from "../tools/f01-live-readiness-plan.mjs";
import {loadMigrationFiles} from "../tools/check-migration-lineage.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const read=p=>JSON.parse(readFileSync(new URL("../"+p,import.meta.url),"utf8"));
const manifest=read("contracts/a6-tech-01-f01-migration-lineage-v1.json");
const evidence=read(readinessEvidencePath), files=loadMigrationFiles(root);
const build=(e=evidence,f=files)=>buildLiveReadinessPlan({manifest,files:f,evidence:e});

test("captured43 reconcile to exactly82 unique repository migrations with39 remaining and no OAuth replay",()=>{
  const plan=build();
  const entries=[...plan.baseline,...plan.aliases,...plan.remaining];
  assert.equal(entries.length,82);assert.equal(new Set(entries.map(x=>x.version)).size,82);
  assert.equal(new Set(entries.map(x=>x.name)).size,82);
  assert.equal(plan.remaining.length,39);assert.equal(plan.ledger.length,43);
  assert.equal(plan.liveApplyAuthorized,false);assert.equal(plan.historyRepairAuthorized,false);
  for(const row of plan.aliases)assert.ok(!plan.remaining.some(x=>x.name===row.name||x.version===row.version));
  assert.deepEqual(manifest.pending_migrations.filter(x=>plan.aliases.some(y=>y.version===x.version)).map(x=>x.applied),[false,false,false],
    "the historical manifest is preserved; the dated observation is a separate overlay");
});

const corruptions=[
  ["wrong project",e=>{e.project.id="other-project";},/PROJECT/],
  ["wrong source",e=>{e.source_main="0".repeat(40);},/SOURCE/],
  ["stale date",e=>{e.checked_at="2026-10-18";},/DATE/],
  ["live authorization",e=>{e.live_apply_authorized=true;},/AUTHORITY/],
  ["false live parity",e=>{e.live_schema_parity_verified=true;},/PARITY/],
  ["wrong alias version",e=>{e.aliases[0].live_version="20261031190929";},/ALIAS/],
  ["same-name arbitrary alias",e=>{e.aliases[0].repository_version="20261028175738";},/ALIAS/],
  ["unverified body",e=>{e.aliases[0].exact_complete_sql_equal=false;},/BODY/],
  ["changed applied hash",e=>{e.aliases[0].applied_sql_sha256="0".repeat(64);},/HASH/],
  ["missing alias",e=>{e.aliases.pop();},/ALIAS_COUNT/],
  ["missing ledger entry",e=>{e.ledger.pop();},/LEDGER/],
  ["unregistered ledger entry",e=>{e.ledger.push({version:"20261103000000",name:"unknown"});},/LEDGER/],
  ["duplicate ledger entry",e=>{e.ledger[1]=e.ledger[0];},/LEDGER/],
  ["renamed ledger entry",e=>{e.ledger[0].name="other";},/LEDGER/],
  ["reordered pending steps",e=>{[e.remaining_migrations[0],e.remaining_migrations[1]]=[e.remaining_migrations[1],e.remaining_migrations[0]];},/ORDER/],
  ["changed pending hash",e=>{e.remaining_migrations[0].repository_sql_sha256="0".repeat(64);},/HASH/],
  ["silently skipped pending step",e=>{e.remaining_migrations.pop();},/ORDER/],
  ["OAuth step reinserted",e=>{e.remaining_migrations.push(e.aliases[0]);},/ORDER/],
];
for(const [name,change,expected]of corruptions)test("readiness rejects "+name,()=>{
  const e=structuredClone(evidence);change(e);assert.throws(()=>build(e),expected);
});
test("readiness rejects modified migration SQL before any replay",()=>{
  const file=manifest.pending_migrations[0].file;
  assert.throws(()=>build(evidence,{...files,[file]:files[file]+"\nselect 1;"}),/SOURCE_LINEAGE_INVALID/);
});
