import assert from "node:assert/strict";
import test from "node:test";
import {googleRawDatasetsFixture} from "./fixtures/google-raw-datasets-fixture.js";
import {createGoogleRawCaptureExecution,readGoogleRawCapturePlan} from "../app/lib/refresh/google-raw-server.server.js";
import {handleGoogleRawCaptureRequest} from "../app/lib/refresh/google-raw-request.server.js";
import {createConfiguredSourceEvidenceCipher} from "../app/lib/database/source-evidence-config.server.js";
import {parseGoogleRawJson,projectGoogleRawPage} from "../app/lib/providers/google-raw-projection.server.js";

for(const merchant of [false,true])test("three fixed datasets: successful Ads zero; Merchant "+(merchant?"complete":"absent is not zero"),async()=>{
 const x=googleRawDatasetsFixture({merchant}),e=createGoogleRawCaptureExecution(x.options),r=await e.run();await e.close();
 assert.equal(r.status,merchant?"stored":"partial",JSON.stringify({r,sql:x.calls.map(c=>c.sql)}));
 assert.equal(r.datasets.account_performance.recordCount,0);assert.equal(r.datasets.product_performance.recordCount,0);
 assert.equal(r.datasets.merchant_identity.status,merchant?"stored":"unavailable");assert.equal(r.datasets.merchant_identity.recordCount,merchant?2:null);
 assert.equal(r.jobPaused,true);assert.equal(r.contentVerified,true);assert.equal(x.writes.length,3);
 assert.equal(x.writes[0].body.pages.length,9);assert.equal(x.writes[1].body.pages.length,8);
 assert.ok(x.writes.every(w=>w.read.operationId===x.plan.target.operationId));
 assert.equal(x.writes[2].body.sourceState,merchant?"complete":"partial");
 assert.equal(x.f.http.filter(u=>u.hostname==="merchantapi.googleapis.com").length,merchant?1:0);
 assert.equal(x.f.http.filter(u=>u.hostname==="googleads.googleapis.com").length,merchant?19:18);
 await assert.rejects(e.run(),/EXECUTION_USED/);
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|ciphertext|access_token|refresh_token/);
});

test("nonempty performance is encrypted; exact decimal and unsafe integer lexical tokens survive decrypt",async()=>{
 const x=googleRawDatasetsFixture();x.hooks.fetch=(u,init)=>{
  if(u.hostname==="googleads.googleapis.com"&&JSON.parse(init.body).query.includes("FROM ad_group_ad")&&!JSON.parse(init.body).query.includes("conversion_action"))
   return new Response('{"results":[{"customer":{"id":"123"},"metrics":{"costMicros":9007199254740993,"conversionsValue":0.1234567890123456789},"segments":{"date":"2026-11-01"}}]}',{headers:{"content-type":"application/json"}});
 };
 const r=await createGoogleRawCaptureExecution(x.options).run();assert.equal(r.status,"partial",JSON.stringify(r));assert.equal(r.datasets.account_performance.recordCount,1);
 const w=x.writes[0],cipher=createConfiguredSourceEvidenceCipher(x.environment),page=w.pages.find(p=>p.family==="search_ad_channel_daily");
 const plain=cipher.open({owner:w.owner,attemptId:w.attemptId,ordinal:0,page});
 assert.deepEqual(plain.records[0].fields.find(f=>f.field==="metrics.cost_micros").value,{jsonNumber:"9007199254740993"});
 assert.deepEqual(plain.records[0].fields.find(f=>f.field==="metrics.conversions_value").value,{jsonNumber:"0.1234567890123456789"});
 assert.ok(!JSON.stringify(w.body).includes("0.1234567890123456789"));
});

