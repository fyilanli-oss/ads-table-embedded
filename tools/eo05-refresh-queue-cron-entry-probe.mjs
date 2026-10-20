import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {handleQueueCronRequest,QUEUE_CRON_PATH} from "../app/lib/refresh/queue-cron-entry.server.js";

// Existing owner-owned synthetic fixture only; no login or Vercel/provider calls.
export async function refreshQueueCronEntryProbe(client) {
  const role="adstable_refresh_queue_runner";
  const attributes=(await client.query("select rolcanlogin,rolsuper,rolinherit,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=$1",[role])).rows[0];
  assert.ok(attributes);assert.ok(Object.values(attributes).every(v=>v===false));
  assert.equal((await client.query("select count(*)::int n from pg_auth_members where member=(select oid from pg_roles where rolname=$1)",[role])).rows[0].n,0);
  const allowed=(await client.query("select n.nspname||'.'||p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','billing','integrations','shopify','operations') and has_function_privilege($1,p.oid,'EXECUTE') order by name",[role])).rows.map(r=>r.name);
  assert.deepEqual(allowed,["operations.check_refresh_queue_on_tick","operations.review_refresh_interrupted_work"]);
  assert.equal((await client.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('app','billing','integrations','shopify','operations') and c.relkind in ('r','p') and has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",[role])).rows[0].n,0);
  const generation=randomUUID(),secret="synthetic-only-not-a-live-secret-00000000";
  const environment={CRON_SECRET:secret,SHOPIFY_APP_URL:"https://synthetic.invalid",VERCEL_ENV:"production",
    ADSTABLE_REFRESH_QUEUE_MODE:"queue_only",ADSTABLE_REFRESH_QUEUE_GENERATION:generation};
  const request=(suffix="",authorization=`Bearer ${secret}`)=>new Request(`https://synthetic.invalid${QUEUE_CRON_PATH}${suffix}`,{headers:{authorization}});
  let creates=0,closes=0;const queries=[];
  const createDatabase=()=>{creates++;return {query:async(sql,args)=>{queries.push(sql);return client.query(sql,args);},close:async()=>{closes++;}};};
  await client.query("savepoint cron_entry");
  try {
    await client.query("update operations.refresh_tick_control set enabled=true,generation=$1,last_minute=null,last_checked_at_ms=null where singleton",[generation]);
    const before=(await client.query("select revision from operations.refresh_control where singleton")).rows[0];
    assert.equal((await handleQueueCronRequest(request("","Bearer invalid"),{environment,createDatabase})).status,401);
    assert.equal((await handleQueueCronRequest(request("?work=enabled"),{environment,createDatabase})).status,400);
    assert.equal(creates,0);
    const response=await handleQueueCronRequest(request(),{environment,createDatabase});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:"queue_checked",interruptedExecutions:0,providerCalls:"disabled",DatasetWrite:"disabled"});
    assert.equal(queries.length,2);assert.equal(creates,1);assert.equal(closes,1);
    assert.deepEqual((await client.query("select revision from operations.refresh_control where singleton")).rows[0],before,"no worker admission");
    await client.query("update operations.refresh_tick_control set last_minute=floor(extract(epoch from clock_timestamp())/60) where singleton");
    const duplicate=await handleQueueCronRequest(request(),{environment,createDatabase});assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).status,"duplicate");
    assert.equal(queries.length,3);
    environment.ADSTABLE_REFRESH_QUEUE_GENERATION=randomUUID();
    assert.equal((await handleQueueCronRequest(request(),{environment,createDatabase})).status,409);
    console.log("EO05_QUEUE_CRON_ENTRY_PASS authenticated=true exact_two_rpc_acl=true no_login=true no_table_access=true queue_checked=true duplicate=true stale_generation=true worker_admission=false provider_calls=0 Dataset_write=false live_changes=false");
  } finally {await client.query("rollback to savepoint cron_entry");await client.query("release savepoint cron_entry");}
}
