import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {createTokenVault} from "../app/lib/oauth/token-vault.server.js";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {shopifyInstallationOwnerProbe} from "./eo05-shopify-installation-owner-probe.mjs";
import {googleIdentityRenewalProbe} from "./eo05-google-identity-renewal-probe.mjs";
import {shopifyOrderQueueProbe} from "./eo05-shopify-order-queue-probe.mjs";

// Rollback-only real SQL + actual envelope crypto. No native provider calls or live keys.
export async function identityOAuthAtomicProbe(client,{execution}) {
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
  assert.equal((await client.query("select session_user as role")).rows[0].role,"postgres");
  const membershipSql="select * from pg_auth_members order by roleid,member,grantor";
  const before=(await client.query(membershipSql)).rows;
  // Same temporary test membership as F01 withTestRuntimeMembership, but SAVEPOINT:
  // the native inventory fixture already owns the transaction and must not be rolled back here.
  await client.query("savepoint identity_oauth_test_membership");
  try {
    await client.query("set local role postgres");
    await client.query("grant adstable_runtime to postgres with inherit false, set true, admin false");
    await client.query("grant adstable_refresh_coordinator to postgres with inherit false, set true, admin false");
    await client.query("set local role adstable_owner");
    await identityOAuthAtomicProbeWithTestMembership(client,{execution});
    await googleIdentityRenewalProbe(client,{execution});
    await shopifyInstallationOwnerProbe(client,{execution});
    await shopifyOrderQueueProbe(client,{execution});
  } finally {
    await client.query("rollback to savepoint identity_oauth_test_membership");
    await client.query("release savepoint identity_oauth_test_membership");
    assert.deepEqual((await client.query(membershipSql)).rows,before,"test membership restored exactly");
  }
}

