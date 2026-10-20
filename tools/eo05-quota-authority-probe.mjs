import assert from "node:assert/strict";
import {createRefreshQuotaClients} from "../app/lib/refresh/quota-authority-binding.server.js";
import {quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";

// Called while the real fenced worker is at request_intent, AFTER fresh billing proof.
// All native data/provider tokens are synthetic. Each authority mutation rolls back to a savepoint.
export async function quotaAuthorityProbe(client,{store,quotaStore,execution,connection,environment,payload}) {
  const input={...execution,provider:execution.claim.provider};
  const current=await store.loadQuotaContext(input);assert.equal(current.accountId,execution.claim.accountId);
  assert.equal(await store.loadQuotaContext({...input,entitlementReceipt:undefined}),null,"provider data needs fresh billing proof");
  assert.equal(await store.loadQuotaContext({...input,entitlementReceipt:{observedAt:"2000-01-01T00:00:00Z"}}),null);
  assert.equal(await store.loadQuotaContext({...input,claim:{...input.claim,fence:input.claim.fence+1}}),null);
  assert.equal(await store.loadQuotaContext({...input,window:{from:"2000-01-01",to:input.window.to}}),null);
  for(const sql of [
    "update integrations.provider_connections set lifecycle_status='reauthorization_required' where id=$1",
    "update integrations.provider_connections set lifecycle_status='disconnect_pending' where id=$1",
    "update integrations.provider_connections set lifecycle_status='disconnected',credential_id=null,disconnected_at=clock_timestamp() where id=$1",
    "update integrations.provider_connections set connection_version=connection_version+1 where id=$1",
    "update operations.refresh_quota_contexts set enabled=false where connection_id=$1",
  ]) {
    await client.query("savepoint authority_probe");
    try {await client.query(sql,[connection]);assert.equal(await store.loadQuotaContext(input),null);}
    finally {await client.query("rollback to savepoint authority_probe");await client.query("release savepoint authority_probe");}
  }
  await client.query("savepoint selection_probe");
  try {
    for(const account of ["222","111"]) await client.query("select * from integrations.select_reporting_account($1,$2,1,'google_ads',$3,clock_timestamp())",[connection,input.claim.workspaceId,account]);
    assert.equal(await store.loadQuotaContext(input),null,"switch away/back cannot revive old work");
  } finally {await client.query("rollback to savepoint selection_probe");await client.query("release savepoint selection_probe");}
  // Real SQL authority loader + real HTTP wrapper. Only quota grant latency is simulated here.
  let calls=0,settles=0,stops=0;
  await client.query("savepoint dispatch_probe");
  try {
    const delayedStore={resolveRoute:x=>quotaStore.resolveRoute(x),reserve:async x=>{
      await client.query("update integrations.provider_connections set lifecycle_status='disconnect_pending' where id=$1",[connection]);
      return {...x,status:"reserved",dispatchBeforeMs:Date.now()+5000,dispatchBudgetMs:5000};
    },settle:async()=>{settles++;return true;},stop:async()=>{stops++;return true;}};
    const api=createRefreshQuotaClients({workStore:store,quotaStore:delayedStore,...execution,now:Date.now,
      fetchFn:async()=>{calls++;return new Response(JSON.stringify(payload));}}).shopify({environment});
    await assert.rejects(api.activeSubscription({apiVersion:"2026-07",query:"query { activeSubscription { id } }",variables:{}}),e=>quotaBoundaryControl(e)?.status==="not_sent");
    assert.equal(calls,0);assert.equal(settles,1);assert.equal(stops,0);
  } finally {await client.query("rollback to savepoint dispatch_probe");await client.query("release savepoint dispatch_probe");}
  for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
    assert.equal((await client.query("select has_table_privilege($1,'operations.refresh_quota_contexts','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
  for(const role of ["anon","authenticated","service_role","adstable_runtime"])
    assert.equal((await client.query("select has_function_privilege($1,'operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  console.log("EO05_QUOTA_AUTHORITY_BINDING_PASS current_fenced_SQL_authority=true fresh_billing_required_for_data=true account_away_back_blocked=true connection_change_blocked=true quota_await_change_zero_HTTP=true private_scope_inventory=true actual_provider_calls=0");
}
