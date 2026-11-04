import assert from "node:assert/strict";
import test from "node:test";
import {googleRawServerFixture} from "./fixtures/google-raw-server-fixture.js";
import {createGoogleRawCaptureExecution,readGoogleRawCapturePlan} from "../app/lib/refresh/google-raw-server.server.js";
import {isGoogleBackgroundOwner,loadGoogleBackgroundOwner} from "../app/lib/refresh/google-background-owner.server.js";
import {createIdentityRuntimeAuthorityLoader} from "../app/lib/providers/identity-runtime-authority.server.js";

test("runtime timeout is transaction-local and a lost commit stops without retry or native HTTP",async()=>{
 const x=googleRawServerFixture();
 x.hooks.runtime=sql=>{if(sql==="commit")throw Error("SYNTHETIC-LOST-COMMIT");};
 const e=createGoogleRawCaptureExecution(x.options),r=await e.run();await e.close();
 assert.notEqual(r.status,"stored");assert.equal(x.f.http.length,0);
 const calls=x.calls.filter(c=>c.role==="runtime");
 assert.equal(calls.filter(c=>c.sql==="begin").length,1);
 const timeout=calls.find(c=>c.sql.startsWith("select pg_catalog.set_config"));
 assert.deepEqual(timeout.args,["5000ms"]);assert.match(timeout.sql,/statement_timeout.*true.*lock_timeout.*true/);
 assert.equal(calls.filter(c=>c.sql==="commit").length,1);
 assert.equal(calls.filter(c=>c.sql==="rollback").length,1);
});

for(const nonempty of [false,true])test("browser-free single capture persists "+(nonempty?"a native product":"a successful empty response")+" and verifies its receipt",async()=>{
 const x=googleRawServerFixture();
 if(nonempty)x.hooks.fetch=u=>u.hostname==="merchantapi.googleapis.com"?Response.json({products:[{name:"accounts/99/products/en~US~sku",offerId:"sku",feedLabel:"US",contentLanguage:"en",dataSource:"accounts/99/dataSources/7"}]}):undefined;
 const e=createGoogleRawCaptureExecution(x.options),r=await e.run();
 assert.equal(r.status,"stored",JSON.stringify({r,calls:x.calls.map(x=>x.sql),http:x.f.http.map(x=>x.hostname)}));
 assert.equal(r.recordCount,nonempty?1:0);assert.equal(r.receiptVerified,true);assert.equal(r.sourceStored,true);
 assert.equal(r.DatasetWritePerformed,false);assert.equal(r.mappingVerified,false);assert.equal(r.hourlyRefreshActivated,false);
 assert.equal(x.f.state.paused,1);assert.ok(x.body.pages.length>=3);
 assert.equal(x.body.rules.length,0);assert.ok(x.body.mappings.every(m=>m.state==="unresolved"&&m.productId===null));
 assert.ok(x.body.pages.every(p=>p.payload===undefined));assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|access_token|refresh_token|ciphertext|credentialId/);
 await assert.rejects(e.run(),/EXECUTION_USED/);await e.close();
 assert.ok(x.f.http.every(u=>u.hostname!=="test.myshopify.com"),"no Shopify Admin/product or browser request");
});

test("expired credential is renewed inside the same headless job before source capture",async()=>{
 const x=googleRawServerFixture();x.expire();const e=createGoogleRawCaptureExecution(x.options),r=await e.run();
 assert.equal(r.status,"stored",JSON.stringify({r,calls:x.calls.map(c=>c.sql)}));
 assert.equal(x.calls.filter(c=>c.sql.includes("commit_google_refresh_renewal")).length,1);
 assert.equal(x.f.http.filter(u=>u.hostname==="oauth2.googleapis.com").length,1);
});

test("background owner cannot be supplied as JSON or reused for Meta authority",async()=>{
 const owner={workspaceId:"11111111-1111-4111-8111-111111111111",installGeneration:1,shopId:"gid://shopify/Shop/12",shopDomain:"test.myshopify.com"};
 const v=await loadGoogleBackgroundOwner({owner,database:{query:async()=>({rows:[{installation_id:"42",workspace_id:owner.workspaceId,install_generation:1,shop_id:owner.shopId,shop_domain:owner.shopDomain,installation_status:"active"}]})}});
 assert.equal(isGoogleBackgroundOwner(v),true);assert.equal(isGoogleBackgroundOwner(JSON.parse(JSON.stringify(v))),false);
 assert.equal(isGoogleBackgroundOwner({...v,identity:{...v.identity,shop:{...v.identity.shop,shopId:"gid://shopify/Shop/99"}}}),false);
 assert.throws(()=>createIdentityRuntimeAuthorityLoader({verified:v,provider:"meta",database:{query(){}},tokenVault:{loadProviderTokenSet(){}}}),/VERIFIED_CALLER/);
});

