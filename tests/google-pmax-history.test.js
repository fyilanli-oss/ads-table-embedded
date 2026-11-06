import assert from "node:assert/strict";
import test from "node:test";
import {pmaxHistoryFixture} from "./fixtures/pmax-history-fixture.js";
import {createGooglePmaxHistoryLoader} from "../app/lib/database/google-pmax-history.server.js";

test("actual cipher restores dated native listing rows without inventing validity or attribution",async()=>{
 const f=pmaxHistoryFixture(),loader=f.create(),r=await loader.load(f.input());
 assert.equal(r.status,"observed_history_only");assert.deepEqual(r.snapshots[0].rows,[f.row]);
 assert.equal(r.snapshots[0].valid_from,null);assert.equal(r.snapshots[0].valid_to,null);
 assert.equal(r.complete,false);assert.equal(r.historical_coverage_verified,false);
 assert.equal(r.snapshots[0].continuity_verified,false);assert.equal(r.DatasetWritePerformed,false);
 assert.equal(Object.isFrozen(r.snapshots[0].rows[0]),true);
 assert.match(r.snapshots[0].tree_hash,/^[a-f0-9]{64}$/);assert.equal(r.snapshots[0].source_pages[0].page_id,"1");
 assert.doesNotMatch(JSON.stringify(r),/credentialId|ciphertext|access_token/);
 assert.ok(f.calls.every(c=>c.sql.startsWith("select evidence.")));
 await assert.rejects(loader.load(f.input()),/EXECUTION_USED/);
});
test("successful empty listing observation is distinct from never captured and expired",async()=>{
 const empty=pmaxHistoryFixture();empty.state.pages=[empty.encode([])];
 const r=await empty.create().load(empty.input());assert.equal(r.status,"observed_history_only");assert.deepEqual(r.snapshots[0].rows,[]);
 const missing=pmaxHistoryFixture();missing.batches.length=0;
 assert.equal((await missing.create().load(missing.input())).status,"missing");assert.equal(missing.calls.length,1);
 const expired=pmaxHistoryFixture();expired.state.pages[0].expired=true;
 const e=await expired.create().load(expired.input());assert.equal(e.status,"unavailable");assert.equal(e.snapshots.length,0);assert.equal(e.gaps.length,1);
});
for(const key of ["workspaceId","installationId","generation","connectionId","connectionVersion","credentialId","selectionEpoch","accountId"])
 test(`history lookup binds ${key} and cannot borrow another owner`,async()=>{
  const f=pmaxHistoryFixture(),input=f.input();
  input.owner={...f.owner,[key]:key.endsWith("Id")&&key!=="accountId"&&key!=="installationId"?"11111111-1111-4111-8111-111111111111":"99"};
  const r=await f.create().load(input);assert.equal(r.status,"missing");assert.equal(f.calls.length,1);
 });
for(const [label,mutate] of Object.entries({
 partial:f=>f.state.receipt.sourceState="partial",
 invalidated:f=>{f.state.receipt.status="invalidated";f.state.receipt.commitId=null;},
 privacy:f=>f.state.receipt.manifest.privacyRedacted=true,
 pruned:f=>f.state.receipt.manifest.retentionPruned=true,
 unavailable:f=>f.state.pages[0].available=false,
 page_pruned:f=>f.state.pages[0].retentionPruned=true,
}))test(`unusable ${label} evidence stays a gap, not empty or exact`,async()=>{
 const f=pmaxHistoryFixture();mutate(f);const r=await f.create().load(f.input());
 assert.equal(r.status,"unavailable");assert.equal(r.complete,false);assert.equal(r.snapshots.length,0);
});
for(const [label,mutate] of Object.entries({
 auth_tag:f=>f.state.pages[0].authTag="0".repeat(32),
 payload_hash:f=>f.state.pages[0].payloadHash="b".repeat(64),
 page_missing:f=>f.state.pages=[],
 wrong_day:f=>f.state.receipt.manifest.googleDatasetRead.window.from="2026-10-02",
 duplicate_batch:f=>f.batches.push({...f.batches[0]}),
 wrong_origin:f=>f.state.pages[0].origin="meta",
 incomplete_cursor:f=>f.state.pages=[f.encode([f.row],{hasNextPage:true})],
 wrong_total:f=>f.state.pages=[f.encode([f.row],{declaredTotal:"2"})],
 wrong_query:f=>f.state.pages=[f.encode([f.row],{query:"SELECT fake FROM fake"})],
 duplicate_native:f=>f.state.pages=[f.encode([f.row,f.row])],
}))test(`corrupt ${label} cannot silently become missing or zero`,async()=>{
 const f=pmaxHistoryFixture();
 mutate(f);
 await assert.rejects(f.create().load(f.input()));
 assert.equal(f.calls.filter(c=>c.sql.includes("find_google_pmax")).length,1);
});
test("receipt changes during decrypt/readback stop the historical handoff",async()=>{
 const f=pmaxHistoryFixture();let reads=0;
 f.hooks.query=sql=>{if(sql.includes("read_source_receipt")&&++reads===2)f.state.receipt.status="invalidated";};
 await assert.rejects(f.create().load(f.input()),/SOURCE_CHANGED/);
});
for(const [field,value,error] of [["maxBatches",1,"BATCH"],["maxPages",1,"PAGE"],["maxBytes",1,"BYTE"],["maxRows",1,"ROW"]])
 test(`${field} exhaustion fails instead of truncating evidence`,async()=>{
  const f=pmaxHistoryFixture();if(field==="maxBatches")f.batches.push({...f.batches[0],batchId:"2",attemptId:"11111111-1111-4111-8111-111111111111"});
  if(field==="maxPages"){f.state.receipt.manifest.counts.pages=2;f.state.pages.push({...f.state.pages[0],id:"2"});}
  if(field==="maxRows")f.state.pages=[f.encode([f.row,{...f.row,assetGroupListingGroupFilter:{...f.row.assetGroupListingGroupFilter,id:"2",resourceName:"customers/123/assetGroupListingGroupFilters/40~2"}}])];
  await assert.rejects(f.create({limits:{...f.limits,[field]:value}}).load(f.input()),new RegExp(error+"_BOUND_EXCEEDED"));
 });
