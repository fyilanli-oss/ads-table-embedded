import assert from "node:assert/strict";
import test from "node:test";
import {klaviyoRawDatasetsFixture} from "./fixtures/klaviyo-raw-datasets-fixture.js";
import {createKlaviyoRawCaptureExecution,readKlaviyoRawCapturePlan} from "../app/lib/refresh/klaviyo-raw-server.server.js";
import {createConfiguredSourceEvidenceCipher} from "../app/lib/database/source-evidence-config.server.js";
import {createKlaviyoRawPacer} from "../app/lib/refresh/klaviyo-raw-collection.server.js";
const metrics=names=>Response.json({data:names.map((name,i)=>({type:"metric",id:"m"+i,attributes:{name,integration:{name:"Shopify"}}})),links:{next:null}});
test("Klaviyo all fixed queries succeed empty: three encrypted readback-verified envelopes",async()=>{
 const x=klaviyoRawDatasetsFixture(),e=createKlaviyoRawCaptureExecution(x.options),r=await e.run();await e.close();
 assert.equal(r.status,"stored",JSON.stringify(r));assert.equal(r.jobPaused,true);assert.equal(r.contentVerified,true);assert.equal(r.empty,false);
 assert.equal(x.writes.length,3);assert.equal(r.datasets.account_performance.recordCount,0);assert.equal(r.datasets.product_performance.recordCount,0);
 assert.equal(x.f.http.filter(u=>u.pathname.includes("values-reports")).length,6);
 assert.ok(x.writes.every(w=>w.owner.selectionEpoch===null&&w.read.operationId===x.plan.target.operationId));
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|ciphertext|access_token/);await assert.rejects(e.run(),/EXECUTION_USED/);
});
for(const names of [[],["Placed Order"],["Ordered Product"]])test("missing Shopify metrics are unavailable, never synthetic zero: "+names,async()=>{
 const x=klaviyoRawDatasetsFixture();x.hooks.fetch=u=>u.pathname==="/api/metrics"?metrics(names):undefined;
 const r=await createKlaviyoRawCaptureExecution(x.options).run();assert.equal(r.status,"partial",JSON.stringify(r));assert.equal(r.jobPaused,true);assert.equal(r.sourceStored,true);
 assert.equal(r.datasets.account_performance.recordCount,null);assert.equal(r.datasets.account_performance.empty,null);assert.equal(r.recordCount,null);
 assert.equal(x.writes.length,3);assert.equal(x.writes[1].body.sourceState,"partial");
 if(!names.includes("Ordered Product")){assert.equal(r.datasets.product_performance.status,"unavailable");assert.equal(r.datasets.product_performance.empty,null);}
});
for(const mode of ["403","429","errors","duplicate_metrics","foreign_cursor","repeat_cursor","wrong_account","wrong_date","lost_write","tampered_page","lost_receipt","missing_page","extra_page","authority_drift"])
test("Klaviyo first failure stops with unknown counts and no replay: "+mode,async()=>{
 const x=klaviyoRawDatasetsFixture();let requests=0,commits=0;
 x.hooks.fetch=u=>{
  if(u.pathname.includes("values-reports")){
   requests++;if(mode==="403"||mode==="429")return Response.json({errors:[{detail:"SECRET"}]},{status:Number(mode)});
   if(mode==="errors")return Response.json({errors:[{code:"private"}]});
   if(mode==="authority_drift")x.f.authority.connectionVersion++;
  }
  if(mode==="duplicate_metrics"&&u.pathname==="/api/metrics")return metrics(["Placed Order","Placed Order"]);
  if(["foreign_cursor","repeat_cursor"].includes(mode)&&u.pathname==="/api/metrics")return Response.json({data:[],links:{next:mode==="foreign_cursor"?"https://evil.example/api/metrics?page%5Bcursor%5D=a":"https://a.klaviyo.com/api/metrics?page%5Bcursor%5D=a"}});
  if(mode==="wrong_account"&&u.pathname==="/api/accounts/")return Response.json({data:[]});
  if(mode==="wrong_date"&&u.pathname==="/api/events")return Response.json({data:[{type:"event",id:"e",attributes:{datetime:"2000-01-01",event_properties:{}},relationships:{metric:{data:{type:"metric",id:"metric3"}}}}],links:{next:null}});
 };
 x.hooks.source=(sql,args)=>{
  if(sql.includes("commit_klaviyo_dataset_source")){commits++;if(mode==="lost_write"&&commits===2)throw Error("SECRET");}
  if(x.writes.length===2&&sql.includes("read_source_receipt")&&mode==="lost_receipt")return {rows:[{result:{status:"unknown"}}]};
  if(x.writes.length===2&&sql.includes("read_source_pages")){
   if(mode==="tampered_page")x.writes[1].pages[0].ciphertext="00";
   if(mode==="missing_page")return {rows:[{result:[]}]};
   if(mode==="extra_page"&&BigInt(args[3])>=BigInt(x.writes[1].pages.at(-1).id))return {rows:[{result:[{...x.writes[1].pages[0],id:"9999"}]}]};
  }
 };
 const r=await createKlaviyoRawCaptureExecution(x.options).run();assert.notEqual(r.status,"stored",JSON.stringify(r));assert.equal(r.recordCount,null);assert.equal(r.empty,null);
 assert.equal(x.f.state.paused,0);assert.ok(commits<=3);assert.doesNotMatch(JSON.stringify(r),/SECRET|SYNTHETIC|ciphertext/);
 if(["403","429","errors"].includes(mode))assert.equal(requests,1);
 if(mode==="lost_write")assert.equal(x.calls.filter(c=>c.sql.includes("read_source_receipt")).length,1);
});
test("per-endpoint pacing is 31 seconds; abort stops before another report",async()=>{
 let time=0;const waits=[],controller=new AbortController(),pace=createKlaviyoRawPacer({now:()=>time,signal:controller.signal,delay:async ms=>{waits.push(ms);time+=ms;}});
 await pace("campaign");await pace("flow");await pace("campaign");await pace("flow");await pace("campaign");assert.deepEqual(waits,[31000,31000]);
 controller.abort();await assert.rejects(pace("campaign"),/read_aborted/);
});
test("Klaviyo plan rejects Reporting Account epoch and caller query selectors",()=>{
 for(const mutate of [p=>p.target.selectionId="71",p=>p.query="arbitrary",p=>p.limits.maxRequests=22,p=>p.target.window={from:"2026-02-30",to:"2026-02-30"}]){
  const x=klaviyoRawDatasetsFixture();mutate(x.plan);x.setPlan();assert.throws(()=>readKlaviyoRawCapturePlan(x.environment,x.options.now()));assert.equal(x.calls.length,0);
 }
});

