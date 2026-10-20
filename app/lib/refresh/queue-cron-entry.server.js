import {timingSafeEqual} from "node:crypto";
import {createQueuePostgresClient} from "../database/refresh-queue-postgres.server.js";
import {createRefreshWorkRepository} from "../database/refresh-work-repository.server.js";
import {runScheduledRefreshCheck,refreshTickGenerationValid} from "./scheduled-queue-check.server.js";

export const QUEUE_CRON_PATH="/internal/refresh/queue-check";
function reply(status,body) {
  return Response.json({...body,providerCalls:"disabled",DatasetWrite:"disabled"},{status,
    headers:{"cache-control":"no-store, max-age=0","cdn-cache-control":"no-store","vercel-cdn-cache-control":"no-store","x-content-type-options":"nosniff",...status===405?{allow:"GET"}:{}}});
}

// Only the HTTP entry. No merchant session initialization, body policy, provider adapter or writer.
export async function handleQueueCronRequest(request,{environment=process.env,createDatabase=createQueuePostgresClient}={}) {
  if(request.method!=="GET") return reply(405,{status:"method_not_allowed"});
  const secret=environment.CRON_SECRET,auth=request.headers.get("authorization");
  if(typeof secret!=="string"||!/^[A-Za-z0-9_-]{32,256}$/.test(secret)||typeof auth!=="string"
    || !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(auth)||auth.length!==secret.length+7
    || !timingSafeEqual(Buffer.from(auth),Buffer.from(`Bearer ${secret}`))) return reply(401,{status:"unauthorized"});
  let origin;
  try {
    const configured=new URL(environment.SHOPIFY_APP_URL);
    if(configured.protocol!=="https:"||configured.origin!==environment.SHOPIFY_APP_URL) throw Error();
    origin=configured.origin;
  } catch {return reply(503,{status:"not_configured"});}
  const generation=environment.ADSTABLE_REFRESH_QUEUE_GENERATION;
  if(environment.VERCEL_ENV!=="production"||environment.ADSTABLE_REFRESH_QUEUE_MODE!=="queue_only"
    || !refreshTickGenerationValid(generation)) return reply(503,{status:"not_configured"});
  const origins=new Set([origin]);
  // Trusted deployment configuration only; never caller-controlled forwarded/host headers.
  for(const host of [environment.VERCEL_URL,environment.VERCEL_PROJECT_PRODUCTION_URL]) {
    if(typeof host==="string"&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)) origins.add(`https://${host}`);
  }
  const url=new URL(request.url);
  if(!origins.has(url.origin)||url.pathname!==QUEUE_CRON_PATH||url.search) return reply(400,{status:"request_not_allowed"});
  let database,result,cleanupFailed=false;
  try {
    database=createDatabase({environment:{ADSTABLE_REFRESH_QUEUE_DATABASE_URL:environment.ADSTABLE_REFRESH_QUEUE_DATABASE_URL,
      ADSTABLE_REFRESH_QUEUE_DB_TIMEOUT_MS:environment.ADSTABLE_REFRESH_QUEUE_DB_TIMEOUT_MS}});
    const store=createRefreshWorkRepository(database);
    // Deliberately no `work` argument. Request input cannot enable provider dispatch.
    result=await runScheduledRefreshCheck({store,generation});
  } catch {result={status:"needs_attention"};}
  finally {if(database) {try {await database.close();} catch {cleanupFailed=true;}}}
  const checked=result?.status==="queue_checked";
  if(cleanupFailed) return reply(503,{status:"needs_attention",queueCheck:checked?"checked":"unconfirmed"});
  if(result?.status==="duplicate") return reply(200,{status:"duplicate"});
  if(result?.status==="not_current_generation") return reply(409,{status:"not_current_generation"});
  if(checked&&result.interruptions?.status==="reviewed"&&result.work?.status==="work_policy_required") {
    return reply(200,{status:"queue_checked",interruptedExecutions:result.interruptions.uncertain});
  }
  return reply(503,{status:result?.status==="not_configured"?"not_configured":"needs_attention",queueCheck:checked?"checked":"unconfirmed"});
}
