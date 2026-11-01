import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import pg from "pg";
import {assertReplayEnvironment,executeMigration,replayConnection,withTestRuntimeMembership} from "./f01-database-replay.mjs";
import {loadMigrationFiles,validateMigrationLineage} from "./check-migration-lineage.mjs";
import {identityOAuthAtomicProbeWithTestMembership} from "./eo05-identity-oauth-atomic-probe.mjs";
import {oauthPermissionScopes} from "../app/lib/oauth/oauth-permission-profile.server.js";
import {googleIdentityRenewalProbe,googleReportingChangeProbe} from "./eo05-google-identity-renewal-probe.mjs";
import {singleAccountSelectionProbe} from "./eo05-single-account-selection-probe.mjs";

// Compiled loopback-only connection and runner gate inherited from F01. No live
// database address, credentials, native provider requests or environment override.
const root=fileURLToPath(new URL("../",import.meta.url));
const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),"utf8").replaceAll("\r\n","\n");
const manifest=JSON.parse(read("contracts/a6-tech-01-f01-migration-lineage-v1.json"));
export const selectedMigrationNames=Object.freeze(["eo05a_identity_oauth_atomic_stage","eo05a_identity_oauth_reconnect"]);
export const renewalMigrationNames=Object.freeze(["eo05a_google_identity_renewal_receipt"]);
const selected=selectedMigrationNames.map(name=>{
  const entry=manifest.pending_migrations.find(entry=>entry.name===name);
  assert.ok(entry);assert.equal(entry.applied,false);assert.equal(entry.live_apply_authorized,false);return entry;
});
const renewal=manifest.pending_migrations.find(entry=>entry.name===renewalMigrationNames[0]);
assert.ok(renewal);assert.equal(renewal.applied,false);assert.equal(renewal.live_apply_authorized,false);

async function exerciseRenewal(client,coordinatorExpected){
  const execution=await scopedIdentityFixture(client);
  await googleIdentityRenewalProbe(client,{execution,coordinatorExpected});
  await googleReportingChangeProbe(client,{execution});
}

export async function scopedIdentityFixture(client){
  await client.query("set local role adstable_runtime");
  const authority=(await client.query("select * from shopify.bootstrap_installation($1,$2,$3,statement_timestamp())",
    [`gid://shopify/Shop/99${Date.now()}`,`scoped-${randomBytes(6).toString('hex')}.myshopify.com`,randomBytes(32)])).rows[0];
  await client.query("set local role adstable_owner");
  const {workspace_id:workspace,install_generation:generation}=authority;
  const installation=(await client.query("select id from shopify.installations where workspace_id=$1",[workspace])).rows[0].id;
  for(const provider of ["meta","google_ads"]){
    const credential=randomUUID(),connection=randomUUID();
    await client.query(`insert into integrations.provider_credential_envelopes
      (id,installation_id,workspace_id,install_generation,provider,purpose,payload_ciphertext,nonce,auth_tag,key_version)
      values ($1,$2,$3,$4,$5,'provider_token_set',$6,$7,$8,1)`,
      [credential,installation,workspace,generation,provider,Buffer.from("SYNTHETIC-ONLY"),randomBytes(12),randomBytes(16)]);
    await client.query(`insert into integrations.provider_connections
      (id,installation_id,workspace_id,install_generation,provider,credential_id,granted_scopes,connected_at,last_verified_at,lifecycle_status)
      values ($1,$2,$3,$4,$5,$6,$7,statement_timestamp()-interval '1 minute',statement_timestamp(),'connected')`,
      [connection,installation,workspace,generation,provider,credential,[...oauthPermissionScopes(provider,"identity_v1")]]);
    const account=(await client.query(`insert into integrations.provider_accounts
      (connection_id,workspace_id,install_generation,provider,provider_account_id,display_name,account_kind,reporting_eligible,verified_at)
      values ($1,$2,$3,$4,'9988776655','Synthetic advertiser','advertiser',true,statement_timestamp()) returning id`,
      [connection,workspace,generation,provider])).rows[0].id;
    await client.query(`insert into integrations.reporting_account_bindings
      (connection_id,account_id,workspace_id,install_generation,provider,effective_from,change_reason)
      values ($1,$2,$3,$4,$5,statement_timestamp()-interval '1 minute','initial_selection')`,[connection,account,workspace,generation,provider]);
  }
  return {claim:{workspaceId:workspace,installGeneration:generation}};
}

