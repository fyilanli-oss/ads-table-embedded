import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {sourceStoreFixture} from '../tests/fixtures/source-store-fixture.js';
import {createSourceEvidenceRepository} from '../app/lib/database/source-evidence-store.server.js';
import {prepareCustomerSourceRun,completeCustomerSourceRun} from '../app/lib/database/customer-source-privacy.server.js';
const gid=n=>'gid://shopify/Order/'+n;
async function rejected(client,action){await client.query('savepoint customer_expected');let error;try{await action();}catch(e){error=e;}await client.query('rollback to savepoint customer_expected');await client.query('release savepoint customer_expected');assert.ok(error);return error;}
export async function customerSourcePrivacyProbe(client){
 await client.query('begin');try{
 await client.query('set local role adstable_owner');
 const identity=randomBytes(32),shopId='gid://shopify/Shop/'+BigInt('0x'+randomBytes(6).toString('hex')),shopDomain='privacy-'+randomBytes(6).toString('hex')+'.myshopify.com';
 const boot=(await client.query('select * from shopify.bootstrap_installation($1,$2,$3,statement_timestamp())',[shopId,shopDomain,identity])).rows[0];
 const installation=(await client.query('select id::text from shopify.installations where workspace_id=$1',[boot.workspace_id])).rows[0].id;
 const owner={workspaceId:boot.workspace_id,installationId:installation,generation:String(boot.install_generation),shopId,shopDomain,provider:'shopify'};
 const {input,prepare}=sourceStoreFixture({owner});input.pages[0].family='order_headers';input.pages[0].payload.records=[input.pages[0].payload.records[0],{id:gid(102),updatedAt:'2026-01-01T00:00:00.000Z',amount:'9.99',currencyCode:'USD'}];
 input.records.references[1]={key:'other-ref',page:'page',locatorKind:'row',locator:'/records/1',nativeType:'Order',nativeId:gid(102),state:'present'};
 input.records.orders.push({key:'other',reference:'other-ref',orderId:gid(102),updatedAt:'2026-01-01T00:00:00.000Z',data:input.pages[0].payload.records[1]});input.records.lines=[];
 for(const [n,order]of input.records.orders.entries()){
  const line={id:'gid://shopify/LineItem/'+(201+n),quantity:1,amount:n?'9.99':'120.50'},summary={firstVisit:null,lastVisit:null,moments:[]};
  const lp='line'+n,jp='journey'+n,lr='lr'+n,jr='jr'+n;
  input.pages.push({...input.pages[0],key:lp,family:'order_lines',ordinal:input.pages.length,payload:{orderId:order.orderId,records:[line]}});
  input.pages.push({...input.pages[0],key:jp,family:'order_journey',ordinal:input.pages.length,payload:{orderId:order.orderId,records:[],summary}});
  input.records.references.push({key:lr,page:lp,locatorKind:'row',locator:'/records/0',nativeType:'LineItem',nativeId:line.id,state:'present'},{key:jr,page:jp,locatorKind:'object',locator:'/summary',nativeType:'JourneySummary',nativeId:null,state:'present'});
  input.records.lines.push({key:lp,reference:lr,order:order.key,lineId:line.id,data:line});
  input.records.journeys.push({key:jp,order:order.key,kind:'summary',ordinal:0,state:'ready',ready:true,complete:true,data:summary});
  input.records.links.push({reference:jr,targetType:'journey',target:jp,role:'summary'});
 }
 await createSourceEvidenceRepository(client).commit(prepare());
 async function claim(kind,scope={version:1,orders:[gid(101)]},webhook=randomUUID()){
  const topic=kind==='customer_data_request'?'customers/data_request':'customers/redact';
  const args=[webhook,null,topic,shopId,shopDomain,identity,'a'.repeat(64),'2026-10',null,new Date().toISOString(),JSON.stringify(scope)];
  const r=(await client.query('select * from privacy.claim_shopify_customer_webhook($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',args)).rows[0];return {runId:r.deletion_run_id,claim:r,args};
 }
 for(const mode of ['redact','disclose','no_receipt','changed','lost','late_failure','duplicate','cross_subject','empty','scope_missing']){
  await client.query('savepoint customer_case');try{
   const c=await claim(mode==='disclose'||mode==='no_receipt'?'customer_data_request':'customer_redact',mode==='empty'?{version:1,orders:[]}:undefined);
   if(mode==='duplicate'){
    const again=(await client.query('select * from privacy.claim_shopify_customer_webhook($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',c.args)).rows[0];assert.equal(again.duplicate,true);assert.equal(again.deletion_run_id,c.runId);
    const conflict=[...c.args];conflict[6]='b'.repeat(64);await rejected(client,()=>client.query('select * from privacy.claim_shopify_customer_webhook($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',conflict));
   }
   if(mode==='scope_missing'){await client.query('update privacy.webhook_claims set source_request_scope=null where id=$1',[c.claim.claim_id]);await rejected(client,()=>prepareCustomerSourceRun({database:client,cipher:input.cipher,runId:c.runId}));continue;}
   const beforeSnapshot=(await client.query('select privacy.customer_source_snapshot($1) result',[c.runId])).rows[0].result;
   const prepared=await prepareCustomerSourceRun({database:client,cipher:input.cipher,runId:c.runId});
   if(mode==='no_receipt'){await assert.rejects(completeCustomerSourceRun({database:client,preparedRun:prepared}),/DISCLOSURE_RECEIPT_REQUIRED/);assert.equal((await client.query('select count(*)::int n from privacy.deletion_manifests where deletion_run_id=$1',[c.runId])).rows[0].n,0);continue;}
   if(mode==='disclose'){assert.equal(prepared.artifact.orders.length,1);assert.equal(prepared.artifact.lines.length,1);assert.equal(prepared.artifact.journeys.length,1);assert.ok(!JSON.stringify(prepared.artifact).includes(gid(102)));await completeCustomerSourceRun({database:client,preparedRun:prepared,disclosureReceipt:'b'.repeat(64)});assert.equal((await client.query('select count(*)::int n from source.shopify_order_versions where installation_id=$1',[installation])).rows[0].n,2);continue;}
   if(mode==='changed'){await client.query("update evidence.source_batches set manifest=manifest||$2::jsonb where installation_id=$1",[installation,JSON.stringify({changed:true})]);await rejected(client,()=>completeCustomerSourceRun({database:client,preparedRun:prepared}));continue;}
   if(mode==='late_failure'){
    await client.query("create function pg_temp.reject_customer_manifest() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_CUSTOMER_MANIFEST_FAILURE';end$$");await client.query('create trigger reject_customer_manifest before insert on privacy.deletion_manifests for each row execute function pg_temp.reject_customer_manifest()');
    await rejected(client,()=>completeCustomerSourceRun({database:client,preparedRun:prepared}));assert.equal((await client.query('select count(*)::int n from source.shopify_order_versions where installation_id=$1',[installation])).rows[0].n,2);continue;
   }
   if(mode==='cross_subject'){
    // Tampered internal plan still cannot remove another customer's linked proof.
    const snap=(await client.query('select privacy.customer_source_snapshot($1) result',[c.runId])).rows[0].result;
    await rejected(client,()=>client.query('select privacy.complete_customer_source_run($1,$2,$3::jsonb,null)',[c.runId,snap.digest,JSON.stringify({pages:[],removedReferences:[snap.references[1].id]})]));continue;
   }
   let writes=0;const db={async query(sql,args){writes++;const r=await client.query(sql,args);if(mode==='lost')throw Error('synthetic lost response');return r;}};
   if(mode==='lost'){await assert.rejects(completeCustomerSourceRun({database:db,preparedRun:prepared}),/WRITE_UNCONFIRMED/);await assert.rejects(completeCustomerSourceRun({database:db,preparedRun:prepared}),/PREPARED_RUN_REQUIRED/);assert.equal(writes,1);}else await completeCustomerSourceRun({database:db,preparedRun:prepared});
   const remains=(await client.query('select order_id from source.shopify_order_versions where installation_id=$1 order by order_id',[installation])).rows.map(x=>x.order_id);
   assert.deepEqual(remains,mode==='empty'?[gid(101),gid(102)]:[gid(102)]);
   for(const t of ['shopify_line_versions','shopify_journey_versions'])assert.equal((await client.query('select count(*)::int n from source.'+t+' where installation_id=$1',[installation])).rows[0].n,mode==='empty'?2:1);
   const stored=(await client.query("select payload_hash,encode(ciphertext,'hex') ciphertext,encode(nonce,'hex') nonce,encode(auth_tag,'hex') auth_tag,key_version,plain_byte_count,sanitizer_version,field_coverage from evidence.source_pages where id=$1",[beforeSnapshot.pages[0].id])).rows[0];
   const page={...beforeSnapshot.pages[0],payloadHash:stored.payload_hash,ciphertext:stored.ciphertext,nonce:stored.nonce,authTag:stored.auth_tag,keyVersion:stored.key_version,plainBytes:stored.plain_byte_count,sanitizerVersion:stored.sanitizer_version,fieldCoverage:stored.field_coverage},batch=beforeSnapshot.batches[0],plain=input.cipher.open({owner:batch.authority,attemptId:batch.attempt_id,ordinal:batch.batch_ordinal,page});
   assert.equal((await client.query('select source_request_scope from privacy.webhook_claims where id=$1',[c.claim.claim_id])).rows[0].source_request_scope,null);
   const receipt=(await client.query('select source_customer_receipt from privacy.deletion_runs where id=$1',[c.runId])).rows[0].source_customer_receipt;
   assert.ok(!JSON.stringify(receipt).includes(gid(101)));
   assert.equal(plain.records[1].id,gid(102));assert.equal(plain.records[1].amount,'9.99');if(mode!=='empty')assert.equal(plain.records[0],null);
   assert.equal((await client.query('select * from privacy.execute_deletion_run($1)',[c.runId])).rows[0].deletion_status,'completed');
   if(mode!=='empty'){const attempt=input.attemptId;input.attemptId=randomUUID();await rejected(client,()=>createSourceEvidenceRepository(client).commit(prepare()));input.attemptId=attempt;}
  }finally{await client.query('rollback to savepoint customer_case');await client.query('release savepoint customer_case');}
 }
 // Whole-install deletion must also clear newly retained order scopes.
 await claim('customer_redact');
 const deletion=(await client.query('select privacy.request_workspace_deletion($1,$2,$3,$4,$5,statement_timestamp()) id',['customer-source-'+randomUUID(),shopId,shopDomain,owner.generation,identity])).rows[0].id;
 assert.equal((await client.query('select * from privacy.execute_deletion_run($1)',[deletion])).rows[0].deletion_status,'completed');
 assert.equal((await client.query('select count(*)::int n from privacy.webhook_claims where workspace_id=$1 and source_request_scope is not null',[owner.workspaceId])).rows[0].n,0);
 assert.equal((await client.query('select count(*)::int n from evidence.source_pages where installation_id=$1',[installation])).rows[0].n,0);
 for(const role of ['anon','authenticated','service_role','adstable_runtime','adstable_refresh_coordinator'])assert.equal((await client.query("select has_function_privilege($1,'privacy.complete_customer_source_run(uuid,text,jsonb,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 console.log('EO05_CUSTOMER_SOURCE_PRIVACY_PASS real_SQL=true exact_verified_order_scope=true mixed_page_other_customer_preserved=true disclosure_ack_required=true atomic_rollback=true snapshot_CAS=true lost_reply_no_retry=true tombstone_blocks_resurrection=true owner_only=true native_HTTP=0');
 }finally{await client.query('rollback');}
}
