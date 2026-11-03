import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildLiveReadinessPlan, readinessEvidencePath} from "./f01-live-readiness-plan.mjs";
import {loadMigrationFiles} from "./check-migration-lineage.mjs";
import {assertReplayEnvironment, executeMigration, inventoryDifferences, replayConnection} from "./f01-database-replay.mjs";
import {sourceEvidenceProbe} from "./eo05-source-evidence-probe.mjs";
import {refreshNativeInventoryProbe} from "./eo05-refresh-native-inventory-probe.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const read=file=>readFileSync(path.join(root,file),"utf8");
const hash=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const inventorySql=read("tools/f01-schema-inventory.sql");
const inventory=async client=>(await client.query(inventorySql)).rows[0].inventory;
const snapshotSql=`select jsonb_build_object(
  'connections',(select jsonb_agg(to_jsonb(t) order by id) from integrations.provider_connections t where workspace_id=$1),
  'credentials',(select jsonb_agg(to_jsonb(t) order by id) from integrations.provider_credential_envelopes t where workspace_id=$1),
  'accounts',(select jsonb_agg(to_jsonb(t) order by id) from integrations.provider_accounts t where workspace_id=$1),
  'reporting',(select jsonb_agg(to_jsonb(t) order by id) from integrations.reporting_account_bindings t where workspace_id=$1)
) as snapshot`;
const snapshot=async(client,workspace)=>{
  await client.query("set role adstable_owner");
  try{return (await client.query(snapshotSql,[workspace])).rows[0].snapshot;}
  finally{await client.query("reset role");}
};

// Called on the third empty CI database only after its existing forty+three
// scoped rollout has completed. No live address, dump, token or runner override.
export async function liveReadinessRehearsal(client, createSyntheticFixture) {
  assertReplayEnvironment(process.env);
  assert.equal(client.connectionParameters.host,"127.0.0.1");
  assert.equal(client.connectionParameters.port,54322);
  assert.equal(client.connectionParameters.database,"postgres");
  assert.equal((await client.query("select session_user as role")).rows[0].role,"postgres");
  assert.equal((await client.query("select to_regclass('operations.refresh_control')::text name")).rows[0].name,null);
  assert.equal((await client.query("select exists(select 1 from pg_roles where rolname='adstable_refresh_coordinator') present")).rows[0].present,false);
  assert.equal((await client.query("select count(*)::int n from pg_namespace where nspname in ('evidence','identity','source')")).rows[0].n,0);
  const manifest=JSON.parse(read("contracts/a6-tech-01-f01-migration-lineage-v1.json")), files=loadMigrationFiles(root);
  const plan=buildLiveReadinessPlan({manifest,files,evidence:JSON.parse(read(readinessEvidencePath))});
  assert.equal((await client.query("select pg_has_role('postgres','adstable_runtime','SET') allowed")).rows[0].allowed,false);
  let fixture;
  await client.query("begin");
  try{
    await client.query("grant adstable_runtime to postgres with inherit false, set true, admin false");
    fixture=await createSyntheticFixture();
    await client.query("set local role postgres");
    await client.query("revoke adstable_runtime from postgres");
    await client.query("commit");
  }catch(error){await client.query("rollback");throw error;}
  assert.equal((await client.query("select pg_has_role('postgres','adstable_runtime','SET') allowed")).rows[0].allowed,false);
  const workspace=fixture.claim.workspaceId, before=await snapshot(client,workspace);
  assert.equal(before.connections.length,2);assert.equal(before.credentials.length,2);
  assert.equal(before.accounts.length,2);assert.equal(before.reporting.length,2);
  await client.query("create temporary table f01_readiness_ledger(version text primary key, repository_version text unique not null, name text unique not null)");
  for(const row of plan.ledger){
    const alias=plan.aliases.find(x=>x.live_version===row.version);
    await client.query("insert into f01_readiness_ledger values($1,$2,$3)",[row.version,alias?.version??row.version,row.name]);
  }
  assert.equal((await client.query("select count(*)::int n from f01_readiness_ledger")).rows[0].n,43);
  for(const entry of plan.remaining){
    assert.equal((await client.query("select count(*)::int n from f01_readiness_ledger where repository_version=$1 or name=$2",[entry.version,entry.name])).rows[0].n,0);
    console.log(`F01_READINESS_APPLY ${entry.version} ${entry.name}`);
    await executeMigration(client,entry,files[entry.file]);
    await client.query("insert into f01_readiness_ledger values($1,$1,$2)",[entry.version,entry.name]);
  }
  assert.equal((await client.query("select count(*)::int n from f01_readiness_ledger")).rows[0].n,82);
  assert.deepEqual(await snapshot(client,workspace),before,"committed synthetic OAuth connections, credentials, accounts and reporting bindings must survive all39 migrations exactly");
  const expected=JSON.parse(readFileSync(path.join(process.env.RUNNER_TEMP,"f01b-staged-schema.json"),"utf8"));
  const after=await inventory(client);
  assert.deepEqual(inventoryDifferences(expected,after),[],"43+39 must match the independent full/staged82 schema, definitions, grants, RLS, triggers and indexes");
  // Same ephemeral database only: remove the committed sentinel before existing
  // synthetic functional probes, using the same cleanup order as F01 probes.
  await client.query("set role adstable_owner");
  try{
    await client.query("delete from shopify.installations where workspace_id=$1",[workspace]);
    await client.query("delete from app.workspaces where id=$1",[workspace]);
  }finally{await client.query("reset role");}
  await sourceEvidenceProbe(client,replayConnection);
  await refreshNativeInventoryProbe(client,replayConnection);
  assert.deepEqual(inventoryDifferences(after,await inventory(client)),[],"functional probes must preserve schema and grants");
  console.log(`F01_LIVE_READINESS_PASS ${JSON.stringify({baseline:43,remaining:39,total:82,skipped_verified_aliases:3,
    committed_synthetic_bindings_preserved:true,independent_schema_sha256:hash(after),source_and_mapping_probes:true,
    business_data_source:"synthetic_only",live_schema_parity_verified:false,live_apply_authorized:false,production_mutation:false})}`);
}
