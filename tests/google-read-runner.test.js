import assert from "node:assert/strict";
import test from "node:test";
import {createGoogleReadRunner} from "../app/lib/refresh/google-read-runner.server.js";
import {googleReadRunnerFixture} from "./fixtures/google-read-runner-fixture.js";

async function run(f){const r=createGoogleReadRunner(f.options);try{return await r.run();}finally{await r.close();}}
const product={name:"accounts/99/products/en~US~real-looking",offerId:"real-looking",feedLabel:"US",contentLanguage:"en",dataSource:"accounts/99/dataSources/7"};
test("existing admitted Google reader reaches native zero without source keys, policies, mapping or Shopify HTTP",async()=>{
 const f=googleReadRunnerFixture(),r=await run(f);assert.equal(r.status,"read_complete");assert.equal(r.recordCount,0);assert.equal(r.empty,true);
 assert.equal(f.httpCalls.length,3);assert.equal(r.sourceStored,false);assert.equal(r.mappingVerified,false);assert.equal(r.DatasetWritePerformed,false);
 assert.ok(!f.sqlCalls.some(x=>/evidence\.|identity\.|finish_refresh|commit_refresh/.test(x.sql)));assert.equal(f.state.closed,1);
});
for(const [name,body,status]of [["missing repeated field",{},200],["permission",{error:{message:"PRIVATE-DIAGNOSTIC"}},403],
 ["HTTP success with error",{error:{message:"PRIVATE-DIAGNOSTIC"}},200],["malformed repeated field",{products:null},200],["array body",[],200]])test("native "+name+" is classified correctly",async()=>{
 const f=googleReadRunnerFixture();f.hooks.fetch=u=>u.hostname==="merchantapi.googleapis.com"&&Response.json(body,{status});
 const r=await run(f);if(name==="missing repeated field"){assert.equal(r.status,"read_complete");assert.equal(r.recordCount,0);}else{assert.equal(r.status,"read_stopped");assert.equal(r.recordCount,null);assert.equal(r.empty,null);assert.equal(f.httpCalls.length,2);}
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE|SYNTHETIC/);
 if(name==="permission")assert.equal(r.reason,"provider_permission_denied");
});
test("nonempty response reports its true count and returns no product payload",async()=>{
 const f=googleReadRunnerFixture();f.hooks.fetch=u=>u.hostname==="merchantapi.googleapis.com"&&Response.json({products:[product]});const r=await run(f);
 assert.equal(r.status,"read_complete");assert.equal(r.recordCount,1);assert.equal(r.empty,false);assert.doesNotMatch(JSON.stringify(r),/real-looking|dataSource/);
});
test("empty intermediate page cannot become a premature zero",async()=>{
 const f=googleReadRunnerFixture();f.hooks.fetch=u=>u.hostname==="merchantapi.googleapis.com"&&Response.json(u.searchParams.has("pageToken")?{products:[product]}:{products:[],nextPageToken:"next"});
 const r=await run(f);assert.equal(r.recordCount,1);assert.equal(r.pages,2);assert.equal(f.httpCalls.length,4);
});
test("page bound and aggregate response byte bound cannot be reported as zero",async()=>{
 for(const kind of ["pages","bytes"]){const f=googleReadRunnerFixture();if(kind==="pages"){f.options.configuration.limits.maxPages=1;f.hooks.fetch=u=>u.hostname==="merchantapi.googleapis.com"&&Response.json({products:[],nextPageToken:"next"});}
  else f.options.configuration.limits.maxBytes=8;const r=await run(f);assert.equal(r.status,"read_stopped");assert.equal(r.recordCount,null);if(kind==="bytes")assert.equal(r.reason,"response_limit");}
});
test("quota wait, role failure and missing context prevent every native request",async()=>{
 for(const key of ["wait","profile","contextMissing"]){const f=googleReadRunnerFixture();f.state[key]=key!=="profile";const r=await run(f);assert.equal(r.status,"read_stopped");assert.equal(r.recordCount,null);assert.equal(f.httpCalls.length,0);}
});
test("expired credential and lost quota acknowledgement never produce zero or retry",async()=>{
 for(const kind of ["expired","lost"]){const f=googleReadRunnerFixture();if(kind==="expired")f.token.expires_at=new Date(f.options.now()-1).toISOString();
  else f.hooks.sql=sql=>{if(sql.includes("reserve_shared_api_quota"))throw Error("PRIVATE-LOST");};const r=await run(f);assert.equal(r.status,"read_stopped");assert.equal(r.recordCount,null);assert.equal(f.httpCalls.length,0);}
});
test("current authority is checked after the native response",async()=>{
 for(const kind of ["context","clock"]){const f=googleReadRunnerFixture();let time=f.options.now();f.options.now=()=>time;
  f.hooks.fetch=(u,i,n)=>{if(n===3){if(kind==="context")f.state.contextMissing=true;else time--;}};
  const r=await run(f);assert.equal(r.status,"read_stopped");assert.equal(r.recordCount,null);}
});
test("bounded deadline settles a hung native call without a second attempt",async()=>{
 const f=googleReadRunnerFixture();f.options.configuration.limits.maxElapsedMs=30;f.hooks.fetch=()=>new Promise(()=>{});const r=await run(f);assert.equal(r.status,"read_stopped");assert.equal(r.recordCount,null);assert.equal(f.httpCalls.length,1);
});
test("one execution has no re-entry, override or post-close restart",async()=>{
 const f=googleReadRunnerFixture(),r=createGoogleReadRunner(f.options);await r.run();await assert.rejects(r.run(),/EXECUTION_USED/);await assert.rejects(r.run({}),/EXECUTION_USED/);await r.close();await assert.rejects(r.run(),/EXECUTION_USED/);
});
test("constructor captures caller/plan inputs before an asynchronous SQL acquisition",async()=>{
 const f=googleReadRunnerFixture(),r=createGoogleReadRunner(f.options);f.options.configuration.merchantId="88";f.options.verified.identity.shop.shopId="gid://shopify/Shop/99";
 const out=await r.run();assert.equal(out.recordCount,0);await r.close();
});
test("invalid caller, target or hidden storage option fails without database acquisition",()=>{
 for(const change of [x=>{x.configuration.sourcePolicy={};},x=>{x.verified.installationAuthority.workspaceId="bad";},x=>{x.configuration.merchantId="0";},x=>{x.execution.claim.provider="meta";}]){
  const f=googleReadRunnerFixture();let pools=0;f.options.poolFactory=()=>{pools++;};change(f.options);assert.throws(()=>createGoogleReadRunner(f.options),/CONFIGURATION_REQUIRED/);assert.equal(pools,0);
 }
});
