import pg from "pg";
import {SUPABASE_ROOT_CA_2021} from "./supabase-root-ca-2021.server.js";
export const KLAVIYO_SOURCE_ROLE="adstable_klaviyo_source_runner";
export const KLAVIYO_SOURCE_RPC=Object.freeze([
 [
  "select * from integrations.load_provider_identity_authority($1::uuid,$2::bigint,$3::text,$4::text,$5::text)",
  "integrations.load_provider_identity_authority(uuid,bigint,text,text,text)"
 ],
 [
  "select operations.load_refresh_quota_context($1::uuid,$2::bigint,$3::text,$4::text,$5::text,$6::bigint,$7::date,$8::date,$9::text,$10::timestamptz) as result",
  "operations.load_refresh_quota_context(uuid,bigint,text,text,text,bigint,date,date,text,timestamptz)"
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
 ],
 [
  "select operations.record_shopify_admin_quota_feedback($1::text,$2::uuid,$3::jsonb) as result",
  "operations.record_shopify_admin_quota_feedback(text,uuid,jsonb)"
 ],
 [
  "select evidence.read_source_receipt($1::jsonb,$2::uuid,$3::integer) as result",
  "evidence.read_source_receipt(jsonb,uuid,integer)"
 ],
 [
  "select evidence.read_source_receipt($1::jsonb,$2::uuid,0) as result",
  "evidence.read_source_receipt(jsonb,uuid,integer)"
 ],
 [
  "select evidence.read_source_pages($1::jsonb,$2::uuid,$3::integer,$4::bigint,$5::integer) as result",
  "evidence.read_source_pages(jsonb,uuid,integer,bigint,integer)"
 ],
 [
  "select evidence.commit_klaviyo_dataset_source($1::jsonb,$2::uuid,$3::integer,$4::jsonb,$5::jsonb) as result",
  "evidence.commit_klaviyo_dataset_source(jsonb,uuid,integer,jsonb,jsonb)"
 ]
].map(Object.freeze));
const queries=new Map(KLAVIYO_SOURCE_RPC.map(([sql])=>[sql,Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(x=>Number(x[1])))]));
const receiptQueries=new Set(KLAVIYO_SOURCE_RPC.filter(([,name])=>name==="evidence.read_source_receipt(jsonb,uuid,integer)").map(([sql])=>sql));
const signatures=Object.freeze([...new Set(KLAVIYO_SOURCE_RPC.map(x=>x[1]))]);
export const KLAVIYO_SOURCE_ROLE_CHECK_SQL=`select current_user as role,
 (not r.rolsuper and not r.rolinherit and not r.rolbypassrls and not r.rolcreatedb and not r.rolcreaterole and not r.rolreplication
 and not exists(select 1 from pg_auth_members m where m.member=r.oid)
 and not has_database_privilege(current_user,current_database(),'CREATE')
 and not exists(select 1 from unnest(array['integrations','operations','evidence']) s(name)
  where not has_schema_privilege(current_user,s.name,'USAGE'))
 and not exists(select 1 from pg_namespace n where n.nspname in ('public','app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
  and has_schema_privilege(current_user,n.oid,'CREATE'))
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
   and c.relkind in ('r','p') and has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 and not exists(select 1 from unnest($1::text[]) s(signature) where to_regprocedure(s.signature) is null
   or not coalesce(has_function_privilege(current_user,to_regprocedure(s.signature)::oid,'EXECUTE'),false))
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('app','shopify','integrations','operations','billing','privacy','analytics','evidence','identity','source')
   and has_function_privilege(current_user,p.oid,'EXECUTE') and p.oid not in
    (select to_regprocedure(s.signature)::oid from unnest($1::text[]) s(signature)))
 ) as profile_ready from pg_roles r where r.rolname=current_user`;
const failure=()=>Error("KLAVIYO_SOURCE_DATABASE_UNAVAILABLE");
export function readKlaviyoSourceDatabaseConfig(environment) {
 try{
  const url=new URL(environment.ADSTABLE_KLAVIYO_SOURCE_DATABASE_URL),timeout=environment.ADSTABLE_KLAVIYO_SOURCE_DB_TIMEOUT_MS;
  if(!["postgres:","postgresql:"].includes(url.protocol)||decodeURIComponent(url.username)!==`${KLAVIYO_SOURCE_ROLE}.podpwkrpmjiksskxhwsu`
   ||decodeURIComponent(url.password).length<24||!/^aws-[0-9]+-eu-central-1\.pooler\.supabase\.com$/.test(url.hostname)
   ||url.port!=="6543"||url.pathname!=="/postgres"||url.hash||url.searchParams.size!==1||url.searchParams.get("sslmode")!=="require"
   ||typeof timeout!=="string"||!/^\d{1,5}$/.test(timeout)||Number(timeout)<1||Number(timeout)>30000)throw Error();
  url.search="";return {connectionString:url.toString(),timeoutMs:Number(timeout),ssl:{ca:SUPABASE_ROOT_CA_2021,rejectUnauthorized:true}};
 }catch{throw Error("KLAVIYO_SOURCE_DATABASE_CONFIGURATION_REQUIRED");}
}

// Each admitted RPC is one bounded transaction on one checked-out connection.
// No table SQL, DDL, OAuth mutation, cleanup, claim finish or arbitrary SET ROLE.
export function createKlaviyoSourcePostgresClient({environment,poolFactory=config=>new pg.Pool(config),inspectionOnly=false,datasetMode=false}) {
 if(typeof inspectionOnly!=="boolean"||typeof datasetMode!=="boolean"||typeof poolFactory!=="function")throw failure();
 const rpc=KLAVIYO_SOURCE_RPC;
 const allowedQueries=datasetMode?new Map(rpc.map(([sql])=>[sql,Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(x=>Number(x[1])))])):queries;
 const requiredSignatures=datasetMode?[...new Set(rpc.map(x=>x[1]))]:signatures;
 const c=readKlaviyoSourceDatabaseConfig(environment);let pool;
 try{pool=poolFactory({connectionString:c.connectionString,ssl:c.ssl,max:1,query_timeout:c.timeoutMs,
  connectionTimeoutMillis:c.timeoutMs,idleTimeoutMillis:10000,allowExitOnIdle:true,application_name:"adstable-klaviyo-source"});}
 catch{throw failure();}
 let stopped=false,closed=false,busy=false;
 pool.on("error",()=>{stopped=true;});
 return Object.freeze({
  async query(sql,parameters=[]){
   if(stopped||closed||busy||!allowedQueries.has(sql)||inspectionOnly&&!receiptQueries.has(sql)
    ||!Array.isArray(parameters)||parameters.length!==allowedQueries.get(sql))throw failure();
   // Detach before the first asynchronous pool acquisition.
   let args;try{args=structuredClone(parameters);}catch{throw failure();}busy=true;let client,broken=false;
   try{
    client=await pool.connect();if(stopped||closed)throw failure();await client.query("begin");
    await client.query("select pg_catalog.set_config('statement_timeout',$1,true),pg_catalog.set_config('lock_timeout',$1,true)",[`${c.timeoutMs}ms`]);
    const identity=(await client.query(KLAVIYO_SOURCE_ROLE_CHECK_SQL,[requiredSignatures])).rows;
    if(stopped||closed||identity?.length!==1||identity[0].role!==KLAVIYO_SOURCE_ROLE||identity[0].profile_ready!==true)throw failure();
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