for(const mode of ["disabled","expired_plan","extra_plan","wrong_operation","missing_source_key","too_many_bytes","unknown_policy","product_pagination","link_pagination"])
 test("invalid headless configuration performs no I/O: "+mode,()=>{
 const x=googleRawServerFixture();let options=x.options;
 if(mode==="disabled")x.environment.ADSTABLE_GOOGLE_RAW_CAPTURE_ENABLED="false";
 if(mode==="expired_plan")x.plan.target.expiresAt=new Date(x.options.now()-1).toISOString();
 if(mode==="extra_plan")x.plan.verified={};
 if(mode==="wrong_operation")options={...options,operationId:"11111111-1111-4111-8111-111111111111"};
 if(mode==="missing_source_key")delete x.environment.ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1;
 if(mode==="too_many_bytes")x.plan.limits.maxBytes=1048577;
 if(mode==="unknown_policy")delete x.plan.sourcePolicy.raw;
 if(mode==="product_pagination")x.plan.limits.maxPages=2;
 if(mode==="link_pagination")x.plan.limits.maxLinkPages=2;
 x.setPlan();assert.throws(()=>createGoogleRawCaptureExecution(options));assert.equal(x.calls.length,0);assert.equal(x.f.http.length,0);
 if(mode==="disabled")assert.equal(readGoogleRawCapturePlan(x.environment),null);
});

for(const mode of ["owner_missing","identity_drift","config_missing","missing_merchant","permission","partial","oversize","lost_source","readback_missing","lost_admission","lost_finish","abort"])
 test("raw capture stops without fabricated zero or replay: "+mode,async()=>{
 const x=googleRawServerFixture(),controller=new AbortController();x.options.signal=controller.signal;
 if(mode==="owner_missing")x.hooks.runtime=sql=>sql.includes("load_active_installation_owner")?{rows:[]}:undefined;
 if(mode==="identity_drift")x.f.authority.connectionVersion++;
 if(mode==="config_missing")x.f.state.configured=false;
 if(mode==="missing_merchant")delete x.f.f.context.merchant;
 if(mode==="permission")x.hooks.fetch=u=>u.hostname==="merchantapi.googleapis.com"?Response.json({error:{message:"SYNTHETIC-PRIVATE"}},{status:403}):undefined;
 if(mode==="partial")x.hooks.fetch=u=>u.hostname==="merchantapi.googleapis.com"?Response.json({products:[],nextPageToken:"more"}):undefined;
 if(mode==="oversize"){x.plan.limits.maxBytes=8;x.setPlan();}
 if(mode==="lost_source")x.hooks.source=sql=>{if(sql.includes("commit_google_identity_source"))throw Error("SYNTHETIC-PRIVATE-LOST");};
 if(mode==="readback_missing")x.hooks.source=sql=>sql.includes("read_source_receipt")?{rows:[{result:{status:"not_observed",rollbackProven:false}}]}:undefined;
 if(["lost_admission","lost_finish"].includes(mode))x.f.hooks.sql=sql=>{if(sql.includes(mode==="lost_finish"?"finish_refresh_work":"commit_refresh_preflight_with_deadline"))throw Error("SYNTHETIC-PRIVATE-LOST");};
 if(mode==="abort")x.hooks.runtime=sql=>{if(sql.includes("load_active_installation_owner"))controller.abort();};
 const r=await createGoogleRawCaptureExecution(x.options).run();assert.notEqual(r.status,"stored",JSON.stringify(r));
 assert.equal(r.recordCount,null);assert.equal(r.empty,null);assert.equal(r.DatasetWritePerformed,false);
 assert.ok(x.calls.filter(c=>c.sql.includes("commit_google_identity_source")).length<=1);
 if(mode==="lost_source"){
  assert.equal(r.sourceStored,null);
  assert.equal(x.calls.filter(c=>c.sql.includes("read_source_receipt")).length,0,"unknown write must not trigger automatic inspection");
 }
 if(mode==="readback_missing"){assert.equal(r.sourceStored,true);assert.equal(r.receiptVerified,false);}
 if(["owner_missing","identity_drift","config_missing","lost_admission","abort"].includes(mode))assert.equal(x.f.http.length,0);
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|ciphertext|access_token|refresh_token/);
});
