import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectGoogleSourceRole,renderGoogleSourceRoleInstallation,roleInstallationPath} from "./eo05-google-source-role-plan.mjs";

// Only the existing ephemeral F01 caller invokes this. Never opens a DB URL.
export async function googleSourceRoleProvisioningProbe(client){
 assert.equal(process.env.GITHUB_ACTIONS,"true");assert.ok(process.env.RUNNER_TEMP);
 const sql=readFileSync(new URL("../"+roleInstallationPath,import.meta.url),"utf8");
 assert.equal(sql,renderGoogleSourceRoleInstallation(),"reviewed artifact must equal the fixed role plan");
 // Preserve the exact transaction body inside rollback-only scenario savepoints.
 const body=sql.replace(/^begin;\s*$/m,"").replace(/^commit;\s*$/m,"");
 const inventorySql=readFileSync(new URL("./f01-schema-inventory.sql",import.meta.url),"utf8");
 const inventory=async()=>(await client.query(inventorySql)).rows[0].inventory;
 const roleExists=async()=>(await client.query("select exists(select 1 from pg_roles where rolname='adstable_google_source_runner') present")).rows[0].present;
 const before=await inventory();let scenarios=0;
 await client.query("begin");
 try{
  // Prior F01 scenarios can leave the session's default role as adstable_owner.
  // Provisioning requires postgres; select it only inside this rollback fixture.
  await client.query("set local role postgres");
  assert.equal((await client.query("select current_user as role")).rows[0].role,"postgres");
  assert.equal(await roleExists(),false);
  async function scenario(run){
   await client.query("savepoint role_case");
   try{await run();scenarios++;}finally{await client.query("rollback to savepoint role_case");await client.query("release savepoint role_case");}
  }
  async function rejected(pattern,attempt=body){
   await client.query("savepoint rejected_install");
   try{await assert.rejects(client.query(attempt),pattern);}
   finally{await client.query("rollback to savepoint rejected_install");await client.query("release savepoint rejected_install");}
  }
  async function ownerMutation(sql){
   // postgres has NOINHERIT membership in the object owner, so fixture DDL also
   // needs an explicit local owner scope. This grants no new role membership.
   await client.query("set local role adstable_owner");
   await client.query(sql);
   await client.query("set local role postgres");
  }
  await scenario(async()=>{
   assert.equal((await inspectGoogleSourceRole(client)).status,"ready_to_install");
   await client.query(body);
   assert.equal((await inspectGoogleSourceRole(client)).status,"installed_inactive");
   // Actual SET ROLE execution is covered by the independent14-mode server
   // rehearsal's explicit fixture-only grant. Provisioning grants none here.
   await rejected(/GOOGLE_SOURCE_ROLE_ALREADY_EXISTS/);
   assert.equal((await inspectGoogleSourceRole(client)).status,"installed_inactive");
  });
  await scenario(async()=>{
   await client.query("create role adstable_google_source_runner nologin inherit");
   assert.equal((await inspectGoogleSourceRole(client)).status,"blocked");
   await rejected(/GOOGLE_SOURCE_ROLE_ALREADY_EXISTS/);
   assert.equal((await client.query("select rolinherit from pg_roles where rolname='adstable_google_source_runner'")).rows[0].rolinherit,true,"never silently repair an existing role");
  });
  for(const mutation of [
   "alter function identity.lookup_verified_mapping(jsonb,jsonb) rename to eo05_probe_missing_mapping",
   "alter function identity.lookup_verified_mapping(jsonb,jsonb) set search_path=pg_catalog",
   "grant execute on function identity.lookup_verified_mapping(jsonb,jsonb) to public",
   "alter table evidence.source_batches no force row level security",
  ])await scenario(async()=>{
   await ownerMutation(mutation);
   assert.equal((await inspectGoogleSourceRole(client)).status,"blocked");
   await rejected(/GOOGLE_SOURCE_ROLE_PREREQUISITES_CHANGED/);
   assert.equal(await roleExists(),false);
  });
  await scenario(async()=>{
   // Inherited PUBLIC privilege on an unrelated RPC is not repairable by this artifact.
   await ownerMutation("grant execute on function evidence.cleanup_source_retention(uuid,bigint,bigint,uuid,text,bigint,integer,timestamptz,jsonb) to public");
   await rejected(/GOOGLE_SOURCE_ROLE_POSTFLIGHT_FAILED/);
   assert.equal(await roleExists(),false,"late postcheck must undo role and all grants");
  });
  await scenario(async()=>{
   await rejected(/division by zero/,body+"\nselect 1/0;");
   assert.equal(await roleExists(),false,"failure after the final grant must roll back every write");
  });
 }finally{await client.query("rollback");}
 assert.equal(await roleExists(),false);
 assert.deepEqual(await inventory(),before,"role/grant probes must leave the82 schema and permissions untouched");
 assert.equal(scenarios,8);
 console.log("EO05_GOOGLE_SOURCE_ROLE_INSTALL_PASS scenarios=8 exact_artifact=true pinned16_definitions=true nologin_no_secret=true unsafe_existing_missing_changed_public_RLS_denied=true late_failure_atomic=true schema_preserved=true native_HTTP=0 live_changes=false");
}
