import pg from "pg";
import {SUPABASE_ROOT_CA_2021} from "./supabase-root-ca-2021.server.js";

export const QUEUE_DATABASE_ROLE="adstable_refresh_queue_runner";
const queries=new Set(["select operations.check_refresh_queue_on_tick($1::uuid) as result","select operations.review_refresh_interrupted_work() as result"]);
const invalid=()=>new Error("REFRESH_QUEUE_DATABASE_CONFIGURATION_REQUIRED");

export function readQueueDatabaseConfig(environment) {
  try {
    const raw=environment.ADSTABLE_REFRESH_QUEUE_DATABASE_URL;
    if(typeof raw!=="string"||!raw) throw invalid();
    const url=new URL(raw),timeout=environment.ADSTABLE_REFRESH_QUEUE_DB_TIMEOUT_MS;
    if(!["postgres:","postgresql:"].includes(url.protocol)
      || decodeURIComponent(url.username)!==`${QUEUE_DATABASE_ROLE}.podpwkrpmjiksskxhwsu`
      || decodeURIComponent(url.password).length<24
      || !/^aws-[0-9]+-eu-central-1\.pooler\.supabase\.com$/.test(url.hostname)
      || url.port!=="6543"||url.pathname!=="/postgres"||url.hash
      || url.searchParams.get("sslmode")!=="require"||url.searchParams.size!==1
      || typeof timeout!=="string"||!/^\d{1,5}$/.test(timeout)||Number(timeout)<1||Number(timeout)>30000) throw invalid();
    url.search="";
    return {connectionString:url.toString(),timeoutMs:Number(timeout),ssl:{ca:SUPABASE_ROOT_CA_2021,rejectUnauthorized:true}};
  } catch {throw invalid();}
}

// Dedicated pool and exact two-RPC surface. Never borrows the merchant runtime URL/role.
export function createQueuePostgresClient({environment,poolFactory=config=>new pg.Pool(config)}) {
  const config=readQueueDatabaseConfig(environment);
  const pool=poolFactory({connectionString:config.connectionString,ssl:config.ssl,max:1,
    connectionTimeoutMillis:config.timeoutMs,idleTimeoutMillis:10000,allowExitOnIdle:true,application_name:"adstable-refresh-queue"});
  let failed=false;
  pool.on("error",()=>{failed=true;}); // No raw idle-client error can enter application logs.
  return Object.freeze({
    async query(sql,parameters=[]) {
      if(failed||!queries.has(sql)) throw new Error("REFRESH_QUEUE_DATABASE_UNAVAILABLE");
      let client,broken=false;
      try {
        client=await pool.connect();
        await client.query("begin");
        await client.query("select pg_catalog.set_config('statement_timeout',$1,true),pg_catalog.set_config('lock_timeout',$1,true)",[`${config.timeoutMs}ms`]);
        const result=await client.query(sql,parameters);
        await client.query("commit");
        return result;
      } catch {
        failed=true;
        if(client) {try {await client.query("rollback");} catch {broken=true;}}
        throw new Error("REFRESH_QUEUE_DATABASE_UNAVAILABLE");
      } finally {if(client) client.release(broken);}
    },
    async close() {try {await pool.end();} catch {throw new Error("REFRESH_QUEUE_DATABASE_UNAVAILABLE");}},
  });
}
