import assert from "node:assert/strict";
import test from "node:test";
import {createGoogleReadRunner} from "../app/lib/refresh/google-read-runner.server.js";
import {googleReadRunnerFixture} from "./fixtures/google-read-runner-fixture.js";

function fixture(expired=true) {
  const f=googleReadRunnerFixture(),renewals=[];
  const options={...f.options,environment:{...f.options.environment,GOOGLE_ADS_OAUTH_CLIENT_ID:"SYNTHETIC-CLIENT",
    GOOGLE_ADS_OAUTH_CLIENT_SECRET:"SYNTHETIC-SECRET",
    GOOGLE_ADS_OAUTH_REDIRECT_URI:"https://embedded.adstable.app/auth/google-ads/callback"}};
  if(expired){f.token.scope_verified_at=new Date(options.now()-3600001).toISOString();
    f.token.expires_at=new Date(options.now()-1).toISOString();}
  let stored=f.token,credential="33333333-3333-4333-8333-333333333333";
  const poolFactory=options.poolFactory;
  options.poolFactory=()=>{const pool=poolFactory();return {...pool,async connect(){const c=await pool.connect();return {...c,async query(sql,args){
    const result=await c.query(sql,args);
    if(sql.includes("load_provider_identity_authority"))result.rows[0].credential_id=credential;
    return result;
  }};}};};
  options.tokenVault={async loadProviderTokenSet(){return stored;},async renewGoogleIdentityCredential(input){
    renewals.push(input);assert.deepEqual(input.refreshExecution,options.execution);
    assert.equal(input.expectedVersion,2);assert.equal(input.expectedCredentialId,credential);
    stored=input.tokenSet;credential="55555555-5555-4555-8555-555555555555";f.state.version++;
    return {renewalId:input.renewalId,connectionId:input.connectionId,credentialId:credential,version:3,status:"connected"};
  }};
  f.hooks.fetch=(url,init)=>{
    if(url.hostname==="oauth2.googleapis.com"){
      assert.equal(init.method,"POST");assert.equal(init.redirect,"error");
      assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)),{client_id:"SYNTHETIC-CLIENT",
        client_secret:"SYNTHETIC-SECRET",refresh_token:"SYNTHETIC-REFRESH",grant_type:"refresh_token"});
      return Response.json({access_token:"SYNTHETIC-NEW",expires_in:3600,token_type:"Bearer",scope:f.token.scope});
    }
    if(expired)assert.equal(new Headers(init.headers).get("authorization"),"Bearer SYNTHETIC-NEW");
  };
  return {f,options,renewals,run:async()=>{const r=createGoogleReadRunner(options);try{return await r.run();}finally{await r.close();}}};
}

test("existing admitted refresh renews an expired token once then reads real adapter pages using the replacement",async()=>{
  const x=fixture(),result=await x.run();assert.equal(result.status,"read_complete",JSON.stringify({result,
    renewals:x.renewals.length,http:x.f.httpCalls.map(u=>u.hostname)}));assert.equal(result.recordCount,0);
  assert.equal(x.renewals.length,1);assert.equal(x.f.httpCalls[0].hostname,"oauth2.googleapis.com");
  assert.equal(x.f.httpCalls.filter(u=>u.hostname==="oauth2.googleapis.com").length,1);
  assert.equal(x.f.httpCalls.filter(u=>u.hostname==="merchantapi.googleapis.com").length,1);
  assert.equal(x.renewals[0].tokenSet.refresh_token,"SYNTHETIC-REFRESH");
  assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC|access_token|refresh_token|client_secret|credentialId/);
});
test("valid token is reused by refresh without any renewal or token HTTP",async()=>{
  const x=fixture(false);assert.equal((await x.run()).status,"read_complete");assert.equal(x.renewals.length,0);
  assert.ok(x.f.httpCalls.every(u=>u.hostname!=="oauth2.googleapis.com"));
});
for(const mode of ["provider_rejection","network","missing_scope","scope_changed","bad_token","short_expiry",
  "oversize","scope_before","missing_refresh","drift_before","drift_after","lost_commit","bad_commit","readback_drift","abort"]){
  test("expired refresh stops before data reads, without retry or fake zero: "+mode,async()=>{
    const x=fixture(),fetch=x.f.hooks.fetch,renew=x.options.tokenVault.renewGoogleIdentityCredential,
      controller=new AbortController();x.options.signal=controller.signal;
    if(mode==="missing_refresh")delete x.f.token.refresh_token;
    if(mode==="scope_before")x.f.token.scope="https://www.googleapis.com/auth/adwords";
    if(mode==="drift_before"){
      const load=x.options.tokenVault.loadProviderTokenSet;
      x.options.tokenVault.loadProviderTokenSet=async args=>{x.f.state.version++;return load(args);};
    }
    x.f.hooks.fetch=(url,init)=>{
      if(url.hostname!=="oauth2.googleapis.com")return fetch(url,init);
      if(mode==="provider_rejection")return Response.json({error:"invalid_grant",description:"PRIVATE"},{status:400});
      if(mode==="network")throw Error("PRIVATE SYNTHETIC-SECRET");
      if(mode==="oversize")return new Response("x".repeat(65537));
      if(["missing_scope","scope_changed","bad_token","short_expiry"].includes(mode))return Response.json({
        access_token:mode==="bad_token"?"SYNTHETIC bad":"SYNTHETIC-NEW",token_type:"Bearer",
        expires_in:mode==="short_expiry"?30:3600,
        scope:mode==="missing_scope"?undefined:x.f.token.scope+(mode==="scope_changed"?" extra":"")});
      if(mode==="drift_after")x.f.state.version++;
      if(mode==="abort")controller.abort();
      return fetch(url,init);
    };
    if(mode==="lost_commit")x.options.tokenVault.renewGoogleIdentityCredential=async args=>{await renew(args);throw Error("PRIVATE lost acknowledgement");};
    if(mode==="bad_commit")x.options.tokenVault.renewGoogleIdentityCredential=async args=>({...await renew(args),version:4});
    if(mode==="readback_drift")x.options.tokenVault.renewGoogleIdentityCredential=async args=>{const r=await renew(args);x.f.state.version++;return r;};
    const result=await x.run();assert.equal(result.status,"read_stopped");assert.equal(result.recordCount,null);assert.equal(result.empty,null);
    assert.ok(x.f.httpCalls.length<=1);assert.ok(x.renewals.length<=1);
    assert.ok(x.f.httpCalls.every(u=>u.hostname==="oauth2.googleapis.com"));
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SYNTHETIC|access_token|refresh_token|client_secret/);
  });
}
