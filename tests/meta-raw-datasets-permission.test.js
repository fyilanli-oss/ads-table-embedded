import assert from "node:assert/strict";
import test from "node:test";
import {metaRawDatasetsFixture} from "./fixtures/meta-raw-datasets-fixture.js";
import {createMetaRawCaptureExecution,readMetaRawCapturePlan} from "../app/lib/refresh/meta-raw-server.server.js";
import {createConfiguredSourceEvidenceCipher} from "../app/lib/database/source-evidence-config.server.js";
import {META_SOURCE_ROLE_CHECK_SQL,createMetaSourcePostgresClient} from "../app/lib/database/meta-source-postgres.server.js";
import {metaRawRehearsalEnvironment} from "../tools/eo05-meta-raw-datasets-probe.mjs";

test("actual SQL rehearsal configuration passes the unchanged independent-key guard before database execution",()=>{
 const env=metaRawRehearsalEnvironment();assert.doesNotThrow(()=>createConfiguredSourceEvidenceCipher(env));
 const reused={...env,ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1:env.ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1};
 assert.throws(()=>createConfiguredSourceEvidenceCipher(reused),/CONFIGURATION_REQUIRED/);
});

test("Meta two successful empty reports produce two encrypted verified envelopes, not catalogue identity",async()=>{
 const x=metaRawDatasetsFixture(),e=createMetaRawCaptureExecution(x.options),r=await e.run();await e.close();
 assert.equal(r.status,"stored",JSON.stringify(r));assert.equal(r.jobPaused,true);assert.equal(r.recordCount,0);assert.equal(r.empty,true);assert.equal(r.contentVerified,true);
 assert.equal(x.writes.length,2);assert.ok(x.writes.every(w=>w.read.operationId===x.plan.target.operationId&&w.body.pages.length===2));
 assert.equal(r.catalogueIdentityVerified,false);assert.equal(r.mappingVerified,false);assert.equal(r.DatasetWritePerformed,false);assert.equal(r.hourlyRefreshActivated,false);
 assert.equal(x.f.http.filter(u=>u.hostname==="graph.facebook.com").length,3);await assert.rejects(e.run(),/EXECUTION_USED/);
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|ciphertext|credential|access_token|appsecret_proof/);
});
const row=(extra={})=>({account_id:"123",campaign_id:"11",adset_id:"12",ad_id:"13",date_start:"2026-11-01",date_stop:"2026-11-01",...extra});
test("Meta native numeric tokens and string decimals survive encrypted roundtrip; paging secrets never enter storage",async()=>{
 const x=metaRawDatasetsFixture();x.hooks.fetch=u=>u.pathname.endsWith("/insights")?new Response('{"data":['+JSON.stringify(row({product_id:"sku"})).slice(0,-1)+',"clicks":9007199254740993,"spend":"0.1234567890123456789","private_email":"SECRET"}]}'):undefined;
 const r=await createMetaRawCaptureExecution(x.options).run();assert.equal(r.status,"stored",JSON.stringify(r));assert.equal(r.recordCount,2);
 const w=x.writes[0],p=w.pages[1],plain=createConfiguredSourceEvidenceCipher(x.environment).open({owner:w.owner,attemptId:w.attemptId,ordinal:0,page:p});
 assert.deepEqual(plain.records[0].fields.find(f=>f.field==="clicks").value,{jsonNumber:"9007199254740993"});
 assert.equal(plain.request.coverage,"native_query_result_not_catalogue_inventory");assert.deepEqual(plain.request.window,x.plan.target.window);
 const product=x.writes[1],productPlain=createConfiguredSourceEvidenceCipher(x.environment).open({owner:product.owner,attemptId:product.attemptId,ordinal:0,page:product.pages[1]});
 assert.equal(productPlain.request.productIdLimit,100);assert.deepEqual(productPlain.request.breakdowns,["product_id"]);
 assert.equal(plain.records[0].fields.find(f=>f.field==="spend").value,"0.1234567890123456789");assert.doesNotMatch(JSON.stringify(plain),/SECRET|private_email/);
 assert.ok(x.writes.every(w=>!JSON.stringify(w.body).includes("9007199254740993")));
});
test("Meta opaque cursor rebuilds only the fixed URL and includes every page",async()=>{
 const x=metaRawDatasetsFixture();let seen=0;x.hooks.fetch=u=>{
  if(!u.pathname.endsWith("/insights")||u.searchParams.has("breakdowns"))return;
  seen++;return seen===1?Response.json({data:[],paging:{next:"https://evil.example/?access_token=SECRET",cursors:{after:"opaque"}}}):Response.json({data:[]});
 };
 const r=await createMetaRawCaptureExecution(x.options).run();assert.equal(r.status,"stored",JSON.stringify(r));assert.equal(x.writes[0].pages.length,3);
 assert.equal(x.f.http.filter(u=>u.searchParams.get("after")==="opaque").length,1);assert.ok(x.f.http.every(u=>u.hostname!=="evil.example"));
});
for(const mode of ["403","429","200_error","invalid_json","wrong_account","wrong_date","missing_product","cursor_loop","oversize","lost_write","tampered_page","lost_receipt","missing_page","extra_page","authority_drift","profile_drift"])
test("Meta first failure stops, no replay or invented zero: "+mode,async()=>{
 const x=metaRawDatasetsFixture();let writes=0;
 x.hooks.fetch=u=>{
  if(!u.pathname.endsWith("/insights")||!u.searchParams.has("breakdowns"))return;
  if(mode==="403"||mode==="429")return Response.json({error:{message:"SECRET"}},{status:Number(mode)});
  if(mode==="200_error")return Response.json({error:{code:100}});
  if(mode==="invalid_json")return new Response('{"data":[],"data":[]}');
  if(mode==="wrong_account")return Response.json({data:[row({account_id:"999",product_id:"sku"})]});
  if(mode==="wrong_date")return Response.json({data:[row({date_stop:"2000-01-01",product_id:"sku"})]});
  if(mode==="missing_product")return Response.json({data:[row()]});
  if(mode==="cursor_loop")return Response.json({data:[],paging:{next:"ignored",cursors:{after:"same"}}});
  if(mode==="oversize")return new Response("x".repeat(1048577));
  if(mode==="authority_drift")x.f.authority.connectionVersion++;
 };
 x.hooks.source=(sql,args)=>{
  if(sql.includes("commit_meta_dataset_source")){writes++;if(mode==="lost_write"&&writes===2)throw Error("SECRET");}
  if(mode==="profile_drift"&&x.writes.length===1&&sql===META_SOURCE_ROLE_CHECK_SQL)return {rows:[{role:"adstable_meta_source_runner",profile_ready:false}]};
  if(x.writes.length===2&&sql.startsWith("select evidence.read_source_receipt(")&&mode==="lost_receipt")return {rows:[{result:{status:"unknown"}}]};
  if(x.writes.length===2&&sql.startsWith("select evidence.read_source_pages(")){
   if(mode==="tampered_page")x.writes[1].pages[0].ciphertext="00";
   if(mode==="missing_page")return {rows:[{result:[]}]};
   if(mode==="extra_page"&&BigInt(args[3])>=BigInt(x.writes[1].pages.at(-1).id))return {rows:[{result:[{...x.writes[1].pages[0],id:"9999"}]}]};
  }
 };
 const r=await createMetaRawCaptureExecution(x.options).run();assert.notEqual(r.status,"stored",JSON.stringify(r));assert.equal(r.empty,null);assert.equal(r.recordCount,null);
 if(mode!=="profile_drift")assert.equal(r.datasets.account_performance.status,"stored",JSON.stringify(r));
 assert.ok(writes<=2);assert.doesNotMatch(JSON.stringify(r),/SECRET|SYNTHETIC|ciphertext/);assert.equal(x.f.state.paused,0);
 if(mode==="lost_write")assert.equal(x.calls.filter(c=>c.sql.startsWith("select evidence.read_source_receipt(")).length,1);
});
for(const mode of ["extra_target","wrong_account","expiry","bounds","query_selector","bad_date"])
test("Meta plan rejects unbounded/foreign input before SQL: "+mode,()=>{
 const x=metaRawDatasetsFixture();if(mode==="extra_target")x.plan.target.catalogId="1";if(mode==="wrong_account")x.plan.target.accountId="123";
 if(mode==="expiry")x.plan.target.expiresAt=new Date(x.options.now()-1).toISOString();if(mode==="bounds")x.plan.limits.maxRequests=22;
 if(mode==="query_selector")x.plan.query="arbitrary";if(mode==="bad_date")x.plan.target.window={from:"2026-02-30",to:"2026-02-30"};
 x.setPlan();assert.throws(()=>readMetaRawCapturePlan(x.environment,x.options.now()));assert.equal(x.calls.length,0);
});
test("Meta source client refuses owner SQL and Google commit RPC without a connection",async()=>{
 const x=metaRawDatasetsFixture(),db=createMetaSourcePostgresClient({environment:x.environment,poolFactory:x.options.readerPoolFactory});
 for(const sql of ["set role adstable_owner","select * from evidence.source_pages","select evidence.commit_google_dataset_source($1,$2,$3,$4,$5)"])await assert.rejects(db.query(sql));
 assert.equal(x.calls.length,0);await db.close();
});
