import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import test from "node:test";
import {GOOGLE_SOURCE_RPC,GOOGLE_SOURCE_ROLE,GOOGLE_SOURCE_ROLE_CHECK_SQL,readGoogleSourceDatabaseConfig,createGoogleSourcePostgresClient} from "../app/lib/database/google-source-postgres.server.js";
import {createConfiguredSourceEvidenceCipher,readSourceStoragePolicy} from "../app/lib/database/source-evidence-config.server.js";
import {sourceStoreFixture} from "./fixtures/source-store-fixture.js";
import {createGoogleSourceServerExecution} from "../app/lib/refresh/google-source-server.server.js";
import {createShopifyAdminIdentitySdkBridge} from "../app/lib/refresh/shopify-admin-sdk-quota-bridge.server.js";
import {abstractFetch,setAbstractFetchFunc} from "@shopify/shopify-api/runtime";

const key=()=>randomBytes(32).toString("base64url");
const environment=()=>({ADSTABLE_GOOGLE_SOURCE_DATABASE_URL:"postgresql://"+GOOGLE_SOURCE_ROLE+".podpwkrpmjiksskxhwsu:"+"x".repeat(32)+"@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",
 ADSTABLE_GOOGLE_SOURCE_DB_TIMEOUT_MS:"1000",ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION:"1",ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1:key(),
 ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:key(),ADSTABLE_SESSION_ENCRYPTION_KEY_V1:key()});
const receipt=GOOGLE_SOURCE_RPC.find(([s])=>s.includes("read_source_receipt"))[0],write=GOOGLE_SOURCE_RPC.find(([s])=>s.includes("commit_verified_mapping"))[0];
function fixture(options={}){
 const calls=[],releases=[];let onError;
 const pool={on(name,fn){if(name==="error")onError=fn;},async end(){calls.push(["end"]);},async connect(){calls.push(["connect"]);if(options.acquire)await options.acquire();
  return {async query(sql,args){calls.push([sql,args]);if(options.fail===sql)throw Error("SENSITIVE-INTERNAL");
   if(sql===GOOGLE_SOURCE_ROLE_CHECK_SQL)return {rows:[{role:options.role??GOOGLE_SOURCE_ROLE,profile_ready:options.ready??true}]};return {rows:[{result:true}]};},release(broken){releases.push(broken);}};}};
 return {calls,releases,onError:()=>onError(Error("SENSITIVE-IDLE")),poolFactory:()=>pool};
}

