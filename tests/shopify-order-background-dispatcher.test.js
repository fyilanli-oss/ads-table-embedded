import assert from "node:assert/strict";
import test from "node:test";
import {Session} from "@shopify/shopify-api";
import {createSessionEnvelopeCipher} from "../app/lib/shopify/session-envelope.server.js";
import {shopifyOrderEntitlementBinding} from "../app/lib/refresh/shopify-order-entitlement.server.js";
import {createShopifyOrderWorkReservations} from "../app/lib/refresh/shopify-order-work-reservation.server.js";
import {createShopifyOrderBackgroundDispatcher} from "../app/lib/refresh/shopify-order-background-dispatcher.server.js";
import {isShopifyOrderCollectionObservation} from "../app/lib/shopify/order-collection.server.js";
import {independentOrderFixture} from "./helpers/independent-order-fixture.js";

async function fixture(){
  const x=await independentOrderFixture(),bound=shopifyOrderEntitlementBinding(x.entitlementCheck).peek(x.verification);
  const s=Object.assign(x.s,{next:[],sessions:[],http:[],queue:[0],token:"SECRET-TOKEN",expires:undefined});
  const {provider,...owner}=x.plan.owner;
  const proposal={owner,key:x.plan.ranges[0].key,range:x.plan.ranges[0].range,includeOrderHistory:false,pageSize:1};
  const database={async query(sql,args){
    if(sql.includes("reserve_next_shopify_order_work")){
      s.next.push(args);if(s.nextFailure)throw Error("SECRET SQL DETAIL");
      if(!s.queue.length)return {rows:[{result:{status:"empty"}}]};
      s.queue.shift();x.s.phase="pre_request";x.s.requests=0;
      const r=await bound.database.query("reserve_shopify_order_work",[owner.installationId,owner.workspaceId,owner.installGeneration,owner.shopId,owner.shopDomain,proposal.key,args[0]]);
      r.rows[0].result.proposal=structuredClone(proposal);s.onProposal?.(r.rows[0].result);return r;
    }
    if(sql.includes("stop_shopify_order_entitlement"))return {rows:[{result:{recorded:true,reservationRetained:args[8]!=="entitlement_denied"}}]};
    return bound.database.query(sql,args);
  }};
  const cipher=createSessionEnvelopeCipher({key:Buffer.alloc(32,7)});
  const sessionDatabase={async query(sql,args){
    s.sessions.push({sql,args});assert.match(sql,/select \* from shopify.load_runtime_session/);
    s.onSession?.();if(s.missing)return {rows:[]};if(s.sessionError)throw Error("SECRET KEY DETAIL");
    const session=new Session({id:args[0],shop:s.shop??owner.shopDomain,state:"synthetic",isOnline:s.online??false,
      accessToken:s.token,scope:"read_orders,read_products",expires:s.expires});
    const e=cipher.encrypt(session);
    return {rows:[{session_id:e.sessionId,shop_domain:e.shopDomain,payload_ciphertext:e.payloadCiphertext,nonce:e.nonce,auth_tag:e.authTag,key_version:e.keyVersion,expires_at:e.expiresAt}]};
  }};
  const options={database,sessionDatabase,quotaStore:x.options.quotaStore,sdkBridge:x.options.sdkBridge,now:Date.now,
    environment:{SHOPIFY_API_KEY:"a".repeat(32),SHOPIFY_API_SECRET:"b".repeat(32),SHOPIFY_APP_URL:"https://embedded.adstable.app",
      ADSTABLE_SESSION_ENCRYPTION_KEY_V1:Buffer.alloc(32,7).toString("base64url"),SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"synthetic"},
    limits:{maxJobs:3,maxCandidates:10,maxElapsedMs:20000,jobTimeoutMs:15000,requestTimeoutMs:1000,finishReserveMs:10,collection:x.options.limits},
    fetchFn:async(input,init)=>{
      const url=new URL(input);s.http.push(url.hostname);s.onHTTP?.();
      if(url.hostname==="partners.shopify.com")return Response.json({data:{activeSubscription:s.denied?null:{shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},
        billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,trialEndsAt:null,currentBillingCycle:{startTime:new Date(Date.now()-10000).toISOString(),endTime:new Date(Date.now()+86400000).toISOString()},
        items:[{handle:"monthly",price:{active:false}}],pendingUpdate:null}}});
      if(s.nativeError)throw Error("SECRET PROVIDER DETAIL");
      assert.equal(init.headers.get("X-Shopify-Access-Token"),"SECRET-TOKEN");
      return x.options.fetchFn(input,init);
    }};
  return {...x,s,options,proposal,work:()=>createShopifyOrderWorkReservations({database}),create:extra=>createShopifyOrderBackgroundDispatcher({...options,...extra})};
}

