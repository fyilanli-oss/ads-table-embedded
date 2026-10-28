import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {createShopifyOrderRangePlanner,shopifyOrderRangeProposal} from "../app/lib/refresh/shopify-order-range-plan.server.js";
import {createShopifyOrderQueueAdmission} from "../app/lib/refresh/shopify-order-queue-admission.server.js";
import {createShopifyOrderQueueRepository} from "../app/lib/database/shopify-order-queue-repository.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";

// Existing rollback-only F01 SQL fixture; all profiles/limits are synthetic, never live defaults.
export async function shopifyOrderQueueProbe(client,{execution}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const {workspaceId,installGeneration}=execution.claim;
  const row=(await client.query("select id::text,shop_id,shop_domain from shopify.installations where workspace_id=$1 and install_generation=$2 and status='active'",[workspaceId,installGeneration])).rows[0];
  const expected={workspaceId,installGeneration:Number(installGeneration),installationId:row.id,shopId:row.shop_id,shopDomain:row.shop_domain};
  const runtime={async query(sql,args){await client.query("set local role adstable_runtime");try{return await client.query(sql,args);}finally{await client.query("set local role adstable_owner");}}};
  const plan=await createShopifyOrderRangePlanner({expected,database:runtime,
    policy:{anchorAt:"2026-10-01T00:00:00Z",cadenceMs:3600000,sliceMs:3600000,settleDelayMs:0,maxRanges:3,pageSize:100,includeOrderHistory:false},
    now:()=>new Date("2026-10-01T03:00:00Z")}).plan({fromInclusive:"2026-10-01T00:00:00Z"});
  const inputs=plan.ranges.map(r=>({plan,rangeKey:r.key}));let writes=0,loseResponse=false;
  const db={async query(sql,args){
    let released=false;
    await client.query("savepoint order_queue_rpc");
    try{
      await client.query("set local role adstable_refresh_coordinator");const result=await client.query(sql,args);
      await client.query("set local role adstable_owner");await client.query("release savepoint order_queue_rpc");released=true;
      if(sql.includes("enqueue_shopify_order_range")){writes++;if(loseResponse)throw Error("synthetic lost reply");}return result;
    }catch(error){
      // Lost reply occurs after release; real SQL errors still need local rollback before resetting role.
      if(!released){await client.query("rollback to savepoint order_queue_rpc");await client.query("release savepoint order_queue_rpc");}
      await client.query("set local role adstable_owner");throw error;
    }
  }};
  const store=createSharedQuotaRepository(db),queue=createShopifyOrderQueueAdmission({database:db,quotaStore:store}),repo=createShopifyOrderQueueRepository(db);
  const hash=()=>createHash("sha256").update(randomUUID()).digest("hex");
  const count=async()=>Number((await client.query("select count(*) n from operations.shopify_order_pending_ranges")).rows[0].n);
  const state=async()=>({control:(await client.query("select * from operations.refresh_control")).rows,
    debits:(await client.query("select count(*)::text n from operations.api_quota_debits")).rows});
  const baseline=await state(),beforeCount=await count();
  const changed=async(sql,args,check)=>{
    await client.query("savepoint order_queue_change");try{await client.query(sql,args);await check();}
    finally{await client.query("rollback to savepoint order_queue_change");await client.query("release savepoint order_queue_change");}
  };
  await client.query("savepoint order_queue_probe");
  try{
    assert.equal((await queue.enqueue(inputs[0])).status,"not_configured");assert.equal(writes,0);
    await client.query("update operations.shopify_order_queue_control set enabled=true,max_pending_total=3,max_pending_per_installation=2,configuration_epoch=configuration_epoch+1");
    await client.query("delete from operations.refresh_quota_contexts where workspace_id=$1 and provider in ('shopify_admin','shopify_partner')",[workspaceId]);
    assert.equal((await queue.enqueue(inputs[0])).status,"quota_configuration_required");
    const contexts={};
    for(const provider of ["shopify_admin","shopify_partner"]){
      const c=contexts[provider]={provider,clientScopeKey:hash(),connectionScopeKey:hash(),connectionEpoch:1,
        accountId:provider==="shopify_admin"?row.shop_domain:null,organizationId:provider==="shopify_partner"?"123":null,apiVersion:"2026-10"};
      await client.query(`insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,
        account_id,organization_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled)
        values($1,$2,$3,$4,$5,$6,$7,$8,1,'2026-10',true)`,
      [workspaceId,installGeneration,provider,row.id,c.accountId,c.organizationId,c.clientScopeKey,c.connectionScopeKey]);
      await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,$2)",[c.connectionScopeKey,provider]);
    }
    assert.equal((await queue.enqueue(inputs[0])).status,"quota_configuration_required");assert.equal(writes,0);
    const routes=[];
    for(const [provider,family] of [["shopify_partner","partner_graphql"],...["permission_scopes","order_headers","order_lines","order_journey"].map(f=>["shopify_admin",f])]){
      const c=contexts[provider],route={...quotaRouteIdentity(c,{provider,family,accountId:c.accountId,organizationId:c.organizationId,version:c.apiVersion,includes:[]}),family};routes.push(route);
      const op=route.routeKey,id=randomUUID(),admin=provider==="shopify_admin";
      await client.query("insert into operations.api_quota_operations(operation_key,provider,route_required,reserved_requested_cost) values($1,$2,true,$3)",[op,provider,admin?37:null]);
      await client.query("insert into operations.api_quota_failure_bindings(operation_key,domain_id) values($1,$2)",[op,c.connectionScopeKey]);
      await client.query(`insert into operations.api_quota_policies(id,provider,cost_unit,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding)
        values($1,$2,$3,60000,120,60,5000,10)`,[id,provider,admin?"shopify_admin_query_points":"quota_units"]);
      await client.query("insert into operations.api_quota_bindings(operation_key,policy_id,units) values($1,$2,$3)",[op,id,admin?37:1]);
      await client.query("insert into operations.api_quota_route_profiles(operation_key,domain_id,quota_fingerprint,enabled) select $1,$2,operations.shared_api_quota_fingerprint($1),true",[op,c.connectionScopeKey]);
      await client.query("insert into operations.api_quota_routes(route_key,operation_key,enabled) values($1,$1,true)",[op]);
      await client.query("update operations.api_quota_operations set enabled=true where operation_key=$1",[op]);
    }
    const admission=await repo.readAdmission(plan.owner);assert.equal(admission.status,"ready");assert.deepEqual(admission.contexts,contexts);
    const proposal=shopifyOrderRangeProposal(plan,inputs[0].rangeKey);
    const args={proposal,revision:admission.revision,configurationEpoch:admission.configurationEpoch,contexts,routes};
    await assert.rejects(repo.enqueue({...args,proposal:{...proposal,key:'0'.repeat(64)}}),/KEY_MISMATCH/);
    assert.equal((await repo.enqueue({...args,routes:routes.map((r,i)=>i===1?{...r,routeKey:'0'.repeat(64)}:r)})).status,"quota_configuration_required");
    await assert.rejects(repo.enqueue({...args,routes:routes.slice(1)}),/ROUTES_INVALID/);
    await assert.rejects(repo.enqueue({...args,proposal:{...proposal,range:{...proposal.range,fromInclusive:"2026-10-01T00:00:00.000001Z"}}}),/INPUT_INVALID/);
    await changed("update operations.api_quota_operations set reserved_requested_cost=38 where operation_key=$1",[routes[1].routeKey],async()=>{
      assert.equal((await repo.enqueue(args)).status,"quota_configuration_required");assert.equal(await count(),beforeCount);
    });
    await changed("update operations.refresh_quota_contexts set connection_epoch=connection_epoch+1 where workspace_id=$1 and provider='shopify_admin'",[workspaceId],async()=>{
      assert.equal((await repo.enqueue(args)).status,"quota_configuration_required");
    });
    await changed("update operations.shopify_order_queue_control set configuration_epoch=configuration_epoch+1",[],async()=>{
      assert.equal((await repo.enqueue(args)).status,"conflict");
    });
    for(const sql of ["update shopify.installations set status='uninstall_pending_redaction' where workspace_id=$1","update app.workspaces set status='suspended' where id=$1"]){
      await changed(sql,[workspaceId],async()=>{assert.equal((await repo.enqueue(args)).status,"not_current");});
    }
    await client.query("update integrations.provider_connections set lifecycle_status='disconnect_pending' where workspace_id=$1",[workspaceId]);
    const first=await queue.enqueue(inputs[0]);assert.equal(first.status,"queued");assert.equal(first.authorizesDispatch,false);
    assert.equal((await queue.enqueue(inputs[0])).status,"already_recorded");assert.equal(await count(),beforeCount+1);
    await changed("update app.workspaces set status='suspended' where id=$1",[workspaceId],async()=>{
      assert.equal((await queue.readPending(inputs[0])).status,"not_observed");assert.equal((await queue.enqueue(inputs[0])).status,"not_current");
    });
    assert.equal((await repo.enqueue({...args,proposal:{...proposal,pageSize:99}})).status,"record_conflict");
    const second=shopifyOrderRangeProposal(plan,inputs[1].rangeKey);
    assert.equal((await repo.enqueue({...args,proposal:second})).status,"conflict","stale queue revision cannot write another range");
    // A different valid plan overlapping the first queued range must not duplicate extraction work.
    const overlapPlan=await createShopifyOrderRangePlanner({expected,database:runtime,
      policy:{...plan.policy,sliceMs:1800000},now:()=>new Date("2026-10-01T03:00:00Z")}).plan({fromInclusive:"2026-10-01T00:30:00Z"});
    assert.equal((await queue.enqueue({plan:overlapPlan,rangeKey:overlapPlan.ranges[0].key})).status,"record_conflict");
    // Commit in SQL, deliberately lose only adapter response, then explicitly reconcile.
    loseResponse=true;const unknown=await queue.enqueue(inputs[1]);loseResponse=false;
    assert.equal(unknown.status,"needs_attention");assert.equal(unknown.queueWriteMayHaveCommitted,true);
    const afterWrites=writes;assert.equal((await queue.readPending(inputs[1])).status,"observed");assert.equal(writes,afterWrites);
    assert.equal(await count(),beforeCount+2);assert.equal((await queue.enqueue(inputs[2])).status,"queue_full");
    await changed("update operations.shopify_order_queue_control set max_pending_total=2,configuration_epoch=configuration_epoch+1",[],async()=>{
      assert.equal((await queue.enqueue(inputs[2])).status,"queue_full");
    });
    // Failure after pending insert, at final control revision update, rolls back the entire RPC.
    await client.query("update operations.shopify_order_queue_control set max_pending_per_installation=3,configuration_epoch=configuration_epoch+1");
    const revision=(await repo.readAdmission(plan.owner)).revision;
    await client.query("create function pg_temp.reject_order_queue_revision() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_QUEUE_FAILURE';end$$");
    await client.query("create trigger reject_order_queue_revision before update of revision on operations.shopify_order_queue_control for each row execute function pg_temp.reject_order_queue_revision()");
    assert.equal((await queue.enqueue(inputs[2])).status,"needs_attention");assert.equal(await count(),beforeCount+2);
    assert.equal((await repo.readAdmission(plan.owner)).revision,revision);assert.equal((await queue.readPending(inputs[2])).status,"not_observed");
    assert.deepEqual(await state(),baseline,"pending metadata cannot reserve worker budget or debit API quota");
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"]){
      for(const table of ["shopify_order_queue_control","shopify_order_pending_ranges"])
        assert.equal((await client.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') ok",[role,`operations.${table}`])).rows[0].ok,false);
      assert.equal((await client.query("select has_function_privilege($1,'operations.shopify_order_queue_contexts(bigint,uuid,bigint)','EXECUTE') ok",[role])).rows[0].ok,false);
      for(const signature of ["operations.read_shopify_order_queue_admission(bigint,uuid,bigint,text,text)",
        "operations.enqueue_shopify_order_range(bigint,uuid,bigint,text,text,text,timestamptz,timestamptz,boolean,integer,bigint,bigint,jsonb,jsonb)",
        "operations.read_shopify_order_pending_range(bigint,uuid,bigint,text,text,text)"])
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') ok",[role,signature])).rows[0].ok,role==="adstable_refresh_coordinator");
    }
    const tables=(await client.query("select relrowsecurity,relforcerowsecurity from pg_class where oid in ('operations.shopify_order_queue_control'::regclass,'operations.shopify_order_pending_ranges'::regclass)")).rows;
    assert.equal(tables.length,2);assert.ok(tables.every(r=>r.relrowsecurity&&r.relforcerowsecurity));
  }finally{await client.query("rollback to savepoint order_queue_probe");await client.query("release savepoint order_queue_probe");}
  assert.equal(await count(),beforeCount);
  console.log("EO05_SHOPIFY_ORDER_PENDING_QUEUE_PASS real_SQL_JS_keys=true disabled_default=true independent_owner=true five_reviewed_routes=true CAS_idempotent_overlap_limits=true lost_reply_explicit_read=true late_failure_atomic=true private_forced_RLS=true no_worker_or_quota_debit=true native_HTTP=0");
}
