import test from "node:test";
import assert from "node:assert/strict";
import {metaRawDatasetsFixture} from "./fixtures/meta-raw-datasets-fixture.js";
import {handleMetaRawCaptureRequest} from "../app/lib/refresh/meta-raw-request.server.js";
import {createMetaRawCaptureExecution} from "../app/lib/refresh/meta-raw-server.server.js";
import {createMetaRawDatasetReader} from "../app/lib/refresh/meta-raw-datasets.server.js";
const secret="s".repeat(43);
function fixture(){const x=metaRawDatasetsFixture();Object.assign(x.environment,{VERCEL_ENV:"production",SHOPIFY_APP_URL:"https://embedded.adstable.app",ADSTABLE_META_RAW_CAPTURE_SERVER_SECRET:secret});return x;}
function request(x,{method="POST",url="https://embedded.adstable.app/internal/meta/raw-capture",auth="Bearer "+secret,body=JSON.stringify({operationId:x.options.operationId}),type="application/json"}={}){
 return new Request(url,{method,headers:{authorization:auth,"content-type":type},...method==="GET"?{}:{body}});
}
for(const mode of ["get","preview","disabled","wrong_secret","cookie_only","wrong_origin","wrong_path","query","extra_body","duplicate_body","oversize_body","bad_type","wrong_operation","expired_plan"])
test("Meta private HTTP gate rejects before execution: "+mode,async()=>{
 const x=fixture(),o={};let created=0;
 if(mode==="get")o.method="GET";if(mode==="preview")x.environment.VERCEL_ENV="preview";if(mode==="disabled")delete x.environment.ADSTABLE_META_RAW_CAPTURE_ENABLED;
 if(mode==="wrong_secret")o.auth="Bearer "+"t".repeat(43);if(mode==="cookie_only")o.auth="";
 if(mode==="wrong_origin")o.url="https://evil.example/internal/meta/raw-capture";if(mode==="wrong_path")o.url="https://embedded.adstable.app/settings";
 if(mode==="query")o.url="https://embedded.adstable.app/internal/meta/raw-capture?accountId=act_123";
 if(mode==="extra_body")o.body=JSON.stringify({operationId:x.options.operationId,accountId:"act_123"});
 if(mode==="duplicate_body")o.body='{"operationId":"'+x.options.operationId+'","operationId":"'+x.options.operationId+'"}';
 if(mode==="oversize_body")o.body="x".repeat(1025);if(mode==="bad_type")o.type="text/plain";
 if(mode==="wrong_operation")o.body=JSON.stringify({operationId:"44444444-4444-4444-8444-444444444445"});
 if(mode==="expired_plan"){x.plan.target.expiresAt=new Date(x.options.now()-1).toISOString();x.setPlan();}
 const res=await handleMetaRawCaptureRequest(request(x,o),{environment:x.environment,now:x.options.now,createExecution(){created++;throw Error();}});
 assert.ok(res.status>=400);assert.equal(created,0);assert.equal(x.calls.length,0);assert.match(res.headers.get("cache-control"),/no-store/);assert.equal((await res.json()).empty,null);
});
test("Meta private HTTP success requires both verified envelopes and paused closure",async()=>{
 const x=fixture(),res=await handleMetaRawCaptureRequest(request(x),{environment:x.environment,now:x.options.now,createExecution:()=>createMetaRawCaptureExecution(x.options)}),r=await res.json();
 assert.equal(res.status,200,JSON.stringify(r));assert.equal(r.complete,true);assert.equal(r.empty,true);assert.equal(r.contentVerified,true);
 assert.equal(r.datasets.account_performance.receiptVerified,true);assert.equal(r.datasets.product_performance.contentVerified,true);
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|access_token|credential|ciphertext/);
});
test("Meta HTTP cannot publish a forged success without content receipts",async()=>{
 const x=fixture(),res=await handleMetaRawCaptureRequest(request(x),{environment:x.environment,now:x.options.now,createExecution:()=>({run:async()=>({status:"stored",sourceStored:true,jobPaused:true,recordCount:0,empty:true}),close:async()=>{}})}),r=await res.json();
 assert.equal(res.status,409);assert.equal(r.complete,false);assert.equal(r.empty,null);assert.equal(r.recordCount,null);
});
test("Meta private owner capability cannot be forged from caller JSON or a Google proof",()=>{
 const x=fixture();assert.throws(()=>createMetaRawDatasetReader({environment:x.environment,verified:{installationAuthority:{authority:"shopify_installation_verified",status:"active",workspaceId:x.plan.target.workspaceId,installGeneration:3}},execution:{claim:{provider:"meta"}}}),/OWNER_REQUIRED/);
});
for(const mode of ["cancelled","authority","quota","permission_expired","permission_app","permission_scope","entitlement","lost_admission"])
test("Meta operation stops before report dispatch: "+mode,async()=>{
 const x=fixture();
 if(mode==="cancelled"){const controller=new AbortController();controller.abort();x.options.signal=controller.signal;}
 if(mode==="authority")x.f.authority.connectionVersion++;
 if(mode==="quota")x.f.hooks.sql=(q)=>q.includes("reserve_shared_api_quota")?{rows:[{result:{status:"waiting"}}]}:undefined;
 if(mode==="lost_admission")x.f.state.lostAdmission=true;
 x.hooks.fetch=u=>{
  if(mode==="entitlement"&&u.hostname==="partners.shopify.com")return Response.json({error:"private"},{status:403});
  if(u.pathname.endsWith("debug_token")&&mode.startsWith("permission_"))return Response.json({data:{is_valid:true,app_id:mode==="permission_app"?"999":x.environment.META_APP_ID,
   scopes:mode==="permission_scope"?["ads_read"]:["ads_read","business_management","catalog_management","pages_read_engagement","pages_show_list"],expires_at:Math.floor(x.options.now()/1000)+(mode==="permission_expired"?-1:3600)}});
 };
 const r=await createMetaRawCaptureExecution(x.options).run();assert.notEqual(r.status,"stored");assert.equal(r.empty,null);assert.equal(x.writes.length,0);
 assert.equal(x.f.http.filter(u=>u.pathname.endsWith("/insights")).length,0);
});