for(const mode of ["403","partial_page","wrong_account","oversize","lost_write","tampered_page","missing_page","extra_page","lost_receipt","authority_drift"])
test("first failure stops, retains known earlier envelopes and never claims zero: "+mode,async()=>{
 const x=googleRawDatasetsFixture();let calls=0,writeCalls=0;
 x.hooks.fetch=(u,init)=>{
  if(u.hostname!=="googleads.googleapis.com")return;calls++;const q=JSON.parse(init.body).query;
  if(calls===10){
   if(mode==="403")return Response.json({error:{message:"SYNTHETIC-PRIVATE"}},{status:403});
   if(mode==="partial_page")return Response.json({results:[],nextPageToken:"next"});
   if(mode==="wrong_account")return Response.json({results:[{customer:{id:"999"}}]});
   if(mode==="oversize")return new Response("x".repeat(1048577));
   if(mode==="authority_drift")x.f.authority.connectionVersion++;
  }
 };
 x.hooks.source=(sql,args)=>{
  if(sql.startsWith("select evidence.commit_google_dataset_source(")){writeCalls++;if(mode==="lost_write"&&writeCalls===2)throw Error("SYNTHETIC-LOST");}
  if(sql.startsWith("select evidence.read_source_receipt(")&&x.writes.length===2&&mode==="lost_receipt")return {rows:[{result:{status:"unknown"}}]};
  if(sql.startsWith("select evidence.read_source_pages(")&&x.writes.length===2){const w=x.writes.at(-1);
   if(mode==="missing_page")return {rows:[{result:[]}]};
   if(mode==="tampered_page"){w.pages[0].ciphertext="00";}
   if(mode==="extra_page"&&args[4]===1&&BigInt(args[3])>=BigInt(w.pages.at(-1).id))return {rows:[{result:[{...w.pages[0],id:"9999"}]}]};
  }
 };
 const r=await createGoogleRawCaptureExecution(x.options).run();assert.notEqual(r.status,"stored");assert.notEqual(r.status,"partial");assert.equal(r.recordCount,null);assert.equal(r.empty,null);
 assert.equal(r.datasets.account_performance.status,"stored",JSON.stringify(r));assert.equal(r.datasets.merchant_identity.status,"not_attempted");
 assert.ok(writeCalls<=2);assert.ok(calls<=17);
 if(mode==="403"){assert.equal(r.reason,"provider_permission_denied");assert.equal(r.datasets.product_performance.reason,"provider_permission_denied");}
 if(mode==="lost_write")assert.equal(x.calls.filter(c=>c.sql.startsWith("select evidence.read_source_receipt(")&&x.writes.some(w=>w.read.dataset==="product_performance"&&w.attemptId===c.args[1])).length,0);
});

test("server projection exposes separate partial state and safe content receipts",async()=>{
 const x=googleRawDatasetsFixture();Object.assign(x.environment,{VERCEL_ENV:"production",SHOPIFY_APP_URL:"https://embedded.adstable.app",ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET:"s".repeat(43)});
 const req=new Request("https://embedded.adstable.app/internal/google/raw-capture",{method:"POST",headers:{authorization:"Bearer "+"s".repeat(43),"content-type":"application/json"},body:JSON.stringify({operationId:x.options.operationId})});
 const response=await handleGoogleRawCaptureRequest(req,{environment:x.environment,now:x.options.now,createExecution:()=>createGoogleRawCaptureExecution(x.options)}),r=await response.json();
 assert.equal(response.status,207,JSON.stringify(r));assert.equal(r.complete,false);assert.equal(r.datasets.merchant_identity.empty,null);assert.equal(r.contentVerified,true);
 assert.doesNotMatch(JSON.stringify(r),/credential|token|ciphertext|SYNTHETIC/);
});

