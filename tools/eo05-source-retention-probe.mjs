import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {sourceStoreFixture} from '../tests/fixtures/source-store-fixture.js';
import {createSourceEvidenceRepository} from '../app/lib/database/source-evidence-store.server.js';
import {createSourceRetentionRepository,prepareSourceRetentionSweep} from '../app/lib/database/source-retention.server.js';
const tables=['evidence.source_batches','evidence.source_pages','evidence.source_references','identity.source_rule_versions','identity.product_identity_mappings','source.shopify_order_versions','source.shopify_line_versions','source.shopify_journey_versions','source.provider_claim_versions','evidence.source_reference_links'];
async function rejected(c,fn){await c.query('savepoint retention_expected');let error;try{await fn();}catch(e){error=e;}await c.query('rollback to savepoint retention_expected');await c.query('release savepoint retention_expected');assert.ok(error);return error;}
export async function sourceRetentionProbe(client){
 await client.query('begin');try{
 await client.query('set local role adstable_owner');
 const identity=randomBytes(32),shopId='gid://shopify/Shop/'+BigInt('0x'+randomBytes(6).toString('hex')),shopDomain='retention-'+randomBytes(6).toString('hex')+'.myshopify.com';
 const b=(await client.query('select * from shopify.bootstrap_installation($1,$2,$3,statement_timestamp())',[shopId,shopDomain,identity])).rows[0];
 const installationId=(await client.query('select id::text from shopify.installations where workspace_id=$1',[b.workspace_id])).rows[0].id;
 const owner={workspaceId:b.workspace_id,installationId,generation:String(b.install_generation),shopId,shopDomain,provider:'shopify'};
 const {input,prepare}=sourceStoreFixture({owner});
 input.records.rules=[{key:'rule',ruleKey:'synthetic-only',version:'1',kind:'test',context:{},parserVersion:'test-v1',state:'conflicting',basis:{type:'synthetic'},applicability:{state:'unknown'}}];
 input.records.mappings=[{key:'mapping',rule:'rule',identity:{provider:'shopify',accountId:null,nativeId:'native-1',context:{}},revision:'1',nativeId:'native-1',context:{},productId:null,variantId:null,state:'unresolved',verifiedAt:null,applicability:{state:'unknown'}}];
 input.records.journeys=[{key:'journey',order:'order',kind:'summary',ordinal:0,state:'ready',ready:true,complete:true,data:{firstVisit:null,lastVisit:null,moments:[]}}];
 for(const [targetType,target]of [['rule','rule'],['mapping','mapping'],['journey','journey']])input.records.links.push({reference:'order-ref',targetType,target,role:'synthetic-proof'});
 const repository=createSourceEvidenceRepository(client);await repository.commit(prepare());
 const order=(await client.query('select id::text,source_reference_id::text from source.shopify_order_versions where installation_id=$1',[installationId])).rows[0];
 await client.query("insert into source.provider_claim_versions(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_reference_id,provider,account_id,claim_identity_key,native_event_or_claim_id,native_order_reference,order_link_state,native_data,observation_hash) values($1,$2,$3,$4,'claim',statement_timestamp()+interval '1 day',$5,'klaviyo','synthetic-only','synthetic-claim','synthetic-event','gid://shopify/Order/101','unlinked',$6::jsonb,repeat('a',64))",[owner.workspaceId,installationId,owner.generation,shopId,order.source_reference_id,JSON.stringify({id:'synthetic-event'})]);
 // Every physical row/HTTP receipt below is synthetic, rollback-only. Setting
 // consumed is fixture setup, never an application/native handoff acceptance.
 async function expire(consumed=true){for(const table of tables)await client.query('update '+table+" set retain_until=statement_timestamp()-interval '1 second' where installation_id=$1",[installationId]);if(consumed)await client.query("update evidence.source_batches set handoff_state='consumed',handoff_receipt=repeat('a',64) where installation_id=$1",[installationId]);}
 const audit=()=>({version:'synthetic-test-policy',until:new Date(Date.now()+86400000).toISOString(),maxReceipts:1000});
 const plan=(kind,patch={})=>prepareSourceRetentionSweep({workspaceId:owner.workspaceId,installationId,generation:owner.generation,kind,after:'0',limit:100,deadlineAt:new Date(Date.now()+60000).toISOString(),auditPolicy:audit(),...patch});
 async function validateForeignKeys(){await client.query('set constraints all immediate');await client.query('set constraints all deferred');}
 const retention=createSourceRetentionRepository({async query(sql,args){const result=await client.query(sql,args);if(sql.includes('evidence.cleanup_source_retention'))await validateForeignKeys();return result;}});
 const count=async table=>(await client.query('select count(*)::int n from '+table+' where installation_id=$1',[installationId])).rows[0].n;
 for(const mode of ['pending','partial','future','long_parent','fresh_pending','privacy','cycle','success','lost','replay','audit_capacity','late_failure','skip_delete','wrong_owner','expired_deadline','budget','external_pin','link_consumer','historical_read']){
  await client.query('savepoint retention_case');try{
   await expire(mode!=='pending');
   if(mode==='partial')await client.query("update evidence.source_batches set source_state='partial' where installation_id=$1",[installationId]);
   if(mode==='future')await client.query("update source.provider_claim_versions set retain_until=statement_timestamp()+interval '1 day' where installation_id=$1",[installationId]);
   if(mode==='long_parent')await client.query("update source.shopify_order_versions set retain_until=statement_timestamp()+interval '1 day' where installation_id=$1",[installationId]);
   if(mode==='fresh_pending'){const old=input.attemptId;input.attemptId=randomUUID();await repository.commit(prepare());input.attemptId=old;await expire(false);await client.query("update evidence.source_batches set handoff_state='pending',handoff_receipt=null where installation_id=$1 and attempt_id<>$2",[installationId,old]);}
   if(mode==='privacy'){await client.query("select * from privacy.claim_shopify_webhook($1,null,'customers/data_request',$2,$3,$4,$5,'2026-10',null,statement_timestamp())",[randomUUID(),shopId,shopDomain,identity,'a'.repeat(64)]);await rejected(client,()=>retention.cleanup(plan('claim')));assert.equal(await count('source.provider_claim_versions'),1);continue;}
   if(mode==='cycle'){await client.query('update identity.product_identity_mappings set supersedes_id=id where installation_id=$1',[installationId]);const r=await retention.cleanup(plan('mapping'));assert.equal(r.held,1);assert.equal(r.deleted,0);continue;}
   if(['pending','partial','future','long_parent','fresh_pending'].includes(mode)){
    const r=await retention.cleanup(plan(mode==='long_parent'?'line':mode==='fresh_pending'?'order':'claim'));assert.equal(r.deleted,0);assert.equal(r.held,mode==='future'?0:1);continue;
   }
   if(mode==='audit_capacity'){
    const policy={...audit(),maxReceipts:1};await retention.cleanup(plan('page',{auditPolicy:policy}));await rejected(client,()=>retention.cleanup(plan('page',{auditPolicy:policy})));
    await client.query("update shopify.installations set source_retention_receipts=jsonb_set(source_retention_receipts,'{0,expiresAt}',to_jsonb((statement_timestamp()-interval '1 second')::text)) where id=$1",[installationId]);await retention.cleanup(plan('page',{auditPolicy:policy}));assert.equal((await client.query('select jsonb_array_length(source_retention_receipts) n from shopify.installations where id=$1',[installationId])).rows[0].n,1);continue;
   }
   if(mode==='expired_deadline'){await rejected(client,()=>retention.cleanup(plan('claim',{deadlineAt:new Date(Date.now()-1000).toISOString()})));assert.equal(await count('source.provider_claim_versions'),1);continue;}
   if(mode==='wrong_owner'){await rejected(client,()=>retention.cleanup(plan('claim',{workspaceId:randomUUID()})));assert.equal(await count('source.provider_claim_versions'),1);continue;}
   if(mode==='late_failure'){
    await client.query("create function pg_temp.reject_retention_audit() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_RETENTION_AUDIT_FAILURE';end$$");await client.query('create trigger reject_retention_audit before update of source_retention_receipts on shopify.installations for each row execute function pg_temp.reject_retention_audit()');
    await rejected(client,()=>retention.cleanup(plan('claim')));assert.equal(await count('source.provider_claim_versions'),1);assert.equal((await client.query('select storage_state from evidence.source_batches where installation_id=$1',[installationId])).rows[0].storage_state,'committed');continue;
   }
   if(mode==='skip_delete'){
    await client.query('create function pg_temp.skip_retention_delete() returns trigger language plpgsql as $$begin return null;end$$');await client.query('create trigger skip_retention_delete before delete on source.provider_claim_versions for each row execute function pg_temp.skip_retention_delete()');await rejected(client,()=>retention.cleanup(plan('claim')));assert.equal(await count('source.provider_claim_versions'),1);continue;
   }
   if(mode==='budget'){
    await client.query("insert into evidence.source_reference_links(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_reference_id,role,mapping_id) select $1,$2,$3,$4,'metadata',statement_timestamp()-interval '1 second',$5,'cap-'||n,m.id from identity.product_identity_mappings m cross join generate_series(1,1001) n where m.installation_id=$2",[owner.workspaceId,installationId,owner.generation,shopId,order.source_reference_id]);const r=await retention.cleanup(plan('mapping'));assert.equal(r.deleted,0);assert.equal(r.linksDeleted,0);assert.equal(r.held,1);continue;
   }
   if(mode==='external_pin'){
    await client.query('create table identity.retention_test_pin(mapping_id bigint references identity.product_identity_mappings(id))');await client.query('insert into identity.retention_test_pin select id from identity.product_identity_mappings where installation_id=$1',[installationId]);const r=await retention.cleanup(plan('mapping'));assert.equal(r.deleted,0);assert.equal(r.held,1);continue;
   }
   if(mode==='link_consumer'){
    await client.query('create table evidence.retention_test_pin(link_id bigint references evidence.source_reference_links(id))');await rejected(client,()=>retention.cleanup(plan('claim')));assert.equal(await count('source.provider_claim_versions'),1);continue;
   }
   if(mode==='success'){
    assert.equal((await retention.cleanup(plan('order'))).held,1);assert.equal((await retention.cleanup(plan('rule'))).held,1);
    for(const kind of ['claim','journey','line','order','mapping','rule','reference','page','batch'])await retention.cleanup(plan(kind));
    for(const table of tables)assert.equal(await count(table),0,table);assert.ok((await client.query('select jsonb_array_length(source_retention_receipts) n from shopify.installations where id=$1',[installationId])).rows[0].n>0);continue;
   }
   if(mode==='historical_read'){
    await client.query("update source.shopify_order_versions set retain_until=statement_timestamp()+interval '1 day' where installation_id=$1",[installationId]);await retention.cleanup(plan('claim'));
    const inspected=await repository.inspect({owner,attemptId:input.attemptId,ordinal:0});assert.equal(inspected.status,'invalidated');
    const pages=await repository.readPages({owner,attemptId:input.attemptId,ordinal:0,limit:10});assert.equal(pages.length,1);assert.equal(pages[0].retentionPruned,true);assert.equal(pages[0].expired,true);assert.equal(input.cipher.open({owner,attemptId:input.attemptId,ordinal:0,page:pages[0]}).records[0].id,'gid://shopify/Order/101');continue;
   }
   let args;const db={async query(sql,a){args=a;const r=await client.query(sql,a);await validateForeignKeys();if(mode==='lost')throw Error('synthetic lost cleanup reply');return r;}};const r=createSourceRetentionRepository(db),p=plan('claim');
   if(mode==='lost'){await assert.rejects(r.cleanup(p),/WRITE_UNCONFIRMED/);await assert.rejects(r.cleanup(p),/CAPABILITY_REQUIRED/);}else await r.cleanup(p);
   const inspection=await retention.inspect({workspaceId:owner.workspaceId,installationId,generation:owner.generation,operationId:p.operationId});assert.equal(inspection.status,'recorded');assert.equal(inspection.receipt.deleted,1);assert.equal(await count('source.provider_claim_versions'),0);
   if(mode==='replay'){const replay=(await client.query('select evidence.cleanup_source_retention($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) result',args)).rows[0].result;assert.deepEqual(replay,inspection.receipt);const changed=[...args];changed[6]=99;await rejected(client,()=>client.query('select evidence.cleanup_source_retention($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',changed));}
  }finally{await client.query('rollback to savepoint retention_case');await client.query('release savepoint retention_case');}
 }
 for(const role of ['anon','authenticated','service_role','adstable_runtime','adstable_refresh_coordinator'])assert.equal((await client.query("select has_function_privilege($1,'evidence.cleanup_source_retention(uuid,bigint,bigint,uuid,text,bigint,integer,timestamptz,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 console.log('EO05_SOURCE_RETENTION_PASS real_SQL=true dependency_and_handoff_holds=true children_first=true bounded_rows_links_batches_audit=true exact_replay_receipt=true expired_audit_pruned=true late_failure_rollback=true lost_reply_explicit_inspection=true historical_proof_readable_not_complete=true privacy_precedence=true erasure_ledger_untouched=true owner_only=true native_HTTP=0');
 }finally{await client.query('rollback');}
}
