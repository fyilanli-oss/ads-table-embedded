import pg from "pg";
import {SUPABASE_ROOT_CA_2021} from "./supabase-root-ca-2021.server.js";

// Existing coordinator connection only; no grants, role activation or arbitrary SQL.
export const KLAVIYO_RAW_COORDINATOR_ROLE="adstable_refresh_coordinator";
export const KLAVIYO_RAW_COORDINATOR_RPC=Object.freeze([
 [
  "select operations.read_refresh_preflight_snapshot() as result",
  "operations.read_refresh_preflight_snapshot()"
 ],
 [
  "select operations.commit_klaviyo_raw_preflight_with_deadline($1::bigint,$2::bigint,$3::jsonb,$4::jsonb,$5::jsonb,$6::uuid,$7::bigint) as result",
  "operations.commit_klaviyo_raw_preflight_with_deadline(bigint,bigint,jsonb,jsonb,jsonb,uuid,bigint)"
 ],
 [
  "select operations.load_refresh_bound_authority($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::date,$8::date) as result",
  "operations.load_refresh_bound_authority(uuid,bigint,text,text,text,bigint,date,date)"
 ],
 [
  "select operations.advance_refresh_work_stage($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::text,$8::text,$9::bigint,$10::bigint,$11::date,$12::date) as result",
  "operations.advance_refresh_work_stage(uuid,bigint,text,text,text,bigint,text,text,bigint,bigint,date,date)"
 ],
 [
  "select operations.refresh_claim_is_current($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint) as result",
  "operations.refresh_claim_is_current(uuid,bigint,text,text,text,bigint)"
 ],
 [
  "select operations.load_refresh_entitlement_installation($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint) as result",
  "operations.load_refresh_entitlement_installation(uuid,bigint,text,text,text,bigint)"
 ],
 [
  "select operations.apply_refresh_entitlement_snapshot($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::jsonb) as result",
  "operations.apply_refresh_entitlement_snapshot(uuid,bigint,text,text,text,bigint,jsonb)"
 ],
 [
  "select operations.refresh_entitlement_is_current($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::timestamptz) as result",
  "operations.refresh_entitlement_is_current(uuid,bigint,text,text,text,bigint,timestamptz)"
 ],
 [
  "select operations.load_refresh_quota_context($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::date,$8::date,$9::text,$10::timestamptz) as result",
  "operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)"
 ],
 [
  "select operations.read_refresh_admission_snapshot() as result",
  "operations.read_refresh_admission_snapshot()"
 ],
 [
  "select operations.record_refresh_work_stop($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::text,$8::bigint) as result",
  "operations.record_refresh_work_stop(uuid,bigint,text,text,text,bigint,text,bigint)"
 ],
 [
  "select operations.finish_refresh_work($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::text) as result",
  "operations.finish_refresh_work(uuid,bigint,text,text,text,bigint,text)"
 ],
 [
  "select operations.resolve_shared_api_quota_route($1::text,$2::text,$3::text) as result",
  "operations.resolve_shared_api_quota_route(text,text,text)"
 ],
 [
  "select operations.reserve_shared_api_quota($1::text,$2::uuid,$3::text) as result",
  "operations.reserve_shared_api_quota(text,uuid,text)"
 ],
 [
  "select operations.stop_shared_api_quota_scoped($1::text,$2::uuid,$3::boolean,$4::boolean,$5::text) as result",
  "operations.stop_shared_api_quota_scoped(text,uuid,boolean,boolean,text)"
 ],
 [
  "select operations.settle_shared_api_quota($1::text,$2::uuid) as result",
  "operations.settle_shared_api_quota(text,uuid)"
 ],
 [
  "select operations.record_shared_api_quota_feedback($1::text,$2::uuid,$3::jsonb) as result",
  "operations.record_shared_api_quota_feedback(text,uuid,jsonb)"
 ]
].map(Object.freeze));
const queries=new Map(KLAVIYO_RAW_COORDINATOR_RPC.map(([sql])=>[sql,Math.max(0,...[...sql.matchAll(/\$(\d+)/g)].map(x=>Number(x[1])))]));
const signatures=Object.freeze(KLAVIYO_RAW_COORDINATOR_RPC.map(([,name])=>name));
export const KLAVIYO_RAW_COORDINATOR_ROLE_CHECK_SQL=`select current_user as role,
 (not r.rolsuper and not r.rolinherit and not r.rolbypassrls and not r.rolcreatedb and not r.rolcreaterole and not r.rolreplication
 and not exists(select 1 from pg_auth_members m where m.member=r.oid)
 and not has_database_privilege(current_user,current_database(),'CREATE')
 and not exists(select 1 from unnest(array['operations']) s(name)
  where not has_schema_privilege(current_user,s.name,'USAGE'))
 and not exists(select 1 from pg_namespace n where n.nspname in ('public','app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
  and has_schema_privilege(current_user,n.oid,'CREATE'))
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
   and c.relkind in ('r','p') and has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 and not exists(select 1 from unnest($1::text[]) s(signature) where to_regprocedure(s.signature) is null
   or not coalesce(has_function_privilege(current_user,to_regprocedure(s.signature)::oid,'EXECUTE'),false))
 ) as profile_ready from pg_roles r where r.rolname=current_user`;
