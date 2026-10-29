import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {createShopifyOrderWorkReservations,shopifyOrderWorkReservationBinding} from "../app/lib/refresh/shopify-order-work-reservation.server.js";
import {createShopifyOrderRangePlanner} from "../app/lib/refresh/shopify-order-range-plan.server.js";
import {createShopifyOrderQueueAdmission} from "../app/lib/refresh/shopify-order-queue-admission.server.js";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";

// Metadata-only real coordinator SQL. Two actual workspaces/installations, five
// reviewed synthetic profiles for the new shop; all changes roll back with savepoint.
export async function shopifyOrderFairDispatchProbe(client,{database,inputs}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  await client.query("savepoint fair_order_dispatch");
  try{
    const root=inputs[0].plan.owner,workspaceId=randomUUID(),domain=`fair-${randomUUID()}.myshopify.com`;
    await client.query("insert into app.workspaces(id,status) values($1,'active')",[workspaceId]);
    const row=(await client.query("insert into shopify.installations(shop_id,shop_domain,workspace_id,install_generation,status) values('gid://shopify/Shop/9000000199',$1,$2,1,'active') returning id::text",[domain,workspaceId])).rows[0];
    const owner={installationId:row.id,workspaceId,installGeneration:1,shopId:"gid://shopify/Shop/9000000199",shopDomain:domain};
    for(const provider of ["shopify_admin","shopify_partner"]){
      const hash=()=>createHash("sha256").update(randomUUID()).digest("hex"),c={provider,clientScopeKey:hash(),connectionScopeKey:hash(),connectionEpoch:1,
        accountId:provider==="shopify_admin"?domain:null,organizationId:provider==="shopify_partner"?"123":null,apiVersion:provider==="shopify_partner"?"2026-07":"2026-10"};
      await client.query(`insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,
        account_id,organization_id,client_scope_key,connection_scope_key,connection_epoch,api_version,enabled)
        values($1,1,$2,$3,$4,$5,$6,$7,1,$8,true)`,[workspaceId,provider,row.id,c.accountId,c.organizationId,c.clientScopeKey,c.connectionScopeKey,c.apiVersion]);
      await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,$2)",[c.connectionScopeKey,provider]);
      for(const family of provider==="shopify_partner"?["partner_graphql"]:["permission_scopes","order_headers","order_lines","order_journey"]){
        const op=quotaRouteIdentity(c,{provider,family,accountId:c.accountId,organizationId:c.organizationId,version:c.apiVersion,includes:[]}).routeKey,id=randomUUID(),admin=provider==="shopify_admin";
        await client.query("insert into operations.api_quota_operations(operation_key,provider,route_required,reserved_requested_cost) values($1,$2,true,$3)",[op,provider,admin?37:null]);
        await client.query("insert into operations.api_quota_failure_bindings(operation_key,domain_id) values($1,$2)",[op,c.connectionScopeKey]);
        await client.query(`insert into operations.api_quota_policies(id,provider,cost_unit,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding)
          values($1,$2,$3,60000,120,60,5000,10)`,[id,provider,admin?"shopify_admin_query_points":"quota_units"]);
        await client.query("insert into operations.api_quota_bindings(operation_key,policy_id,units) values($1,$2,$3)",[op,id,admin?37:1]);
        await client.query("insert into operations.api_quota_route_profiles(operation_key,domain_id,quota_fingerprint,enabled) select $1,$2,operations.shared_api_quota_fingerprint($1),true",[op,c.connectionScopeKey]);
        await client.query("insert into operations.api_quota_routes(route_key,operation_key,enabled) values($1,$1,true)",[op]);
        await client.query("update operations.api_quota_operations set enabled=true where operation_key=$1",[op]);
      }
    }
    const runtime={async query(sql,args){await client.query("set local role adstable_runtime");try{return await client.query(sql,args);}finally{await client.query("set local role adstable_owner");}}};
    const plan=await createShopifyOrderRangePlanner({expected:owner,database:runtime,policy:{...inputs[0].plan.policy,maxRanges:1},
      now:()=>new Date("2026-10-01T03:00:00Z")}).plan({fromInclusive:"2026-10-01T00:00:00Z"});
    assert.equal((await createShopifyOrderQueueAdmission({database,quotaStore:createSharedQuotaRepository(database)}).enqueue({plan,rangeKey:plan.ranges[0].key})).status,"queued");
    const budget=(await client.query("select budget from operations.refresh_control")).rows[0].budget;
    budget.workspaces.push({workspaceId,limit:{requests:10,dbWrites:10,connections:10,rows:10,bytes:10}});
    await client.query("update operations.refresh_control set budget=$1::jsonb",[JSON.stringify(budget)]);
    const work=createShopifyOrderWorkReservations({database}),bind=shopifyOrderWorkReservationBinding(work);
    const next=()=>work.reserveNext({maxCandidates:2});
    const a=await next();assert.equal(a.status,"reserved","first fair candidate must produce a genuine SQL reservation");assert.equal(bind.peek(a).p.owner.workspaceId,workspaceId,"never-served workspace is chosen before previously served root");
    assert.equal((await work.releaseBeforeRequest({reservation:a})).status,"released");
    const b=await next();assert.equal(b.status,"reserved");assert.equal(bind.peek(b).p.owner.workspaceId,root.workspaceId,"released attempts retain service age across factory instances");
    assert.equal(b.rangeKey,inputs[0].rangeKey,"oldest queued range first");
    const blocked=await next();assert.equal(blocked.status,"no_admission","shared capacity remains reserved; another process cannot overbook");
    assert.equal((await work.releaseBeforeRequest({reservation:b})).status,"released");
    const third=createShopifyOrderWorkReservations({database});
    const c=await third.reserveNext({maxCandidates:2,excludeWorkspaceIds:[workspaceId]});
    assert.equal(c.status,"reserved");assert.equal(c.rangeKey,inputs[0].rangeKey);
    // Use exact owning factory for release; another factory cannot mint the handle.
    await assert.rejects(work.releaseBeforeRequest({reservation:c}),/INPUT_INVALID/);
    await client.query("savepoint fair_dispatch_empty");
    await client.query("update operations.shopify_order_pending_ranges set status='cancelled' where workspace_id=$1",[workspaceId]);
    assert.equal((await next()).status,"empty","busy installations are not selected again");
    await client.query("rollback to savepoint fair_dispatch_empty");await client.query("release savepoint fair_dispatch_empty");
    assert.equal((await third.releaseBeforeRequest({reservation:c})).status,"released");
    await client.query("update operations.refresh_quota_contexts set connection_epoch=connection_epoch+1 where workspace_id=$1 and provider='shopify_admin'",[workspaceId]);
    assert.equal((await work.reserveNext({maxCandidates:1})).status,"no_admission","one stale candidate is bounded and visibly refused");
    const rotated=await work.reserveNext({maxCandidates:1});assert.equal(rotated.status,"reserved","refused candidate age persists; healthy workspace is next even with scan bound one");
    assert.equal(bind.peek(rotated).p.owner.workspaceId,root.workspaceId);
    assert.equal((await work.releaseBeforeRequest({reservation:rotated})).status,"released");
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
      assert.equal((await client.query("select has_function_privilege($1,'operations.reserve_next_shopify_order_work(uuid,integer,uuid[])','EXECUTE') ok",[role])).rows[0].ok,role==="adstable_refresh_coordinator");
    const unknown=createShopifyOrderWorkReservations({database:{async query(sql,args){await database.query(sql,args);throw Error("synthetic lost reply");}}});
    const before=(await client.query("select count(*) n from operations.shopify_order_work_reservations")).rows[0].n;
    // The adapter loses a committed reply; it cannot automatically reserve again.
    const lost=await unknown.reserveNext({maxCandidates:2});assert.equal(lost.status,"needs_attention");
    assert.equal(Number((await client.query("select count(*) n from operations.shopify_order_work_reservations")).rows[0].n),Number(before)+1);
    assert.equal((await client.query("select status from operations.shopify_order_work_reservations where attempt_id=$1",[lost.attemptId])).rows[0].status,"reserved");
  }finally{await client.query("rollback to savepoint fair_order_dispatch");await client.query("release savepoint fair_order_dispatch");}
  console.log("EO05_SHOPIFY_ORDER_FAIR_DISPATCH_PASS real_SQL=true two_workspaces=true persisted_service_age=true oldest_range=true single_flight=true shared_capacity=true coordinator_only=true no_HTTP_or_Dataset=true");
}