test("background batch binds SQL queue owner, fresh Partner receipt, encrypted offline session and actual SDK collection",async()=>{
  const f=await fixture(),result=await f.create().runBatch();
  assert.equal(result.status,"empty");assert.ok(isShopifyOrderCollectionObservation(result.results[0].collection));
  assert.equal(result.results[0].collection.scope.installation_id,f.owner.installationId);
  assert.equal(f.s.http[0],"partners.shopify.com");assert.ok(f.s.http.slice(1).every(v=>v===f.owner.shopDomain));
  assert.ok(f.s.sessions.length>2);assert.equal(f.s.next.length,2);assert.deepEqual(f.s.next[1][2],[f.owner.workspaceId]);
  for(const k of ["checkpointAdvanced","DatasetWritePerformed","resumeAuthorized","persistable","authorizesActivation"])assert.equal(result[k],false);
  assert.equal(f.s.phase,"order_observed");
});
for(const mode of ["missing","online","expired","other_shop","decrypt_failed"]){
  test(`offline session ${mode} stops without Admin HTTP or renewal`,async()=>{
    const f=await fixture();
    if(mode==="missing")f.s.missing=true;if(mode==="online")f.s.online=true;
    if(mode==="expired")f.s.expires=new Date(Date.now()-1000);
    if(mode==="other_shop")f.s.shop="other.myshopify.com";
    if(mode==="decrypt_failed")f.s.sessionError=true;
    const result=await f.create().runBatch();assert.equal(result.status,"needs_attention");
    assert.equal(result.results[0].reservationRetained,true);assert.deepEqual(f.s.http,["partners.shopify.com"]);
    assert.equal(f.s.next.length,1);assert.doesNotMatch(JSON.stringify(result),/SECRET/);
  });
}
test("session rotation between pages discards the collection without switching tokens or retrying",async()=>{
  const f=await fixture();f.s.onSession=()=>{if(f.f.calls.length>0)f.s.token="ROTATED";};
  const r=await f.create().runBatch();assert.equal(r.status,"needs_attention");assert.equal(r.results[0].collection,null);
  assert.equal(f.f.calls.length,1);assert.equal(f.s.next.length,1);
});
test("native error stops the whole batch without trying another shop or automatic auth recovery",async()=>{
  const f=await fixture();f.s.queue.push(1);f.s.nativeError=true;
  const r=await f.create().runBatch();assert.equal(r.status,"needs_attention");assert.equal(f.s.next.length,1);
  assert.equal(f.s.http.length,2);assert.equal(r.results[0].reservationRetained,true);assert.doesNotMatch(JSON.stringify(r),/SECRET/);
});
test("denied entitlement does not read a session or open the Admin API",async()=>{
  const f=await fixture();f.s.denied=true;const r=await f.create().runBatch();
  assert.equal(r.status,"denied");assert.equal(f.s.sessions.length,0);assert.deepEqual(f.s.http,["partners.shopify.com"]);
});
test("unknown reservation response ends batch without a session or physical HTTP",async()=>{
  const f=await fixture();f.s.nextFailure=true;const r=await f.create().runBatch();
  assert.equal(r.status,"needs_attention");assert.equal(f.s.http.length,0);assert.equal(f.s.sessions.length,0);assert.equal(f.s.next.length,1);
});
test("collection limits outside actual SQL reservation release only before any Partner or Admin request",async()=>{
  const f=await fixture();const r=await f.create({limits:{...f.options.limits,collection:{...f.options.limits.collection,maxRows:1001}}}).runBatch();
  assert.equal(r.status,"configuration_required");assert.equal(r.results[0].status,"released");assert.equal(f.s.http.length,0);assert.equal(f.s.sessions.length,0);
});
test("invalid SQL proposal is never promoted to a genuine reservation",async()=>{
  const f=await fixture();f.s.onProposal=r=>{r.proposal.key="0".repeat(64);};
  const r=await f.create().runBatch();assert.equal(r.status,"needs_attention");assert.equal(f.s.http.length,0);
});
test("closed or already aborted dispatcher performs no reservation or session read",async()=>{
  const f=await fixture(),closed=f.create();closed.close();await assert.rejects(closed.runBatch(),/INPUT_INVALID/);
  const ac=new AbortController();ac.abort();const r=await f.create({signal:ac.signal}).runBatch();
  assert.equal(r.status,"stopped");assert.equal(f.s.next.length,0);assert.equal(f.s.sessions.length,0);
});
test("shutdown during Partner request cannot apply a late entitlement or open Admin",async()=>{
  const f=await fixture(),ac=new AbortController();f.s.onHTTP=()=>ac.abort();
  const r=await f.create({signal:ac.signal}).runBatch();assert.equal(r.results[0].entitlementVerified,false);
  assert.equal(f.s.sessions.length,0);assert.equal(f.s.http.length,1);
});
test("owner invalidation during offline session read stops before Admin",async()=>{
  const f=await fixture();f.s.onSession=()=>{f.s.current=false;};
  const r=await f.create().runBatch();assert.equal(r.status,"needs_attention");assert.equal(f.s.http.length,1);
});
test("concurrent batch invocation is rejected while the first remains bounded",async()=>{
  const f=await fixture();let unblock;const barrier=new Promise(r=>{unblock=r;});
  const query=f.options.database.query;f.options.database.query=async(sql,args)=>{if(sql.includes("reserve_next"))await barrier;return query(sql,args);};
  const d=f.create(),first=d.runBatch();await assert.rejects(d.runBatch(),/INPUT_INVALID/);unblock();await first;
});
test("clock regression and exhausted batch time never select new work",async()=>{
  const f=await fixture();let count=0;const d=f.create({now:()=>++count===1?10000:9999});
  assert.equal((await d.runBatch()).status,"stopped");assert.equal(f.s.next.length,0);
});
test("batch/job limits and caller-selected session/owner overrides are rejected before SQL",async()=>{
  const f=await fixture();
  for(const extra of [{owner:f.owner},{session:{}},{admin:{}},{database:null},{sdkBridge:{}},{limits:{...f.options.limits,maxJobs:101}},
    {limits:{...f.options.limits,requestTimeoutMs:15000}},{limits:{...f.options.limits,collection:{...f.options.limits.collection,maxRequests:0}}}])assert.throws(()=>f.create(extra));
  const d=f.create();await assert.rejects(d.runBatch({shop:f.owner.shopDomain}),/INPUT_INVALID/);assert.equal(f.s.next.length,0);
});
test("reserveNext bounds scans and workspace exclusions without exposing raw queue selection",async()=>{
  const f=await fixture(),w=f.work();
  for(const input of [{maxCandidates:0},{maxCandidates:101},{maxCandidates:1,excludeWorkspaceIds:["bad"]},
    {maxCandidates:1,excludeWorkspaceIds:[f.owner.workspaceId,f.owner.workspaceId]},{maxCandidates:1,owner:f.owner}])await assert.rejects(w.reserveNext(input),/INPUT_INVALID/);
  const reservation=await w.reserveNext({maxCandidates:1});assert.equal(reservation.status,"reserved");
  assert.equal((await w.releaseBeforeRequest({reservation})).status,"released");
  await assert.rejects(w.releaseBeforeRequest({reservation:{...reservation}}),/INPUT_INVALID/);
});
