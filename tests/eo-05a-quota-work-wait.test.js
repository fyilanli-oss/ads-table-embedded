import test from "node:test";
import assert from "node:assert/strict";
import {createQuotaManagedFetch} from "../app/lib/refresh/quota-native-fetch.server.js";
import {createQuotaManagedClients} from "../app/lib/providers/quota-managed-clients.server.js";
import {refreshQuotaWait,refreshQuotaWaitBoundary} from "../app/lib/refresh/quota-work-wait.server.js";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {createQuotaRefreshEntitlementVerifier,createRefreshEntitlementVerifier} from "../app/lib/refresh/entitlement-check.server.js";
import {runRefreshChunk} from "../app/lib/refresh/chunk-worker.server.js";
import {readFileSync} from "node:fs";

const claim={workspaceId:"w",installGeneration:"1",provider:"meta",accountId:"act_1",id:"j",fence:1,
  cost:{requests:2,dbWrites:5,connections:1,rows:5,bytes:1000}};
const window={from:"2026-10-19",to:"2026-10-19"};
const limits={deadlineAt:1000,requestTimeoutMs:50,finishReserveMs:10,maxRows:5,maxBytes:1000};
const environment={SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"SYNTHETIC"};
async function waitError(guard={execute:async()=>({status:"waiting"})}) {
  const fetch=createQuotaManagedFetch({provider:"meta",guard,lane:"background",resolveOperation:async()=>"a".repeat(64),fetchFn:async()=>{throw Error("must not send");}});
  try {await fetch("https://graph.facebook.com/v24.0/act_1/insights");assert.fail();} catch(e) {return e;}
}
function worker() {
  const stops=[],waits=[];let calls=0;
  const args={claim,window,limits,now:()=>0,store:{advanceStage:async()=>true,isClaimCurrent:async()=>true,
    readAdmissionSnapshot:async()=>({state:{revision:1}}),recordStop:async x=>{stops.push(x);return {recorded:true};},
    deferQuotaWait:async x=>{waits.push(x);return true;}},
    loadAuthority:async()=>({...claim,installationVerified:true,connected:true,setupComplete:true,allowedWindow:true,connectionId:"c",connectionVersion:1}),
    verifyEntitlement:async()=>({status:"verified",receipt:{}}),isEntitlementCurrent:async()=>true,
    readPage:async()=>{calls++;return {kind:"complete",payload:{}};},validatePage:()=>({complete:true,rows:[]})};
  return {args,stops,waits,calls:()=>calls};
}
test("only private first-boundary normal waits yield job-bound single-use deferral receipts",async()=>{
  const e=await waitError(),wait=refreshQuotaWait(e,"entitlement",claim);
  assert.equal(refreshQuotaWaitBoundary(wait),"entitlement");
  assert.equal(refreshQuotaWait({status:"waiting",priorBoundaryAttempts:0},"entitlement",claim),null);
  for(const status of ["not_configured","not_sent","clock_invalid","already_reserved","stopped","needs_attention"])
    assert.equal(refreshQuotaWait(await waitError({execute:async()=>({status})}),"entitlement",claim),null);
  const queries=[],repo=createRefreshWorkRepository({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{result:true}]};}});
  await assert.rejects(repo.deferQuotaWait({claim:{...claim,fence:2},window,wait}),/INPUT_INVALID/);
  assert.equal(await repo.deferQuotaWait({claim,window,wait}),true);
  await assert.rejects(repo.deferQuotaWait({claim,window,wait}),/INPUT_INVALID/);
  assert.equal(queries.length,1);assert.equal(queries[0].args.length,9);assert.equal(queries[0].args[8],"entitlement");
  await assert.rejects(repo.deferQuotaWait({claim,window,wait:{...wait}}),/INPUT_INVALID/);
});
test("first-boundary wait closes the execution transport and pending concurrent dispatches cannot send late",async()=>{
  let enter,call=0,calls=0;
  const pending=new Promise(r=>{enter=r;});
  const fetch=createQuotaManagedFetch({provider:"meta",lane:"background",resolveOperation:async()=>"a".repeat(64),
    guard:{execute:async({run})=>{if(++call===1) return {status:"waiting"};await pending;try{return await run();}catch{return {status:"needs_attention"};}}},
    fetchFn:async()=>{calls++;return new Response("{}");}});
  const a=fetch("https://graph.facebook.com/v24.0/act_1/insights").catch(e=>e);
  const b=fetch("https://graph.facebook.com/v24.0/act_1/insights").catch(e=>e);
  assert.equal(refreshQuotaWaitBoundary(refreshQuotaWait(await a,"provider_page",claim)),"provider_page");
  enter();await b;assert.equal(calls,0);
  await assert.rejects(fetch("https://graph.facebook.com/v24.0/act_1/insights"));assert.equal(calls,0);
});
test("a previous HTTP attempt prevents automatic first-page replay even when next boundary was not sent",async()=>{
  let entries=0;
  const fetch=createQuotaManagedFetch({provider:"meta",lane:"background",resolveOperation:async()=>"a".repeat(64),
    guard:{execute:async({run})=>++entries===1?{status:"returned",value:(await run()).value}:{status:"waiting"}},
    fetchFn:async()=>new Response("{}",{headers:{"content-type":"application/json"}})});
  await fetch("https://graph.facebook.com/v24.0/act_1/insights");
  let error;try{await fetch("https://graph.facebook.com/v24.0/act_1/insights");}catch(e){error=e;}
  assert.equal(refreshQuotaWait(error,"provider_page",claim),null);
  const f=worker();f.args.readPage=async()=>{throw error;};
  assert.equal((await runRefreshChunk(f.args)).status,"uncertain");assert.equal(f.waits.length,0);
});
test("managed Shopify entitlement uses only HTTP quota, returns private wait and makes no billing projection or ad read",async()=>{
  let calls=0,writes=0,reservations=0;
  const store={loadRefreshInstallation:async()=>({workspaceId:"w",installGeneration:"1",shopId:"gid://shopify/Shop/1",shopDomain:"test.myshopify.com",status:"active",observedAt:"2026-10-20T12:00:00Z"}),
    applyEntitlementSnapshot:async()=>{writes++;},isEntitlementCurrent:async()=>true};
  const config={store,appId:environment.SHOPIFY_APP_GID,environment,now:()=>0,limits,
    guard:{execute:async()=>{reservations++;return {status:"waiting"};}},resolveOperation:async()=>"a".repeat(64),fetchFn:async()=>{calls++;}};
  const verifier=createQuotaRefreshEntitlementVerifier(config),f=worker();f.args.verifyEntitlement=c=>verifier.verify(c);
  const result=await runRefreshChunk(f.args);assert.equal(result.status,"quota_waiting");assert.equal(f.calls(),0);
  assert.equal(calls,0);assert.equal(writes,0);assert.equal(reservations,1);assert.equal(f.stops.length,0);
  assert.throws(()=>createQuotaRefreshEntitlementVerifier({...config,authorizeRead:async()=>true}),/DOUBLE_QUOTA/);
  const partnerApi=createQuotaManagedClients({...config,lane:"background"}).shopify({environment});
  assert.throws(()=>createRefreshEntitlementVerifier({...config,partnerApi,authorizeRead:async()=>true}),/INPUT_INVALID/);
});
test("first provider-page wait releases only through durable receipt; unknown DB outcomes retain reservation without retry",async()=>{
  for(const mode of ["ok","false","throw"]) {
    const f=worker(),e=await waitError();let attempts=0;
    f.args.readPage=async()=>{throw e;};f.args.store.deferQuotaWait=async({wait})=>{attempts++;assert.equal(refreshQuotaWaitBoundary(wait),"provider_page");if(mode==="throw")throw Error("PRIVATE");return mode==="ok";};
    const r=await runRefreshChunk(f.args);assert.equal(r.status,mode==="ok"?"quota_waiting":"needs_attention");
    if(mode!=="throw") {assert.equal(r.waitingBoundary,"provider_page");assert.equal(r.externalOutcome,"settled");assert.equal(r.boundaryExternalOutcome,"not_sent");}
    assert.equal(r.reservationRetained,mode!=="ok");assert.equal(attempts,1);assert.equal(f.stops.length,0);assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  }
  const f=worker();f.args.verifyEntitlement=async()=>({status:"quota_waiting",externalOutcome:"not_sent"});
  assert.equal((await runRefreshChunk(f.args)).status,"paused");assert.equal(f.waits.length,0);
});
test("delivery preserves private access, exact native binding and no live or Dataset authority",()=>{
  const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
  const c=JSON.parse(read("contracts/eo-05a-quota-work-wait-v1.json")),sql=read(c.migration);
  for(const key of ["live_apply_authorized","live_activation","existing_production_routes_changed","new_secret_or_service","Dataset_write","Dataset_or_product_decision","hourly_data_scope_selected","listing_tree_resumed"]) assert.equal(c[key],false);
  assert.match(sql,/force row level security/);assert.match(sql,/wait.state='waiting' and b.source=base_source and b.from_date=start_day and b.to_date=end_day and b.partition_id=p_partition/);
  assert.match(sql,/stage='request_intent'/);assert.match(sql,/state<>'resolved'/);
  assert.doesNotMatch(sql,/cron\.schedule|pg_net|grant .* to adstable_runtime|delete from|update operations.api_quota_debits/);
  const manifest=JSON.parse(read("contracts/a6-tech-01-f01-migration-lineage-v1.json"));
  assert.equal(manifest.pending_migrations.find(m=>m.file===c.migration).applied,false);
});
