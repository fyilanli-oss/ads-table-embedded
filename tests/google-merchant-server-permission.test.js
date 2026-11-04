import test from "node:test";
import assert from "node:assert/strict";
import {googleRawServerFixture} from "./fixtures/google-raw-server-fixture.js";
import {createGoogleMerchantServerExecution} from "../app/lib/refresh/google-merchant-server.server.js";
import {handleGoogleMerchantServerRequest} from "../app/lib/refresh/google-merchant-request.server.js";

function fixture(){
 const x=googleRawServerFixture(),p=x.plan.target,plan=Object.fromEntries(["operationId","workspaceId","installGeneration","shopId","shopDomain",
  "connectionId","connectionVersion","credentialId","selectionId","accountId","expiresAt"].map(k=>[k,p[k]]));
 const secret="s".repeat(43),setPlan=()=>{x.environment.ADSTABLE_GOOGLE_MERCHANT_DISCOVERY_PLAN=JSON.stringify(plan);};setPlan();
 Object.assign(x.environment,{VERCEL_ENV:"production",SHOPIFY_APP_URL:"https://embedded.adstable.app",ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET:secret});
 for(const k of Object.keys(x.environment))if(/GOOGLE_RAW_CAPTURE_(PLAN|ENABLED)|GOOGLE_SOURCE_|GOOGLE_ACCEPTANCE_|SOURCE_EVIDENCE_/.test(k))delete x.environment[k];
 const request=({method="POST",url="https://embedded.adstable.app/internal/google/merchant-links",auth=`Bearer ${secret}`,type="application/json",body=JSON.stringify({operationId:plan.operationId}),signal}={})=>
  new Request(url,{method,headers:{authorization:auth,"content-type":type},...method==="GET"?{}:{body},signal});
 const options={environment:x.environment,now:x.options.now,createExecution:args=>createGoogleMerchantServerExecution({...x.options,...args})};
 return {x,plan,setPlan,request,options};
}

for(const mode of ["one","none","multiple","expired"])test("private Merchant entry uses actual reader without browser or source/job config: "+mode,async()=>{
 const {x,request,options}=fixture();if(mode==="expired")x.expire();
 if(["none","multiple"].includes(mode))x.hooks.fetch=u=>u.hostname==="googleads.googleapis.com"?Response.json({results:mode==="none"?[]:["99","101"].map((id,i)=>({productLink:{resourceName:`customers/${x.plan.target.accountId}/productLinks/${i+1}`,productLinkId:String(i+1),type:"MERCHANT_CENTER",merchantCenter:{merchantCenterId:id}}}))}):undefined;
 const r=await handleGoogleMerchantServerRequest(request(),options),v=await r.json();
 assert.equal(r.status,200,JSON.stringify({v,sql:x.calls.map(c=>c.sql)}));assert.equal(v.complete,true);
 assert.deepEqual(v.merchant_ids,mode==="none"?[]:mode==="multiple"?["101","99"]:["99"]);
 assert.equal(v.link_count,mode==="none"?0:mode==="multiple"?2:1);assert.equal(v.has_linked_merchant,mode!=="none");
 assert.equal(v.credential_renewed,mode==="expired");assert.equal(v.product_read_performed,false);assert.equal(v.authorizes_activation,false);
 assert.equal(x.f.http.filter(u=>u.hostname==="googleads.googleapis.com").length,1);
 assert.equal(x.f.http.filter(u=>u.hostname==="oauth2.googleapis.com").length,mode==="expired"?1:0);
 assert.equal(x.calls.some(c=>/commit_google_identity_source|operations\.|source_rule/.test(c.sql)),false);
 assert.equal(x.f.http.some(u=>u.hostname==="merchantapi.googleapis.com"||u.hostname.endsWith("myshopify.com")),false);
 assert.doesNotMatch(JSON.stringify(v),/SYNTHETIC|ciphertext|access_token|refresh_token|credentialId|connectionVersion/);
});

