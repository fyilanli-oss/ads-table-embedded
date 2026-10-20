import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {handleQueueCronRequest,QUEUE_CRON_PATH} from "../app/lib/refresh/queue-cron-entry.server.js";
import {readQueueDatabaseConfig,createQueuePostgresClient,QUEUE_DATABASE_ROLE} from "../app/lib/database/refresh-queue-postgres.server.js";

const generation="44444444-4444-4444-4444-444444444444",secret="s".repeat(40);
const environment={CRON_SECRET:secret,SHOPIFY_APP_URL:"https://embedded.adstable.app",VERCEL_ENV:"production",
  ADSTABLE_REFRESH_QUEUE_MODE:"queue_only",ADSTABLE_REFRESH_QUEUE_GENERATION:generation,
  ADSTABLE_REFRESH_QUEUE_DATABASE_URL:`postgresql://${QUEUE_DATABASE_ROLE}.podpwkrpmjiksskxhwsu:${"p".repeat(32)}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require`,
  ADSTABLE_REFRESH_QUEUE_DB_TIMEOUT_MS:"1000"};
const request=(options={})=>new Request(`https://embedded.adstable.app${QUEUE_CRON_PATH}`,{headers:{authorization:`Bearer ${secret}`},...options});
function fixture(status="checked") {
  const calls=[];let closes=0,creates=0;
  const database={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{result:sql.includes("on_tick")?
    {status,generation,sequence:1,queueRevision:2,checkedAtMs:1000}:{status:"reviewed",stopped:0,uncertain:0}}]};},close:async()=>{closes++;}};
  const createDatabase=({environment:passed})=>{creates++;assert.equal(passed.CRON_SECRET,undefined);assert.equal(passed.SHOPIFY_APP_URL,undefined);return database;};
  return {args:{environment:{...environment},createDatabase},database,calls,creates:()=>creates,closes:()=>closes};
}
test("cron entry verifies method and exact bearer before constructing a database client",async()=>{
  for(const method of ["POST","PUT","DELETE","HEAD","OPTIONS"]) {
    const f=fixture(),r=await handleQueueCronRequest(request({method}),f.args);assert.equal(r.status,405);assert.equal(r.headers.get("allow"),"GET");assert.equal(f.creates(),0);
  }
  for(const authorization of ["",`Bearer ${"x".repeat(40)}`,`Bearer ${"é".repeat(40)}`,`bearer ${secret}`,`Bearer ${secret}, Bearer ${secret}`]) {
    const f=fixture(),r=await handleQueueCronRequest(request({headers:{authorization}}),f.args);assert.equal(r.status,401);assert.equal(f.creates(),0);
  }
  const f=fixture();delete f.args.environment.CRON_SECRET;assert.equal((await handleQueueCronRequest(request(),f.args)).status,401);assert.equal(f.creates(),0);
});
test("disabled, preview, missing generation and request-supplied scope cannot reach the database",async()=>{
  for(const patch of [{ADSTABLE_REFRESH_QUEUE_MODE:undefined},{ADSTABLE_REFRESH_QUEUE_MODE:"provider"},{VERCEL_ENV:"preview"},
    {ADSTABLE_REFRESH_QUEUE_GENERATION:"bad"},{SHOPIFY_APP_URL:"http://embedded.adstable.app"},{SHOPIFY_APP_URL:"https://embedded.adstable.app/path"}]) {
    const f=fixture();Object.assign(f.args.environment,patch);assert.equal((await handleQueueCronRequest(request(),f.args)).status,503);assert.equal(f.creates(),0);
  }
  for(const url of [`https://evil.example${QUEUE_CRON_PATH}`,`https://embedded.adstable.app${QUEUE_CRON_PATH}?work=enabled`,`https://embedded.adstable.app/wrong`]) {
    const f=fixture();assert.equal((await handleQueueCronRequest(new Request(url,{headers:{authorization:`Bearer ${secret}`}}),f.args)).status,400);assert.equal(f.creates(),0);
  }
});
test("authorized entry runs only queue and interruption RPCs; result is not provider or Dataset success",async()=>{
  const f=fixture(),r=await handleQueueCronRequest(request(),f.args),body=await r.json();
  assert.equal(r.status,200);assert.deepEqual(body,{status:"queue_checked",interruptedExecutions:0,providerCalls:"disabled",DatasetWrite:"disabled"});
  assert.equal(f.creates(),1);assert.equal(f.closes(),1);assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0].args,[generation]);
  assert.equal(r.headers.get("cache-control"),"no-store, max-age=0");assert.equal(r.headers.get("vercel-cdn-cache-control"),"no-store");
  assert.doesNotMatch(JSON.stringify(body),/44444444|sequence|account|workspace|secret|rows/);
});

