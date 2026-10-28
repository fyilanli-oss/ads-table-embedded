import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createTokenVault} from "../app/lib/oauth/token-vault.server.js";
import {stampGoogleIdentityCredential} from "../app/lib/oauth/google-identity-credential.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";

// Invoked only inside the existing F01 temporary runtime-membership SAVEPOINT.
export async function googleIdentityRenewalProbe(client,{execution}) {
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
    for(const role of ["anon","authenticated","service_role","adstable_refresh_coordinator"]){
      assert.equal((await client.query("select has_function_privilege($1,'integrations.read_google_identity_renewal(uuid,uuid,bigint)','EXECUTE') allowed",[role])).rows[0].allowed,false);
      assert.equal((await client.query("select has_function_privilege($1,'integrations.commit_google_identity_renewal(uuid,uuid,bigint,uuid,bigint,uuid,uuid,text[],timestamptz,bytea,bytea,bytea,smallint,timestamptz)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    }
    assert.equal((await client.query("select has_table_privilege('adstable_runtime','integrations.provider_connection_lifecycle_events','SELECT,INSERT,UPDATE,DELETE') allowed")).rows[0].allowed,false);
  }finally{await client.query("rollback to savepoint google_renewal_probe");await client.query("release savepoint google_renewal_probe");}
  console.log("EO05_GOOGLE_IDENTITY_RENEWAL_PASS real_SQL_crypto_CAS_receipt=true selection_preserved=true retired_credentials_do_not_block_history=true conflicts_and_late_failure_no_orphans=true lost_response_no_retry=true explicit_receipt_historical_only=true private_runtime_only=true native_HTTP=0");
}