async function identityOAuthAtomicProbeWithTestMembership(client,{execution}) {
  const {workspaceId,installGeneration}=execution.claim;
  const owner={authority:"shopify_installation_verified",status:"active",workspaceId,installGeneration:Number(installGeneration)};
  const environment={ADSTABLE_PROVIDER_TOKEN_ACTIVE_KEY_VERSION:"1",
    ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V1:Buffer.alloc(32,31).toString("base64url")};
  // Existing fixture envelopes can mention another synthetic key version; include it.
  const versions=(await client.query("select distinct key_version from integrations.provider_credential_envelopes union select distinct key_version from integrations.oauth_pkce_envelopes")).rows;
  for(const {key_version:v} of versions) if(Number(v)!==1) environment[`ADSTABLE_PROVIDER_TOKEN_ENCRYPTION_KEY_V${v}`]=Buffer.alloc(32,31+Number(v)).toString("base64url");
  const runtimeDB={query:async(sql,args)=>{
    await client.query("set local role adstable_runtime");
    try{return await client.query(sql,args);}finally{await client.query("set local role adstable_owner");}
  }};
  const vault=createTokenVault({database:runtimeDB,environment});
  async function transaction(provider){
    const id=randomUUID();
    await client.query(`insert into integrations.oauth_transactions
      (id,installation_id,workspace_id,install_generation,provider,state_digest,transaction_nonce,callback_uri,
       pkce_required,pkce_challenge,status,created_at,expires_at,claimed_at)
      select $1,i.id,$2,$3,$4,$5,$6,$7,$8,$9,'claimed',statement_timestamp(),
       statement_timestamp()+interval '10 minutes',statement_timestamp()
      from shopify.installations i where i.workspace_id=$2 and i.install_generation=$3 and i.status='active'`,
      [id,workspaceId,installGeneration,provider,randomBytes(32),randomBytes(32),
        `https://embedded.adstable.app/auth/${provider==='meta'?'meta':'google-ads'}/callback`,
        provider!=='meta',provider==='meta'?null:'s'.repeat(43)]);
    return id;
  }
  async function current(provider){return (await client.query("select * from integrations.provider_connections where workspace_id=$1 and install_generation=$2 and provider=$3",[workspaceId,installGeneration,provider])).rows[0];}
  async function input(provider){
    const c=await current(provider),scopes=[...oauthPermissionScopes(provider,"identity_v1")];
    const accounts=(await client.query("select provider_account_id id from integrations.provider_accounts where connection_id=$1 and account_kind='advertiser' and reporting_eligible",[c.id])).rows.map(a=>({...a,kind:"advertiser",reportingEligible:true}));
    return {installationAuthority:owner,provider,transactionId:await transaction(provider),connectionId:randomUUID(),
      binding:{connectionId:c.id,version:Number(c.connection_version)},scopes,accounts,
      tokenSet:{access_token:"SYNTHETIC-ONLY",refresh_token:"SYNTHETIC-ONLY",permission_profile:"identity_v1",scope:scopes.join(" "),scopes},
      verifiedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()};
  }
  // For SQL exception tests, don't reset role inside an aborted savepoint.
  // The adapter below resets role only after the test restores the savepoint.
  const roleDB={async query(sql,args){await client.query("set local role adstable_runtime");return client.query(sql,args);}};
  const failureVault=createTokenVault({database:roleDB,environment});
  await vault.assertRuntimeReady();await failureVault.assertRuntimeReady();await client.query("set local role adstable_owner");
  await client.query("savepoint identity_oauth_probe");
  try {
    for(const provider of ["meta","google_ads"]){
      await client.query("savepoint provider_upgrade");
      const v=await input(provider),old=await current(provider);
      const selection=await client.query("select id::text,account_id::text from integrations.reporting_account_bindings where connection_id=$1 and effective_to is null",[old.id]);
      const result=await vault.commitIdentityOAuthCredential(v);
      assert.equal(result.status,"connected");assert.equal(result.version,Number(old.connection_version)+1);
      assert.notEqual(result.credentialId,old.credential_id);
      assert.equal((await client.query("select id from integrations.provider_credential_envelopes where id=$1",[old.credential_id])).rowCount,0);
      assert.deepEqual((await client.query("select id::text,account_id::text from integrations.reporting_account_bindings where connection_id=$1 and effective_to is null",[old.id])).rows,selection.rows);
      const receipt=await vault.readIdentityOAuthCommit(v);assert.equal(receipt.credentialId,result.credentialId);
      assert.equal(receipt.historicalCommit,true);assert.equal(receipt.authorizesActivation,false);
      assert.equal((await client.query("select status from integrations.oauth_transactions where id=$1",[v.transactionId])).rows[0].status,"exchanged");
      // Simulate response loss AFTER real SQL committed. No automatic second write or deletion.
      await client.query("rollback to savepoint provider_upgrade");
      const lost=await input(provider);let writes=0;
      const uncertain=createTokenVault({environment,database:{async query(sql,args){
        const r=await runtimeDB.query(sql,args);if(sql.includes("commit_identity_oauth_credential")){writes++;throw Error("simulated lost response");}return r;
      }}});
      await assert.rejects(uncertain.commitIdentityOAuthCredential(lost),/IDENTITY_OAUTH_WRITE_UNCONFIRMED/);
      assert.equal(writes,1);assert.ok(await uncertain.readIdentityOAuthCommit(lost));assert.equal(writes,1);
      await client.query("rollback to savepoint provider_upgrade");
      // Fail AFTER envelope+connection mutation, at final receipt update: whole SQL must roll back.
      const late=await input(provider),lateBefore=await current(provider);
      const lateCount=(await client.query("select count(*)::int n from integrations.provider_credential_envelopes")).rows[0].n;
      await client.query("create function pg_temp.reject_identity_receipt() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_RECEIPT_FAILURE'; end$$");
      await client.query("create trigger reject_identity_receipt before update of identity_credential_id on integrations.oauth_transactions for each row execute function pg_temp.reject_identity_receipt()");
      await client.query("savepoint late_reject");
      await assert.rejects(failureVault.commitIdentityOAuthCredential(late),/IDENTITY_OAUTH_WRITE_UNCONFIRMED/);
      await client.query("rollback to savepoint late_reject");await client.query("set local role adstable_owner");
      assert.equal((await current(provider)).credential_id,lateBefore.credential_id);
      assert.equal((await current(provider)).connection_version,lateBefore.connection_version);
      assert.equal((await client.query("select count(*)::int n from integrations.provider_credential_envelopes")).rows[0].n,lateCount);
      await client.query("rollback to savepoint provider_upgrade");
      for(const mode of ["version","initial_collision","missing_asset","disconnect","expired_claim","scope_downgrade"]){
        const bad=await input(provider),before=await current(provider);
        if(mode==="version")bad.binding.version++;
        if(mode==="initial_collision")bad.binding={connectionId:null,version:null};
        if(mode==="missing_asset")bad.accounts=[{id:"not-selected",kind:"advertiser",reportingEligible:true}];
        if(mode==="disconnect")await client.query("update integrations.provider_connections set lifecycle_status='disconnect_pending' where id=$1",[before.id]);
        if(mode==="expired_claim")await client.query("update integrations.oauth_transactions set created_at=statement_timestamp()-interval '11 minutes',expires_at=statement_timestamp()-interval '1 minute' where id=$1",[bad.transactionId]);
        if(mode==="scope_downgrade")await client.query("update integrations.provider_connections set granted_scopes=array_append(granted_scopes,'ungranted-extra') where id=$1",[before.id]);
        const count=(await client.query("select count(*)::int n from integrations.provider_credential_envelopes")).rows[0].n;
        await client.query("savepoint rejected_write");
        await assert.rejects(failureVault.commitIdentityOAuthCredential(bad),/IDENTITY_OAUTH_WRITE_UNCONFIRMED/);
        await client.query("rollback to savepoint rejected_write");await client.query("set local role adstable_owner");
        assert.equal((await client.query("select count(*)::int n from integrations.provider_credential_envelopes")).rows[0].n,count);
        assert.equal(await vault.readIdentityOAuthCommit(bad),null);
        await client.query("rollback to savepoint provider_upgrade");
      }
      // Reauthorization/pending and initial setup remain CAS-bound.
      for(const mode of ["reauthorization_required","initial"]){
        const v=await input(provider);
        if(mode==="initial"){
          await client.query("delete from integrations.provider_connections where id=$1",[v.binding.connectionId]);
          v.binding={connectionId:null,version:null};
        }else await client.query("update integrations.provider_connections set lifecycle_status=$2 where id=$1",[v.binding.connectionId,mode]);
        const r=await vault.commitIdentityOAuthCredential(v);assert.equal(r.status,"pending_account_selection");
        assert.equal(r.version,mode==="initial"?1:v.binding.version+1);
        await client.query("rollback to savepoint provider_upgrade");
      }
      await client.query("release savepoint provider_upgrade");
    }
    // Fresh explicit reconnect keeps the old connection ID/version, but no old grant or selection.
    for(const provider of ["google_ads","meta"]){
      for(const mode of ["success","stale_version","unbound_initial","disconnect_pending","active_reporting"]){
        await client.query("savepoint identity_reconnect");
        const v=await input(provider),old=await current(provider);
        if(mode!=="active_reporting")await client.query("update integrations.reporting_account_bindings set effective_to=statement_timestamp() where connection_id=$1 and effective_to is null",[old.id]);
        if(mode==="disconnect_pending")await client.query("update integrations.provider_connections set lifecycle_status='disconnect_pending' where id=$1",[old.id]);
        else await client.query("update integrations.provider_connections set lifecycle_status='disconnected',credential_id=null,disconnected_at=statement_timestamp(),granted_scopes=array['retired-grant']::text[] where id=$1",[old.id]);
        if(mode==="stale_version")v.binding.version++;
        if(mode==="unbound_initial")v.binding={connectionId:null,version:null};
        v.accounts=[{id:"9988776655",kind:"advertiser",reportingEligible:true}];
        const envelopeCount=(await client.query("select count(*)::int n from integrations.provider_credential_envelopes")).rows[0].n;
        if(mode==="success"){
          const r=await vault.commitIdentityOAuthCredential(v);
          assert.equal(r.connectionId,old.id);assert.equal(r.status,"pending_account_selection");
          assert.equal(r.version,Number(old.connection_version)+1);
          const after=await current(provider);
          assert.deepEqual(after.granted_scopes,v.scopes);assert.equal(after.disconnected_at,null);
          assert.equal((await client.query("select count(*)::int n from integrations.reporting_account_bindings where connection_id=$1 and effective_to is null",[old.id])).rows[0].n,0);
          const receipt=await vault.readIdentityOAuthCommit(v);assert.equal(receipt.status,"pending_account_selection");
          await client.query("savepoint reconnect_replay");
          await assert.rejects(failureVault.commitIdentityOAuthCredential(v),/IDENTITY_OAUTH_WRITE_UNCONFIRMED/);
          await client.query("rollback to savepoint reconnect_replay");await client.query("set local role adstable_owner");
          assert.equal((await current(provider)).connection_version,after.connection_version);
        }else{
          const before=await current(provider);
          await client.query("savepoint reconnect_rejected");
          await assert.rejects(failureVault.commitIdentityOAuthCredential(v),/IDENTITY_OAUTH_WRITE_UNCONFIRMED/);
          await client.query("rollback to savepoint reconnect_rejected");await client.query("set local role adstable_owner");
          assert.deepEqual(await current(provider),before);
          assert.equal((await client.query("select count(*)::int n from integrations.provider_credential_envelopes")).rows[0].n,envelopeCount);
          assert.equal(await vault.readIdentityOAuthCommit(v),null);
        }
        await client.query("rollback to savepoint identity_reconnect");await client.query("release savepoint identity_reconnect");
      }
    }
    console.log("EO05_IDENTITY_RECONNECT_PASS real_SQL_CAS_fresh_scope_pending_selection=true stale_pending_active_reporting_replay_rejected=true native_HTTP=0");
    for(const role of ["anon","authenticated","service_role","adstable_refresh_coordinator"]){
      assert.equal((await client.query("select has_function_privilege($1,'integrations.read_identity_oauth_commit(uuid,uuid,bigint,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    }
    assert.equal((await client.query("select has_table_privilege('adstable_runtime','integrations.oauth_transactions','SELECT,INSERT,UPDATE,DELETE') allowed")).rows[0].allowed,false);
  }finally{await client.query("rollback to savepoint identity_oauth_probe");await client.query("release savepoint identity_oauth_probe");}
  console.log("EO05_IDENTITY_OAUTH_ATOMIC_PASS real_SQL_encrypted_envelope_CAS_receipt=true connected_selection_preserved=true initial_pending_upgrade=true conflicts_rollback_no_orphans=true lost_response_no_retry_explicit_historical_receipt=true private_runtime_only=true native_HTTP=0");
}
