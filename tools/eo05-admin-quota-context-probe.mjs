import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";

// Existing rollback-only F01 scenario, real PostgreSQL and adapter; no native HTTP.
export async function adminQuotaContextProbe(client,{store,execution,connection}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const {claim,window}=execution,input={...execution,provider:"shopify_admin"};
  const hash=()=>createHash("sha256").update(randomUUID()).digest("hex");
  const owner=(await client.query("select id,shop_domain from shopify.installations where workspace_id=$1 and install_generation=$2 and status='active'",[claim.workspaceId,claim.installGeneration])).rows[0];
  const expected={provider:"shopify_admin",clientScopeKey:hash(),connectionScopeKey:hash(),connectionEpoch:1,
    accountId:owner.shop_domain,organizationId:null,apiVersion:"2026-10"};
  await client.query("savepoint admin_context_probe");
  try{
    assert.equal(await store.loadQuotaContext(input),null,"no Admin inventory is not configured");
    await client.query(`insert into operations.refresh_quota_contexts(workspace_id,install_generation,provider,installation_id,
      account_id,client_scope_key,connection_scope_key,connection_epoch,api_version)
      values($1,$2,'shopify_admin',$3,$4,$5,$6,1,'2026-10')`,
    [claim.workspaceId,claim.installGeneration,owner.id,owner.shop_domain,expected.clientScopeKey,expected.connectionScopeKey]);
    assert.equal(await store.loadQuotaContext(input),null,"Admin scope defaults disabled");
    await client.query("update operations.refresh_quota_contexts set enabled=true where workspace_id=$1 and provider='shopify_admin'",[claim.workspaceId]);
    assert.deepEqual(await store.loadQuotaContext(input),expected);
    for(const changed of [
      {...input,entitlementReceipt:undefined},
      {...input,entitlementReceipt:{observedAt:"2000-01-01T00:00:00Z"}},
      {...input,claim:{...claim,fence:claim.fence+1}},
      {...input,claim:{...claim,installGeneration:"2"}},
      {...input,claim:{...claim,accountId:"other-account"}},
      {...input,window:{from:"2000-01-01",to:window.to}},
    ])assert.equal(await store.loadQuotaContext(changed),null,"original provider authority and fresh billing required for Admin");

    const other=randomUUID(),suffix=other.slice(0,8),shopId=BigInt("0x"+other.replaceAll("-","").slice(0,12)).toString();
    await client.query("insert into app.workspaces(id) values($1)",[other]);
    const foreign=(await client.query("insert into shopify.installations(workspace_id,shop_id,shop_domain) values($1,$2,$3) returning id",
      [other,`gid://shopify/Shop/${shopId}`,`admin-${suffix}.myshopify.com`])).rows[0].id;
    const changes=[
      ["update operations.refresh_quota_contexts set enabled=false where workspace_id=$1 and provider='shopify_admin'",[claim.workspaceId]],
      ["update operations.refresh_quota_contexts set account_id='other.myshopify.com' where workspace_id=$1 and provider='shopify_admin'",[claim.workspaceId]],
      ["update operations.refresh_quota_contexts set installation_id=$2 where workspace_id=$1 and provider='shopify_admin'",[claim.workspaceId,foreign]],
      ["update operations.refresh_quota_contexts set install_generation=2 where workspace_id=$1 and provider='shopify_admin'",[claim.workspaceId]],
      ["update integrations.provider_connections set connection_version=connection_version+1 where id=$1",[connection]],
      ["update integrations.provider_connections set lifecycle_status='disconnect_pending' where id=$1",[connection]],
      ["update operations.refresh_work_progress set stage='response_received' where workspace_id=$1 and provider=$2 and account_id=$3 and job_id=$4 and fence=$5",[claim.workspaceId,claim.provider,claim.accountId,claim.id,claim.fence]],
    ];
    for(const [sql,params] of changes){
      await client.query("savepoint admin_context_change");
      try{await client.query(sql,params);assert.equal(await store.loadQuotaContext(input),null);}
      finally{await client.query("rollback to savepoint admin_context_change");await client.query("release savepoint admin_context_change");}
    }
    // Real selection mutation away/back must not revive the original provider job.
    await client.query("savepoint admin_selection_change");
    try{
      for(const account of ["222","111"])await client.query("select * from integrations.select_reporting_account($1,$2,1,'google_ads',$3,clock_timestamp())",[connection,claim.workspaceId,account]);
      assert.equal(await store.loadQuotaContext(input),null);
    }finally{await client.query("rollback to savepoint admin_selection_change");await client.query("release savepoint admin_selection_change");}
    for(const [sql,params] of [
      ["update operations.refresh_quota_contexts set account_id='UPPER.myshopify.com' where workspace_id=$1 and provider='shopify_admin'",[claim.workspaceId]],
      ["update operations.refresh_quota_contexts set api_version='2026-11' where workspace_id=$1 and provider='shopify_admin'",[claim.workspaceId]],
      ["update operations.refresh_quota_contexts set connection_id=$2 where workspace_id=$1 and provider='shopify_admin'",[claim.workspaceId,connection]],
    ]){
      await client.query("savepoint admin_constraint");
      try{await assert.rejects(client.query(sql,params),e=>e.code==="23514");}
      finally{await client.query("rollback to savepoint admin_constraint");await client.query("release savepoint admin_constraint");}
    }
    for(const role of ["anon","authenticated","service_role","adstable_runtime","adstable_refresh_coordinator"])
      assert.equal((await client.query("select has_table_privilege($1,'operations.refresh_quota_contexts','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
    for(const role of ["anon","authenticated","service_role","adstable_runtime"])
      assert.equal((await client.query("select has_function_privilege($1,'operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    assert.deepEqual(await store.loadQuotaContext(input),expected,"savepoints restore current original execution");
  }finally{await client.query("rollback to savepoint admin_context_probe");await client.query("release savepoint admin_context_probe");}
  assert.equal(await store.loadQuotaContext(input),null,"synthetic Admin inventory rolled back");
  console.log("EO05_ADMIN_QUOTA_CONTEXT_PASS same_installation_domain=true original_provider_fence_window_connection=true fresh_billing=true disabled_default=true private_inventory=true synthetic_rows_rolled_back=true native_HTTP=0");
}
