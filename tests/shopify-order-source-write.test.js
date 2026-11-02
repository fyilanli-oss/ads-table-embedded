import test,{after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {fixture,restoreShopifyOrderFixtureFetch} from "./helpers/shopify-order-fixture.js";
import {sourceStoreFixture} from "./fixtures/source-store-fixture.js";
import {prepareShopifyOrderSourceWrite} from "../app/lib/shopify/order-source-write.server.js";
import {createSourceEvidenceRepository,sourcePayloadHash} from "../app/lib/database/source-evidence-store.server.js";
after(restoreShopifyOrderFixtureFetch);
async function setup(mutate=()=>{}){
  const f=fixture();f.config.captureSource=true;mutate(f);
  const collection=await f.create().readEvidence(),{input}=sourceStoreFixture();
  const owner={workspaceId:collection.scope.workspace_id,installationId:collection.scope.installation_id,
    generation:String(collection.scope.installation_generation),shopId:collection.shop.id,shopDomain:collection.shop.myshopifyDomain,provider:"shopify"};
  const options={collection,owner,attemptId:randomUUID(),policy:input.policy,cipher:input.cipher,limits:{maxBytes:1000000,maxRows:1000},now:input.now};
  return {f,collection,options,prepare:()=>prepareShopifyOrderSourceWrite(options)};
}
test("genuine SDK collection binds exact parsed pages, records and consistency rereads to encrypted evidence",async()=>{
  const {prepare,options,collection,f}=await setup(),before=f.calls.length,write=prepare();
  assert.equal(f.calls.length,before);assert.equal(write.body.sourceState,"complete");
  assert.equal(write.body.orders.length,collection.orders.length);assert.equal(write.body.lines.length,collection.orders[0].lineItems.length);
  assert.deepEqual(write.body.orders[0].data,collection.orders[0].header);
  assert.equal(write.body.orders[0].data.updatedAt,"2026-10-01T12:00:00Z");
  assert.equal(write.body.orders[0].updatedAt,"2026-10-01T12:00:00.000Z");
  assert.ok(write.body.links.some(r=>r.role==="consistency"));
  const refs=new Map(write.body.references.map(r=>[r.key,r]));
  for(const row of [...write.body.orders,...write.body.lines])assert.equal(sourcePayloadHash(row.data),refs.get(row.reference).hash);
  for(const page of write.body.pages){
    assert.equal(page.captureLayer,"collector_projection");assert.equal(page.numericFidelity,"decoded_only");
    const payload=options.cipher.open({owner:write.owner,attemptId:write.attemptId,ordinal:0,page});
    assert.ok(Array.isArray(payload.records));assert.equal(JSON.stringify(payload).includes("SECRET-TOKEN"),false);
  }
  assert.throws(prepare,/SOURCE_OBSERVATION_REQUIRED/);
});
test("copies and caller-fabricated collection flags never produce a source write",async()=>{
  const {options}=await setup();
  assert.throws(()=>prepareShopifyOrderSourceWrite({...options,collection:structuredClone(options.collection)}),/OBSERVATION_INVALID/);
  assert.throws(()=>prepareShopifyOrderSourceWrite({...options,owner:{...options.owner,installationId:"43"}}),/OWNER_MISMATCH/);
});
test("collection without explicit capture cannot reconstruct missing original pages",async()=>{
  const f=fixture(),collection=await f.create().readEvidence(),{options}=await setup();
  assert.throws(()=>prepareShopifyOrderSourceWrite({...options,collection}),/SOURCE_OBSERVATION_REQUIRED/);
});
test("unavailable journey is retained as partial evidence, never zero or a verified platform claim",async()=>{
  const {prepare}=await setup(f=>{f.q.native=({family,payload})=>{if(family==="order_journey")payload.data.order.customerJourneySummary=null;};});
  const write=prepare();assert.equal(write.body.sourceState,"partial");assert.equal(write.body.journeys[0].state,"unavailable");
  assert.equal(write.body.journeys[0].complete,false);assert.equal(write.body.claims.length,0);
});
test("empty complete range retains empty parsed pages and produces no invented order",async()=>{
  const {prepare}=await setup(f=>{f.rows.headers=[];});const write=prepare();
  assert.equal(write.body.orders.length,0);assert.equal(write.body.pages.length,2);assert.equal(write.body.sourceState,"complete");
});
test("oversized source package fails without silently dropping rows or advancing a checkpoint",async()=>{
  const {options}=await setup();assert.throws(()=>prepareShopifyOrderSourceWrite({...options,limits:{maxBytes:1000,maxRows:1000}}),/BOUNDS/);
});
test("failed native read yields no accepted collection or source package",async()=>{
  const f=fixture();f.config.captureSource=true;f.q.native=({family,payload})=>{if(family==="order_lines")payload.errors=[{message:"private failure"}];};
  await assert.rejects(f.create().readEvidence(),/SHOPIFY_ORDER_COLLECTION_FAILED/);
});
test("unknown source commit is one-shot and can only be reconciled by explicit readback",async()=>{
  const {prepare,collection}=await setup(),write=prepare(),calls=[];
  const binding={rangeKey:"test",fence:"1",observedAt:new Date().toISOString(),sourceHash:"a".repeat(64),stats:collection.stats,range:collection.extractionRange};
  const repository=createSourceEvidenceRepository({async query(sql,args){calls.push({sql,args});
    if(sql.includes("commit_shopify"))throw Error("synthetic lost acknowledgement");
    return {rows:[{result:{status:"not_observed",rollbackProven:false}}]};}});
  await assert.rejects(repository.commitShopifyOrder(write,binding),/WRITE_UNCONFIRMED/);
  await assert.rejects(repository.commitShopifyOrder(write,binding),/WRITE_CAPABILITY_REQUIRED/);
  assert.equal(calls.length,1);assert.ok(calls[0].sql.includes("evidence.commit_shopify_order_source"));
  assert.deepEqual(await repository.inspect(write),{status:"not_observed",rollbackProven:false});assert.equal(calls.length,2);
});
