import test from "node:test";
import assert from "node:assert/strict";
import {datasetSourceBindingFixture} from "./fixtures/dataset-source-binding-fixture.js";
import {bindStoredDatasetSources} from "../app/lib/database/dataset-source-binding.server.js";
import {readStoredDatasetSources} from "../app/lib/database/dataset-source-reader.server.js";
import {sourceDecimal, addSourceDecimals} from "../app/lib/database/dataset-source-values.server.js";
import {projectStoredGoogleDataset} from "../app/lib/providers/stored-dataset-projection.server.js";
import {projectStoredKlaviyoDataset} from "../app/lib/providers/stored-klaviyo-dataset.server.js";
import {prepareKlaviyoRawDatasetPackages} from "../app/lib/database/klaviyo-dataset-source-store.server.js";
import {sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";
import {sourceStoreFixture} from "./fixtures/source-store-fixture.js";
import {randomUUID} from "node:crypto";
import {reconcileStoredDatasetSources} from "../app/lib/database/dataset-reconciliation.server.js";
import {KLAVIYO_DAILY_STAGE_SQL,KLAVIYO_DAILY_PUBLISH_SQL,KLAVIYO_DAILY_INSPECT_SQL,KLAVIYO_DAILY_FINISH_SQL} from "../app/lib/database/dataset-rpc.server.js";

test("lossless native decimal tokens normalize exponent/scale and micros without a floating point conversion", () => {
  assert.equal(sourceDecimal({jsonNumber: "9007199254740993.123456789"}), "9007199254740993.123456789");
  assert.equal(sourceDecimal("1.2500e1"), "12.5");
  assert.equal(sourceDecimal("1234567", {micros: true}), "1.234567");
  assert.equal(addSourceDecimals("9007199254740993.000000001", "0.000000009"), "9007199254740993.00000001");
  assert.equal(sourceDecimal("-0.000"), "0");
  for (const v of [0.1, "-1", "NaN", "Infinity", "1e9999", {jsonNumber: "1", forged: true}]) assert.throws(() => sourceDecimal(v));
});

test("Google encrypted envelopes become PD/performance/sale rows, with exact amounts and no overlapping cart-family duplicate", async () => {
  const f = await datasetSourceBindingFixture("google_ads"), result = await bindStoredDatasetSources(f);
  assert.equal(result.status, "stored"); assert.equal(result.rowsStored, 3); assert.equal(result.consumerReceipt, false); assert.equal(result.publishable, false);
  const rows = f.writes[0].rows, pd = rows.find(r => r.table === "pd_facts").row, sales = rows.find(r => r.table === "cpd_product_sales_facts").row;
  assert.equal(pd.impression, "9007199254740993"); assert.equal(pd.spend_value, "1.234567"); assert.equal(pd.purchase, "2.5"); assert.equal(pd.purchase_value, "12.250000000000000001");
  assert.equal(pd.checkout, null); assert.equal(pd.observation_state.checkout, "missing"); assert.equal(pd.target_currency, null); assert.equal(pd.fx_state, "missing");
  assert.equal(sales.sales_quantity, "2"); assert.equal(sales.sales_value, "12.5"); assert.equal(sales.sales_role, "Advertised");
  assert.ok(result.auxiliary.includes("cart_data_product_sales_daily"));
  assert.equal(pd.provenance.source_context.snapshot.currency, "USD");
  assert.ok(f.queries.every(q => !/handoff_state\s*=|complete.*refresh|token|grant/i.test(q)));
});

test("Meta preserves exact PD and product performance, while holding the unproved conversion-field sales interpretation", async () => {
  const f = await datasetSourceBindingFixture("meta"), r = await bindStoredDatasetSources(f);
  assert.equal(r.status, "partially_stored"); assert.equal(r.rowsStored, 2); assert.ok(r.holds.some(h => h.reason === "meta_sales_semantics_unproven"));
  assert.equal(f.writes[0].rows.find(x => x.table === "pd_facts").row.ad_click, "4");
  assert.equal(f.writes[0].rows.find(x => x.table === "pd_facts").row.spend_value, "1.234567890123456789");
  assert.equal(f.writes[0].rows.some(x => x.table === "cpd_product_sales_facts"), false);
});

test("Klaviyo composes only matching native message/variation/medium fragments and keeps Ordered Product separate", async () => {
  const f = await datasetSourceBindingFixture("klaviyo"), r = await bindStoredDatasetSources(f);
  assert.equal(r.status, "stored"); assert.equal(r.rowsStored, 2);
  const pd = f.writes[0].rows.find(x => x.table === "pd_facts").row, sale = f.writes[0].rows.find(x => x.table === "cpd_product_sales_facts").row;
  assert.equal(pd.impression, "9007199254740993"); assert.equal(pd.purchase_value, "12.500000000000000001");
  assert.equal(pd.spend_value, null); assert.equal(pd.metric_support.spend_value, "unsupported");
  assert.equal(sale.provider_event_id, "event-1"); assert.equal(sale.sales_quantity, "2.5"); assert.equal(sale.sales_role, "Assisted"); assert.equal(sale.channel_id, "message-1");
  assert.equal(f.writes[0].rows.some(x => x.table === "cpd_product_performance_facts"), false);
});

test("Klaviyo daily purchase reports preserve message metrics and Ordered Product sales", async () => {
  const f = await datasetSourceBindingFixture("klaviyo", {klaviyoDailyPurchaseOnly: true, missingMetric: true});
  const result = await bindStoredDatasetSources(f);
  assert.equal(result.status, "stored");
  assert.equal(result.rowsStored, 2);
  const performance = f.writes[0].rows.find(row => row.table === "pd_facts").row;
  const sale = f.writes[0].rows.find(row => row.table === "cpd_product_sales_facts").row;
  assert.equal(performance.root_entity_id, "campaign-1");
  assert.equal(performance.entity_id, "message-1");
  assert.equal(performance.impression, "9007199254740993");
  assert.equal(performance.ad_click, "4");
  assert.equal(performance.purchase, "2.5");
  assert.equal(performance.purchase_value, "12.500000000000000001");
  for (const field of ["add_to_cart", "add_to_cart_value", "checkout", "checkout_value"]) assert.equal(performance[field], null);
  assert.equal(sale.native_sold_product_id, "product-1");
  assert.equal(sale.sales_quantity, "2.5");
  assert.equal(sale.sales_value, "12.500000000000000001");
  assert.equal(sale.channel_id, "message-1");
});

test("Klaviyo keeps unrelated native metrics as evidence without using them as Shopify sales", async () => {
  const f = await datasetSourceBindingFixture("klaviyo", {mixedMetrics: true}), r = await bindStoredDatasetSources(f);
  assert.equal(r.status, "stored"); assert.equal(r.rowsStored, 2);
  const sale = f.writes[0].rows.find(x => x.table === "cpd_product_sales_facts").row;
  assert.equal(sale.product_context.metric_id, "product");
});

test("Klaviyo reads only complete ordered package groups and blocks legacy report writes", async () => {
  const f=await datasetSourceBindingFixture("klaviyo");
  const input=f.batches.at(-1),original=f.envelopes.get(input.attemptId);
  const clocks={observedAt:"2026-11-02T00:00:00.000Z",completedAt:"2026-11-02T00:01:00.000Z"};
  for(const envelope of f.envelopes.values()) Object.assign(envelope.receipt.manifest.klaviyoDatasetRead,clocks);
  const read={...original.receipt.manifest.klaviyoDatasetRead,packageCount:2};
  const seed=sourceStoreFixture().input;
  const writes=prepareKlaviyoRawDatasetPackages({owner:f.owner,attemptId:input.attemptId,complete:false,
    pages:f.native.find(d=>d.dataset==="product_performance").pages,cipher:f.cipher,
    policy:seed.policy,now:seed.now,limits:{maxRows:7,maxBytes:1048576},maxPackages:2});
  assert.equal(writes.length,2);
  const parts=writes.map((write,ordinal)=>{
    const digest=sourcePayloadHash(write.body);
    return {receipt:{status:"committed",sourceState:"partial",batchId:String(300+ordinal),commitId:randomUUID(),digest,
      manifest:{counts:{pages:write.body.pages.length},klaviyoDatasetRead:read,klaviyoDatasetInputDigest:digest,
        klaviyoPackageCoverage:{pages:ordinal,events:ordinal}}},
      pages:write.body.pages.map((page,i)=>({...page,id:String(400+ordinal*10+i),available:true,expired:false,retentionPruned:false}))};
  });
  const stageParts=[];
  let published, loseCommit=false, inspected=0, finished=0;
  f.hooks.query=(sql,args)=>{
    if(sql===KLAVIYO_DAILY_STAGE_SQL) {
      const write=JSON.parse(args[1]),context=JSON.parse(args[2]),ordinal=args[4],packageCount=args[5];
      const result={status:"staged",operationId:write.operationId,ordinal,rowCount:write.rows.length,packageCount,
        digest:sourcePayloadHash({write,context})};
      stageParts[ordinal]={ordinal,rowCount:result.rowCount,digest:result.digest};
      return {rows:[{result}]};
    }
    if(sql===KLAVIYO_DAILY_PUBLISH_SQL) {
      const context=JSON.parse(args[1]);
      published={version:"klaviyo-daily-receipt-v1",operationId:args[3],status:"consumed",consumerReceipt:true,
        checkpointAdvanced:true,comparison:"matched",rowCount:2,revision:1,digest:"f".repeat(64),packages:stageParts,
        jobId:read.jobId,fence:read.fence,businessDate:context.businessDate,timeZone:context.timeZone,batchIds:context.batchIds};
      return {rows:[{result:structuredClone(published)}]};
    }
    if(sql===KLAVIYO_DAILY_INSPECT_SQL) {inspected++;return {rows:[{result:structuredClone(published)}]};}
    if(sql===KLAVIYO_DAILY_FINISH_SQL) {finished++;return {rows:[{result:args[4]===published.digest}]};}
    if(args[1]!==input.attemptId)return;
    const part=parts[args[2]];
    if(sql.includes("read_source_receipt"))return {rows:[{result:structuredClone(part.receipt)}]};
    if(sql.includes("read_source_pages"))return {rows:[{result:part.pages.filter(p=>BigInt(p.id)>BigInt(args[3])).slice(0,args[4])}]};
  };
  const batches=[...f.batches,{...input,ordinal:1}];
  const bundle=await readStoredDatasetSources({...f,batches});
  assert.equal(bundle.datasets.at(-1).receipt.sourceState,"partial");
  assert.deepEqual(bundle.datasets.at(-1).packageReceipts,parts.map(part=>part.receipt));
  const sale=projectStoredKlaviyoDataset(bundle).rows.find(x=>x.table==="cpd_product_sales_facts");
  assert.equal(sale.row.provider_event_id,"event-1");
  assert.ok(sale.row.provenance.sources.some(ref=>ref.batch_id===parts[1].receipt.batchId));
  assert.equal((await bindStoredDatasetSources({...f,batches})).status,"held");
  assert.deepEqual(f.writes,[]);
  const database={query:f.database.query,async transaction(run){
    const result=await run(f.database);if(loseCommit)throw Error("lost commit");return result;
  }};
  const scheduled={...f,batches,database,scheduled:true,expectedRevision:0,
    admittedScope:{jobId:read.jobId,fence:read.fence,from:read.window.from,to:read.window.to}};
  const completed=await reconcileStoredDatasetSources(scheduled);
  assert.equal(completed.jobCompleted,true);
  assert.deepEqual(completed.batchIds.slice(-2),parts.map(part=>part.receipt.batchId));
  assert.equal(inspected,1);assert.equal(finished,1);
  loseCommit=true;
  await assert.rejects(reconcileStoredDatasetSources(scheduled),/WRITE_UNCONFIRMED/);
  assert.equal(inspected,1);assert.equal(finished,1);
  await assert.rejects(readStoredDatasetSources(f),/PACKAGE_INCOMPLETE/);
  await assert.rejects(readStoredDatasetSources({...f,batches:[...f.batches,{...input,ordinal:2}]}),/BATCH_INPUT_INVALID/);
  parts[1].receipt.manifest.klaviyoPackageCoverage.events=2;
  await assert.rejects(readStoredDatasetSources({...f,batches}),/PACKAGE_COVERAGE_INVALID/);
});

test("Klaviyo missing metric remains unknown/partial rather than zero", async () => {
  const f = await datasetSourceBindingFixture("klaviyo", {missingMetric: true}), r = await bindStoredDatasetSources(f);
  assert.equal(r.status, "partially_stored");
  const pd = f.writes[0].rows.find(x => x.table === "pd_facts").row;
  assert.equal(pd.checkout, null); assert.equal(pd.metric_support.checkout, "unknown"); assert.equal(pd.observation_state.checkout, "unknown");
  assert.equal(pd.source_completeness, "partial");
});

for (const provider of ["google_ads", "meta", "klaviyo"]) test(`${provider}: successful empty physical families write no placeholder fact or consumer receipt`, async () => {
  const f = await datasetSourceBindingFixture(provider, {nonempty: false}), r = await bindStoredDatasetSources(f);
  assert.equal(r.status, "empty"); assert.equal(r.empty, true); assert.equal(f.writes.length, 0); assert.equal(r.consumerReceipt, false);
});

test("caller JSON cannot manufacture a verified projection observation", async () => {
  const f = await datasetSourceBindingFixture("google_ads"), proof = await readStoredDatasetSources(f);
  assert.throws(() => projectStoredGoogleDataset(structuredClone(proof)), /VERIFIED_SOURCE_REQUIRED/);
});

for (const mode of ["cipher", "hash", "expired", "extra_page", "missing_page", "wrong_schema", "context", "read_scope", "receipt_changed", "stale_owner", "cancel", "deadline"]) {
  test(`source ${mode} fails before any Dataset write`, async () => {
    const f = await datasetSourceBindingFixture("google_ads"), first = f.envelopes.get(f.batches[0].attemptId);
    if (mode === "cipher") first.pages[0].ciphertext = "00".repeat(first.pages[0].ciphertext.length / 2);
    if (mode === "hash") first.pages[0].payloadHash = "f".repeat(64);
    if (mode === "expired") first.pages[0].expired = true;
    if (mode === "wrong_schema") first.pages[0].schemaVersion = "forged";
    if (mode === "extra_page") first.pages.push({...first.pages.at(-1), id: "999999"});
    if (mode === "missing_page") first.pages.pop();
    if (mode === "context") f.source.currency = "FORGED";
    if (mode === "read_scope") f.envelopes.get(f.batches[1].attemptId).receipt.manifest.googleDatasetRead.operationId = "different";
    if (mode === "receipt_changed") {let n = 0; f.hooks.query = (sql, args) => {
      if (sql.includes("read_source_receipt") && args[1] === f.batches[0].attemptId && ++n === 2) return {rows: [{result: {...first.receipt, digest: "f".repeat(64)}}]};
    };}
    if (mode === "stale_owner") f.hooks.query = sql => {if (sql.includes("assert_source_owner")) throw Error("SYNTHETIC_OWNER_CHANGED");};
    if (mode === "cancel") f.signal = AbortSignal.abort();
    if (mode === "deadline") f.limits.deadlineAt = Date.now() - 1;
    await assert.rejects(bindStoredDatasetSources(f)); assert.equal(f.writes.length, 0);
  });
}

test("a raw first-day envelope containing pre-connection hours cannot authorize a Dataset day", async () => {
  const f = await datasetSourceBindingFixture("meta"); f.source.eligibleFromMs = Date.parse("2026-11-01T12:00:00Z");
  await assert.rejects(bindStoredDatasetSources(f), /PRE_CONNECTION_HOURS/); assert.equal(f.writes.length, 0);
});

test("lost Dataset write acknowledgement never triggers readback or a retry", async () => {
  const f = await datasetSourceBindingFixture("google_ads"); let sent = 0;
  f.hooks.query = sql => {if (sql.includes("commit_dataset_storage")) {sent++; throw Error("synthetic lost acknowledgement");}};
  await assert.rejects(bindStoredDatasetSources(f), /WRITE_UNCONFIRMED/);
  assert.equal(sent, 1); assert.equal(f.queries.some(q => q.includes("inspect_dataset_storage")), false);
});
