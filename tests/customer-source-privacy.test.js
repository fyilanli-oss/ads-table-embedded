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

function klaviyoFixture(kind='customer_redact'){
 const f=fixture(kind),batch=f.snapshot.batches[0],events=[101,102].map((n,i)=>({id:'event-'+n,type:'event',attributes:{event_properties:{OrderId:gid(n),ProductID:'456',Quantity:{jsonNumber:'2'},$value:{jsonNumber:i?'9.990':'12.5000'}}},relationships:{attributions:{data:[{id:'attr-'+n,type:'attribution'}]}}}));
 const included=[101,102].map(n=>({id:'attr-'+n,type:'attribution',relationships:{campaign:{data:{id:'camp-1',type:'campaign'}}}}));
 const add=(id,family,payload)=>{const page=f.input.cipher.seal({owner:f.input.owner,attemptId:batch.attempt_id,ordinal:0,page:{family,ordinal:Number(id)-1,origin:'klaviyo',captureLayer:'native_response_projection',numericFidelity:'lossless_token',fieldCoverage:Object.keys(payload),schemaVersion:'v1',sanitizerVersion:'v1'},payload});f.snapshot.pages.push({...page,id,batchId:'1',available:true});};
 add('2','klaviyo_ordered_product_events',{records:events,included});add('3','klaviyo_account',{records:[{id:'account-1',attributes:{timezone:'UTC',preferred_currency:'USD'}}],included:[]});
 for(const [i,e]of events.entries()){
  const ref=String(3+i),attr=String(5+i),claim=String(10+i);f.snapshot.references.push({id:ref,page_id:'2',record_locator:'/records/'+i,record_hash:sourcePayloadHash(e),native_record_type:'KlaviyoOrderedProductEvent'},{id:attr,page_id:'2',record_locator:'/included/'+i,record_hash:sourcePayloadHash(included[i]),native_record_type:'KlaviyoAttribution'});
  f.snapshot.claims.push({id:claim,source_reference_id:ref,native_order_reference:gid(101+i),shopify_order_version_id:null,native_data:e});f.snapshot.links.push({source_reference_id:attr,claim_version_id:claim},{source_reference_id:'7',claim_version_id:claim});
 }
 f.snapshot.references.push({id:'7',page_id:'3',record_locator:'/records/0',record_hash:sourcePayloadHash({id:'account-1',attributes:{timezone:'UTC',preferred_currency:'USD'}}),native_record_type:'KlaviyoAccount'});return f;
}
test('customer source: Klaviyo exact order reference removes only target event/attribution and preserves shared account evidence and numeric tokens',async()=>{
 const f=klaviyoFixture(),run=await f.prepare();await completeCustomerSourceRun({database:f.database,preparedRun:run});const changes=JSON.parse(f.calls[1].args[2]);assert.deepEqual(changes.removedReferences.sort(),['1','3','5']);assert.equal(changes.pages.length,2);
 const page=changes.pages.find(p=>p.id==='2'),payload=f.input.cipher.open({owner:f.input.owner,attemptId:f.snapshot.batches[0].attempt_id,ordinal:0,page});assert.equal(payload.records[0],null);assert.equal(payload.included[0],null);assert.equal(payload.records[1].attributes.event_properties.$value.jsonNumber,'9.990');assert.equal(payload.included[1].id,'attr-102');
});
test('customer source: Klaviyo disclosure includes the targeted event and native amount without another order/event/attribution',async()=>{
 const f=klaviyoFixture('customer_data_request'),run=await f.prepare();const json=JSON.stringify(run.artifact);assert.ok(json.includes('12.5000'));assert.ok(!json.includes('event-102'));assert.ok(!json.includes('attr-102'));assert.ok(!json.includes(gid(102)));
});
test('customer source: native event lacking exact order reference is held even when another event is resolved',async()=>{
 const f=klaviyoFixture();f.snapshot.claims[1].native_order_reference=null;await assert.rejects(f.prepare(),/SUBJECT_UNRESOLVED/);assert.equal(f.calls.length,1);
});

test('customer source: a numeric Klaviyo reference is not assumed to be the Shopify Order ID',async()=>{
 const f=klaviyoFixture();f.snapshot.claims[0].native_order_reference='101';await assert.rejects(f.prepare(),/SUBJECT_UNRESOLVED/);assert.equal(f.calls.length,1);
});
test('scope persistence: fabricated verified flag or copied claim cannot provide source scope',async()=>{
 const claim=await webhook({orders_to_redact:[101]});let calls=0;const repo=createPrivacyLifecycleRepository({query:async()=>{calls++;throw Error('must not execute');}},{customerSourceScope:true});
 await assert.rejects(repo.claimWebhook(structuredClone(claim)),/VERIFIED_SOURCE_REQUEST_SCOPE_REQUIRED/);assert.equal(calls,0);
});
