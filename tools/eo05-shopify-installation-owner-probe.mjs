import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createShopifyInstallationOwnerRepository} from "../app/lib/database/shopify-installation-owner-repository.server.js";

// Real SQL against the existing rollback-only F01 installation; no token/provider dependency.
export async function shopifyInstallationOwnerProbe(client,{execution}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const {workspaceId,installGeneration}=execution.claim;
  const row=(await client.query("select id::text,shop_id,shop_domain from shopify.installations where workspace_id=$1 and install_generation=$2 and status='active'",[workspaceId,installGeneration])).rows[0];
  const expected={workspaceId,installGeneration:Number(installGeneration),shopId:row.shop_id,shopDomain:row.shop_domain};
  const repository=createShopifyInstallationOwnerRepository({async query(sql,args){
    await client.query("set local role adstable_runtime");
    try{return await client.query(sql,args);}finally{await client.query("set local role adstable_owner");}
  }});
  assert.equal((await repository.load(expected)).installationId,row.id);
  for(const change of [{workspaceId:randomUUID()},{installGeneration:Number(installGeneration)+1},{shopId:"gid://shopify/Shop/999999999"},{shopDomain:"other.myshopify.com"}]){
    assert.equal(await repository.load({...expected,...change}),null);
  }
  await client.query("savepoint shopify_owner_probe");
  try{
    await client.query("update integrations.provider_connections set lifecycle_status='disconnect_pending' where workspace_id=$1",[workspaceId]);
    assert.equal((await repository.load(expected)).installationId,row.id,"Shopify order owner is independent of provider OAuth");
    await client.query("update shopify.installations set status='uninstall_pending_redaction' where workspace_id=$1",[workspaceId]);
    assert.equal(await repository.load(expected),null);
  }finally{await client.query("rollback to savepoint shopify_owner_probe");await client.query("release savepoint shopify_owner_probe");}
  for(const role of ["anon","authenticated","service_role","adstable_refresh_coordinator"]){
    assert.equal((await client.query("select has_function_privilege($1,'shopify.load_active_installation_owner(uuid,bigint,text,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  }
  for(const role of ["adstable_runtime"]){
    assert.equal((await client.query("select has_function_privilege($1,'shopify.load_active_installation_owner(uuid,bigint,text,text)','EXECUTE') allowed",[role])).rows[0].allowed,true);
    assert.equal((await client.query("select has_table_privilege($1,'shopify.installations','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
  }
  console.log("EO05_SHOPIFY_INSTALLATION_OWNER_PASS actual_PK_text=true exact_workspace_generation_shop_domain=true provider_independent=true inactive_denied=true private_function_only=true native_HTTP=0");
}