test("one wall deadline and abort stop hanging SQL without retry",async()=>{
 const f=pmaxHistoryFixture();f.hooks.query=()=>new Promise(()=>{});
 await assert.rejects(f.create({limits:{...f.limits,maxElapsedMs:15}}).load(f.input()),/DEADLINE_EXCEEDED/);assert.equal(f.calls.length,1);
 const aborted=pmaxHistoryFixture(),c=new AbortController();c.abort();
 await assert.rejects(aborted.create().load({...aborted.input(),signal:c.signal}),/ABORTED/);assert.equal(aborted.calls.length,0);
});
test("invalid date, malformed limits and JSON copied loader never become authority",async()=>{
 const f=pmaxHistoryFixture();await assert.rejects(f.create().load({...f.input(),businessDate:"2026-02-30"}),/INPUT_INVALID/);
 assert.throws(()=>createGooglePmaxHistoryLoader({database:{},cipher:f.cipher,limits:f.limits}),/INPUT_INVALID/);
});

for(const [field,error] of [["maxRows","ROW"],["maxBytes","BYTE"]])test(`parent remaining ${field} tightens factory bounds`,async()=>{
 const f=pmaxHistoryFixture();const limits={maxRows:100,maxBytes:1000000,[field]:1};
 if(field==="maxRows")f.state.pages=[f.encode([f.row,{...f.row,assetGroupListingGroupFilter:{...f.row.assetGroupListingGroupFilter,id:"2",resourceName:"customers/123/assetGroupListingGroupFilters/40~2"}}])];
 await assert.rejects(f.create().load({...f.input(),limits}),new RegExp(error+"_BOUND_EXCEEDED"));
 assert.equal(f.calls.filter(c=>c.sql.includes("find_google_pmax")).length,1);
});
test("parent budget cannot enlarge factory bounds or change while SQL waits",async()=>{
 const f=pmaxHistoryFixture();f.state.pages=[f.encode([f.row,{...f.row,assetGroupListingGroupFilter:{...f.row.assetGroupListingGroupFilter,id:"2",resourceName:"customers/123/assetGroupListingGroupFilters/40~2"}}])];
 await assert.rejects(f.create({limits:{...f.limits,maxRows:1}}).load({...f.input(),limits:{maxRows:9999,maxBytes:9999999}}),/ROW_BOUND_EXCEEDED/);
 const g=pmaxHistoryFixture(),limits={maxRows:100,maxBytes:1};g.hooks.query=()=>{limits.maxBytes=1000000;};
 await assert.rejects(g.create().load({...g.input(),limits}),/BYTE_BOUND_EXCEEDED/);
});
for(const limits of [{maxRows:0,maxBytes:1},{maxRows:1,maxBytes:0},{maxRows:1,maxBytes:2.5},{maxRows:1,maxBytes:1,extra:true}])test("invalid parent budget stops before SQL "+JSON.stringify(limits),async()=>{
 const f=pmaxHistoryFixture();await assert.rejects(f.create().load({...f.input(),limits}),/INPUT_INVALID/);assert.equal(f.calls.length,0);
});
