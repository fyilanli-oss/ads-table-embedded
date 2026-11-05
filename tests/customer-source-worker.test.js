import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handleCustomerSourceWorkerRequest as handle} from '../app/lib/privacy/customer-source-worker.server.js';
import {customerWorkerFixture} from './fixtures/customer-worker-fixture.js';
import {PRIVACY_SOURCE_RPC as rpc,createPrivacySourcePostgresClient,PRIVACY_SOURCE_ROLE_CHECK_SQL} from '../app/lib/database/privacy-source-postgres.server.js';
import {callCustomerSourceWorker} from '../tools/run-customer-source-worker.mjs';
const now=()=>Date.parse('2026-11-05T12:00:00.000Z'),secret='s'.repeat(40);
const environment={VERCEL_ENV:'production',SHOPIFY_APP_URL:'https://embedded.adstable.app',ADSTABLE_PRIVACY_SOURCE_WORKER_ENABLED:'true',ADSTABLE_PRIVACY_SOURCE_SERVER_SECRET:secret};
const input=()=>({mode:'run',operationId:randomUUID(),deadlineAt:new Date(now()+40000).toISOString()});
const request=(body,headers={})=>new Request(environment.SHOPIFY_APP_URL+'/internal/privacy/source-worker',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
function execution(kind='customer_redact',modify=()=>{},lose=null){
 const f=customerWorkerFixture(kind),records=new Map(),calls=[];modify(f);
 const database={close:async()=>{},async query(sql,args){
  calls.push(sql);const operationId=args[0];
  if(sql===rpc[0][0]){
   if(records.has(operationId))return {rows:[{result:{status:'recorded',observation:records.get(operationId)}}]};
   records.set(operationId,{operationId,status:'reserved'});
   if(lose==='reserve')throw Error('synthetic lost reserve');
   return {rows:[{result:{status:'reserved',runId:f.runId,kind}}]};
  }
  if(sql===rpc[1][0])return {rows:[{result:f.snapshot}]};
  if(sql===rpc[2][0]){
   const changes=JSON.parse(args[2]);f.changes=changes;
   const outcome={status:'completed',manifestId:randomUUID(),result:kind==='customer_redact'&&!f.empty?'deleted':'no_customer_data'};
   records.set(operationId,{operationId,status:'completed',receipt:outcome});
   if(lose==='complete')throw Error('synthetic lost completion');
   return {rows:[{result:outcome}]};
  }
  if(sql===rpc[3][0]){const v={operationId,status:'held',receipt:{reason:args[1]}};records.set(operationId,v);return {rows:[{result:v}]};}
  if(sql===rpc[4][0])return {rows:[{result:records.get(operationId)??{operationId,status:'not_observed',rollbackProven:false}}]};
  throw Error('query denied');
 }};
 return {f,calls,records,run:async body=>{const r=await handle(request(body),{environment,now,databaseFactory:()=>database,cipherFactory:()=>f.input.cipher});return {code:r.status,body:await r.json()};}};
}
test('private source entry rejects before database/key access',async()=>{
 const base=input();let touched=0;
 const opts={environment,now,databaseFactory:()=>{touched++;throw Error();},cipherFactory:()=>{touched++;throw Error();}};
 for(const req of [request(base,{authorization:'Bearer wrong'}),request(base,{origin:environment.SHOPIFY_APP_URL}),request(base,{cookie:'session=anything'}),
  request({...base,workspaceId:randomUUID()}),request({...base,disclosureReceipt:'a'.repeat(64)}),
  request({...base,deadlineAt:new Date(now()+60000).toISOString()}),request('{"mode":"run","mode":"inspect"}'),request('x'.repeat(1025)),
  new Request(environment.SHOPIFY_APP_URL+'/internal/privacy/source-worker')]){
  assert.ok((await handle(req,opts)).status>=400);
 }assert.equal(touched,0);
 assert.equal((await handle(request(base),{...opts,environment:{...environment,VERCEL_ENV:'preview'}})).status,503);
});
test('private worker calls real projector and only reseals target record',async()=>{
 const e=execution(),body=input(),out=await e.run(body);assert.equal(out.body.result,'deleted');
 assert.deepEqual(e.f.changes.removedReferences,['1']);
 const page=e.f.input.cipher.open({owner:e.f.input.owner,attemptId:e.f.snapshot.batches[0].attempt_id,ordinal:0,page:e.f.changes.pages[0]});
 assert.equal(page.records[0],null);assert.equal(page.records[1].amount,'9.99');
 const count=e.calls.length;assert.deepEqual((await e.run(body)).body,out.body);assert.equal(e.calls.length,count+1);
 assert.ok(!JSON.stringify(out).includes('shopify/Order'));assert.ok(!JSON.stringify(out).includes('ciphertext'));
});
test('private worker holds nonempty disclosure, unavailable proof and tampering without completion',async()=>{
 for(const [kind,modify,reason] of [['customer_data_request',()=>{},'disclosure_required'],['customer_redact',f=>f.snapshot.pages[0].available=false,'review_required'],['customer_redact',f=>f.snapshot.pages[0].authTag='0'.repeat(32),'review_required']]){
  const e=execution(kind,modify),out=await e.run(input());assert.equal(out.body.status,'held');assert.equal(out.body.reason,reason);assert.ok(!e.calls.includes(rpc[2][0]));
 }
});
test('private worker proves no match through real projector for data request',async()=>{
 const e=execution('customer_data_request',f=>{f.snapshot.scope.orders=['gid://shopify/Order/999'];f.empty=true;});
 assert.equal((await e.run(input())).body.result,'no_customer_data');assert.equal(e.f.changes.matchedSourceRecords,0);
});
test('lost reserve or completion is unknown, never held/retried; separate inspect reports durable state',async()=>{
 for(const lose of ['reserve','complete']){
  const e=execution('customer_redact',()=>{},lose),b=input(),out=await e.run(b);assert.equal(out.code,202);assert.equal(out.body.status,'unknown');
  assert.equal(e.calls.filter(x=>x===rpc[0][0]).length,1);assert.ok(!e.calls.includes(rpc[3][0]));assert.ok(!e.calls.includes(rpc[4][0]));
  const inspected=await e.run({mode:'inspect',operationId:b.operationId});assert.equal(inspected.body.status,lose==='complete'?'completed':'reserved');
 }
});
test('inspection never requires source key; key failure never reserves',async()=>{
 let db=0,key=0;
 const b=input();await handle(request(b),{environment,now,cipherFactory:()=>{key++;throw Error();},databaseFactory:()=>{db++;}});
 assert.equal(db,0);assert.equal(key,1);
 const r=await handle(request({mode:'inspect',operationId:b.operationId}),{environment,now,cipherFactory:()=>{throw Error('must not read key');},databaseFactory:()=>({query:async()=>({rows:[{result:{operationId:b.operationId,status:'not_observed'}}]}),close:async()=>{}})});
 assert.equal((await r.json()).status,'not_observed');
});
const dbEnv={ADSTABLE_PRIVACY_SOURCE_DATABASE_URL:'postgresql://adstable_privacy_source_runner.podpwkrpmjiksskxhwsu:'+('p'.repeat(32))+'@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require',ADSTABLE_PRIVACY_SOURCE_DB_TIMEOUT_MS:'5000'};
test('database client validates least role each RPC; inspection is readonly and arbitrary SQL denied',async()=>{
 const seen=[];let config;
 const client=createPrivacySourcePostgresClient({environment:dbEnv,inspectionOnly:true,poolFactory:c=>{config=c;return {on(){},end:async()=>{},connect:async()=>({release(){},query:async(sql,args)=>{seen.push(sql);return {rows:sql===PRIVACY_SOURCE_ROLE_CHECK_SQL?[{role:'adstable_privacy_source_runner',profile_ready:true}]:[{result:{}}]};}})};}});
 await assert.rejects(client.query('select 1'));await assert.rejects(client.query(rpc[0][0],[randomUUID(),new Date().toISOString()]));assert.equal(seen.length,0);
 await client.query(rpc[4][0],[randomUUID()]);assert.equal(seen[0],'begin read only');assert.equal(config.max,1);assert.equal(config.ssl.rejectUnauthorized,true);await client.close();
});
test('database lost COMMIT stops subsequent use',async()=>{
 let connects=0;
 const client=createPrivacySourcePostgresClient({environment:dbEnv,poolFactory:()=>({on(){},end:async()=>{},connect:async()=>{connects++;return {release(){},query:async(sql)=>{if(sql==='commit')throw Error();return {rows:sql===PRIVACY_SOURCE_ROLE_CHECK_SQL?[{role:'adstable_privacy_source_runner',profile_ready:true}]:[]};}};}})});
 await assert.rejects(client.query(rpc[4][0],[randomUUID()]));await assert.rejects(client.query(rpc[4][0],[randomUUID()]));assert.equal(connects,1);await client.close();
});
test('operator requires explicit enable, no retry, never prints provider body',async()=>{
 let calls=0;
 await assert.rejects(callCustomerSourceWorker({environment:{},args:['--run'],fetchFn:()=>{calls++;}}));assert.equal(calls,0);
 const out=await callCustomerSourceWorker({environment:{...environment,ADSTABLE_PRIVACY_SOURCE_OPERATOR_APPROVED:'true'},args:['--run'],now,fetchFn:async()=>{calls++;throw Error('private details');}});
 assert.equal(calls,1);assert.equal(out.status,'unknown');assert.ok(out.operationId);assert.ok(!JSON.stringify(out).includes(secret));
});
