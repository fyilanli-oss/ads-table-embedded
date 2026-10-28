import test,{after} from "node:test";
import assert from "node:assert/strict";
import {createShopifyOrderRangePlanner} from "../app/lib/refresh/shopify-order-range-plan.server.js";
import {createShopifyOrderQueueAdmission} from "../app/lib/refresh/shopify-order-queue-admission.server.js";
import {fixture,prewriteOwner,restoreShopifyOrderFixtureFetch} from "./helpers/shopify-order-fixture.js";
after(restoreShopifyOrderFixtureFetch);
const context=(provider,a,b)=>({provider,clientScopeKey:a.repeat(64),connectionScopeKey:b.repeat(64),connectionEpoch:1,
  accountId:provider==="shopify_admin"?"test.myshopify.com":null,organizationId:provider==="shopify_partner"?"123":null,apiVersion:"2026-10"});
const readiness=()=>({status:"ready",revision:0,configurationEpoch:2,contexts:{
  shopify_admin:context("shopify_admin","a","b"),shopify_partner:context("shopify_partner","c","d")}});
async function setup(){
  const f=fixture(),plan=await createShopifyOrderRangePlanner({expected:prewriteOwner(),database:f.config.database,
    policy:{anchorAt:"2026-10-01T00:00:00Z",cadenceMs:3600000,sliceMs:86400000,settleDelayMs:0,maxRanges:2,pageSize:100,includeOrderHistory:false},
    now:()=>new Date("2026-10-02T00:00:00Z")}).plan({fromInclusive:"2026-10-01T00:00:00Z"});
  const state={ready:readiness(),writes:0,reads:0,routes:[],queries:[],missingRoute:0,lost:false,stored:null};
  const input={plan,rangeKey:plan.ranges[0].key};
  const database={async query(sql,args){
    state.queries.push({sql,args});
    if(sql.includes("read_shopify_order_queue_admission")){if(state.readError)throw Error("private");return {rows:[{result:state.ready}]};}
    if(sql.includes("enqueue_shopify_order_range")){
      state.writes++;state.args=args;
      state.stored={rangeKey:args[5],recordStatus:"queued",version:1,fromInclusive:args[6],toExclusive:args[7]};
      if(state.lost)throw Error("secret transport detail");
      return {rows:[{result:state.result??{status:"queued",recordStatus:"queued",version:1,rangeKey:args[5]}}]};
    }
    if(sql.includes("read_shopify_order_pending_range")){state.reads++;if(state.readError)throw Error("private");return {rows:[{result:state.stored}]};}
    throw Error("unexpected query");
  }};
  const quotaStore={async resolveRoute(route){state.routes.push(route);state.onResolve?.(route);return state.routes.length===state.missingRoute?null:route.routeKey;},
    reserve(){assert.fail("queue cannot reserve quota");},settle(){assert.fail("queue cannot settle quota");}};
  return {f,state,input,database,quotaStore,queue:createShopifyOrderQueueAdmission({database,quotaStore})};
}
const noAuthority=r=>{for(const k of ["workerAdmitted","quotaReserved","authorizesDispatch","authorizesActivation","checkpointAdvanced","persistable","DatasetWritePerformed"])assert.equal(r[k],false,k);};
test("genuine installation plan binds five reviewed routes and parameterized metadata only",async()=>{
  const h=await setup(),r=await h.queue.enqueue(h.input);assert.equal(r.status,"queued");noAuthority(r);
  assert.equal(h.state.writes,1);assert.equal(h.state.reads,0);assert.equal(h.f.calls.length,0);
  assert.deepEqual(h.state.routes.map(x=>x.family),["partner_graphql","permission_scopes","order_headers","order_lines","order_journey"]);
  assert.equal(h.state.args.length,14);assert.deepEqual(h.state.args.slice(0,5),["42",prewriteOwner().workspaceId,3,prewriteOwner().shopId,"test.myshopify.com"]);
  assert.equal(h.state.args[5],h.input.rangeKey);assert.equal(h.state.args[9],100);
  assert.deepEqual(JSON.parse(h.state.args[12]),h.state.ready.contexts);assert.equal(JSON.parse(h.state.args[13]).length,5);
  assert.ok(Object.isFrozen(r));
});
for(const status of ["not_configured","not_current","quota_configuration_required"])
  test(`readiness ${status} causes no route lookup or write`,async()=>{
    const h=await setup();h.state.ready={status};const r=await h.queue.enqueue(h.input);assert.equal(r.status,status);noAuthority(r);assert.equal(h.state.writes,0);assert.equal(h.state.routes.length,0);
  });
