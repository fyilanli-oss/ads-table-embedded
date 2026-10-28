import test,{after} from "node:test";
import assert from "node:assert/strict";
import {setAbstractFetchFunc} from "@shopify/shopify-api/runtime";
import {independentOrderFixture} from "./helpers/independent-order-fixture.js";
import {restoreShopifyOrderFixtureFetch} from "./helpers/shopify-order-fixture.js";
import {isShopifyOrderCollectionObservation} from "../app/lib/shopify/order-collection.server.js";
import {reviewShopifyOrderPrewrite} from "../app/lib/shopify/order-prewrite.server.js";
after(restoreShopifyOrderFixtureFetch);
const flags=r=>{for(const k of ["authorizesActivation","resumeAuthorized","reloadFirstPageAuthorized","checkpointAdvanced","persistable","DatasetWritePerformed"])assert.equal(r[k],false);};
test("independent source uses genuine SDK/pages/permissions and SQL dispatch per request without ad account identity",async()=>{
  const h=await independentOrderFixture(),reader=h.create(),r=await reader.readEvidence();assert.equal(r.status,"collected_not_durably_committed");flags(r);
  assert.ok(isShopifyOrderCollectionObservation(r.collection));assert.equal(r.collection.orders.length,1);assert.equal(r.collection.scope.installation_id,"42");
  assert.equal(r.collection.scope.job.source,"shopify_orders");assert.equal(r.collection.scope.job.provider,undefined);assert.equal(r.collection.scope.job.account_id,undefined);
  assert.equal(h.s.requests,h.f.calls.length);assert.equal(h.s.requests,r.collection.stats.requests);assert.deepEqual(h.s.stats,r.collection.stats);
  assert.deepEqual(h.s.caps,h.options.limits);assert.equal(h.f.q.scopeReads,2);assert.equal(h.s.phase,"order_observed");
  assert.ok(h.s.requests>1,"one active-request slot can read bounded sequential pages");
  assert.equal(reviewShopifyOrderPrewrite({expected:h.owner,current:r.collection}).persistable,false);
  await assert.rejects(reader.readEvidence(),/INPUT_INVALID/);assert.throws(()=>h.create(),/INPUT_INVALID/);
});
for(const waitAt of [1,3])test(`quota wait at Admin boundary ${waitAt} never resumes/reloads and SQL count governs release`,async()=>{
  const h=await independentOrderFixture();h.f.q.waitAt=waitAt;const r=await h.create().readEvidence();assert.equal(r.status,"quota_waiting");flags(r);
  assert.equal(r.collection,null);assert.equal(r.adminRequests,waitAt-1);assert.equal(r.reservationRetained,waitAt!==1);assert.equal(h.f.calls.length,waitAt-1);assert.equal(h.s.stopCount,1);
});
test("new native billing denial stops before first Admin HTTP",async()=>{
  const h=await independentOrderFixture();h.s.current=false;h.s.beginFalse=true;
  const r=await h.create().readEvidence();assert.equal(r.status,"not_current");assert.equal(h.f.calls.length,0);flags(r);
});
test("authority and actual installation PK changes after a native page discard the entire observation",async()=>{
  for(const mode of ["current","pk"]){const h=await independentOrderFixture();h.f.q.native=()=>{if(mode==="current")h.s.current=false;else h.s.ownerId="43";};
    const r=await h.create().readEvidence();assert.equal(r.status,"needs_attention");assert.equal(r.collection,null);assert.equal(r.reservationRetained,true);assert.equal(h.f.calls.length,1);flags(r);
  }
});
for(const mode of ["beginError","dispatchError","observeError","stopError"])
 test(`unknown SQL ${mode} cannot yield reusable evidence or release`,async()=>{
   const h=await independentOrderFixture();h.s[mode]=true;if(mode==="stopError")h.f.q.throw=true;
   const r=await h.create().readEvidence();assert.equal(r.status,"needs_attention");assert.equal(r.collection,null);assert.equal(r.reservationRetained,true);flags(r);
   if(mode==="beginError")assert.equal(h.f.calls.length,0);
   if(mode==="dispatchError"){assert.equal(h.f.calls.length,0);assert.equal(r.adminRequests,1);}
 });
test("missing SDK hook never makes an unguarded physical request",async()=>{
  const h=await independentOrderFixture();setAbstractFetchFunc(globalThis.fetch);const r=await h.create().readEvidence();assert.equal(r.status,"needs_attention");assert.equal(h.f.calls.length,0);flags(r);
});
test("native permission denial and changing order version never bypass the existing collection protocol",async()=>{
  for(const mode of ["scopes","order"]){const h=await independentOrderFixture();h.f.q.native=({family,payload,scan})=>{
    if(mode==="scopes"&&family==="permission_scopes")payload.data.currentAppInstallation.accessScopes=[];
    if(mode==="order"&&family==="order_headers"&&scan===2)payload.data.orders.edges[0].node.updatedAt="2026-10-01T13:00:00Z";
   };
   const r=await h.create().readEvidence();assert.equal(r.status,"needs_attention");assert.equal(r.collection,null);assert.equal(r.reservationRetained,true);flags(r);
  }
});
test("prepared reader captures limits before any await",async()=>{
  const h=await independentOrderFixture(),reader=h.create();h.options.limits.maxRequests=1;
  assert.equal((await reader.readEvidence()).status,"collected_not_durably_committed");assert.equal(h.s.caps.maxRequests,100);
});
test("explicit request bound stops a prefix without marking it complete",async()=>{
  const h=await independentOrderFixture(),r=await h.create({limits:{...h.options.limits,maxRequests:1}}).readEvidence();
  assert.equal(r.status,"needs_attention");assert.equal(r.collection,null);assert.equal(h.f.calls.length,1);assert.equal(r.reservationRetained,true);flags(r);
});
test("timeout with a late native reply cannot record a handoff or start another request",async()=>{
  const h=await independentOrderFixture();h.f.q.delay=100;
  const r=await h.create({limits:{...h.options.limits,maxElapsedMs:250},timeoutMs:25}).readEvidence();assert.equal(r.status,"needs_attention");assert.equal(r.reservationRetained,true);
  await new Promise(resolve=>setTimeout(resolve,120));assert.equal(h.f.calls.length,1);assert.equal(h.s.stats,undefined);assert.equal(r.collection,null);flags(r);
});
test("two prepared readers cannot consume the same genuine verification twice",async()=>{
  const h=await independentOrderFixture(),first=h.create(),second=h.create(),pending=first.readEvidence();
  await assert.rejects(second.readEvidence(),/INPUT_INVALID/);assert.equal((await pending).status,"collected_not_durably_committed");
  assert.equal(h.s.sql.filter(x=>x.sql.includes("begin_shopify_order_read")).length,1);
});
for(const field of ["claim","range","checkCurrent","database","includeOrderHistory","entitlementReceipt","resolveOperation","cursor"])
 test(`caller cannot inject ${field}`,async()=>{const h=await independentOrderFixture();assert.throws(()=>h.create({[field]:true}),/INPUT_INVALID/);assert.equal(h.s.sql.length,0);});
test("forged verification and widened row/byte/page budgets fail before SQL or native HTTP",async()=>{
  const h=await independentOrderFixture();assert.throws(()=>h.create({verification:structuredClone(h.verification)}),/INPUT_INVALID/);
  for(const limits of [{...h.options.limits,maxRows:1001},{...h.options.limits,maxBytes:1000001},{...h.options.limits,pageSize:2}])assert.throws(()=>h.create({limits}),/INPUT_INVALID/);
  assert.equal(h.s.sql.length,0);assert.equal(h.f.calls.length,0);
});
