import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {sourceStoreFixture} from '../tests/fixtures/source-store-fixture.js';
import {createSourceEvidenceRepository} from '../app/lib/database/source-evidence-store.server.js';
import {handleCustomerSourceWorkerRequest} from '../app/lib/privacy/customer-source-worker.server.js';
import {PRIVACY_SOURCE_RPC as rpc,PRIVACY_SOURCE_ROLE_CHECK_SQL} from '../app/lib/database/privacy-source-postgres.server.js';
const gid=n=>'gid://shopify/Order/'+n;
const prepared=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/^begin;s*$/m,'').replace(/^commit;s*$/m,'');
async function rejected(client,fn){await client.query('savepoint worker_rejected');let e;try{await fn();}catch(error){e=error;}await client.query('rollback to savepoint worker_rejected');await client.query('release savepoint worker_rejected');assert.ok(e);}
export async function privacySourceWorkerProbe(client,connection,environment){
 assert.equal(environment.GITHUB_ACTIONS,'true');assert.ok(environment.RUNNER_TEMP);
 assert.equal(connection.host,'127.0.0.1');assert.equal(connection.port,54322);
 await client.query('begin');try{
  await client.query('set local role adstable_owner');
  await client.query(prepared('supabase/migrations/20261105100338_eo05_customer_request_completion.sql'));
  await client.query(prepared('supabase/migrations/20261105111527_eo05_private_customer_source_worker.sql'));
  await client.query('reset role');
  await client.query(prepared('tools/sql/eo05-privacy-source-role-install.sql'));
  // Isolated rollback-only harness membership, never part of the role installer.
  await client.query('grant adstable_privacy_source_runner to postgres with inherit false, set true, admin false');
  await client.query('set local role adstable_privacy_source_runner');
  const profile=(await client.query(PRIVACY_SOURCE_ROLE_CHECK_SQL,[rpc.map(x=>x[1])])).rows[0];
  assert.equal(profile.profile_ready,true);assert.equal(profile.role,'adstable_privacy_source_runner');
  await client.query('set local role adstable_owner');
  assert.equal((await client.query("select rolcanlogin from pg_roles where rolname='adstable_privacy_source_runner'")).rows[0].rolcanlogin,false);
  for(const role of ['anon','authenticated','service_role','adstable_runtime','adstable_refresh_coordinator']){
   assert.equal((await client.query("select has_table_privilege($1,'privacy.source_worker_operations','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
   for(const [,signature]of rpc)assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed,false);
  }
  await rejected(client,async()=>{await client.query('set local role adstable_privacy_source_runner');await client.query('select * from privacy.source_worker_operations');});
  await rejected(client,async()=>{await client.query('set local role adstable_privacy_source_runner');await client.query('select privacy.customer_source_snapshot($1)',[randomUUID()]);});
  const identity=randomBytes(32),shopId='gid://shopify/Shop/'+BigInt('0x'+randomBytes(6).toString('hex')),shopDomain='worker-'+randomBytes(6).toString('hex')+'.myshopify.com';
  const boot=(await client.query('select * from shopify.bootstrap_installation($1,$2,$3,statement_timestamp())',[shopId,shopDomain,identity])).rows[0];
  const installation=(await client.query('select id::text from shopify.installations where workspace_id=$1',[boot.workspace_id])).rows[0].id;
  const owner={workspaceId:boot.workspace_id,installationId:installation,generation:String(boot.install_generation),shopId,shopDomain,provider:'shopify'};
  const {input,prepare}=sourceStoreFixture({owner});
  input.pages[0].family='order_headers';input.pages[0].payload.records=[input.pages[0].payload.records[0],{id:gid(102),updatedAt:'2026-01-01T00:00:00.000Z',amount:'9.99',currencyCode:'USD'}];
  input.records.references[1]={key:'other-ref',page:'page',locatorKind:'row',locator:'/records/1',nativeType:'Order',nativeId:gid(102),state:'present'};
  input.records.orders.push({key:'other',reference:'other-ref',orderId:gid(102),updatedAt:'2026-01-01T00:00:00.000Z',data:input.pages[0].payload.records[1]});
  input.records.lines=[];await createSourceEvidenceRepository(client).commit(prepare());
  const env={VERCEL_ENV:'production',SHOPIFY_APP_URL:'https://embedded.adstable.app',ADSTABLE_PRIVACY_SOURCE_WORKER_ENABLED:'true',ADSTABLE_PRIVACY_SOURCE_SERVER_SECRET:'s'.repeat(40)};
  let writes=0,lose=null;
  const db={close:async()=>{},async query(sql,args){
   assert.ok(rpc.some(x=>x[0]===sql));await client.query('savepoint worker_rpc');
   let result;
   try{
    await client.query('set local role adstable_privacy_source_runner');result=await client.query(sql,args);
    await client.query('set local role adstable_owner');await client.query('release savepoint worker_rpc');
   }catch(e){await client.query('rollback to savepoint worker_rpc');await client.query('release savepoint worker_rpc');throw e;}
   if(sql===rpc[2][0])writes++;
   if(sql===lose)throw Error('synthetic acknowledgement lost after successful SQL');
   return result;
  }};
  const runBody=()=>({mode:'run',operationId:randomUUID(),deadlineAt:new Date(Date.now()+44000).toISOString()});
  async function call(body){
   const request=new Request(env.SHOPIFY_APP_URL+'/internal/privacy/source-worker',{method:'POST',headers:{authorization:'Bearer '+env.ADSTABLE_PRIVACY_SOURCE_SERVER_SECRET,'content-type':'application/json'},body:JSON.stringify(body)});
   return (await handleCustomerSourceWorkerRequest(request,{environment:env,databaseFactory:()=>db,cipherFactory:()=>input.cipher})).json();
  }
  async function claim(kind,orders=[gid(101)]){
   const topic=kind==='customer_redact'?'customers/redact':'customers/data_request';
   return (await client.query('select * from privacy.claim_shopify_customer_webhook($1,null,$2,$3,$4,$5,$6,$7,null,statement_timestamp(),$8::jsonb)',
    [randomUUID(),topic,shopId,shopDomain,identity,'a'.repeat(64),'2026-10',JSON.stringify({version:1,orders})])).rows[0].deletion_run_id;
  }
  for(const mode of ['idle','no_match','redact','disclosure','proof_missing','lost_reserve','lost_complete','expired','whole_priority','whole_cleanup']){
   await client.query('savepoint worker_case');try{
    writes=0;lose=null;const b=runBody();let run;
    if(mode!=='idle')run=await claim(mode==='disclosure'||mode==='no_match'?'customer_data_request':'customer_redact',mode==='no_match'?[gid(999)]:undefined);
    if(mode==='proof_missing')await client.query("update evidence.source_pages set ciphertext=null,nonce=null,auth_tag=null,purged_at=statement_timestamp(),purge_reason='expired_unreferenced' where installation_id=$1",[installation]);
    let whole;
    async function wholeRequest(){
     await client.query('select privacy.request_workspace_deletion($1,$2,$3,$4,$5,statement_timestamp())',['worker-whole-'+randomUUID(),shopId,shopDomain,owner.generation,identity]);
     return (await client.query("select id from privacy.deletion_runs where workspace_id=$1 and kind='merchant_delete_my_data'",[owner.workspaceId])).rows[0].id;
    }
    if(mode==='whole_priority')whole=await wholeRequest();
    if(mode==='lost_reserve')lose=rpc[0][0];
    if(mode==='lost_complete')lose=rpc[2][0];
    if(mode==='expired'||mode==='whole_cleanup'){
     await db.query(rpc[0][0],[b.operationId,b.deadlineAt]);
     if(mode==='expired'){
      await client.query("update privacy.source_worker_operations set deadline_at=clock_timestamp()-interval '1 second' where operation_id=$1",[b.operationId]);
      await rejected(client,()=>db.query(rpc[1][0],[b.operationId]));
      assert.equal((await call({mode:'inspect',operationId:b.operationId})).status,'unknown');
      assert.equal((await call(runBody())).status,'idle');
      // Legacy queue must not count or retry a reserved/unknown run.
      const q=(await client.query('select * from privacy.process_deletion_queue(100)')).rows[0];assert.equal(q.selected_count,0);
     }else{
      whole=await wholeRequest();assert.equal((await client.query('select * from privacy.execute_deletion_run($1)',[whole])).rows[0].deletion_status,'completed');
      assert.equal((await client.query('select count(*)::int n from privacy.source_worker_operations where workspace_id=$1',[owner.workspaceId])).rows[0].n,0);
      assert.equal((await client.query('select status from privacy.deletion_runs where id=$1',[run])).rows[0].status,'superseded');
     }
     continue;
    }
    const before=(await client.query('select jsonb_agg(to_jsonb(p) order by id) v from evidence.source_pages p where installation_id=$1',[installation])).rows[0].v;
    const result=await call(b);
    if(['idle','whole_priority'].includes(mode)){
     assert.equal(result.status,'idle');
     if(mode==='idle'){await claim('customer_redact');assert.equal((await call(b)).status,'idle','idle replay cannot acquire later work');}
    }else if(mode==='disclosure'||mode==='proof_missing'){
     assert.equal(result.status,'held');assert.equal(result.reason,mode==='disclosure'?'disclosure_required':'review_required');assert.equal(writes,0);
     const q=(await client.query('select * from privacy.process_deletion_queue(100)')).rows[0];assert.equal(q.selected_count,0);
    }else if(mode.startsWith('lost')){
     assert.equal(result.status,'unknown');assert.equal(writes,mode==='lost_complete'?1:0);lose=null;
     const observation=await call({mode:'inspect',operationId:b.operationId});
     assert.equal(observation.status,mode==='lost_complete'?'completed':'reserved');
     await call(b);assert.equal(writes,mode==='lost_complete'?1:0);
    }else{
     assert.equal(result.status,'completed');assert.equal(result.result,mode==='redact'?'deleted':'no_customer_data');
     assert.equal(writes,1);assert.deepEqual(await call(b),result);assert.equal(writes,1);
     const remaining=(await client.query('select order_id from source.shopify_order_versions where installation_id=$1 order by order_id',[installation])).rows.map(x=>x.order_id);
     assert.deepEqual(remaining,mode==='redact'?[gid(102)]:[gid(101),gid(102)]);
     if(mode==='redact')await rejected(client,()=>createSourceEvidenceRepository(client).commit(prepare()));
    }
    if(!['redact','lost_complete'].includes(mode)){
     assert.deepEqual((await client.query('select jsonb_agg(to_jsonb(p) order by id) v from evidence.source_pages p where installation_id=$1',[installation])).rows[0].v,before);
    }
    assert.ok(!JSON.stringify(result).includes(gid(101)));assert.ok(!JSON.stringify(result).includes('ciphertext'));
   }finally{await client.query('rollback to savepoint worker_case');await client.query('release savepoint worker_case');}
  }
 }finally{await client.query('rollback');}
 console.log('EO05_PRIVATE_PRIVACY_WORKER_PASS least_role=true private_entry=true no_match=true scoped_redaction=true disclosure_hold=true proof_hold=true idle_replay=true lost_ack_no_retry=true expired_no_requeue=true whole_erasure_priority=true prepared_rollback_only=true');
}
