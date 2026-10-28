import assert from "node:assert/strict";
import {createIdentityRuntimeAuthorityLoader} from "../app/lib/providers/identity-runtime-authority.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";

// Existing rollback-only F01 fixture; real snapshot SQL and loader, synthetic vault only.
export async function identityAuthoritySnapshotProbe(client,{execution}){
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const {workspaceId,installGeneration}=execution.claim;
  const owner=(await client.query("select id::text,shop_id,shop_domain from shopify.installations where workspace_id=$1 and install_generation=$2 and status='active'",[workspaceId,installGeneration])).rows[0];
  const verified={installationAuthority:{authority:"shopify_installation_verified",status:"active",workspaceId,installGeneration:Number(installGeneration)},
    identity:{session:{authority:"shopify_id_token_verified",shopDomain:owner.shop_domain},shop:{authority:"shopify_admin_verified",shopId:owner.shop_id,myshopifyDomain:owner.shop_domain}},
    context:{admin:{graphql(){throw Error("native HTTP forbidden");}}}};
  const read=provider=>client.query("select * from integrations.load_provider_identity_authority($1,$2,$3,$4,$5)",[workspaceId,installGeneration,provider,owner.shop_id,owner.shop_domain]);
  await client.query("savepoint identity_snapshot_probe");
  try{
    for(const provider of ["meta","google_ads","klaviyo"]){
      const scopes=provider==="klaviyo"?["campaigns:read","events:read","flows:read","metrics:read"]:[...oauthPermissionScopes(provider,"identity_v1")];
      await client.query("update integrations.provider_connections set granted_scopes=$1 where workspace_id=$2 and provider=$3",[scopes,workspaceId,provider]);
      const row=(await read(provider)).rows[0];assert.equal(row.installation_id,owner.id);assert.equal(row.lifecycle_status,"connected");
      assert.equal(row.reporting_selection_epoch===null,provider==="klaviyo");assert.ok(row.accounts.every(a=>!Object.hasOwn(a,"name")));
      const token={access_token:"SYNTHETIC-ONLY",refresh_token:"SYNTHETIC-ONLY",permission_profile:"identity_v1",scope:scopes.join(" "),scopes,
        scope_verified_at:new Date().toISOString(),expires_in:3600,expires_at:new Date(Date.now()+3600000).toISOString()};
      let vaultCalls=0;
      const loader=createIdentityRuntimeAuthorityLoader({verified,database:client,provider,tokenVault:{loadProviderTokenSet:async args=>{
        vaultCalls++;assert.equal(args.credentialId,row.credential_id);return token;}}});
      const current=await loader.loadCurrent();assert.equal(current.installation_id,owner.id);assert.equal(current.reporting_selection_epoch,row.reporting_selection_epoch);
      assert.equal(current.canonical_scope_ready,false);assert.equal(current.persistable,false);assert.equal(vaultCalls,1);
      if(provider==="google_ads"){
        await client.query("savepoint identity_selection_change");
        try{
          const changing=createIdentityRuntimeAuthorityLoader({verified,database:client,provider,tokenVault:{loadProviderTokenSet:async()=>{
            for(const account of ["222","111"])await client.query("select * from integrations.select_reporting_account($1,$2,$3,'google_ads',$4,clock_timestamp())",[row.connection_id,workspaceId,installGeneration,account]);
            return token;}}});
          await assert.rejects(changing.loadCurrent(),/AUTHORITY_CHANGED/);await assert.rejects(changing.loadCurrent(),/EXECUTION_STOPPED/);
          const after=(await read(provider)).rows[0];assert.equal(after.reporting_account_id,row.reporting_account_id);
          assert.notEqual(after.reporting_selection_epoch,row.reporting_selection_epoch,"same selected account has a new binding ID after away/back");
        }finally{await client.query("rollback to savepoint identity_selection_change");await client.query("release savepoint identity_selection_change");}
        for(const sql of ["update integrations.provider_connections set connection_version=connection_version+1 where id=$1",
          "update integrations.provider_connections set lifecycle_status='disconnect_pending' where id=$1"]){
          await client.query("savepoint identity_connection_change");
          try{
            const changing=createIdentityRuntimeAuthorityLoader({verified,database:client,provider,tokenVault:{loadProviderTokenSet:async()=>{await client.query(sql,[row.connection_id]);return token;}}});
            await assert.rejects(changing.loadCurrent(),/AUTHORITY_CHANGED|INSTALLATION_CHANGED/);
          }finally{await client.query("rollback to savepoint identity_connection_change");await client.query("release savepoint identity_connection_change");}
        }
      }
    }
    for(const args of [[workspaceId,installGeneration,"meta","gid://shopify/Shop/1",owner.shop_domain],
      [workspaceId,installGeneration,"meta",owner.shop_id,"wrong.myshopify.com"],[workspaceId,"999","google_ads",owner.shop_id,owner.shop_domain],
      [workspaceId,installGeneration,"unsupported",owner.shop_id,owner.shop_domain]])
      assert.equal((await client.query("select * from integrations.load_provider_identity_authority($1,$2,$3,$4,$5)",args)).rows.length,0);
    for(const role of ["anon","authenticated","service_role"])
      assert.equal((await client.query("select has_function_privilege($1,'integrations.load_provider_identity_authority(uuid,bigint,text,text,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    for(const role of ["adstable_runtime","adstable_refresh_coordinator"]){
      assert.equal((await client.query("select has_function_privilege($1,'integrations.load_provider_identity_authority(uuid,bigint,text,text,text)','EXECUTE') allowed",[role])).rows[0].allowed,true);
      assert.equal((await client.query("select has_table_privilege($1,'integrations.provider_connections','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
    }
  }finally{await client.query("rollback to savepoint identity_snapshot_probe");await client.query("release savepoint identity_snapshot_probe");}
  console.log("EO05_IDENTITY_AUTHORITY_SNAPSHOT_PASS real_SQL_and_three_provider_loaders=true installation_PK_lossless=true selection_binding_epoch=true same_account_away_back_detected=true credential_version_lifecycle_drift_blocked=true private_function_only=true synthetic_vault_no_native_HTTP=true");
}
