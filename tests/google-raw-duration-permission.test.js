import assert from "node:assert/strict";
import test from "node:test";
import {vercelPreset} from "@vercel/react-router/vite";
import {googleRawDatasetsFixture} from "./fixtures/google-raw-datasets-fixture.js";
import {createGoogleRawCaptureExecution} from "../app/lib/refresh/google-raw-server.server.js";
import {handleGoogleRawCaptureRequest} from "../app/lib/refresh/google-raw-request.server.js";

test("installed Vercel preset isolates Frankfurt placement to the private raw reader",()=>{
 const {serverBundles}=vercelPreset().reactRouterConfig({reactRouterUserConfig:{ssr:true}});
 const config=name=>JSON.parse(Buffer.from(serverBundles({branch:[{id:name,file:`app/routes/${name}.ts`}]}).slice("nodejs_".length),"base64url").toString());
 assert.deepEqual(config("internal.google.raw-capture"),{maxDuration:120,regions:["fra1"],runtime:"nodejs"});
 assert.equal(config("internal.google.merchant-links").regions,undefined);
});

for(const mode of ["deadline","abort"])test(`raw reader ${mode} is explicit, aborts in-flight HTTP and never advances/replays`,async t=>{
 const x=googleRawDatasetsFixture(),controller=new AbortController();
 let entered,signal,calls=0;
 const started=new Promise(resolve=>{entered=resolve;});
 x.hooks.fetch=async(u,init)=>{
  if(u.hostname!=="googleads.googleapis.com")return;
  calls++;signal=init.signal;entered();
  return new Promise((resolve,reject)=>init.signal.addEventListener("abort",()=>reject(init.signal.reason),{once:true}));
 };
 t.mock.timers.enable({apis:["setTimeout"]});
 const e=createGoogleRawCaptureExecution({...x.options,signal:controller.signal}),pending=e.run();
 await started;
 if(mode==="deadline")t.mock.timers.tick(60000);else controller.abort();
 const r=await pending;await e.close();t.mock.timers.reset();
 assert.equal(r.reason,mode==="deadline"?"read_deadline_exceeded":"read_aborted",JSON.stringify(r));
 assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(x.writes.length,0);
 assert.equal(r.sourceStored,false);assert.equal(r.empty,null);assert.equal(r.recordCount,null);
 assert.equal(r.datasets.account_performance.status,"failed");
 assert.equal(r.datasets.product_performance.status,"not_attempted");
 assert.equal(r.datasets.merchant_identity.status,"not_attempted");
 await assert.rejects(e.run(),/EXECUTION_USED/);
});

for(const reason of ["read_deadline_exceeded","read_aborted"])test(`private response preserves ${reason} without claiming success`,async()=>{
 const x=googleRawDatasetsFixture();Object.assign(x.environment,{VERCEL_ENV:"production",SHOPIFY_APP_URL:"https://embedded.adstable.app",ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET:"s".repeat(43)});
 const request=new Request("https://embedded.adstable.app/internal/google/raw-capture",{method:"POST",headers:{authorization:"Bearer "+"s".repeat(43),"content-type":"application/json"},body:JSON.stringify({operationId:x.options.operationId})});
 const response=await handleGoogleRawCaptureRequest(request,{environment:x.environment,now:x.options.now,createExecution:()=>({async run(){return {status:"stopped",reason,sourceStored:false,datasets:{account_performance:{status:"failed",reason},product_performance:{status:"not_attempted"},merchant_identity:{status:"not_attempted"}}};},async close(){}})});
 const r=await response.json();assert.equal(response.status,409);assert.equal(r.reason,reason);
 assert.equal(r.datasets.account_performance.reason,reason);assert.equal(r.complete,false);assert.equal(r.contentVerified,false);
 assert.equal(r.hourlyRefreshActivated,false);assert.equal(r.empty,null);assert.equal(r.recordCount,null);
});