const failure=()=>Error("KLAVIYO_RAW_COORDINATOR_DATABASE_UNAVAILABLE");
export function readKlaviyoRawCoordinatorDatabaseConfig(environment) {
 try{
  const url=new URL(environment.ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DATABASE_URL),timeout=environment.ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DB_TIMEOUT_MS;
  if(!["postgres:","postgresql:"].includes(url.protocol)||decodeURIComponent(url.username)!==`${KLAVIYO_RAW_COORDINATOR_ROLE}.podpwkrpmjiksskxhwsu`
   ||decodeURIComponent(url.password).length<24||!/^aws-[0-9]+-eu-central-1\.pooler\.supabase\.com$/.test(url.hostname)
   ||url.port!=="6543"||url.pathname!=="/postgres"||url.hash||url.searchParams.size!==1||url.searchParams.get("sslmode")!=="require"
   ||typeof timeout!=="string"||!/^\d{1,5}$/.test(timeout)||Number(timeout)<1||Number(timeout)>30000)throw Error();
  url.search="";return {connectionString:url.toString(),timeoutMs:Number(timeout),ssl:{ca:SUPABASE_ROOT_CA_2021,rejectUnauthorized:true}};
 }catch{throw Error("KLAVIYO_RAW_COORDINATOR_DATABASE_CONFIGURATION_REQUIRED");}
}

// Each admitted RPC is one bounded transaction on one checked-out connection.
// No table SQL, DDL, OAuth mutation, cleanup or arbitrary SET ROLE. The existing
// guarded finish RPC is reachable only through the reviewed Klaviyo raw lifecycle.
export function createKlaviyoRawCoordinatorPostgresClient({environment,poolFactory=config=>new pg.Pool(config),}) {
 if(typeof poolFactory!=="function")throw failure();
 const c=readKlaviyoRawCoordinatorDatabaseConfig(environment);let pool;
 try{pool=poolFactory({connectionString:c.connectionString,ssl:c.ssl,max:1,query_timeout:c.timeoutMs,
  connectionTimeoutMillis:c.timeoutMs,idleTimeoutMillis:10000,allowExitOnIdle:true,application_name:"adstable-klaviyo-raw-coordinator"});}
 catch{throw failure();}
 let stopped=false,closed=false,busy=false;
 pool.on("error",()=>{stopped=true;});
 return Object.freeze({
  async query(sql,parameters=[]){
   if(stopped||closed||busy||!queries.has(sql)
    ||!Array.isArray(parameters)||parameters.length!==queries.get(sql))throw failure();
   // Detach before the first asynchronous pool acquisition.
   let args;try{args=structuredClone(parameters);}catch{throw failure();}busy=true;let client,broken=false;
   try{
    client=await pool.connect();if(stopped||closed)throw failure();await client.query("begin");
    await client.query("select pg_catalog.set_config('statement_timeout',$1,true),pg_catalog.set_config('lock_timeout',$1,true)",[`${c.timeoutMs}ms`]);
    const identity=(await client.query(KLAVIYO_RAW_COORDINATOR_ROLE_CHECK_SQL,[signatures])).rows;
    if(stopped||closed||identity?.length!==1||identity[0].role!==KLAVIYO_RAW_COORDINATOR_ROLE||identity[0].profile_ready!==true)throw failure();
    const result=await client.query(sql,args);await client.query("commit");return result;
   }catch{
    stopped=true;broken=true;
    if(client){try{await client.query("rollback");}catch{}}
    // A lost COMMIT acknowledgement is unknown. Never retry this client.
    throw failure();
   }finally{busy=false;if(client)client.release(broken);}
  },
  async close(){if(closed)return;closed=true;try{await pool.end();}catch{throw failure();}},
 });
}