test("expired token is renewed once inside the admitted three-dataset job",async()=>{
 const x=googleRawDatasetsFixture();x.expire();const r=await createGoogleRawCaptureExecution(x.options).run();
 assert.equal(r.status,"partial",JSON.stringify(r));assert.equal(x.f.http.filter(u=>u.hostname==="oauth2.googleapis.com").length,1);
 assert.equal(x.calls.filter(c=>c.sql.startsWith("select * from integrations.commit_google_refresh_renewal(")).length,1);
 assert.equal(x.writes.length,3);
});
test("all pages use the same fixed query and stay in one linked dataset envelope",async()=>{
 const x=googleRawDatasetsFixture();x.plan.limits.maxPages=2;x.setPlan();let first=true;
 x.hooks.fetch=(u,init)=>{if(u.hostname!=="googleads.googleapis.com")return;const b=JSON.parse(init.body);
  if(b.query.includes("FROM customer")&&first){first=false;return Response.json({results:[],nextPageToken:"next",totalResultsCount:"0"});}
  if(b.query.includes("FROM customer")){assert.equal(b.pageToken,"next");return Response.json({results:[],totalResultsCount:"0"});}
 };
 const r=await createGoogleRawCaptureExecution(x.options).run();assert.equal(r.status,"partial",JSON.stringify(r));assert.equal(x.writes[0].body.pages.length,10);
 assert.equal(x.writes[0].body.pages.filter(p=>p.family==="account_identity").length,2);
});
for(const mode of ["wrong_date","total_mismatch","repeated_cursor","unlinked_target"])
 test("scope/completeness cannot be inferred from an HTTP200: "+mode,async()=>{
 const x=googleRawDatasetsFixture({merchant:mode==="unlinked_target"});x.plan.limits.maxPages=2;x.setPlan();
 x.hooks.fetch=(u,init)=>{if(u.hostname!=="googleads.googleapis.com")return;const q=JSON.parse(init.body).query;
  if(mode==="unlinked_target"&&q.includes("FROM product_link"))return Response.json({results:[]});
  if(mode==="total_mismatch"&&q.includes("FROM customer"))return Response.json({results:[],totalResultsCount:"2"});
  if(mode==="repeated_cursor"&&q.includes("FROM customer"))return Response.json({results:[],nextPageToken:"repeat"});
  if(mode==="wrong_date"&&q.includes("FROM ad_group_ad"))return Response.json({results:[{customer:{id:"123"},segments:{date:"2000-01-01"}}]});
 };
 const r=await createGoogleRawCaptureExecution(x.options).run();assert.notEqual(r.status,"stored");assert.notEqual(r.status,"partial");assert.equal(r.empty,null);
 assert.equal(x.f.http.filter(u=>u.hostname==="merchantapi.googleapis.com").length,0);
});

for(const text of ['{"results":[],"results":[]}','{"__proto__":{}}','{"x":01}','{"x":1} trailing'])
 test("strict source parser rejects conflicting/invalid JSON "+text,()=>assert.throws(()=>parseGoogleRawJson(text)));
test("unselected private fields cannot enter the source projection",()=>{
 const p=projectGoogleRawPage(parseGoogleRawJson('{"results":[{"customer":{"id":"123","email":"private"},"metrics":{"clicks":1}}]}'),{
  query:"SELECT customer.id, metrics.clicks FROM customer",accountId:"123",family:"account_identity",ordinal:0,requestId:null});
 assert.doesNotMatch(JSON.stringify(p),/private|email/);
});
for(const mode of ["extra_target","merchant_forgery","request_limit","pagination_limit","missing_version"])
 test("v2 plan is fixed, bounded and does not infer Merchant identity: "+mode,()=>{
 const x=googleRawDatasetsFixture();if(mode==="extra_target")x.plan.target.query="SELECT anything";
 if(mode==="merchant_forgery")x.plan.merchant={targetAccountId:"99"};if(mode==="request_limit")x.plan.limits.maxRequests=81;
 if(mode==="pagination_limit")x.plan.limits.maxPages=11;if(mode==="missing_version")delete x.plan.version;x.setPlan();
 assert.throws(()=>readGoogleRawCapturePlan(x.environment,x.options.now()));assert.equal(x.calls.length,0);
});
