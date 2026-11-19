import test from "node:test";
import assert from "node:assert/strict";
import {datasetSourceBindingFixture} from "./fixtures/dataset-source-binding-fixture.js";
import {prepareGoogleRawDatasetPackages} from "../app/lib/database/google-dataset-source-store.server.js";
import {reconcileStoredDatasetSources} from "../app/lib/database/dataset-reconciliation.server.js";
import {GOOGLE_DAILY_STAGE_SQL as STAGE,GOOGLE_DAILY_PUBLISH_SQL as PUBLISH,GOOGLE_DAILY_INSPECT_SQL as INSPECT,GOOGLE_DAILY_FINISH_SQL as FINISH} from "../app/lib/database/dataset-rpc.server.js";
import {sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";

test("Google raw packaging keeps native pages intact, bounded and ordered",async()=>{
 const f=await datasetSourceBindingFixture("google_ads",{googleProducts:100});
 const pages=f.native.find(x=>x.dataset==="product_performance").pages;
 const options={owner:f.owner,attemptId:f.batches[1].attemptId,dataset:"product_performance",pages,complete:true,
  cipher:f.cipher,policy:{version:"source-evidence-v1",until:new Date(Date.now()+86400000).toISOString()},limits:{maxRows:200,maxBytes:1048576},now:new Date().toISOString()};
 // Reuse the actual fixture's validated source policy.
 options.policy=f.envelopes.get(f.batches[1].attemptId).sourceWrite.body.policy;
 const writes=prepareGoogleRawDatasetPackages(options);
 assert.ok(writes.length>1);assert.deepEqual(writes.map(w=>w.ordinal),writes.map((_,n)=>n));
 const decoded=writes.flatMap(w=>w.body.pages.map(p=>f.cipher.open({owner:f.owner,attemptId:w.attemptId,ordinal:w.ordinal,page:p})));
 assert.deepEqual(decoded,pages);assert.ok(writes.every(w=>w.body.sourceState==="partial"));
});

test("Google multipart source rejects missing, reordered and foreign-bound packages",async()=>{
 const f=await datasetSourceBindingFixture("google_ads",{googleProducts:250});
 const limits={...f.limits,maxBytes:16000000};assert.ok(f.batches.length>2);
 const good=await readStoredDatasetSources({...f,limits});
 assert.ok(good.datasets.some(d=>d.packageReceipts?.length>1));
 const batches=f.batches.filter((_,i)=>i!==f.batches.length-1);
 await assert.rejects(readStoredDatasetSources({...f,limits,batches}),/PACKAGE_INCOMPLETE/);
 const swap=[...f.batches];[swap[1],swap[2]]=[swap[2],swap[1]];
 await assert.rejects(readStoredDatasetSources({...f,limits,batches:swap}),/BATCH_INPUT_INVALID/);
 const part=[...f.envelopes.values()].find(e=>e.sourceWrite.ordinal===1);
 part.receipt.manifest.googleDatasetRead={...part.receipt.manifest.googleDatasetRead,operationId:"00000000-0000-4000-8000-000000000000"};
 await assert.rejects(readStoredDatasetSources({...f,limits}),/PACKAGE_BINDING_INVALID/);
});

for(const mode of ["success","lost_publish","bad_readback","lost_finish"]){
 test("Google first-day handoff uses all packages and one receipt: "+mode,async()=>{
  const f=await datasetSourceBindingFixture("google_ads",{googleProducts:100});let receipt;const packages=[];let commits=0,rollbacks=0;
  f.database.transaction=async run=>{try{const x=await run(f.database);commits++;return x;}catch(e){rollbacks++;throw e;}};
  for(const e of f.envelopes.values())Object.assign(e.receipt.manifest.googleDatasetRead,{observedAt:new Date(Date.now()-1000).toISOString(),completedAt:new Date(Date.now()-500).toISOString()});
  f.hooks.query=(sql,args)=>{
   if(sql===STAGE){const w=JSON.parse(args[1]),c=JSON.parse(args[2]);const p={ordinal:args[4],rowCount:w.rows.length,digest:sourcePayloadHash({write:w,context:c})};packages.push(p);return {rows:[{result:{status:"staged",operationId:w.operationId,packageCount:args[5],...p}}]};}
   if(sql===PUBLISH){if(mode==="lost_publish")throw Error("lost");const c=JSON.parse(args[1]);receipt={version:"google-daily-receipt-v1",status:"consumed",comparison:"matched",consumerReceipt:true,checkpointAdvanced:true,
    operationId:args[3],rowCount:201,revision:1,jobId:c.sourceContext.job_id,fence:c.sourceContext.fence,businessDate:c.businessDate,timeZone:c.timeZone,packages,batchIds:c.batchIds,digest:"a".repeat(64)};return {rows:[{result:receipt}]};}
   if(sql===INSPECT)return {rows:[{result:{...receipt,...mode==="bad_readback"?{digest:"b".repeat(64)}:{}}}]};
   if(sql===FINISH){if(mode==="lost_finish")throw Error("lost");return {rows:[{result:true}]};}
  };
  const options={...f,scheduled:true,googleDailyPackages:true,expectedRevision:0,admittedScope:{jobId:"synthetic-binding-job",fence:"1",from:"2026-11-01",to:"2026-11-01"}};
  if(mode==="success"){const r=await reconcileStoredDatasetSources(options);assert.equal(r.jobCompleted,true);assert.equal(r.rowsStored,201);assert.deepEqual(packages.map(p=>p.rowCount),[200,1]);assert.equal(commits,1);}
  else await assert.rejects(reconcileStoredDatasetSources(options),/UNCONFIRMED/);
  assert.equal(f.queries.filter(s=>s===PUBLISH).length,1);
  assert.equal(f.queries.filter(s=>s===INSPECT).length,mode==="lost_publish"?0:1);
  assert.equal(f.queries.filter(s=>s===FINISH).length,["success","lost_finish"].includes(mode)?1:0);
  assert.equal(rollbacks,mode==="lost_publish"?1:0);
 });
}
