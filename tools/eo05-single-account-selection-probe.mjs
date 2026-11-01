import assert from "node:assert/strict";
import {createTokenVault} from "../app/lib/oauth/token-vault.server.js";
import {createMetaOAuthRuntime} from "../app/lib/oauth/meta-oauth-runtime.server.js";
import {createGoogleOAuthRuntime} from "../app/lib/oauth/google-oauth-runtime.server.js";
import {stampGoogleIdentityCredential} from "../app/lib/oauth/google-identity-credential.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {OAUTH_CALLBACK_URIS} from "../app/lib/oauth/oauth-transaction.server.js";

// Runner-only, rollback-only: real runtime/repositories/crypto/SQL; fake HTTP and
// fresh synthetic keys. The caller supplies F01's temporary runtime membership.
export async function singleAccountSelectionProbe(client,{execution}) {
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const {workspaceId,installGeneration}=execution.claim;
  const owner={authority:"shopify_installation_verified",status:"active",workspaceId,installGeneration:Number(installGeneration)};
  for(const provider of ["meta","google_ads"]){
    await client.query("savepoint single_account_selection");
    try{
      await client.query("set local role adstable_owner");
      const before=(await client.query("select * from integrations.provider_connections where workspace_id=$1 and provider=$2",[workspaceId,provider])).rows[0];
      const environment={ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",
        ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:Buffer.alloc(32,41).toString("base64url"),
        META_APP_ID:"123",META_APP_SECRET:"SYNTHETIC-SECRET",META_GRAPH_VERSION:"v26.0",META_OAUTH_REDIRECT_URI:OAUTH_CALLBACK_URIS.meta,
        GOOGLE_ADS_OAUTH_CLIENT_ID:"synthetic-client",GOOGLE_ADS_OAUTH_CLIENT_SECRET:"synthetic-secret",GOOGLE_ADS_OAUTH_REDIRECT_URI:OAUTH_CALLBACK_URIS.google_ads};
      const queries=[],calls=[],receipts=[];
      const database={async query(sql,args){
        queries.push(sql);await client.query("savepoint single_selection_rpc");
        try{
          await client.query("set local role adstable_runtime");
          const result=await client.query(sql,args);
          if(sql.includes("complete_pending_provider_account_selection("))receipts.push(result.rows[0]);
          await client.query("set local role adstable_owner");await client.query("release savepoint single_selection_rpc");return result;
        }catch(error){
          await client.query("rollback to savepoint single_selection_rpc");await client.query("release savepoint single_selection_rpc");throw error;
        }
      }};
      const vault=createTokenVault({database,environment}),scopes=oauthPermissionScopes(provider,"identity_v1");
      const tokenSet=provider==="meta"?{access_token:"SYNTHETIC-ACCESS",permission_profile:"identity_v1",scopes,
        expires_at:new Date(Date.now()+3600000).toISOString()}:stampGoogleIdentityCredential({access_token:"SYNTHETIC-ACCESS",
        refresh_token:"SYNTHETIC-REFRESH",scope:scopes.join(" "),expires_in:3600});
      const stored=await vault.storeProviderTokenSet({installationAuthority:owner,provider,tokenSet});
      await client.query("update integrations.reporting_account_bindings set effective_to=statement_timestamp() where connection_id=$1 and effective_to is null",[before.id]);
      await client.query("update integrations.provider_accounts set active=false,disconnected_at=statement_timestamp() where connection_id=$1 and active",[before.id]);
      await client.query("update integrations.provider_connections set lifecycle_status='pending_account_selection',credential_id=$2 where id=$1",[before.id,stored.credentialId]);
      const first=provider==="meta"?"act_9988776655":"9988776655";
      const second=provider==="meta"?"act_9988776644":"9988776644";
      const runtime=(provider==="meta"?createMetaOAuthRuntime:createGoogleOAuthRuntime)({database,tokenVault:vault,environment,
        identityAuthorizationEnabled:true,fetchFn:async address=>{
          calls.push(address);let body;
          if(provider==="meta"){
            if(address.includes("/debug_token"))body={data:{is_valid:true,app_id:"123",scopes,expires_at:Math.floor(Date.now()/1000)+3600}};
            else{assert.match(address,/\/me\/adaccounts\?/);body={data:[{id:first,name:"Synthetic first"},{id:second,name:"Synthetic second"}]};}
          }else{
            if(address.endsWith("/customers:listAccessibleCustomers"))body={resourceNames:["customers/9988776655"]};
            else{assert.match(address,/\/customers\/9988776655\/googleAds:search$/);body={results:[first,second].map((id,index)=>({customerClient:{id,level:String(index),manager:false,status:"ENABLED"}}))};}
          }
          return new Response(JSON.stringify(body),{status:200});
        }});
      const result=await runtime.combinedSetup.select({installationAuthority:owner,selectedAccountIds:[first],
        expectedConnection:{connectionId:before.id,version:Number(before.connection_version)}});
      assert.equal(receipts.length,1);
      assert.deepEqual(Object.keys(receipts[0]).sort(),["connected_account_count","connection_id","connection_version","lifecycle_status"]);
      assert.equal(Object.hasOwn(receipts[0],"reporting_account_id"),false,"real SQL receipt must not fabricate the missing field");
      assert.equal(result.setupResumeAction,"reporting_selected");assert.equal(result.reportingAccountId,first);
      assert.equal(result.connectionState,"connected");assert.equal(result.setupComplete,false);
      assert.equal(result.connectionVersion,Number(before.connection_version)+1);
      assert.equal(queries.filter(sql=>sql.includes("complete_pending_provider_account_selection(")).length,1);
      assert.equal(queries.filter(sql=>sql.includes("load_provider_account_authority(")).length,1);
      assert.equal(calls.length,2,"readback must not issue another native request or repeat OAuth");
      const durable=(await client.query(`select a.provider_account_id from integrations.reporting_account_bindings b
        join integrations.provider_accounts a on a.id=b.account_id where b.connection_id=$1 and b.effective_to is null`,[before.id])).rows;
      assert.deepEqual(durable.map(row=>row.provider_account_id),[first]);
      assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC|credentialId|access_token|refresh_token/);
      console.log(`EO05_SINGLE_ACCOUNT_SELECTION_PASS provider=${provider} actual_SQL_receipt_without_reporting_ID=true durable_reporting_binding_verified=true one_write_no_retry=true extra_native_HTTP=0`);
    }finally{await client.query("rollback to savepoint single_account_selection");await client.query("release savepoint single_account_selection");}
  }
}