async function exercise(client,coordinatorExpected){
  await withTestRuntimeMembership(client,async()=>{
    const execution=await scopedIdentityFixture(client);
    await identityOAuthAtomicProbeWithTestMembership(client,{execution,coordinatorExpected});
    await singleAccountSelectionProbe(client,{execution});
  });
  assert.equal((await client.query("select count(*)::int n from app.workspaces")).rows[0].n,0,"synthetic fixture fully rolled back");
}

async function main(){
  assertReplayEnvironment(process.env);
  assert.deepEqual(validateMigrationLineage({manifest,files:loadMigrationFiles(root)}),[]);
  const client=new pg.Client(replayConnection);await client.connect();
  try{
    const version=Number((await client.query("show server_version_num")).rows[0].server_version_num);
    assert.ok(version>=170000&&version<180000);
    assert.equal((await client.query("select count(*)::int n from pg_namespace where nspname='app'")).rows[0].n,0,"empty isolated database required");
    const baseline=[...manifest.historical_migrations,...manifest.forward_migrations];
    assert.equal(baseline.length,40,"31 October live migration count");
    assert.equal(baseline.at(-1).version,"20261018181906");
    for(const entry of baseline)await executeMigration(client,entry,read(entry.file));
    assert.equal((await client.query("select exists(select 1 from pg_roles where rolname='adstable_refresh_coordinator') present")).rows[0].present,false);
    // Real commit boundaries, exact planned two files, no other pending migration.
    for(const entry of selected)await executeMigration(client,entry,read(entry.file));
    assert.equal((await client.query("select exists(select 1 from pg_roles where rolname='adstable_refresh_coordinator') present")).rows[0].present,false,"OAuth rollout must not create refresh role");
    assert.equal((await client.query("select to_regclass('operations.refresh_control')::text name")).rows[0].name,null);
    await exercise(client,false);
    console.log("F01_SCOPED_IDENTITY_ROLLOUT_PASS baseline=40 selected=2 coordinator_absent=true real_commit_boundaries=true native_HTTP=0");

    // Separate rollback-only branch: recreate the two functions as on first
    // install while a preexisting coordinator has inherited EXECUTE defaults.
    // This proves the conditional REVOKE actually removes privileges on both.
    await client.query("begin");
    try{
      await client.query("create role adstable_refresh_coordinator nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls");
      await client.query("set local role adstable_owner");
      await client.query("drop function integrations.commit_identity_oauth_credential(uuid,uuid,bigint,text,uuid,uuid,bigint,uuid,text[],jsonb,timestamptz,bytea,bytea,bytea,smallint,timestamptz),integrations.read_identity_oauth_commit(uuid,uuid,bigint,text)");
      await client.query("alter table integrations.oauth_transactions drop constraint identity_oauth_receipt_shape,drop column identity_credential_id,drop column identity_connection_id,drop column identity_connection_version,drop column identity_result_status");
      await client.query("alter default privileges for role adstable_owner in schema integrations grant execute on functions to adstable_refresh_coordinator");
      for(const entry of selected){
        const sql=read(entry.file).replace(/^begin;\s*$/m,"").replace(/^commit;\s*$/m,"");
        await client.query(sql);
      }
      const signatures=["integrations.commit_identity_oauth_credential(uuid,uuid,bigint,text,uuid,uuid,bigint,uuid,text[],jsonb,timestamptz,bytea,bytea,bytea,smallint,timestamptz)","integrations.read_identity_oauth_commit(uuid,uuid,bigint,text)"];
      for(const signature of signatures){
        assert.equal((await client.query("select has_function_privilege('adstable_refresh_coordinator',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,false);
        assert.equal((await client.query("select has_function_privilege('adstable_runtime',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,true);
      }
      // All fixture mutations and temporary test membership stay in this transaction.
      await client.query("set local role postgres");
      await client.query("grant adstable_runtime to postgres with inherit false, set true, admin false");
      const execution=await scopedIdentityFixture(client);
      await identityOAuthAtomicProbeWithTestMembership(client,{execution,coordinatorExpected:true});
      await singleAccountSelectionProbe(client,{execution});
    }finally{await client.query("rollback");}
    assert.equal((await client.query("select exists(select 1 from pg_roles where rolname='adstable_refresh_coordinator') present")).rows[0].present,false);
    assert.equal((await client.query("select count(*)::int n from app.workspaces")).rows[0].n,0);
    console.log("F01_SCOPED_IDENTITY_ROLE_PRESENT_PASS inherited_default_execute_revoked=true same_SQL_CAS_rollback_probes=true synthetic_only=true production_mutation=false");

    // The current live shape is the forty-file baseline plus the two OAuth files
    // above. Prove the missing renewal RPC on that shape before applying only it.
    assert.equal((await client.query("select to_regprocedure('integrations.commit_google_identity_renewal(uuid,uuid,bigint,uuid,bigint,uuid,uuid,text[],timestamptz,bytea,bytea,bytea,smallint,timestamptz)')::text name")).rows[0].name,null);
    await client.query("begin");
    try{
      await assert.rejects(client.query(`select * from integrations.commit_google_identity_renewal(
        null::uuid,null::uuid,null::bigint,null::uuid,null::bigint,null::uuid,null::uuid,
        null::text[],null::timestamptz,null::bytea,null::bytea,null::bytea,null::smallint,null::timestamptz)`),error=>error.code==="42883");
    }finally{await client.query("rollback");}
    await executeMigration(client,renewal,read(renewal.file));
    await withTestRuntimeMembership(client,()=>exerciseRenewal(client,false));
    assert.equal((await client.query("select exists(select 1 from pg_roles where rolname='adstable_refresh_coordinator') present")).rows[0].present,false);
    assert.equal((await client.query("select to_regclass('operations.refresh_control')::text name")).rows[0].name,null);
    assert.equal((await client.query("select count(*)::int n from app.workspaces")).rows[0].n,0);
    console.log("F01_SCOPED_GOOGLE_RENEWAL_PASS baseline=42 selected=1 missing_RPC_42883_reproduced=true coordinator_absent=true real_commit_boundary=true native_HTTP=0");

    // Independent rollback-only branch: inherited EXECUTE must be removed even
    // if optional refresh infrastructure already exists when this file runs.
    await client.query("begin");
    try{
      await client.query("create role adstable_refresh_coordinator nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls");
      await client.query("set local role adstable_owner");
      await client.query("drop function integrations.commit_google_identity_renewal(uuid,uuid,bigint,uuid,bigint,uuid,uuid,text[],timestamptz,bytea,bytea,bytea,smallint,timestamptz),integrations.read_google_identity_renewal(uuid,uuid,bigint)");
      await client.query("alter table integrations.provider_connection_lifecycle_events drop constraint google_identity_renewal_receipt_shape,drop column identity_credential_before_id,drop column identity_credential_after_id");
      await client.query("alter default privileges for role adstable_owner in schema integrations grant execute on functions to adstable_refresh_coordinator");
      await client.query(read(renewal.file).replace(/^begin;\s*$/m,"").replace(/^commit;\s*$/m,""));
      await client.query("set local role postgres");
      await client.query("grant adstable_runtime to postgres with inherit false, set true, admin false");
      await exerciseRenewal(client,true);
    }finally{await client.query("rollback");}
    assert.equal((await client.query("select exists(select 1 from pg_roles where rolname='adstable_refresh_coordinator') present")).rows[0].present,false);
    assert.equal((await client.query("select count(*)::int n from app.workspaces")).rows[0].n,0);
    console.log("F01_SCOPED_GOOGLE_RENEWAL_ROLE_PRESENT_PASS inherited_default_execute_revoked=true same_SQL_reporting_change_probes=true synthetic_only=true production_mutation=false");
  }finally{await client.end();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main().catch(error=>{
  console.error(`F01_SCOPED_IDENTITY_STOP ${JSON.stringify({code:error.code??'ASSERTION_FAILED',message:error.message})}`);process.exitCode=1;
});
