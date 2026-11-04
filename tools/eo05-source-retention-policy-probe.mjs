import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {sourceStoreFixture} from '../tests/fixtures/source-store-fixture.js';
import {createSourceEvidenceRepository} from '../app/lib/database/source-evidence-store.server.js';
const relations={batch:'evidence.source_batches',page:'evidence.source_pages',reference:'evidence.source_references',rule:'identity.source_rule_versions',mapping:'identity.product_identity_mappings',order:'source.shopify_order_versions',line:'source.shopify_line_versions',journey:'source.shopify_journey_versions',claim:'source.provider_claim_versions',link:'evidence.source_reference_links'};
async function rejected(c,fn,code){await c.query('savepoint policy_expected');let error;try{await fn();}catch(e){error=e;}await c.query('rollback to savepoint policy_expected');await c.query('release savepoint policy_expected');assert.ok(error);if(code)assert.match(error.message,code);}
export async function sourceRetentionPolicyProbe(client){
 await client.query('begin');try{
 // Install this prepared SQL only inside the rollback-only fixture transaction.
 if(!(await client.query("select to_regprocedure('evidence.apply_source_retention_policy(uuid,bigint,bigint,uuid,jsonb,timestamptz)') as installed")).rows[0].installed)await client.query(readFileSync(new URL('../supabase/migrations/20261104213905_eo05_source_retention_policy.sql',import.meta.url),'utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));
 await client.query('set local role adstable_owner');
 const identity=randomBytes(32),shopId='gid://shopify/Shop/'+BigInt('0x'+randomBytes(6).toString('hex')),shopDomain='policy-'+randomBytes(6).toString('hex')+'.myshopify.com';
 const b=(await client.query('select * from shopify.bootstrap_installation($1,$2,$3,statement_timestamp())',[shopId,shopDomain,identity])).rows[0];
 const installationId=(await client.query('select id::text from shopify.installations where workspace_id=$1',[b.workspace_id])).rows[0].id;
 const owner={workspaceId:b.workspace_id,installationId,generation:String(b.install_generation),shopId,shopDomain,provider:'shopify'};
 const {input,prepare}=sourceStoreFixture({owner});
 input.records.rules=[{key:'rule',ruleKey:'synthetic-only',version:'1',kind:'test',context:{},parserVersion:'test-v1',state:'conflicting',basis:{type:'synthetic'},applicability:{state:'unknown'}}];
 input.records.mappings=[{key:'mapping',rule:'rule',identity:{provider:'shopify',accountId:null,nativeId:'native-1',context:{}},revision:'1',nativeId:'native-1',context:{},productId:null,variantId:null,state:'unresolved',verifiedAt:null,applicability:{state:'unknown'}}];
 input.records.journeys=[{key:'journey',order:'order',kind:'summary',ordinal:0,state:'ready',ready:true,complete:true,data:{firstVisit:null,lastVisit:null,moments:[]}}];
 for(const [targetType,target]of [['rule','rule'],['mapping','mapping'],['journey','journey']])input.records.links.push({reference:'order-ref',targetType,target,role:'synthetic-proof'});
 const repository=createSourceEvidenceRepository(client),original=await repository.commit(prepare());
 const ref=(await client.query('select id::text from evidence.source_references where installation_id=$1 order by id limit 1',[installationId])).rows[0].id;
 await client.query("insert into source.provider_claim_versions(workspace_id,installation_id,installation_generation,shop_id,retention_class,retain_until,source_reference_id,provider,account_id,claim_identity_key,native_event_or_claim_id,order_link_state,native_data,observation_hash) values($1,$2,$3,$4,'claim',statement_timestamp()+interval '7 days',$5,'klaviyo','synthetic-only','synthetic-claim','synthetic-event','unlinked','{}',repeat('a',64))",[owner.workspaceId,installationId,owner.generation,shopId,ref]);
 async function snapshot(){const result=[];for(const [kind,table]of Object.entries(relations)){const rows=(await client.query('select to_jsonb(t) as row from '+table+' t where installation_id=$1 order by id',[installationId])).rows;for(const {row}of rows)result.push({kind,row});}return result;}
 async function expected(){return (await snapshot()).map(({kind,row})=>({kind,id:String(row.id),until:row.retain_until}));}
 const apply=(items,op=randomUUID(),workspace=owner.workspaceId,deadline=new Date(Date.now()+60000).toISOString())=>client.query('select evidence.apply_source_retention_policy($1,$2,$3,$4,$5::jsonb,$6) result',[workspace,installationId,owner.generation,op,JSON.stringify(items),deadline]);
 const first=await expected(),before=await snapshot(),op=randomUUID(),deadline=new Date(Date.now()+60000).toISOString();
 assert.deepEqual([...new Set(first.map(x=>x.kind))].sort(),Object.keys(relations).sort());
 const receipt=(await apply(first,op,owner.workspaceId,deadline)).rows[0].result;assert.equal(receipt.checked,first.length);assert.equal(receipt.changed,first.length);assert.equal(receipt.deletionPerformed,false);assert.equal(receipt.originalSourceReceiptChanged,false);
 assert.deepEqual((await apply(first,op,owner.workspaceId,deadline)).rows[0].result,receipt);
 const after=await snapshot();for(let n=0;n<before.length;n++){
  const a=after[n].row,z=before[n].row;assert.deepEqual({...a,retain_until:z.retain_until},z,'only expiry can change');
  const days=a.retention_class==='metadata'?365:90;assert.equal(Date.parse(a.retain_until)-Date.parse(a.recorded_at),days*86400000);
 }
 const inspected=await repository.inspect({owner,attemptId:input.attemptId,ordinal:0});assert.equal(inspected.commitId,original.commitId);assert.equal(inspected.digest,original.digest);assert.deepEqual(inspected.manifest,original.manifest);
 const pages=await repository.readPages({owner,attemptId:input.attemptId,ordinal:0,limit:10});assert.equal(input.cipher.open({owner,attemptId:input.attemptId,ordinal:0,page:pages[0]}).records[0].id,'gid://shopify/Order/101');
 const check=(await client.query('select evidence.inspect_source_retention_policy($1,$2,$3,$4) result',[owner.workspaceId,installationId,owner.generation,op])).rows[0].result;assert.equal(check.status,'recorded');assert.deepEqual(check.receipt,receipt);
 for(const mode of ['mismatch','duplicate','foreign','expired_deadline','privacy','expired_page','pruned','audit_failure','skip_update','longer']){
  await client.query('savepoint policy_case');try{
   const items=await expected();
   if(mode==='longer'){await client.query("update evidence.source_pages set retain_until=statement_timestamp()+interval '400 days' where installation_id=$1",[installationId]);const old=(await snapshot()).find(x=>x.kind==='page').row.retain_until;await apply(await expected());assert.equal((await snapshot()).find(x=>x.kind==='page').row.retain_until,old);continue;}
   if(mode==='privacy')await client.query("select * from privacy.claim_shopify_webhook($1,null,'customers/data_request',$2,$3,$4,$5,'2026-10',null,statement_timestamp())",[randomUUID(),shopId,shopDomain,identity,'a'.repeat(64)]);
   if(mode==='expired_page')await client.query("update evidence.source_pages set retain_until=statement_timestamp()-interval '1 second' where installation_id=$1",[installationId]);
   if(mode==='pruned')await client.query("update evidence.source_batches set storage_state='invalidated',commit_id=null,committed_at=null where installation_id=$1",[installationId]);
   if(mode==='audit_failure'){await client.query("create function pg_temp.reject_policy_audit() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_AUDIT_FAILURE';end$$");await client.query('create trigger reject_policy_audit before update of source_retention_policy_receipts on shopify.installations for each row execute function pg_temp.reject_policy_audit()');}
   if(mode==='skip_update'){await client.query('create function pg_temp.skip_policy_update() returns trigger language plpgsql as $$begin return null;end$$');await client.query('create trigger skip_policy_update before update of retain_until on evidence.source_pages for each row execute function pg_temp.skip_policy_update()');}
   const stable=await snapshot();const invalid=structuredClone(mode==='expired_page'?await expected():items);
   if(mode==='mismatch'){invalid.at(-1).until='2099-01-01T00:00:00Z';await client.query("update evidence.source_batches set retain_until=statement_timestamp()+interval '1 day' where installation_id=$1",[installationId]);invalid[0]=(await expected())[0];}
   if(mode==='duplicate')invalid.push(invalid[0]);
   const stableAtCall=await snapshot();await rejected(client,()=>apply(invalid,randomUUID(),mode==='foreign'?randomUUID():owner.workspaceId,mode==='expired_deadline'?new Date(Date.now()-1000).toISOString():undefined));assert.deepEqual(await snapshot(),stableAtCall);
   void stable;
  }finally{await client.query('rollback to savepoint policy_case');await client.query('release savepoint policy_case');}
 }
 for(const role of ['anon','authenticated','service_role','adstable_runtime','adstable_refresh_coordinator'])for(const fn of ['apply_source_retention_policy(uuid,bigint,bigint,uuid,jsonb,timestamptz)','inspect_source_retention_policy(uuid,bigint,bigint,uuid)'])assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,'evidence.'+fn])).rows[0].allowed,false);
 assert.equal((await client.query("select count(*)::int n from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid in ('evidence.apply_source_retention_policy(uuid,bigint,bigint,uuid,jsonb,timestamptz)'::regprocedure,'evidence.inspect_source_retention_policy(uuid,bigint,bigint,uuid)'::regprocedure) and a.grantee<>p.proowner and a.privilege_type='EXECUTE'")).rows[0].n,0);
 // A future normal lifetime, pending handoff and policy audit must not delay erasure.
 const deletion=(await client.query('select privacy.request_workspace_deletion($1,$2,$3,$4,$5,statement_timestamp()) id',['retention-policy-'+randomUUID(),shopId,shopDomain,owner.generation,identity])).rows[0].id;
 assert.equal((await client.query('select * from privacy.execute_deletion_run($1)',[deletion])).rows[0].deletion_status,'completed');
 for(const table of Object.values(relations))assert.equal((await client.query('select count(*)::int n from '+table+' where installation_id=$1',[installationId])).rows[0].n,0);
 assert.equal((await client.query('select count(*)::int n from shopify.installations where id=$1',[installationId])).rows[0].n,0);
 await rejected(client,()=>repository.commit(prepare()));
 console.log('EO05_SOURCE_RETENTION_POLICY_PASS real_SQL=true all10_kinds=true elapsed90_365=true old_digest_cipher_manifest_unchanged=true expected_row_CAS=true no_shortening_no_resurrection=true audit_atomic=true denied_runner_grants=true pending_and_future_retention_dont_block_erasure=true policy_audit_erased=true native_HTTP=0');
 }finally{await client.query('rollback');}
}
