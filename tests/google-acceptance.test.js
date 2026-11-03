import assert from "node:assert/strict";
import test from "node:test";
import {createGoogleAcceptanceExecution,readGoogleAcceptancePlan} from "../app/lib/refresh/google-acceptance-server.server.js";
import {handleGoogleAcceptanceRequest,GOOGLE_ACCEPTANCE_HEADER} from "../app/lib/refresh/google-acceptance-request.server.js";
import {createGoogleAcceptanceCoordinatorPostgresClient,GOOGLE_ACCEPTANCE_COORDINATOR_RPC} from "../app/lib/database/google-acceptance-coordinator-postgres.server.js";
import {googleAcceptanceFixture} from "./fixtures/google-acceptance-fixture.js";
const run=f=>createGoogleAcceptanceExecution(f.options).run();
test("admission, real reader native zero and guarded paused closure are one execution, never a Dataset",async()=>{
 const f=googleAcceptanceFixture(),r=await run(f);assert.equal(r.status,"observed",JSON.stringify({r,state:f.state}));assert.equal(r.recordCount,0);assert.equal(r.empty,true);
 assert.equal(r.jobPaused,true);assert.equal(f.state.paused,1);assert.equal(f.http.length,4);assert.equal(f.state.closed,1);
 assert.equal(f.f.state.closed,1);assert.equal(f.state.phase,"response_received");assert.equal(r.DatasetWritePerformed,false);
 assert.ok(!f.calls.some(c=>c.args?.includes("ready_for_dataset")||c.args?.includes("completed")));
});
test("fresh entitlement denied never calls Google or finishes a claim",async()=>{
 const f=googleAcceptanceFixture();f.hooks.fetch=u=>u.hostname==="partners.shopify.com"&&Response.json({data:{activeSubscription:null}});
 const r=await run(f);assert.equal(r.status,"stopped");assert.equal(r.recordCount,null);assert.equal(f.f.httpCalls.length,0);assert.equal(f.state.paused,0);assert.equal(f.state.stops,1);
});
test("a repeated operation is durable non-replay even after the successful claim was paused",async()=>{
 const f=googleAcceptanceFixture();assert.equal((await run(f)).status,"observed");const count=f.http.length;
 const r=await run(f);assert.equal(r.status,"stopped");assert.equal(f.http.length,count);assert.equal(f.state.admissions,1);
});
test("lost admission acknowledgement never advances, retries or releases",async()=>{
 const f=googleAcceptanceFixture();f.state.lostAdmission=true;const r=await run(f);assert.equal(r.status,"stopped");assert.equal(r.reservationMayExist,true);
 assert.equal(f.state.admissions,1);assert.equal(f.http.length,0);assert.equal(f.state.paused,0);assert.equal(f.state.stops,0);
});
for(const kind of ["queue","budget","role","scope","merchant","account","expiry"]){test("preconditions stop before Google: "+kind,async()=>{
 const f=googleAcceptanceFixture();
 if(kind==="queue")f.state.configured=false;
 if(kind==="budget")f.budget.global.requests=0;
 if(kind==="role")f.state.profile=false;
 if(kind==="scope")f.f.token.scope="https://www.googleapis.com/auth/adwords";
 if(kind==="merchant")f.f.context.merchant.quotaAccountId="97";
 if(kind==="account")f.source.accountId="999";
 if(kind==="expiry")f.f.token.expires_at=new Date(f.options.now()-1).toISOString();
 const r=await run(f);assert.equal(r.status,"stopped");assert.equal(r.recordCount,null);assert.equal(f.f.httpCalls.length,0);assert.equal(f.state.paused,0);
 });}