for(const mode of ["method","disabled","preview","missing_secret","wrong_secret","unicode_secret","query","origin","path","body_owner","wrong_operation","oversize","content_type","expired_plan","renewal_purpose","abort"])
 test("private Merchant gate rejects with zero database/native I/O: "+mode,async()=>{
 const {x,plan,setPlan,request,options}=fixture(),input={};let created=0;
 if(mode==="method")input.method="GET";
 if(mode==="disabled")delete x.environment.ADSTABLE_GOOGLE_MERCHANT_DISCOVERY_PLAN;
 if(mode==="preview")x.environment.VERCEL_ENV="preview";
 if(mode==="missing_secret")delete x.environment.ADSTABLE_GOOGLE_RAW_CAPTURE_SERVER_SECRET;
 if(mode==="wrong_secret")input.auth="Bearer "+"x".repeat(43);
 if(mode==="unicode_secret")input.auth="Bearer "+"ü".repeat(43);
 if(mode==="query")input.url="https://embedded.adstable.app/internal/google/merchant-links?account=9";
 if(mode==="origin")input.url="https://other.example/internal/google/merchant-links";
 if(mode==="path")input.url="https://embedded.adstable.app/internal/google/raw-capture";
 if(mode==="body_owner")input.body=JSON.stringify({operationId:plan.operationId,verified:{},merchantId:"99"});
 if(mode==="wrong_operation")input.body=JSON.stringify({operationId:"11111111-1111-4111-8111-111111111111"});
 if(mode==="oversize")input.body="x".repeat(1025);
 if(mode==="content_type")input.type="text/plain";
 if(mode==="expired_plan"){plan.expiresAt=new Date(x.options.now()-1).toISOString();setPlan();}
 if(mode==="renewal_purpose"){plan.purpose="renew_credential";setPlan();}
 if(mode==="abort"){const c=new AbortController();c.abort();input.signal=c.signal;}
 const r=await handleGoogleMerchantServerRequest(request(input),{...options,createExecution:()=>{created++;throw Error("PRIVATE");}});
 assert.ok(r.status>=400);assert.equal(created,0);assert.equal(x.calls.length,0);assert.equal(x.f.http.length,0);
 assert.doesNotMatch(await r.text(),/PRIVATE|SYNTHETIC/);
});

for(const mode of ["permission","partial","oversize","identity_drift","owner_missing","renewal_denied","renewal_lost_commit","late_abort"])
 test("Merchant failure is never empty success, retry or subsequent product read: "+mode,async()=>{
 const {x,request,options}=fixture(),controller=new AbortController();let renewalWrite=false;
 if(mode==="identity_drift")x.f.authority.connectionVersion++;
 if(mode==="owner_missing")x.hooks.runtime=sql=>sql.includes("load_active_installation_owner")?{rows:[]}:undefined;
 if(mode.startsWith("renewal_"))x.expire();
 x.hooks.fetch=u=>{
  if(mode==="renewal_denied"&&u.hostname==="oauth2.googleapis.com")return Response.json({error:"invalid_grant",error_description:"PRIVATE"},{status:400});
  if(u.hostname!=="googleads.googleapis.com")return;
  if(mode==="permission")return Response.json({error:{code:403,status:"PERMISSION_DENIED",message:"PRIVATE"}},{status:403});
  if(mode==="partial")return Response.json({results:[],nextPageToken:"more"});
  if(mode==="oversize")return new Response("x".repeat(1048577));
  if(mode==="late_abort"){controller.abort();return Response.json({results:[]});}
 };
 if(mode==="renewal_lost_commit")x.hooks.runtime=sql=>{if(sql.includes("commit_google_identity_renewal"))renewalWrite=true;if(renewalWrite&&sql==="commit")throw Error("PRIVATE-LOST");};
 const r=await handleGoogleMerchantServerRequest(request({signal:controller.signal}),options),v=await r.json();
 assert.notEqual(r.status,200);assert.equal(v.complete,false);assert.equal(v.merchant_ids,null);assert.equal(v.link_count,null);
 assert.equal(v.provider_retry_performed,false);assert.equal(v.product_read_performed,false);
 const googleCalls=x.f.http.filter(u=>u.hostname==="googleads.googleapis.com").length;
 assert.ok(googleCalls<=1);if(mode.startsWith("renewal_")||mode==="identity_drift"||mode==="owner_missing")assert.equal(googleCalls,0);
 assert.doesNotMatch(JSON.stringify(v),/PRIVATE|ciphertext|SYNTHETIC/);
});

test("Merchant execution is single-use and sanitizes arbitrary result fields",async()=>{
 const {x,request,options}=fixture(),e=createGoogleMerchantServerExecution(x.options);
 assert.equal((await e.run()).status,"observed");await assert.rejects(e.run(),/EXECUTION_USED/);
 const r=await handleGoogleMerchantServerRequest(request(),{...options,createExecution:()=>({run:async()=>({status:"observed",complete:true,
  merchant_ids:["99"],link_count:1,has_linked_merchant:true,access_token:"PRIVATE",payload:{secret:"PRIVATE"}}),close:async()=>{}})});
 assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/PRIVATE|access_token|payload/);
});
