import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {createRefreshWorkRepository} from "../app/lib/database/refresh-work-repository.server.js";
import {checkRefreshQueueFromAuthority} from "../app/lib/refresh/native-inventory.server.js";
import {refreshPreflightProbe} from "./eo05-refresh-preflight-probe.mjs";

export async function refreshNativeInventoryProbe(client,connection,environment=process.env) {
  assert.equal(environment.GITHUB_ACTIONS,"true");assert.ok(environment.RUNNER_TEMP);assert.equal(connection.host,"127.0.0.1");assert.equal(connection.port,54322);
  const other=new pg.Client(connection),workspaces=Array.from({length:4},()=>randomUUID());
  const connections={meta:randomUUID(),google_ads:randomUUID(),klaviyo:randomUUID()};
  const initial=new Date(Date.now()-4*3600000).toISOString();let installed=false;
  try {
    await other.connect();await client.query("set role adstable_owner");await other.query("set role adstable_owner");
    await client.query("insert into app.workspaces(id) select unnest($1::uuid[])",[workspaces]);installed=true;
    for(let n=0;n<3;n++) await client.query("insert into shopify.installations(shop_id,shop_domain,workspace_id,status) values($1,$2,$3,$4)",
      [`gid://shopify/Shop/${99999980+n}`,`inventory-${n}.myshopify.com`,workspaces[n],n===2?"uninstall_pending_redaction":"active"]);
    const installationId=(await client.query("select id from shopify.installations where workspace_id=$1",[workspaces[0]])).rows[0].id;
    for(const provider of Object.keys(connections)) {
      const credential=randomUUID();
      await client.query("insert into integrations.provider_credential_envelopes(id,installation_id,workspace_id,install_generation,provider,purpose,payload_ciphertext,nonce,auth_tag,key_version) values($1,$2,$3,1,$4,'provider_token_set',$5,$6,$7,1)",
        [credential,installationId,workspaces[0],provider,Buffer.from("SENSITIVE-SYNTHETIC-CIPHERTEXT"),Buffer.alloc(12),Buffer.alloc(16)]);
      const scopes=provider==="meta"?["ads_read"]:provider==="google_ads"?["https://www.googleapis.com/auth/adwords"]:["campaigns:read","events:read","flows:read","metrics:read"];
      await client.query("insert into integrations.provider_connections(id,installation_id,workspace_id,install_generation,provider,credential_id,granted_scopes,connected_at,last_verified_at) values($1,$2,$3,1,$4,$5,$6,$7,$7)",
        [connections[provider],installationId,workspaces[0],provider,credential,scopes,initial]);
    }
    const addAccount=async(provider,id,kind,eligible=true)=>(await client.query("insert into integrations.provider_accounts(connection_id,workspace_id,install_generation,provider,provider_account_id,display_name,account_kind,reporting_eligible,provider_status,currency_code,timezone_name,verified_at) values($1,$2,1,$3,$4,'SENSITIVE-NAME',$5,$6,'active','USD','UTC',$7) returning id",
      [connections[provider],workspaces[0],provider,id,kind,eligible,initial])).rows[0].id;
    const meta=await addAccount("meta","act_101","advertiser");await addAccount("meta","act_202","advertiser");
    const google=await addAccount("google_ads","111","advertiser");await addAccount("google_ads","222","advertiser");await addAccount("google_ads","999","manager",false);
    await addAccount("klaviyo","klaviyo-a","account");
    for(const [provider,id] of [["meta",meta],["google_ads",google]]) await client.query("insert into integrations.reporting_account_bindings(connection_id,account_id,workspace_id,install_generation,provider,effective_from,change_reason) values($1,$2,$3,1,$4,$5,'initial_selection')",[connections[provider],id,workspaces[0],provider,initial]);
    await client.query("update operations.refresh_queue_control set max_workspaces=8,max_accounts=8,max_snapshot_bytes=30000,max_snapshot_age_ms=60000 where singleton");
    const store=createRefreshWorkRepository(client),second=createRefreshWorkRepository(other);
    const state=await store.readQueueCheck();
    const race=await Promise.all([store.checkQueueFromAuthority({expectedRevision:state.revision}),second.checkQueueFromAuthority({expectedRevision:state.revision})]);
    assert.equal(race.filter(r=>r.committed).length,1);
    let result=await store.readQueueCheck();assert.equal(result.checkedWorkspaces,4);assert.equal(result.checkedAccounts,3);
    let statuses=await store.readInventoryStatus();assert.equal(statuses.length,12);
    assert.equal(statuses.filter(s=>s.reason==="ready_for_entitlement_check").length,3);
    assert.equal(statuses.filter(s=>s.reason==="installation_missing").length,3);
    assert.equal(statuses.filter(s=>s.reason==="installation_inactive").length,3);
    assert.equal(statuses.filter(s=>s.reason==="not_connected").length,3);
    assert.deepEqual(new Set(result.accounts.map(a=>a.accountId)),new Set(["act_101","111","klaviyo-a"]),"unselected and manager accounts cannot enter queue");
    assert.doesNotMatch(JSON.stringify(statuses),/SENSITIVE|myshopify|credential|ciphertext|access_token/);
    const age=result.accounts.find(a=>a.accountId==="111").firstQueuedAtMs;
    await refreshPreflightProbe(client,{workspace:workspaces[0],connections,shopId:"gid://shopify/Shop/99999980",shopDomain:"inventory-0.myshopify.com"});
    await checkRefreshQueueFromAuthority({store});assert.equal((await store.readQueueCheck()).accounts.find(a=>a.accountId==="111").firstQueuedAtMs,age);
    // Switch away AND back before the next queue scan. OAuth connection_version stays unchanged.
    await client.query("select * from integrations.select_reporting_account($1,$2,1,'google_ads','222',clock_timestamp())",[connections.google_ads,workspaces[0]]);
    await client.query("select * from integrations.select_reporting_account($1,$2,1,'google_ads','111',clock_timestamp())",[connections.google_ads,workspaces[0]]);
    assert.equal((await checkRefreshQueueFromAuthority({store})).status,"checked");
    result=await store.readQueueCheck();assert.equal(result.accounts.find(a=>a.accountId==="111").firstDueHourMs,null,"new selection epoch cannot inherit old pending hours");
    await client.query("update integrations.provider_connections set lifecycle_status='reauthorization_required' where id=$1",[connections.meta]);
    await addAccount("klaviyo","klaviyo-b","account");
    await checkRefreshQueueFromAuthority({store});statuses=await store.readInventoryStatus();
    assert.equal(statuses.find(s=>s.workspaceId===workspaces[0]&&s.provider==="meta").reason,"reauthorization_required");
    assert.equal(statuses.find(s=>s.workspaceId===workspaces[0]&&s.provider==="klaviyo").reason,"account_ambiguous");
    result=await store.readQueueCheck();assert.ok(result.accounts.every(a=>a.accountId!=="klaviyo-a"&&a.accountId!=="klaviyo-b"));
    const baseline=JSON.stringify(result),statusBaseline=JSON.stringify(statuses);
    for(const setting of ["max_workspaces=3","max_accounts=1","max_snapshot_bytes=1"]) {
      await client.query(`update operations.refresh_queue_control set ${setting} where singleton`);
      assert.equal((await checkRefreshQueueFromAuthority({store})).status,"needs_attention");
      assert.equal(JSON.stringify(await store.readQueueCheck()),baseline,"over-bound scan cannot advance heartbeat or retire metadata");
      assert.equal(JSON.stringify(await store.readInventoryStatus()),statusBaseline);
      await client.query("update operations.refresh_queue_control set max_workspaces=8,max_accounts=8,max_snapshot_bytes=30000 where singleton");
    }
    for(const role of ["anon","authenticated","service_role","adstable_runtime"])
      for(const fn of ["operations.read_refresh_inventory_status()","operations.check_refresh_queue_from_authority(bigint)"])
        assert.equal((await client.query("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,fn])).rows[0].allowed,false);
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
      assert.equal((await client.query("select has_table_privilege($1,'operations.refresh_inventory_status','SELECT,INSERT,UPDATE,DELETE') as allowed",[role])).rows[0].allowed,false);
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.check_refresh_queue_from_authority(bigint)','EXECUTE') as allowed")).rows[0].allowed,true);
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.build_refresh_native_inventory()','EXECUTE') as allowed")).rows[0].allowed,false);
    assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator','operations.commit_refresh_queue_check(bigint,jsonb)','EXECUTE') as allowed")).rows[0].allowed,false,"coordinator cannot substitute an invented inventory");
    console.log("EO05_NATIVE_INVENTORY_PASS full_workspace_scope=true canonical_accounts_only=true empty_and_blocked_visible=true source_snapshot_atomic=true selection_epoch_safe=true over_bound_no_heartbeat=true arbitrary_JSON_denied=true synthetic_metadata_only=true provider_calls=0 live_changes=false");
  } finally {
    try {
      if(installed) {
        await client.query("delete from integrations.provider_connections where workspace_id=any($1::uuid[])",[workspaces]);
        await client.query("delete from integrations.provider_credential_envelopes where workspace_id=any($1::uuid[])",[workspaces]);
        await client.query("delete from shopify.installations where workspace_id=any($1::uuid[])",[workspaces]);
        await client.query("delete from app.workspaces where id=any($1::uuid[])",[workspaces]);
        await client.query("update operations.refresh_queue_control set max_workspaces=null,max_accounts=null,max_snapshot_bytes=null,max_snapshot_age_ms=null,last_success_at_ms=null,last_observed_at_ms=null,checked_workspaces=null,checked_accounts=null where singleton");
      }
      await client.query("reset role");
    } finally {await other.end();}
  }
}