test("native production deployment URL is accepted only from trusted environment, never forwarded headers",async()=>{
  const f=fixture();f.args.environment.VERCEL_URL="synthetic-deployment.vercel.app";
  const r=await handleQueueCronRequest(new Request(`https://synthetic-deployment.vercel.app${QUEUE_CRON_PATH}`,{headers:{authorization:`Bearer ${secret}`}}),f.args);
  assert.equal(r.status,200);
  const g=fixture();assert.equal((await handleQueueCronRequest(new Request(`https://evil.example${QUEUE_CRON_PATH}`,{headers:{authorization:`Bearer ${secret}`,"x-forwarded-host":"embedded.adstable.app"}}),g.args)).status,400);
  assert.equal(g.creates(),0);
});
test("duplicate, stale generation, DB/commit uncertainty and cleanup errors never retry or return false green",async()=>{
  for(const [status,expected] of [["duplicate",200],["not_current_generation",409],["clock_invalid",503],["not_configured",503]]) {
    const f=fixture(status),r=await handleQueueCronRequest(request(),f.args);assert.equal(r.status,expected);assert.equal(f.calls.length,1);assert.equal(f.closes(),1);
  }
  const f=fixture();f.database.query=async()=>{throw Error("SENSITIVE-DB-URL");};
  const r=await handleQueueCronRequest(request(),f.args);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/SENSITIVE/);assert.equal(f.closes(),1);
  const g=fixture();g.database.close=async()=>{throw Error("secret");};
  const failed=await handleQueueCronRequest(request(),g.args);assert.equal(failed.status,503);assert.equal((await failed.json()).queueCheck,"checked");
});
test("dedicated DB configuration rejects merchant/owner role, foreign project, non-TLS and unchosen timeout",()=>{
  assert.equal(readQueueDatabaseConfig(environment).timeoutMs,1000);
  for(const url of [environment.ADSTABLE_REFRESH_QUEUE_DATABASE_URL.replace(QUEUE_DATABASE_ROLE,"adstable_runtime"),
    environment.ADSTABLE_REFRESH_QUEUE_DATABASE_URL.replace("podpwkrpmjiksskxhwsu","otherproject"),
    environment.ADSTABLE_REFRESH_QUEUE_DATABASE_URL.replace("sslmode=require","sslmode=disable"),
    environment.ADSTABLE_REFRESH_QUEUE_DATABASE_URL+"&options=unsafe"]) assert.throws(()=>readQueueDatabaseConfig({...environment,ADSTABLE_REFRESH_QUEUE_DATABASE_URL:url}),/CONFIGURATION_REQUIRED/);
  for(const timeout of [undefined,"0","30001","-1","1.5"]) assert.throws(()=>readQueueDatabaseConfig({...environment,ADSTABLE_REFRESH_QUEUE_DB_TIMEOUT_MS:timeout}),/CONFIGURATION_REQUIRED/);
});

test("committed queue with failed interruption review and unknown COMMIT never becomes refresh success or retries",async()=>{
  const f=fixture();let n=0;
  const query=f.database.query;f.database.query=async(...args)=>{if(++n===2) throw Error("private");return query(...args);};
  const response=await handleQueueCronRequest(request(),f.args);
  assert.equal(response.status,503);assert.equal((await response.json()).queueCheck,"checked");assert.equal(n,2);
  const calls=[];let released=false;
  const client={query:async sql=>{calls.push(sql);if(sql==="commit") throw Error("connection lost after commit");return {rows:[]};},release:()=>{released=true;}};
  const db=createQueuePostgresClient({environment,poolFactory:()=>({on:()=>{},connect:async()=>client,end:async()=>{}})});
  await assert.rejects(db.query("select operations.review_refresh_interrupted_work() as result"),/UNAVAILABLE/);
  assert.equal(calls.filter(x=>x.includes("review_refresh")).length,1);assert.equal(calls.at(-1),"rollback");assert.equal(released,true);
  const before=calls.length;await assert.rejects(db.query("select operations.review_refresh_interrupted_work() as result"));assert.equal(calls.length,before);await db.close();
});
test("dedicated DB wraps each exact RPC in one bounded transaction, releases clients and has no retry fallback",async()=>{
  const calls=[];let released=0,ended=0;
  const client={query:async(...args)=>{calls.push(args);return {rows:[]};},release:()=>{released++;}};
  const pool={on:()=>{},connect:async()=>client,end:async()=>{ended++;}};
  const db=createQueuePostgresClient({environment,poolFactory:config=>{assert.equal(config.max,1);assert.equal(config.ssl.rejectUnauthorized,true);return pool;}});
  await db.query("select operations.review_refresh_interrupted_work() as result");
  assert.deepEqual(calls.map(c=>c[0]),["begin","select pg_catalog.set_config('statement_timeout',$1,true),pg_catalog.set_config('lock_timeout',$1,true)","select operations.review_refresh_interrupted_work() as result","commit"]);
  assert.deepEqual(calls[1][1],["1000ms"]);assert.equal(released,1);
  await assert.rejects(db.query("select operations.commit_refresh_admissions(1,'{}')"),/UNAVAILABLE/);assert.equal(calls.length,4);
  client.query=async(sql)=>{calls.push([sql]);if(sql==="begin") throw Error("private detail");return {rows:[]};};
  await assert.rejects(db.query("select operations.review_refresh_interrupted_work() as result"),/REFRESH_QUEUE_DATABASE_UNAVAILABLE/);
  const count=calls.length;await assert.rejects(db.query("select operations.review_refresh_interrupted_work() as result"));assert.equal(calls.length,count);
  await db.close();assert.equal(ended,1);assert.equal(released,2);
});
test("route is non-visual and cron, secret and login activation remain absent",()=>{
  const c=JSON.parse(readFileSync(new URL("../contracts/eo-05a-refresh-queue-cron-entry-v1.json",import.meta.url),"utf8"));
  for(const key of ["provider_calls_enabled","Dataset_write","cron_registered","live_activation","login_or_credential_created","live_migration_apply"]) assert.equal(c[key],false);
  const route=readFileSync(new URL("../app/routes/internal.refresh.queue-check.ts",import.meta.url),"utf8");
  assert.doesNotMatch(route,/shopify\.server|default|JSX|createQuota|readPage/);
  assert.equal(existsSync(new URL("../vercel.json",import.meta.url)),false);
  const current=readFileSync(new URL("../.env.example",import.meta.url),"utf8");
  for(const item of c.planned_environment) assert.equal(new RegExp(`^${item.key}=`,'m').test(current),false);
});
