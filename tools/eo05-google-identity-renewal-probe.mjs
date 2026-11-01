import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createTokenVault} from "../app/lib/oauth/token-vault.server.js";
import {stampGoogleIdentityCredential} from "../app/lib/oauth/google-identity-credential.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {createGoogleOAuthRuntime} from "../app/lib/oauth/google-oauth-runtime.server.js";
import {OAUTH_CALLBACK_URIS} from "../app/lib/oauth/oauth-transaction.server.js";

// Invoked only inside the existing F01 temporary runtime-membership SAVEPOINT.
export async function googleIdentityRenewalProbe(client,{execution,coordinatorExpected=true}) {
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const {workspaceId,installGeneration}=execution.claim;
  const owner={authority:"shopify_installation_verified",status:"active",workspaceId,installGeneration:Number(installGeneration)};
  const environment={ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",
    ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:Buffer.alloc(32,41).toString("base64url")};
  for(const {v} of (await client.query("select distinct key_version v from integrations.provider_credential_envelopes union select distinct key_version v from integrations.oauth_pkce_envelopes")).rows){
    if(Number(v)!==1)environment[`ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V${v}`]=Buffer.alloc(32,41+Number(v)).toString("base64url");
  }
  const db={async query(sql,args){
    await client.query("savepoint google_renew_rpc");
    try {
      await client.query("set local role adstable_runtime");
      const result=await client.query(sql,args);
      await client.query("set local role adstable_owner");await client.query("release savepoint google_renew_rpc");
      return result;
    }catch(error){
      await client.query("rollback to savepoint google_renew_rpc");await client.query("release savepoint google_renew_rpc");
      throw error;
    }
  }};
  const vault=createTokenVault({database:db,environment});await vault.assertRuntimeReady();
  const current=async()=> (await client.query("select * from integrations.provider_connections where workspace_id=$1 and install_generation=$2 and provider='google_ads'",[workspaceId,installGeneration])).rows[0];
  async function input(){
    const c=await current();return {installationAuthority:owner,renewalId:randomUUID(),connectionId:c.id,
      expectedVersion:Number(c.connection_version),expectedCredentialId:c.credential_id,
      tokenSet:stampGoogleIdentityCredential({access_token:"SYNTHETIC-NEW",refresh_token:"SYNTHETIC-REFRESH",
        expires_in:3600,scope:oauthPermissionScopes("google_ads","identity_v1").join(" ")})};
  }
  const count=async()=>Number((await client.query("select count(*) n from integrations.provider_credential_envelopes")).rows[0].n);
  await client.query("savepoint google_renewal_probe");
  try {
    const v=await input(),before=await current();
    const selection=(await client.query("select id::text,account_id::text from integrations.reporting_account_bindings where connection_id=$1 and effective_to is null",[before.id])).rows;
    const r=await vault.renewGoogleIdentityCredential(v);
    assert.equal(r.version,Number(before.connection_version)+1);assert.equal(r.status,"connected");
    assert.equal((await current()).credential_id,r.credentialId);
    assert.equal((await client.query("select id from integrations.provider_credential_envelopes where id=$1",[before.credential_id])).rowCount,0);
    assert.deepEqual((await client.query("select id::text,account_id::text from integrations.reporting_account_bindings where connection_id=$1 and effective_to is null",[before.id])).rows,selection);
    const decrypted=await vault.loadProviderTokenSet({installationAuthority:owner,provider:"google_ads",credentialId:r.credentialId});
    assert.equal(decrypted.access_token,"SYNTHETIC-NEW");
    const proof=await vault.readGoogleIdentityRenewal(v);assert.equal(proof.credentialAfterId,r.credentialId);
    assert.equal(proof.credentialBeforeId,before.credential_id);assert.equal(proof.historicalCommit,true);assert.equal(proof.authorizesActivation,false);
    // After another renewal, old receipt stays historical and doesn't require the retired envelope.
    const second=await vault.renewGoogleIdentityCredential(await input());assert.notEqual(second.credentialId,r.credentialId);
    assert.equal((await vault.readGoogleIdentityRenewal(v)).credentialAfterId,r.credentialId);
    assert.equal(await vault.readGoogleIdentityRenewal({...v,installationAuthority:{...owner,installGeneration:owner.installGeneration+1}}),null);
    assert.equal(await vault.readGoogleIdentityRenewal({...v,installationAuthority:{...owner,workspaceId:randomUUID()}}),null);
    await client.query("rollback to savepoint google_renewal_probe");

    const lost=await input();let writes=0;
    const uncertain=createTokenVault({environment,database:{async query(sql,args){
      const result=await db.query(sql,args);if(sql.includes("commit_google_identity_renewal")){writes++;throw Error("simulated lost response");}return result;
    }}});
    await assert.rejects(uncertain.renewGoogleIdentityCredential(lost),e=>e.message==="GOOGLE_IDENTITY_RENEWAL_WRITE_UNCONFIRMED"&&e.renewalId===lost.renewalId);
    assert.equal(writes,1);assert.ok(await uncertain.readGoogleIdentityRenewal(lost));assert.equal(writes,1);
    await client.query("rollback to savepoint google_renewal_probe");

    for(const mode of ["version","credential","disconnect","scope_downgrade","reused_event","late_receipt"]){
      const bad=await input(),original=await current();
      if(mode==="version")bad.expectedVersion++;
      if(mode==="credential")bad.expectedCredentialId=randomUUID();
      if(mode==="disconnect")await client.query("update integrations.provider_connections set lifecycle_status='disconnect_pending' where id=$1",[original.id]);
      if(mode==="scope_downgrade")await client.query("update integrations.provider_connections set granted_scopes=array_append(granted_scopes,'ungranted-extra') where id=$1",[original.id]);
      if(mode==="reused_event"){
        const committed=await vault.renewGoogleIdentityCredential(bad);
        const next=await input();bad.expectedVersion=next.expectedVersion;bad.expectedCredentialId=committed.credentialId;
      }
      if(mode==="late_receipt"){
        await client.query("create function pg_temp.reject_google_renewal_receipt() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_RECEIPT_FAILURE'; end$$");
        await client.query("create trigger reject_google_renewal_receipt before update of identity_credential_after_id on integrations.provider_connection_lifecycle_events for each row execute function pg_temp.reject_google_renewal_receipt()");
      }
      const n=await count(),state=await current();
      await assert.rejects(vault.renewGoogleIdentityCredential(bad),/GOOGLE_IDENTITY_RENEWAL_WRITE_UNCONFIRMED/);
      assert.equal(await count(),n);assert.equal((await current()).credential_id,state.credential_id);
      assert.equal((await current()).connection_version,state.connection_version);
      if(mode!=="reused_event")assert.equal(await vault.readGoogleIdentityRenewal(bad),null);
      await client.query("rollback to savepoint google_renewal_probe");
    }
    for(const role of ["anon","authenticated","service_role",...(coordinatorExpected?["adstable_refresh_coordinator"]:[])]){
      assert.equal((await client.query("select has_function_privilege($1,'integrations.read_google_identity_renewal(uuid,uuid,bigint)','EXECUTE') allowed",[role])).rows[0].allowed,false);
      assert.equal((await client.query("select has_function_privilege($1,'integrations.commit_google_identity_renewal(uuid,uuid,bigint,uuid,bigint,uuid,uuid,text[],timestamptz,bytea,bytea,bytea,smallint,timestamptz)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    }
    assert.equal((await client.query("select has_table_privilege('adstable_runtime','integrations.provider_connection_lifecycle_events','SELECT,INSERT,UPDATE,DELETE') allowed")).rows[0].allowed,false);
  }finally{await client.query("rollback to savepoint google_renewal_probe");await client.query("release savepoint google_renewal_probe");}
  console.log("EO05_GOOGLE_IDENTITY_RENEWAL_PASS real_SQL_crypto_CAS_receipt=true selection_preserved=true retired_credentials_do_not_block_history=true conflicts_and_late_failure_no_orphans=true lost_response_no_retry=true explicit_receipt_historical_only=true private_runtime_only=true native_HTTP=0");
}

// Reproduce the owner's exact trigger through the real runtime, vault, crypto,
// renewal RPC and Reporting Account write. All HTTP replies and keys are synthetic.
export async function googleReportingChangeProbe(client,{execution}) {
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  const {workspaceId,installGeneration}=execution.claim;
  const owner={authority:"shopify_installation_verified",status:"active",workspaceId,installGeneration:Number(installGeneration)};
  const environment={ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",
    ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:Buffer.alloc(32,41).toString("base64url"),
    GOOGLE_ADS_OAUTH_CLIENT_ID:"synthetic-client",GOOGLE_ADS_OAUTH_CLIENT_SECRET:"synthetic-secret",
    GOOGLE_ADS_OAUTH_REDIRECT_URI:OAUTH_CALLBACK_URIS.google_ads};
  const calls=[],queries=[];
  const db={async query(sql,args){
    queries.push(sql);
    await client.query("savepoint google_reporting_rpc");
    try{
      await client.query("set local role adstable_runtime");
      const result=await client.query(sql,args);
      await client.query("set local role adstable_owner");await client.query("release savepoint google_reporting_rpc");
      return result;
    }catch(error){
      await client.query("rollback to savepoint google_reporting_rpc");await client.query("release savepoint google_reporting_rpc");throw error;
    }
  }};
  const vault=createTokenVault({database:db,environment});
  const scopes=oauthPermissionScopes("google_ads","identity_v1");
  const json=body=>new Response(JSON.stringify(body),{status:200});
  const runtime=createGoogleOAuthRuntime({database:db,tokenVault:vault,environment,fetchFn:async(address,options)=>{
    calls.push(address);
    if(address==="https://oauth2.googleapis.com/token"){
      const form=new URLSearchParams(options.body);
      assert.equal(form.get("grant_type"),"refresh_token");assert.equal(form.get("refresh_token"),"SYNTHETIC-REFRESH");
      return json({access_token:"SYNTHETIC-NEW",token_type:"Bearer",expires_in:3600,scope:scopes.join(" ")});
    }
    assert.equal(options.headers.authorization,"Bearer SYNTHETIC-NEW");
    if(address.endsWith("/customers:listAccessibleCustomers"))return json({resourceNames:["customers/9988776655"]});
    assert.match(address,/\/customers\/9988776655\/googleAds:search$/);
    return json({results:["9988776655","9988776644"].map((id,index)=>({customerClient:{id,level:String(index),manager:false,status:"ENABLED"}}))});
  }});
  await client.query("savepoint google_reporting_change_probe");
  try{
    await client.query("set local role adstable_owner");
    const before=(await client.query("select * from integrations.provider_connections where workspace_id=$1 and provider='google_ads'",[workspaceId])).rows[0];
    await client.query(`insert into integrations.provider_accounts
      (connection_id,workspace_id,install_generation,provider,provider_account_id,display_name,account_kind,reporting_eligible,verified_at)
      values ($1,$2,$3,'google_ads','9988776644','Synthetic second advertiser','advertiser',true,statement_timestamp())`,[before.id,workspaceId,installGeneration]);
    const stored=await vault.storeProviderTokenSet({installationAuthority:owner,provider:"google_ads",
      tokenSet:stampGoogleIdentityCredential({access_token:"SYNTHETIC-EXPIRED",refresh_token:"SYNTHETIC-REFRESH",expires_in:3600,scope:scopes.join(" ")},()=>new Date(Date.now()-7200000))});
    await client.query("update integrations.provider_connections set credential_id=$2 where id=$1",[before.id,stored.credentialId]);
    const result=await runtime.changeReporting({installationAuthority:owner,reportingAccountId:"9988776644"});
    assert.equal(result.changed,true);assert.equal(result.reportingAccountId,"9988776644");
    assert.equal(calls.length,3);assert.equal(calls.filter(url=>url==="https://oauth2.googleapis.com/token").length,1);
    const renewalIndex=queries.findIndex(sql=>sql.includes("commit_google_identity_renewal("));
    assert.ok(renewalIndex>=0);assert.ok(queries.findIndex(sql=>sql.includes("select_reporting_account("))>renewalIndex);
    const after=(await client.query("select * from integrations.provider_connections where id=$1",[before.id])).rows[0];
    assert.equal(Number(after.connection_version),Number(before.connection_version)+1);
    assert.notEqual(after.credential_id,stored.credentialId);assert.equal(after.lifecycle_status,"connected");
    assert.equal((await client.query(`select a.provider_account_id from integrations.reporting_account_bindings b
      join integrations.provider_accounts a on a.id=b.account_id where b.connection_id=$1 and b.effective_to is null`,[before.id])).rows[0].provider_account_id,"9988776644");
  }finally{await client.query("rollback to savepoint google_reporting_change_probe");await client.query("release savepoint google_reporting_change_probe");}
  console.log("EO05_GOOGLE_REPORTING_CHANGE_PASS expired_token_refreshed_once=true real_SQL_vault_renewal_and_reporting_write=true selected_second_account_persisted=true native_HTTP=0");
}
