import test from "node:test";
import assert from "node:assert/strict";
import {datasetSourceBindingFixture} from "./fixtures/dataset-source-binding-fixture.js";
import {prepareGoogleRawDatasetPackages} from "../app/lib/database/google-dataset-source-store.server.js";
import {reconcileStoredDatasetSources} from "../app/lib/database/dataset-reconciliation.server.js";
import {GOOGLE_DAILY_STAGE_SQL as STAGE,GOOGLE_DAILY_PUBLISH_SQL as PUBLISH,GOOGLE_DAILY_INSPECT_SQL as INSPECT,GOOGLE_DAILY_FINISH_SQL as FINISH,
 GOOGLE_DAILY_PRODUCT_LINKS_SQL, GOOGLE_DAILY_PRODUCT_MAPPING_SQL} from "../app/lib/database/dataset-rpc.server.js";
import {sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {googleRawDatasetsFixture} from "./fixtures/google-raw-datasets-fixture.js";
import {createGoogleRawCaptureExecution} from "../app/lib/refresh/google-raw-server.server.js";
import {projectStoredGoogleDataset} from "../app/lib/providers/stored-dataset-projection.server.js";
import {GOOGLE_DAILY_PRODUCT_REPORT_PLAN} from "../app/lib/providers/google-reporting.server.js";
import {bindGoogleDailyProductMappings} from "../app/lib/database/google-daily-product-mapping.server.js";
import {verifiedMappingFixture} from "./fixtures/verified-mapping-fixture.js";
import {REGISTER_GOOGLE_REPORT_PRODUCT_SQL,registerReviewedGoogleReportProduct} from "../app/lib/database/google-report-product-registration.server.js";
import {randomUUID} from "node:crypto";

test("Google report link registration requires authenticated report evidence and an exact approval", async () => {
 const base=verifiedMappingFixture("google_ads");
 const data=await datasetSourceBindingFixture("google_ads",{owner:base.owner,cipher:base.cipher,shopifyMapping:true,googleDailyReport:true});
 const source=await readStoredDatasetSources(data);
 const sale=source.datasets.find(d=>d.dataset==="product_performance").pages.find(p=>p.family==="pmax_cart_data_product_sales_daily");
 const snapshot=base.snapshot();
 Object.assign(snapshot.mapping,{state:"verified",productId:"gid://shopify/Product/123",variantId:"gid://shopify/ProductVariant/456"});
 const identity=JSON.parse(snapshot.mapping.identityKey),decisionId=randomUUID();
 const target={identity,pageId:sale.ref.page_id,role:"sold",replacesMappingId:null};
 let writes=0;
 const database={async query(sql,args){
  assert.deepEqual(JSON.parse(args[0]),source.owner);
  if(sql.includes("lookup_verified_mapping"))return {rows:[{result:snapshot}]};
  assert.equal(sql,REGISTER_GOOGLE_REPORT_PRODUCT_SQL);writes++;
  const body=JSON.parse(args[1]);
  assert.equal(body.sourceDigest,sale.ref.payload_hash);assert.equal(body.sourcePageId,sale.ref.page_id);
  assert.equal(body.decisionId,decisionId);assert.equal(body.role,"sold");
  return {rows:[{result:{status:"registered",mappingId:"1",businessDate:source.scope.window.from,role:"sold",decisionId}}]};
 }};
 const input={source,database,cipher:base.cipher,deadlineAt:Date.now()+60000,target,
  reviewAuthority:({proposalHash,expiresAt})=>({status:"approved",proposalHash,validUntil:expiresAt,decisionId})};
 await assert.rejects(registerReviewedGoogleReportProduct({...input,source:structuredClone(source)}),/INPUT_INVALID/);
 await assert.rejects(registerReviewedGoogleReportProduct({...input,target:{...target,identity:{...identity,nativeId:"unrelated"}}}),/REPORT_EVIDENCE_REQUIRED/);
 await assert.rejects(registerReviewedGoogleReportProduct({...input,reviewAuthority:()=>({status:"approved",proposalHash:"wrong"})}),/EXPLICIT_REVIEW_REQUIRED/);
 assert.equal(writes,0);
 assert.equal((await registerReviewedGoogleReportProduct(input)).mappingId,"1");
 assert.equal(writes,1);
});

test("Google daily mapping verifies exact reviewed roles and shares a single evidence read across repeated rows", async () => {
 const f=verifiedMappingFixture("google_ads");
 const mapping=f.snapshot();
 Object.assign(mapping.mapping,{state:"verified",productId:"gid://shopify/Product/123",variantId:"gid://shopify/ProductVariant/456"});
 const run=async mode=>{
  const context={merchant_id:"99",feed_label:"US",language:"en"};
  const performance=()=>({table:"cpd_product_performance_facts",row:{product_context:{...context},native_product_id:mapping.mapping.nativeId,product_mapping_id:null}});
  const sale={table:"cpd_product_sales_facts",row:{product_context:{...context},native_sold_product_id:mapping.mapping.nativeId,
   native_advertised_product_id:mapping.mapping.nativeId,sold_product_mapping_id:null,advertised_product_mapping_id:null}};
  const missing=performance();missing.row.native_product_id="unlinked";
  const rows=[performance(),performance(),sale,missing];
  let reads=0;
  const database={async query(sql,args){
   if(sql===GOOGLE_DAILY_PRODUCT_LINKS_SQL){
    const keys=JSON.parse(args[3]);
    assert.deepEqual(keys.map(k=>k.role),["performance","sold","advertised","performance"]);
    assert.equal(keys[3].nativeId,"unlinked");
    return {rows:[{result:[0,1].map(index=>({index,mappingId:"1",context:mapping.mapping.context}))}]};
   }
   assert.equal(sql,GOOGLE_DAILY_PRODUCT_MAPPING_SQL);assert.equal(args[3],"1");reads++;
   return {rows:[{result:mode==="stale"?null:mode==="wrong_shop"?{...mapping,owner:{...mapping.owner,shopId:"gid://shopify/Shop/999"}}:mapping}]};
  }};
  const promise=bindGoogleDailyProductMappings({database,owner:f.owner,rows,cipher:f.cipher,now:()=>f.now,stop(){}});
  if(mode==="wrong_shop")await assert.rejects(promise,/MAPPING_STORE_SNAPSHOT_INVALID/);
  else await promise;
  assert.equal(reads,1);
  const id=mode==="current"?"1":null;
  assert.deepEqual(rows.slice(0,2).map(r=>r.row.product_mapping_id),[id,id]);
  assert.equal(sale.row.sold_product_mapping_id,id);
  assert.equal(sale.row.advertised_product_mapping_id,null);
  assert.equal(missing.row.product_mapping_id,null);
 };
 for(const mode of ["current","wrong_shop","stale"])await run(mode);
});

test("Google daily plan omits only the auxiliary cart report and preserves the 1000 Dataset facts", async () => {
 const options={googleProducts:500,googleSalesProducts:499,googlePageSize:10000,googleStorageMaxBytes:2097152};
 const baseline=await datasetSourceBindingFixture("google_ads",options);
 const daily=await datasetSourceBindingFixture("google_ads",{...options,googleDailyReport:true});
 const read=f=>readStoredDatasetSources({...f,limits:{...f.limits,maxRows:2000,maxBytes:16000000}});
 const before=await read(baseline),after=await read(daily);
 const families=bundle=>bundle.datasets.flatMap(d=>d.pages.map(page=>page.family));
 assert.deepEqual(families(after),families(before).filter(f=>f!=="cart_data_product_sales_daily"));
 const facts=bundle=>projectStoredGoogleDataset(bundle).rows.map(({table,row:{provenance,source_batch_id,...row}})=>({table,row}));
 assert.equal(facts(after).length,1000);
 assert.deepEqual(facts(after),facts(before));
 const productEnvelopes=f=>[...f.envelopes.values()].filter(e=>e.dataset==="product_performance");
 for(const e of productEnvelopes(baseline))e.receipt.manifest.googleDatasetRead.reportPlan=GOOGLE_DAILY_PRODUCT_REPORT_PLAN;
 const invalidDaily=await read(baseline);
 assert.throws(()=>projectStoredGoogleDataset(invalidDaily),/FAMILY_INVALID/);
 for(const e of productEnvelopes(daily))delete e.receipt.manifest.googleDatasetRead.reportPlan;
 const incompleteHistorical=await read(daily);
 assert.throws(()=>projectStoredGoogleDataset(incompleteHistorical),/FAMILY_MISSING/);
});

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

test("full synthetic Google capture projects exactly 1000 facts and publishes five 200-row packages",async()=>{
 const x=googleRawDatasetsFixture({googleProducts:500,googleSalesProducts:499});
 x.plan.limits.maxRows=2000;x.plan.storageLimits.maxBytes=2097152;x.setPlan();
 const e=createGoogleRawCaptureExecution(x.options),capture=await e.run();await e.close();
 assert.equal(capture.status,"partial",JSON.stringify(capture)); // Merchant absence stays separate.
 assert.equal(capture.datasets.account_performance.recordCount,3);
 assert.equal(capture.datasets.product_performance.recordCount,1498);
 assert.equal(capture.datasets.merchant_identity.status,"unavailable");
 assert.equal(capture.contentVerified,true);assert.equal(capture.jobPaused,true);
 assert.equal(x.f.http.filter(u=>u.hostname==="googleads.googleapis.com").length,18);
 assert.equal(x.f.http.filter(u=>u.hostname==="oauth2.googleapis.com").length,0);
 assert.equal(x.plan.storageLimits.maxRows,1000);
 assert.ok(x.writes.every(w=>Buffer.byteLength(JSON.stringify(w.body))<=x.plan.storageLimits.maxBytes));
 const f=x.datasetInputs(),source=await readStoredDatasetSources(f);
 assert.equal(source.rowsRead,1501);assert.equal(source.pagesRead,17);
 assert.equal(new Set(source.datasets.flatMap(d=>d.pages.map(p=>p.family))).size,17);
 const projection=projectStoredGoogleDataset(source);assert.deepEqual(projection.holds,[]);
 assert.equal(projection.rows.length,1000);
 assert.deepEqual(Object.fromEntries(["pd_facts","cpd_product_performance_facts","cpd_product_sales_facts"].map(t=>[t,projection.rows.filter(r=>r.table===t).length])),
  {pd_facts:1,cpd_product_performance_facts:500,cpd_product_sales_facts:499});
 assert.ok(projection.rows.some(r=>r.row.native_product_id==="product-500"));
 assert.ok(!projection.rows.some(r=>r.row.native_sold_product_id==="product-500"));
 let receipt,transactions=0;const packages=[];
 f.database.transaction=async run=>{transactions++;return run(f.database);};
 x.hooks.dataset=(sql,args)=>{
  if(sql===STAGE){const w=JSON.parse(args[1]),c=JSON.parse(args[2]);const p={ordinal:args[4],rowCount:w.rows.length,digest:sourcePayloadHash({write:w,context:c})};packages.push(p);return {rows:[{result:{status:"staged",operationId:w.operationId,packageCount:args[5],...p}}]};}
  if(sql===PUBLISH){const c=JSON.parse(args[1]);receipt={version:"google-daily-receipt-v1",status:"consumed",comparison:"matched",consumerReceipt:true,checkpointAdvanced:true,
   operationId:args[3],rowCount:1000,revision:1,jobId:c.sourceContext.job_id,fence:c.sourceContext.fence,businessDate:c.businessDate,timeZone:c.timeZone,packages,batchIds:c.batchIds,digest:"a".repeat(64)};return {rows:[{result:receipt}]};}
  if(sql===INSPECT)return {rows:[{result:structuredClone(receipt)}]};
  if(sql===FINISH)return {rows:[{result:args[3]===receipt.operationId&&args[4]===receipt.digest}]};
 };
 const result=await reconcileStoredDatasetSources({...f,scheduled:true,googleDailyPackages:true,expectedRevision:0,
  admittedScope:{jobId:source.scope.jobId,fence:source.scope.fence,from:source.scope.window.from,to:source.scope.window.to}});
 assert.equal(result.jobCompleted,true);assert.equal(result.rowsStored,1000);assert.equal(transactions,1);
 assert.deepEqual(packages.map(p=>p.rowCount),[200,200,200,200,200]);
 for(const sql of [PUBLISH,INSPECT,FINISH])assert.equal(f.queries.filter(s=>s===sql).length,1);
});

test("the SQL source fixture retains intact large native pages for exactly 1000 facts",async()=>{
 const f=await datasetSourceBindingFixture("google_ads",{googleProducts:500,googleSalesProducts:499,googlePageSize:10000,googleStorageMaxBytes:2097152});
 const source=await readStoredDatasetSources({...f,limits:{...f.limits,maxRows:2000,maxBytes:16000000}});
 assert.equal(source.rowsRead,1501);assert.equal(source.pagesRead,17);
 assert.equal(projectStoredGoogleDataset(source).rows.length,1000);
 assert.ok([...f.envelopes.values()].some(e=>Buffer.byteLength(JSON.stringify(e.sourceWrite.body))>1048576));
 assert.ok([...f.envelopes.values()].every(e=>Buffer.byteLength(JSON.stringify(e.sourceWrite.body))<=2097152));
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