test("lossless report/event numeric tokens survive encryption and PII never enters source pages",async()=>{
 const x=klaviyoRawDatasetsFixture();x.hooks.fetch=u=>{
  if(u.pathname.includes("values-reports")){const k=u.pathname.includes("campaign")?"campaign":"flow";return new Response('{"data":{"type":"'+k+'-values-report","attributes":{"results":[{"groupings":{"'+k+'_id":"c","'+k+'_message_id":"m","'+k+'_message_name":"name","send_channel":"email"},"statistics":{"conversions":9007199254740993,"conversion_value":"0.1234567890123456789"}}]}},"links":{"next":null}}');}
  if(u.pathname==="/api/events")return new Response('{"data":[{"type":"event","id":"e","attributes":{"datetime":"2026-11-01T12:00:00Z","event_properties":{"Quantity":9007199254740993,"$value":"0.1234567890123456789","email":"SECRET"}},"relationships":{"metric":{"data":{"type":"metric","id":"metric3"}},"profile":{"data":{"type":"profile","id":"SECRET"}}}}],"links":{"next":null}}');
 };
 const r=await createKlaviyoRawCaptureExecution(x.options).run();assert.equal(r.status,"stored",JSON.stringify(r));
 const cipher=createConfiguredSourceEvidenceCipher(x.environment),plain=x.writes.flatMap(w=>w.pages.map(p=>cipher.open({owner:w.owner,attemptId:w.attemptId,ordinal:0,page:p})));
 const report=plain.find(p=>p.family==="klaviyo_campaign_report"),event=plain.find(p=>p.family==="klaviyo_ordered_product_events");
 assert.deepEqual(report.records[0].statistics.conversions,{jsonNumber:"9007199254740993"});assert.equal(report.records[0].statistics.conversion_value,"0.1234567890123456789");
 assert.deepEqual(event.records[0].attributes.event_properties.Quantity,{jsonNumber:"9007199254740993"});assert.doesNotMatch(JSON.stringify(plain),/SECRET|authorization|access_token/);
 assert.ok(x.writes.every(w=>!JSON.stringify(w.body).includes("9007199254740993")));
});
test("expired/insufficient credential stops before Klaviyo data HTTP without token endpoint attempt",async()=>{
 const x=klaviyoRawDatasetsFixture();x.setToken({expires_at:new Date(x.options.now()+120000).toISOString()});
 const r=await createKlaviyoRawCaptureExecution(x.options).run();assert.equal(r.reason,"credential_refresh_required");assert.equal(x.writes.length,0);assert.equal(x.f.http.filter(u=>u.hostname==="a.klaviyo.com").length,0);
});
test("failure of account reports preserves the already verified configuration receipt",async()=>{
 const x=klaviyoRawDatasetsFixture();x.hooks.fetch=u=>u.pathname.includes("values-reports")?Response.json({errors:[]},{status:403}):undefined;
 const r=await createKlaviyoRawCaptureExecution(x.options).run();assert.equal(r.datasets.configuration.status,"stored");assert.equal(r.datasets.configuration.contentVerified,true);assert.equal(r.datasets.account_performance.status,"failed");
});
test("cursor rebuild retains fixed request and stores all metric pages without cursor URLs",async()=>{
 const x=klaviyoRawDatasetsFixture();let n=0;x.hooks.fetch=u=>{if(u.pathname!=="/api/metrics")return;n++;if(n===1)return Response.json({data:[],links:{next:"https://a.klaviyo.com/api/metrics?page%5Bcursor%5D=opaque"}});};
 const r=await createKlaviyoRawCaptureExecution(x.options).run();assert.equal(r.status,"stored",JSON.stringify(r));assert.equal(n,2);
 const w=x.writes[0],cipher=createConfiguredSourceEvidenceCipher(x.environment);assert.equal(w.pages.filter(p=>p.family==="klaviyo_metrics").length,2);
 for(const p of w.pages)assert.doesNotMatch(JSON.stringify(cipher.open({owner:w.owner,attemptId:w.attemptId,ordinal:0,page:p})),/opaque|page%5Bcursor%5D/);
});
