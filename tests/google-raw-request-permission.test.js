import test from "node:test";
import assert from "node:assert/strict";
import {googleRawServerFixture} from "./fixtures/google-raw-server-fixture.js";
import {handleGoogleRawCaptureRequest} from "../app/lib/refresh/google-raw-request.server.js";
import {createGoogleRawCaptureExecution} from "../app/lib/refresh/google-raw-server.server.js";

function fixture(){const x=googleRawServerFixture(),secret="s".repeat(43);
 Object.assign(x.environment,{VERCEL_ENV:"production",SHOPIFY_APP_URL:"https://embedded.adstable.app",ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET:secret});
 const request=({url="https://embedded.adstable.app/internal/google/raw-capture",method="POST",auth=`Bearer ${secret}`,body=JSON.stringify({operationId:x.plan.target.operationId}),type="application/json",signal}={})=>new Request(url,{method,headers:{authorization:auth,"content-type":type},...method==="GET"?{}:{body},signal});
 return {x,request};}

test("private HTTP entry executes the actual browser-free capture and returns only its safe receipt",async()=>{
 const {x,request}=fixture();let calls=0;
 const options={environment:x.environment,now:x.options.now,createExecution:args=>{calls++;return createGoogleRawCaptureExecution({...x.options,...args});}};
 const response=await handleGoogleRawCaptureRequest(request(),options),body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.status,"stored");assert.equal(body.recordCount,0);assert.equal(body.receiptVerified,true);assert.equal(calls,1);
 assert.equal(response.headers.get("cache-control"),"no-store, max-age=0");assert.doesNotMatch(JSON.stringify(body),/SYNTHETIC|ciphertext|access_token|refresh_token/);
 const count=x.f.http.length,r=await handleGoogleRawCaptureRequest(request(),options);assert.equal(r.status,409);assert.equal(x.f.http.length,count,"same operation never repeats native calls");
});
test("private HTTP response never forwards arbitrary internal fields or error text",async()=>{
 const {x,request}=fixture();
 const response=await handleGoogleRawCaptureRequest(request(),{environment:x.environment,now:x.options.now,
  createExecution:()=>({run:async()=>({status:"stopped",sourceStored:null,reason:"PRIVATE SECRET",payload:{access_token:"PRIVATE"}}),close:async()=>{}})});
 assert.equal(response.status,409);assert.doesNotMatch(await response.text(),/PRIVATE|SECRET|payload|access_token/);
});
for(const mode of ["method","disabled","preview","missing_secret","wrong_secret","unicode_secret","query","origin","path","body_owner","wrong_operation","oversize","content_type","expired_plan","abort"])
 test("private raw HTTP rejects before creating an execution: "+mode,async()=>{
 const {x,request}=fixture(),input={};let calls=0;
 if(mode==="method")input.method="GET";
 if(mode==="disabled")x.environment.ADSTABLE_GOOGLE_RAW_CAPTURE_ENABLED="false";
 if(mode==="preview")x.environment.VERCEL_ENV="preview";
 if(mode==="missing_secret")delete x.environment.ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET;
 if(mode==="wrong_secret")input.auth="Bearer "+"x".repeat(43);
 if(mode==="unicode_secret")input.auth="Bearer "+"ü".repeat(43);
 if(mode==="query")input.url="https://embedded.adstable.app/internal/google/raw-capture?account=123";
 if(mode==="origin")input.url="https://other.example/internal/google/raw-capture";
 if(mode==="path")input.url="https://embedded.adstable.app/settings";
 if(mode==="body_owner")input.body=JSON.stringify({operationId:x.plan.target.operationId,verified:{}});
 if(mode==="wrong_operation")input.body=JSON.stringify({operationId:"11111111-1111-4111-8111-111111111111"});
 if(mode==="oversize")input.body="x".repeat(1025);
 if(mode==="content_type")input.type="text/plain";
 if(mode==="expired_plan"){x.plan.target.expiresAt=new Date(x.options.now()-1).toISOString();x.setPlan();}
 if(mode==="abort"){const controller=new AbortController();controller.abort();input.signal=controller.signal;}
 const r=await handleGoogleRawCaptureRequest(request(input),{environment:x.environment,now:x.options.now,createExecution:()=>{calls++;throw Error("PRIVATE");}});
 assert.ok(r.status>=400);assert.equal(calls,0);assert.equal(x.calls.length,0);assert.equal(x.f.http.length,0);
 assert.doesNotMatch(await r.text(),/PRIVATE|SYNTHETIC/);
});