test("source cipher loads a distinct explicit key and retains owned copies after configuration cleanup",()=>{
 const env=environment(),cipher=createConfiguredSourceEvidenceCipher(env),{input}=sourceStoreFixture();
 const sealed=cipher.seal({owner:input.owner,attemptId:input.attemptId,ordinal:0,page:input.pages[0],payload:{records:[{id:"123"}]}});
 assert.deepEqual(cipher.open({owner:input.owner,attemptId:input.attemptId,ordinal:0,page:sealed}),{records:[{id:"123"}]});
 assert.equal(JSON.stringify(cipher),"{}");
});
for(const [name,change]of [
 ["missing active",e=>{delete e.ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION;}],
 ["missing source key",e=>{delete e.ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1;}],
 ["unavailable version",e=>{e.ADSTABLE_SOURCE_EVIDENCE_ACTIVE_KEY_VERSION="2";}],
 ["session reuse",e=>{e.ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1=e.ADSTABLE_SESSION_ENCRYPTION_KEY_V1;}],
 ["provider reuse",e=>{e.ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1=e.ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1;}],
 ["source version reuse",e=>{e.ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V2=e.ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1;}],
 ["malformed version",e=>{e.ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V01=key();}],
 ["missing session exclusion",e=>{delete e.ADSTABLE_SESSION_ENCRYPTION_KEY_V1;}],
 ["missing provider exclusion",e=>{delete e.ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1;}],
])test("source key configuration rejects "+name,()=>{
 const env=environment();change(env);assert.throws(()=>createConfiguredSourceEvidenceCipher(env),/^Error: SOURCE_EVIDENCE_CONFIGURATION_REQUIRED$/);
});
test("explicit finite class policies are detached and metadata cannot expire before supporting evidence",()=>{
 const {input}=sourceStoreFixture(),now=Date.now(),p=readSourceStoragePolicy(input.policy,now);
 input.policy.raw.version="changed";assert.notEqual(p.raw.version,"changed");assert.ok(Object.isFrozen(p.raw));
 for(const change of [x=>{delete x.raw;},x=>{x.identity.until=new Date(now-1).toISOString();},x=>{x.metadata.until=new Date(now+1).toISOString();},x=>{x.claim.version="";},x=>{x.extra={};}]){
  const q=structuredClone(p);change(q);assert.throws(()=>readSourceStoragePolicy(q,now),/CONFIGURATION_REQUIRED/);
 }
});
for(const [name,change]of [
 ["runtime role",e=>{e.ADSTABLE_GOOGLE_SOURCE_DATABASE_URL=e.ADSTABLE_GOOGLE_SOURCE_DATABASE_URL.replace(GOOGLE_SOURCE_ROLE,"adstable_runtime");}],
 ["owner role",e=>{e.ADSTABLE_GOOGLE_SOURCE_DATABASE_URL=e.ADSTABLE_GOOGLE_SOURCE_DATABASE_URL.replace(GOOGLE_SOURCE_ROLE,"adstable_owner");}],
 ["wrong project",e=>{e.ADSTABLE_GOOGLE_SOURCE_DATABASE_URL=e.ADSTABLE_GOOGLE_SOURCE_DATABASE_URL.replace("podpwkrpmjiksskxhwsu","other");}],
 ["unverified TLS",e=>{e.ADSTABLE_GOOGLE_SOURCE_DATABASE_URL=e.ADSTABLE_GOOGLE_SOURCE_DATABASE_URL.replace("sslmode=require","sslmode=disable");}],
 ["extra connection option",e=>{e.ADSTABLE_GOOGLE_SOURCE_DATABASE_URL+="&options=unsafe";}],
 ["missing timeout",e=>{delete e.ADSTABLE_GOOGLE_SOURCE_DB_TIMEOUT_MS;}],
 ["unbounded timeout",e=>{e.ADSTABLE_GOOGLE_SOURCE_DB_TIMEOUT_MS="30001";}],
])test("source database config rejects "+name,()=>{const e=environment();change(e);assert.throws(()=>readGoogleSourceDatabaseConfig(e),/CONFIGURATION_REQUIRED/);});
test("one checked-out connection binds role, timeout, RPC and commit with verified TLS",async()=>{
 const f=fixture();let config;const db=createGoogleSourcePostgresClient({environment:environment(),poolFactory:c=>{config=c;return f.poolFactory();}});
 await db.query(receipt,["{}","id",0]);assert.equal(config.max,1);assert.equal(config.ssl.rejectUnauthorized,true);
 assert.deepEqual(f.calls.map(x=>x[0]),["connect","begin","select pg_catalog.set_config('statement_timeout',$1,true),pg_catalog.set_config('lock_timeout',$1,true)",GOOGLE_SOURCE_ROLE_CHECK_SQL,receipt,"commit"]);
 assert.deepEqual(f.releases,[false]);await db.close();
});
test("SQL outside the exact profile and wrong arity fail before pool acquisition",async()=>{
 const f=fixture(),db=createGoogleSourcePostgresClient({environment:environment(),poolFactory:f.poolFactory});
 for(const sql of ["select * from identity.product_identity_mappings","set role adstable_owner","select privacy.process_deletion_queue(1)",write+"; select 1",receipt.toUpperCase()])await assert.rejects(db.query(sql,[]),/UNAVAILABLE/);
 await assert.rejects(db.query(receipt,["{}"]),/UNAVAILABLE/);assert.deepEqual(f.calls,[]);await db.close();
});
test("unexpected database role poisons the instance before any business RPC",async()=>{
 const f=fixture({role:"adstable_owner"}),db=createGoogleSourcePostgresClient({environment:environment(),poolFactory:f.poolFactory});
 await assert.rejects(db.query(receipt,["{}","id",0]),/UNAVAILABLE/);
 assert.ok(!f.calls.some(x=>x[0]===receipt));const n=f.calls.length;await assert.rejects(db.query(receipt,["{}","id",0]));assert.equal(f.calls.length,n);assert.deepEqual(f.releases,[true]);await db.close();
});
test("correct role name with unsafe or incomplete grant profile still stops before RPC",async()=>{
 const f=fixture({ready:false}),db=createGoogleSourcePostgresClient({environment:environment(),poolFactory:f.poolFactory});
 await assert.rejects(db.query(receipt,["{}","id",0]),/UNAVAILABLE/);assert.ok(!f.calls.some(x=>x[0]===receipt));await db.close();
});
test("server never supplies a default reviewer, SDK hook, caller identity or execution",()=>{
 let pools=0;for(const input of [{},{environment:environment(),reviewAuthority:async()=>({status:"approved"})},
  {environment:environment(),verified:{},tokenVault:{loadProviderTokenSet:async()=>({})},sdkBridge:{}}]){
  assert.throws(()=>createGoogleSourceServerExecution({...input,poolFactory:()=>{pools++;}}),/GOOGLE_SOURCE_SERVER_CONFIGURATION_REQUIRED/);
 }assert.equal(pools,0);
});
test("server rejects mismatched target, missing policy/key and unsafe cloning before acquiring SQL",async()=>{
 const previous=abstractFetch,bridge=createShopifyAdminIdentitySdkBridge();setAbstractFetchFunc(bridge.fetch);
 try{
  const {input}=sourceStoreFixture(),owner=input.owner,time=Date.now(),context={merchant_id:"99",feed_label:"US",content_language:"en",data_source:"accounts/99/dataSources/7",legacy_local:false};
  const base=()=>({environment:environment(),sdkBridge:bridge,tokenVault:{loadProviderTokenSet:async()=>({})},reviewAuthority:async()=>({}),
   verified:{installationAuthority:{authority:"shopify_installation_verified",status:"active",workspaceId:owner.workspaceId,installGeneration:1},
    identity:{shop:{authority:"shopify_admin_verified",shopId:owner.shopId,myshopifyDomain:owner.shopDomain},session:{authority:"shopify_id_token_verified",shopDomain:owner.shopDomain}},context:{admin:{graphql:async()=>{}}}},
   execution:{claim:{workspaceId:owner.workspaceId,installGeneration:"1",provider:"google_ads",accountId:"111",id:"job",fence:1},window:{from:"2026-11-01",to:"2026-11-01"},entitlementReceipt:{observedAt:new Date(time).toISOString()}},
   configuration:{merchantId:"99",sourceRules:[{}],sourcePolicy:structuredClone(input.policy),limits:{maxRows:10,maxBytes:10000,maxPages:10,maxLinkPages:10,maxLinks:10,maxElapsedMs:1000},
    plan:{identity:{provider:"google_ads",accountId:"111",nativeId:"shopify_US_123_456",context},ruleProposal:{},rulePolicy:{version:"test",until:new Date(time+30000).toISOString()},mappingPolicy:{version:"test",until:new Date(time+30000).toISOString()},deadlineAt:new Date(time+60000).toISOString()}}});
  for(const change of [x=>{x.configuration.merchantId="100";},x=>{x.configuration.sourceRules=[];},x=>{delete x.configuration.sourcePolicy.raw;},
   x=>{delete x.environment.ADSTABLE_SOURCE_EVIDENCE_ENCRYPTION_KEY_V1;},x=>{x.configuration.plan.private=()=>"SENSITIVE-CONFIG";}]){
   const f=fixture(),options=base();options.environment.GOOGLE_ADS_DEVELOPER_TOKEN="SYNTHETIC";change(options);
   let pools=0;assert.throws(()=>createGoogleSourceServerExecution({...options,poolFactory:()=>{pools++;return f.poolFactory();}}),/^(?:Error: GOOGLE_SOURCE_SERVER_CONFIGURATION_REQUIRED|Error: SOURCE_EVIDENCE_CONFIGURATION_REQUIRED)$/);
   assert.equal(pools,0);assert.deepEqual(f.calls,[]);
  }
 }finally{setAbstractFetchFunc(previous);}
});
for(const fail of [receipt,"commit"])test("RPC or COMMIT failure is sanitized, discarded and never automatically retried: "+fail,async()=>{
 const f=fixture({fail}),db=createGoogleSourcePostgresClient({environment:environment(),poolFactory:f.poolFactory});
 await assert.rejects(db.query(receipt,["{}","id",0]),/^Error: GOOGLE_SOURCE_DATABASE_UNAVAILABLE$/);
 const n=f.calls.length;await assert.rejects(db.query(receipt,["{}","id",0]));assert.equal(f.calls.length,n);assert.deepEqual(f.releases,[true]);await db.close();
});
test("explicit inspection transport accepts only historical receipt reads",async()=>{
 const f=fixture(),db=createGoogleSourcePostgresClient({environment:environment(),poolFactory:f.poolFactory,inspectionOnly:true});
 await assert.rejects(db.query(write,["{}","id","{}"]));assert.deepEqual(f.calls,[]);
 await db.query(receipt,["{}","id",0]);await db.close();
});
test("parameters detach before acquisition and concurrent calls cannot queue a second operation",async()=>{
 let release;const acquired=new Promise(r=>{release=r;}),f=fixture({acquire:()=>acquired});
 const db=createGoogleSourcePostgresClient({environment:environment(),poolFactory:f.poolFactory}),args=[{before:true},"id",0];
 const pending=db.query(receipt,args);args[0].before=false;
 await assert.rejects(db.query(receipt,args),/UNAVAILABLE/);release();await pending;
 assert.deepEqual(f.calls.find(x=>x[0]===receipt)[1][0],{before:true});await db.close();
});
test("idle error and closed instance cannot issue another query",async()=>{
 const f=fixture(),db=createGoogleSourcePostgresClient({environment:environment(),poolFactory:f.poolFactory});f.onError();await assert.rejects(db.query(receipt,["{}","id",0]));assert.deepEqual(f.calls,[]);await db.close();await assert.rejects(db.query(receipt,["{}","id",0]));
});
