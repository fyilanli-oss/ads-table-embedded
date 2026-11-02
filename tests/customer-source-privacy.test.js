import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {sourceStoreFixture} from './fixtures/source-store-fixture.js';
import {sourcePayloadHash} from '../app/lib/database/source-evidence-store.server.js';
import {prepareCustomerSourceRun,completeCustomerSourceRun} from '../app/lib/database/customer-source-privacy.server.js';
import {verifyShopifyWebhookRequest} from '../app/lib/shopify/privacy-webhook.server.js';
import {createPrivacyLifecycleRepository} from '../app/lib/database/privacy-lifecycle-repository.server.js';
const gid=n=>'gid://shopify/Order/'+n;
function fixture(kind='customer_redact'){
 const {input}=sourceStoreFixture(),runId=randomUUID(),attempt=randomUUID();
 const rows=[{id:gid(101),amount:'12.5000'},{id:gid(102),amount:'9.99'}];
 const page=input.cipher.seal({owner:input.owner,attemptId:attempt,ordinal:0,page:{family:'order_headers',ordinal:0,origin:'shopify',captureLayer:'collector_projection',numericFidelity:'decoded_only',fieldCoverage:['records'],schemaVersion:'v1',sanitizerVersion:'v1'},payload:{records:rows}});
 const snapshot={runId,kind,scope:{version:1,orders:[gid(101)]},digest:'a'.repeat(64),installationId:'1',workspaceId:input.owner.workspaceId,generation:'1',shopId:input.owner.shopId,
 batches:[{id:'1',authority:input.owner,attempt_id:attempt,batch_ordinal:0}],pages:[{...page,id:'1',batchId:'1',available:true}],
 references:rows.map((r,n)=>({id:String(n+1),page_id:'1',record_locator:'/records/'+n,record_hash:sourcePayloadHash(r),native_record_type:'Order'})),links:[],
 orders:rows.map((r,n)=>({id:String(n+1),order_id:r.id,source_reference_id:String(n+1),native_data:r})),lines:[],journeys:[],claims:[]};
 const calls=[];const database={async query(sql,args){calls.push({sql,args});return {rows:[{result:sql.includes('snapshot')?structuredClone(snapshot):{status:'completed'}}]};}};
 return {input,runId,snapshot,database,calls,prepare:()=>prepareCustomerSourceRun({database,cipher:input.cipher,runId})};
}
test('customer source: mixed page removes only requested record and preserves other record, locator, hash and amount',async()=>{
 const f=fixture(),run=await f.prepare();assert.equal(run.artifact,null);await completeCustomerSourceRun({database:f.database,preparedRun:run});
 const c=JSON.parse(f.calls[1].args[2]);assert.deepEqual(c.removedReferences,['1']);assert.equal(c.pages.length,1);
 const page=c.pages[0],payload=f.input.cipher.open({owner:f.input.owner,attemptId:f.snapshot.batches[0].attempt_id,ordinal:0,page});
 assert.equal(payload.records[0],null);assert.deepEqual(payload.records[1],{id:gid(102),amount:'9.99'});assert.equal(sourcePayloadHash(payload.records[1]),f.snapshot.references[1].record_hash);
 assert.equal(page.previousHash,f.snapshot.pages[0].payloadHash);
});
test('customer source: data request exposes only requested rows and requires explicit durable disclosure receipt',async()=>{
 const f=fixture('customer_data_request'),run=await f.prepare();assert.deepEqual(run.artifact.orders,[{id:gid(101),amount:'12.5000'}]);assert.ok(!JSON.stringify(run.artifact).includes(gid(102)));
 await assert.rejects(completeCustomerSourceRun({database:f.database,preparedRun:run}),/DISCLOSURE_RECEIPT_REQUIRED/);assert.equal(f.calls.length,1);
 await completeCustomerSourceRun({database:f.database,preparedRun:run,disclosureReceipt:'b'.repeat(64)});assert.equal(f.calls.length,2);
});
test('customer source: lost write response is one-use unknown and is never retried',async()=>{
 const f=fixture(),run=await f.prepare();const database={query:async()=>{throw Error('synthetic loss');}};
 await assert.rejects(completeCustomerSourceRun({database,preparedRun:run}),/WRITE_UNCONFIRMED/);
 await assert.rejects(completeCustomerSourceRun({database,preparedRun:run}),/PREPARED_RUN_REQUIRED/);
});
test('customer source: cloned or fabricated plan cannot authorize SQL',async()=>{
 const f=fixture(),run=await f.prepare();await assert.rejects(completeCustomerSourceRun({database:f.database,preparedRun:structuredClone(run)}),/PREPARED_RUN_REQUIRED/);assert.equal(f.calls.length,1);
});
test('customer source: unknown claim subject blocks without deleting another customer',async()=>{
 const f=fixture();f.snapshot.claims=[{id:'3',native_order_reference:'unknown'}];await assert.rejects(f.prepare(),/SUBJECT_UNRESOLVED/);assert.equal(f.calls.length,1);
});
test('customer source: exact claim evidence shared with another subject is held',async()=>{
 const f=fixture();f.snapshot.claims=[{id:'3',native_order_reference:gid(102),source_reference_id:'1'}];await assert.rejects(f.prepare(),/SHARED_SUBJECT_DEPENDENCY/);
});
test('customer source: unavailable proof, wrong reference hash and unknown family each stop before write',async()=>{
 for(const change of [f=>f.snapshot.pages[0].available=false,f=>f.snapshot.references[0].record_hash='f'.repeat(64),f=>f.snapshot.pages[0].family='new_unreviewed_family']){
  const f=fixture();change(f);await assert.rejects(f.prepare());assert.equal(f.calls.length,1);
 }
});
test('customer source: AAD or ciphertext tampering stops without returning body',async()=>{
 const f=fixture();f.snapshot.pages[0].authTag='0'.repeat(32);await assert.rejects(f.prepare(),/^Error: SOURCE_PRIVACY_DECRYPT_FAILED$/);
});
test('customer source: over-bound snapshot and missing exact scope are rejected',async()=>{
 for(const change of [f=>f.snapshot.pages[0].plainBytes=16777217,f=>f.snapshot.scope=null]){const f=fixture();change(f);await assert.rejects(f.prepare());assert.equal(f.calls.length,1);}
});
async function webhook(payload,topic='customers/redact'){
 const secret='x'.repeat(40),raw=JSON.stringify({shop_id:1,...payload});
 return verifyShopifyWebhookRequest(new Request('https://example.com/webhook',{method:'POST',body:raw,headers:{'content-type':'application/json','x-shopify-hmac-sha256':createHmac('sha256',secret).update(raw).digest('base64'),'x-shopify-topic':topic,'x-shopify-webhook-id':'verified-webhook-id','x-shopify-shop-domain':'test.myshopify.com'}}),{environment:{SHOPIFY_API_SECRET:secret}});
}
test('verified webhook preserves only exact order scope without profile/contact data',async()=>{
 const c=await webhook({orders_to_redact:[101,'9007199254740993'],customer:{email:'private@example.com',id:1}});assert.deepEqual(c.sourceRequestScope,{version:1,orders:[gid(101),gid('9007199254740993')]});assert.ok(!JSON.stringify(c).includes('private@example'));
});
test('verified webhook distinguishes missing from empty scope and rejects lossy, duplicate or malformed IDs',async()=>{
 assert.equal((await webhook({})).sourceRequestScope,null);assert.deepEqual((await webhook({orders_to_redact:[]})).sourceRequestScope.orders,[]);
 for(const orders_to_redact of [[9007199254740992],[101,101],['001'],['gid://shopify/Order/1'],{},[0],[null]])await assert.rejects(webhook({orders_to_redact}),/ORDER_SCOPE_INVALID/);
 assert.deepEqual((await webhook({orders_requested:[12]},'customers/data_request')).sourceRequestScope.orders,[gid(12)]);
});
test('scope persistence is explicit internal composition; default existing ingress and native calls unchanged',async()=>{
 for(const enabled of [false,true]){let sql,args;const repo=createPrivacyLifecycleRepository({query:async(s,a)=>{sql=s;args=a;return {rows:[{claim_id:randomUUID(),workspace_id:randomUUID(),install_generation:'1',outcome:'queued',duplicate:false}]};}},{customerSourceScope:enabled});await repo.claimWebhook(await webhook({orders_to_redact:[101]}));assert.equal(sql.includes('claim_shopify_customer_webhook'),enabled);assert.equal(args.length,enabled?11:10);}
});