for(const kind of ["permission","pagination","drift","closure"]){test("native failure/late drift cannot publish or claim accepted zero: "+kind,async()=>{
 const f=googleAcceptanceFixture();
 if(kind==="permission")f.f.hooks.fetch=u=>u.hostname==="merchantapi.googleapis.com"&&Response.json({error:{message:"PRIVATE"}},{status:403});
 if(kind==="pagination")f.f.hooks.fetch=u=>u.hostname==="merchantapi.googleapis.com"&&Response.json({products:[],nextPageToken:"more"});
 if(kind==="drift")f.f.hooks.fetch=(u,i,n)=>{if(n===3)f.authority.connectionVersion++;};
 if(kind==="closure")f.hooks.sql=sql=>sql.includes("finish_refresh_work")?{rows:[{result:false}]}:undefined;
 const r=await run(f);assert.equal(r.status,"stopped");assert.equal(r.recordCount,null);assert.equal(f.state.paused,0);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE|SYNTHETIC/);
 });}
test("operator config is strict, bounded and detached before asynchronous work",async()=>{
 const f=googleAcceptanceFixture(),execution=createGoogleAcceptanceExecution(f.options);
 f.plan.accountId="999";f.setPlan();const r=await execution.run();assert.equal(r.status,"observed");await assert.rejects(execution.run(),/EXECUTION_USED/);
 for(const change of [p=>p.extra=true,p=>p.window.from="2026-02-30",p=>p.expiresAt="2000-01-01",p=>p.merchantId="0"]){const x=googleAcceptanceFixture();change(x.plan);x.setPlan();assert.throws(()=>readGoogleAcceptancePlan(x.options.environment,x.options.now()),/CONFIGURATION_REQUIRED/);}
});
test("closed or malformed HTTP gate performs no authentication, SQL or native I/O",async()=>{
 for(const kind of ["closed","id","extra","large"]){const f=googleAcceptanceFixture();let auth=0;
 if(kind==="closed")delete f.options.environment.ADSTABLE_GOOGLE_ACCEPTANCE_ENABLED;
 const body={mode:"step15_google_zero_acceptance",operationId:kind==="id"?"bad":f.plan.operationId,...kind==="extra"?{verified:f.options.verified}:{} };
 const request=new Request("https://example.com/settings/google-live-evidence",{method:"POST",headers:{[GOOGLE_ACCEPTANCE_HEADER]:"v1","content-type":"application/json"},body:kind==="large"?"x".repeat(1025):JSON.stringify(body)});
 const response=await handleGoogleAcceptanceRequest({...f.options,request,authenticateAdmin(){auth++;throw Error();}});
 assert.ok(response.status>=400);assert.equal(auth,0);assert.equal(f.calls.length,0);assert.equal(f.http.length,0);
 }
});
test("authenticated HTTP mode uses the real read-only Shopify authority resolver and one Admin try",async()=>{
 const f=googleAcceptanceFixture();let auth=0,admin=0;
 const request=new Request("https://example.com/settings/google-live-evidence",{method:"POST",headers:{[GOOGLE_ACCEPTANCE_HEADER]:"v1","content-type":"application/json"},body:JSON.stringify({mode:"step15_google_zero_acceptance",operationId:f.plan.operationId})});
 const response=await handleGoogleAcceptanceRequest({...f.options,request,authenticateAdmin:async()=>{auth++;return {sessionToken:{dest:"https://test.myshopify.com/"},admin:{graphql(q,o){admin++;assert.equal(o.tries,1);return Response.json({data:{shop:{id:f.plan.shopId,myshopifyDomain:f.plan.shopDomain}}});}}};}});
 assert.equal(response.status,200,await response.clone().text());assert.equal(auth,1);assert.equal(admin,1);assert.equal((await response.json()).recordCount,0);
});
test("coordinator adapter exposes only17 existing RPCs and refuses raw SQL and wrong role URL",async()=>{
 const f=googleAcceptanceFixture();assert.equal(GOOGLE_ACCEPTANCE_COORDINATOR_RPC.length,17);
 const db=createGoogleAcceptanceCoordinatorPostgresClient({environment:f.options.environment,poolFactory:f.options.coordinatorPoolFactory});
 await assert.rejects(db.query("select * from integrations.provider_credential_envelopes"),/UNAVAILABLE/);assert.equal(f.calls.length,0);await db.close();
 assert.throws(()=>createGoogleAcceptanceCoordinatorPostgresClient({environment:{...f.options.environment,ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DATABASE_URL:f.options.environment.ADSTABLE_GOOGLE_SOURCE_DATABASE_URL}}),/CONFIGURATION_REQUIRED/);
});
test("concurrent copies of the same operation admit once across independent server executions",async()=>{
 const f=googleAcceptanceFixture(),results=await Promise.all([run(f),run(f)]);
 assert.deepEqual(results.map(x=>x.status).sort(),["observed","stopped"]);assert.equal(f.state.admissions,1);assert.equal(f.http.length,4);
});
test("abort during native HTTP retains an unresolved job and never finishes it",async()=>{
 const f=googleAcceptanceFixture(),controller=new AbortController();f.options.signal=controller.signal;
 f.f.hooks.fetch=()=>{controller.abort();return new Promise(()=>{});};
 const r=await run(f);assert.equal(r.status,"stopped");assert.equal(r.recordCount,null);assert.equal(f.state.paused,0);assert.equal(f.state.stops,1);
});
test("lost paused acknowledgement is reported unknown without reissuing finish or provider HTTP",async()=>{
 const f=googleAcceptanceFixture();let finishes=0;
 f.hooks.sql=sql=>{if(sql.includes("finish_refresh_work")){finishes++;f.state.paused++;throw Error("SYNTHETIC-LOST");}};
 const r=await run(f);assert.equal(r.status,"stopped");assert.equal(r.reservationMayExist,true);assert.equal(finishes,1);assert.equal(f.state.paused,1);assert.equal(f.http.length,4);
});
test("missing source configuration and overlong DB deadlines reject before creating pools or HTTP",()=>{
 for(const key of ["GOOGLE_ADS_DEVELOPER_TOKEN","ADSTABLE_GOOGLE_SOURCE_DATABASE_URL","ADSTABLE_GOOGLE_SOURCE_DB_TIMEOUT_MS"]){
  const f=googleAcceptanceFixture();if(key.endsWith("TIMEOUT_MS"))f.options.environment[key]="30000";else delete f.options.environment[key];
  assert.throws(()=>createGoogleAcceptanceExecution(f.options));assert.equal(f.calls.length,0);assert.equal(f.http.length,0);
 }
});
test("selection drift immediately after paused finish cannot return an accepted zero",async()=>{
 const f=googleAcceptanceFixture();f.hooks.sql=sql=>{if(sql.includes("finish_refresh_work")){f.state.paused++;f.f.state.version++;return {rows:[{result:true}]};}};
 const r=await run(f);assert.equal(r.status,"stopped");assert.equal(r.recordCount,null);assert.equal(r.jobPaused,true);assert.equal(r.reservationMayExist,false);assert.equal(f.http.length,4);
});
test("an aborted vault read settles the operation and a late vault value cannot start admission",async()=>{
 const f=googleAcceptanceFixture(),controller=new AbortController();let release;
 f.options.signal=controller.signal;f.options.tokenVault={loadProviderTokenSet(){controller.abort();return new Promise(resolve=>release=resolve);}};
 const r=await run(f);assert.equal(r.status,"stopped");assert.equal(f.state.admissions,0);assert.equal(f.http.length,0);
 release(f.f.token);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.state.admissions,0);assert.equal(f.http.length,0);
});
test("HTTP authority errors are sanitized, never retried, and cannot open a coordinator pool",async()=>{
 const f=googleAcceptanceFixture();let auth=0;
 const request=new Request("https://example.com/settings/google-live-evidence",{method:"POST",headers:{[GOOGLE_ACCEPTANCE_HEADER]:"v1","content-type":"application/json"},body:JSON.stringify({mode:"step15_google_zero_acceptance",operationId:f.plan.operationId})});
 const response=await handleGoogleAcceptanceRequest({...f.options,request,authenticateAdmin:async()=>{auth++;throw Error("SYNTHETIC-PRIVATE-CREDENTIAL");}});
 assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/SYNTHETIC|PRIVATE|CREDENTIAL/);assert.equal(auth,1);assert.equal(f.calls.length,0);assert.equal(f.http.length,0);
});