for(const missingRoute of [1,3,5])test(`missing reviewed quota route ${missingRoute} stops before SQL mutation`,async()=>{
  const h=await setup();h.state.missingRoute=missingRoute;const r=await h.queue.enqueue(h.input);assert.equal(r.status,"quota_configuration_required");assert.equal(h.state.writes,0);assert.equal(h.state.routes.length,missingRoute);noAuthority(r);
});
for(const status of ["not_configured","not_current","quota_configuration_required","conflict","record_conflict","queue_full"])
  test(`atomic SQL ${status} is preserved without retry`,async()=>{
    const h=await setup();h.state.result={status};const r=await h.queue.enqueue(h.input);assert.equal(r.status,status);assert.equal(h.state.writes,1);assert.equal(h.state.reads,0);noAuthority(r);
  });
test("response loss is unknown; explicit read observes metadata without authorizing continuation",async()=>{
  const h=await setup();h.state.lost=true;const r=await h.queue.enqueue(h.input);assert.equal(r.status,"needs_attention");assert.equal(r.reason,"queue_write_unconfirmed");assert.equal(r.queueWriteMayHaveCommitted,true);noAuthority(r);
  assert.equal(h.state.writes,1);assert.equal(h.state.reads,0);assert.doesNotMatch(JSON.stringify(r),/secret|transport/);
  const read=await h.queue.readPending(h.input);assert.equal(read.status,"observed");noAuthority(read);assert.equal(h.state.writes,1);assert.equal(h.state.reads,1);
});
test("absent explicit read is not a successful write or rollback receipt",async()=>{
  const h=await setup(),r=await h.queue.readPending(h.input);assert.equal(r.status,"not_observed");assert.equal(r.metadataRecorded,undefined);noAuthority(r);assert.equal(h.state.writes,0);
});
test("cancelled existing metadata never becomes dispatch permission",async()=>{
  const h=await setup();h.state.result={status:"already_recorded",recordStatus:"cancelled",version:2,rangeKey:h.input.rangeKey};
  const r=await h.queue.enqueue(h.input);assert.equal(r.status,"already_recorded");assert.equal(r.recordStatus,"cancelled");noAuthority(r);
});
for(const key of ["range","cursor","provider","accountId","fence","entitlementReceipt","revision","contexts","persisted"])
  test(`caller cannot inject ${key}`,async()=>{
    const h=await setup();await assert.rejects(h.queue.enqueue({...h.input,[key]:"invented"}),/INPUT_INVALID/);await assert.rejects(h.queue.readPending({...h.input,[key]:"invented"}),/INPUT_INVALID/);assert.equal(h.state.queries.length,0);
  });
test("serialized plan and another range key fail before IO",async()=>{
  const h=await setup();for(const input of [{...h.input,plan:structuredClone(h.input.plan)},{...h.input,rangeKey:"a".repeat(64)}])await assert.rejects(h.queue.enqueue(input),/PROVENANCE_REQUIRED/);
  assert.equal(h.state.queries.length,0);
});
test("quota contexts are captured before asynchronous route resolution",async()=>{
  const h=await setup(),before=structuredClone(h.state.ready.contexts);h.state.onResolve=()=>{h.state.ready.contexts.shopify_admin.connectionEpoch=999;};
  assert.equal((await h.queue.enqueue(h.input)).status,"queued");assert.deepEqual(JSON.parse(h.state.args[12]),before);
});
for(const mode of ["readError","badRevision","extraContext","wrongProvider","badSuccess"])
  test(`invalid readiness or result fails closed ${mode}`,async()=>{
    const h=await setup();if(mode==="readError")h.state.readError=true;
    if(mode==="badRevision")h.state.ready.revision="0";
    if(mode==="extraContext")h.state.ready.contexts.meta={};
    if(mode==="wrongProvider")h.state.ready.contexts.shopify_admin.provider="meta";
    if(mode==="badSuccess")h.state.result={status:"queued",rangeKey:h.input.rangeKey,version:"1",recordStatus:"queued"};
    const r=await h.queue.enqueue(h.input);assert.equal(r.status,"needs_attention");assert.equal(h.state.writes,mode==="badSuccess"?1:0);noAuthority(r);
  });
test("explicit read rejects malformed or foreign metadata",async()=>{
  const h=await setup();h.state.stored={rangeKey:h.input.rangeKey,version:1,recordStatus:"queued",fromInclusive:"foreign",toExclusive:"foreign"};
  assert.equal((await h.queue.readPending(h.input)).status,"needs_attention");assert.equal(h.state.writes,0);
});
