import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createSharedQuotaRepository} from "../app/lib/database/shared-quota-repository.server.js";
import {createSharedQuotaGuard} from "../app/lib/refresh/shared-quota.server.js";
import {createQuotaScopeResolver,quotaRouteIdentity} from "../app/lib/refresh/quota-scope-resolver.server.js";
import {createQuotaManagedFetch,quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";

// Real SQL + existing HTTP boundary in the rollback-only F01 authority fixture.
export async function merchantQuotaContextProbe(client,{store,execution,connection}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const input={...execution,provider:"google_ads"},base=await store.loadQuotaContext(input);
  assert.equal(base.provider,"google_ads");assert.equal(Object.hasOwn(base,"merchant"),false);
  const owner=(await client.query("select credential_id from integrations.provider_connections where id=$1",[connection])).rows[0];
  const merchant={targetAccountId:"99",quotaAccountId:"98",apiVersion:"products/v1",bindingEpoch:2};
  const expected={...base,merchant},policy=randomUUID(),quotaStore=createSharedQuotaRepository(client);
  const descriptor={provider:"google_ads",family:"merchant_products",accountId:"99",organizationId:null,version:"products/v1",includes:[]};
  const route=quotaRouteIdentity(expected,descriptor);
  const qwhere=" where workspace_id=$1 and provider='google_ads'";
  let calls=0;
  async function native(activeStore=quotaStore){
    const resolve=createQuotaScopeResolver({loadContext:()=>store.loadQuotaContext(input),store:activeStore});
    const fetch=createQuotaManagedFetch({provider:"google_ads",lane:"background",resolveOperation:resolve,
      guard:createSharedQuotaGuard({store:activeStore,now:Date.now}),isDispatchCurrent:async(d,k)=>await resolve(d)===k,
      fetchFn:async()=>{calls++;return new Response('{"products":[]}',{headers:{"content-type":"application/json"}});}});
    return fetch("https://merchantapi.googleapis.com/products/v1/accounts/99/products?pageSize=1000",{headers:{authorization:"Bearer SYNTHETIC-ONLY"}});
  }
  async function changed(sql,args,run){await client.query("savepoint merchant_change");try{await client.query(sql,args);await run();}finally{await client.query("rollback to savepoint merchant_change");await client.query("release savepoint merchant_change");}}
  async function noHTTP(){const before=calls;await assert.rejects(native(),e=>quotaBoundaryControl(e)?.status==="not_configured");assert.equal(calls,before);}
  await client.query("savepoint merchant_context_probe");
  try{
    await client.query("update operations.refresh_quota_contexts set merchant_target_account_id='99',merchant_quota_account_id='98',merchant_api_version='products/v1',merchant_binding_epoch=1,merchant_credential_id=$2"+qwhere,[execution.claim.workspaceId,owner.credential_id]);
    assert.deepEqual(await store.loadQuotaContext(input),base,"prepared Merchant inventory defaults disabled");
    await client.query("update operations.refresh_quota_contexts set merchant_enabled=true,merchant_binding_epoch=2"+qwhere,[execution.claim.workspaceId]);
    assert.deepEqual(await store.loadQuotaContext(input),base,"existing Ads consent does not grant content access");
    await client.query("update integrations.provider_connections set granted_scopes=array_append(granted_scopes,'https://www.googleapis.com/auth/content') where id=$1",[connection]);
    assert.deepEqual(await store.loadQuotaContext(input),expected);
    for(const changedInput of [{...input,entitlementReceipt:undefined},{...input,claim:{...input.claim,fence:input.claim.fence+1}},
      {...input,window:{from:"2000-01-01",to:input.window.to}}])assert.equal(await store.loadQuotaContext(changedInput),null);
    const ads={provider:"google_ads",family:"reporting_query",accountId:base.accountId,organizationId:null,version:base.apiVersion,includes:[]};
    assert.deepEqual(quotaRouteIdentity(base,ads),quotaRouteIdentity(expected,ads),"ordinary Ads route identity is unchanged");
    await client.query("insert into operations.api_quota_failure_domains(id,provider) values($1,'google_ads')",[base.connectionScopeKey]);
    await client.query("insert into operations.api_quota_operations(operation_key,provider,enabled,route_required) values($1,'google_ads',true,true)",[route.routeKey]);
    await client.query("insert into operations.api_quota_policies(id,provider,window_ms,max_units,interactive_reserve,dispatch_delay_ms,max_outstanding) values($1,'google_ads',60000,10,0,5000,10)",[policy]);
    await client.query("insert into operations.api_quota_bindings(operation_key,policy_id,units) values($1,$2,1)",[route.routeKey,policy]);
    await client.query("insert into operations.api_quota_failure_bindings(operation_key,domain_id) values($1,$2)",[route.routeKey,base.connectionScopeKey]);
    await client.query("insert into operations.api_quota_route_profiles(operation_key,domain_id,quota_fingerprint,enabled) select $1,$2,operations.shared_api_quota_fingerprint($1),true",[route.routeKey,base.connectionScopeKey]);
    await client.query("insert into operations.api_quota_routes(route_key,operation_key,enabled) values($1,$1,true)",[route.routeKey]);
    assert.equal((await native()).status,200);assert.equal(calls,1);
    assert.equal((await client.query("select count(*)::int n from operations.api_quota_debits where operation_key=$1 and settled",[route.routeKey])).rows[0].n,1);
    for(const sql of [
      "update operations.refresh_quota_contexts set merchant_enabled=false,merchant_binding_epoch=3"+qwhere,
      "update operations.refresh_quota_contexts set merchant_credential_id='00000000-0000-4000-8000-000000000001',merchant_binding_epoch=3"+qwhere,
    ])await changed(sql,[execution.claim.workspaceId],async()=>{assert.deepEqual(await store.loadQuotaContext(input),base);await noHTTP();});
    await changed("update integrations.provider_connections set granted_scopes=array_remove(granted_scopes,'https://www.googleapis.com/auth/content') where id=$1",[connection],async()=>{
      assert.deepEqual(await store.loadQuotaContext(input),base);await noHTTP();
    });
    for(const assignment of ["merchant_target_account_id='100'","merchant_quota_account_id='97'","merchant_binding_epoch=3"])
      await changed("update operations.refresh_quota_contexts set "+assignment+(assignment.startsWith("merchant_binding_epoch")?"":",merchant_binding_epoch=3")+qwhere,[execution.claim.workspaceId],noHTTP);
    for(const sql of ["update integrations.provider_connections set connection_version=connection_version+1 where id=$1",
      "update integrations.provider_connections set lifecycle_status='disconnect_pending' where id=$1"])
      await changed(sql,[connection],async()=>{assert.equal(await store.loadQuotaContext(input),null);await noHTTP();});
    for(const assignment of ["merchant_target_account_id='100'","merchant_quota_account_id='97'","merchant_enabled=false","enabled=false","merchant_binding_epoch=1"]){
      await client.query("savepoint merchant_epoch_bad");
      try{await assert.rejects(client.query("update operations.refresh_quota_contexts set "+assignment+qwhere,[execution.claim.workspaceId]),e=>e.code==="P0001");}
      finally{await client.query("rollback to savepoint merchant_epoch_bad");await client.query("release savepoint merchant_epoch_bad");}
    }
    for(const assignment of ["merchant_target_account_id='0'","merchant_target_account_id='099'","merchant_quota_account_id='9223372036854775808'",
      "merchant_api_version='products/v1beta'","merchant_binding_epoch=0","merchant_binding_epoch=9007199254740992","merchant_credential_id=null"]){
      await client.query("savepoint merchant_constraint_bad");
      try{await assert.rejects(client.query("update operations.refresh_quota_contexts set "+assignment+(assignment.startsWith("merchant_binding_epoch")?"":",merchant_binding_epoch=3")+qwhere,[execution.claim.workspaceId]),e=>["23514","P0001"].includes(e.code));}
      finally{await client.query("rollback to savepoint merchant_constraint_bad");await client.query("release savepoint merchant_constraint_bad");}
    }
    await changed("update operations.refresh_quota_contexts set merchant_target_account_id='100',merchant_binding_epoch=3"+qwhere,[execution.claim.workspaceId],async()=>{
      await client.query("update operations.refresh_quota_contexts set merchant_target_account_id='99',merchant_binding_epoch=4"+qwhere,[execution.claim.workspaceId]);
      assert.equal((await store.loadQuotaContext(input)).merchant.bindingEpoch,4);await noHTTP();
    });
    // Current scope must be re-read after the actual SQL reservation, before native dispatch.
    await client.query("savepoint merchant_dispatch_change");
    try{
      const delayed={...quotaStore,reserve:async x=>{const r=await quotaStore.reserve(x);await client.query("update operations.refresh_quota_contexts set merchant_binding_epoch=3"+qwhere,[execution.claim.workspaceId]);return r;}};
      const before=calls;await assert.rejects(native(delayed),e=>quotaBoundaryControl(e)?.status==="not_sent");assert.equal(calls,before);
      assert.equal((await client.query("select count(*)::int n from operations.api_quota_debits where operation_key=$1 and settled",[route.routeKey])).rows[0].n,2);
    }finally{await client.query("rollback to savepoint merchant_dispatch_change");await client.query("release savepoint merchant_dispatch_change");}
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
      assert.equal((await client.query("select has_table_privilege($1,'operations.refresh_quota_contexts','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.load_refresh_quota_context_before_merchant(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)','EXECUTE') allowed")).rows[0].allowed,false);
  }finally{await client.query("rollback to savepoint merchant_context_probe");await client.query("release savepoint merchant_context_probe");}
  assert.deepEqual(await store.loadQuotaContext(input),base);
  console.log("EO05_MERCHANT_QUOTA_CONTEXT_PASS real_SQL_to_route_guard_HTTP=true target_quota_accounts_distinct=true current_credential_content_scope=true monotonic_epoch_away_back=true reserve_await_drift_zero_HTTP=true Ads_unchanged=true private_disabled_and_rolled_back=true native_HTTP=0");
}
