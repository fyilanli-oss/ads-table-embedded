import pg from "pg";
import {createHash} from "node:crypto";
import {readGoogleAcceptancePlan,GOOGLE_ACCEPTANCE_WORK_COST} from "./google-acceptance-server.server.js";
import {readRuntimeDatabaseConfig} from "../database/runtime-postgres.server.js";
import {createGoogleServerRuntime} from "./google-server-runtime.server.js";
import {createGoogleAcceptanceCoordinatorPostgresClient} from "../database/google-acceptance-coordinator-postgres.server.js";
import {readGoogleSourceDatabaseConfig} from "../database/google-source-postgres.server.js";
import {createIdentityAuthorityRepository} from "../database/identity-authority-repository.server.js";
import {createRefreshWorkRepository} from "../database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../database/shared-quota-repository.server.js";
import {createTokenVault} from "../oauth/token-vault.server.js";
import {createConfiguredSourceEvidenceCipher,readSourceStoragePolicy} from "../database/source-evidence-config.server.js";
import {readShopifyPartnerRuntimeConfig} from "../shopify/partner-api.server.js";
import {loadGoogleBackgroundOwner} from "./google-background-owner.server.js";
import {planRefreshPreflightAdmissions} from "./admission-policy.server.js";
import {createAuthorityQuotaEntitlementVerifier} from "./entitlement-check.server.js";
import {createGoogleRawReader} from "./google-raw-reader.server.js";

const fail=()=>{throw Error("GOOGLE_RAW_CAPTURE_CONFIGURATION_REQUIRED");};
const exact=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const boundary=Object.freeze({mappingVerified:false,DatasetWritePerformed:false,authorizesActivation:false,hourlyRefreshActivated:false});
// Configuration is server-owned, finite and default closed. Its target uses the
// existing strict identity/window validator; it never enables the browser route.
export function readGoogleRawCapturePlan(environment,now=Date.now()) {
 if(environment?.ADSTABLE_GOOGLE_RAW_CAPTURE_ENABLED!=="true")return null;
 const raw=environment.ADSTABLE_GOOGLE_RAW_CAPTURE_PLAN;
 if(typeof raw!=="string"||Buffer.byteLength(raw)>16384)fail();
 let p;try{p=JSON.parse(raw);}catch{fail();}
 if(!exact(p,["target","limits","storageLimits","sourcePolicy"]))fail();
 const target=readGoogleAcceptancePlan({ADSTABLE_GOOGLE_ACCEPTANCE_ENABLED:"true",ADSTABLE_GOOGLE_ACCEPTANCE_PLAN:JSON.stringify(p.target)},now);
 const l=p.limits,s=p.storageLimits;
 if(!exact(l,["maxBytes","maxElapsedMs","maxLinkPages","maxLinks","maxPages","maxRows"])
  ||Object.values(l).some(v=>!Number.isSafeInteger(v)||v<1)||l.maxElapsedMs>60000||l.maxBytes>GOOGLE_ACCEPTANCE_WORK_COST.bytes
  ||l.maxPages!==1||l.maxLinkPages!==1
  ||["maxPages","maxRows","maxLinks","maxLinkPages"].some(k=>l[k]>1000)
  ||!exact(s,["maxRows","maxBytes"])||!Number.isSafeInteger(s.maxRows)||s.maxRows<1||s.maxRows>GOOGLE_ACCEPTANCE_WORK_COST.rows
  ||!Number.isSafeInteger(s.maxBytes)||s.maxBytes<1||s.maxBytes>GOOGLE_ACCEPTANCE_WORK_COST.bytes)fail();
 return {target,limits:l,storageLimits:s,sourcePolicy:readSourceStoragePolicy(p.sourcePolicy,now)};
}

// Dedicated server process only. No route/request/session/verified-caller input,
// OAuth execution, SDK global hook, role provisioning or owner-table SQL.
export function createGoogleRawCaptureExecution({environment,operationId,signal,now=Date.now,fetchFn=globalThis.fetch,
 runtimePoolFactory=options=>new pg.Pool(options),coordinatorPoolFactory,readerPoolFactory}={}) {
 const env={...environment},configuration=readGoogleRawCapturePlan(env,now()),p=configuration?.target;
 if(!p||p.operationId!==operationId||typeof now!=="function"||typeof fetchFn!=="function"
  ||typeof runtimePoolFactory!=="function"||signal!==undefined&&!(signal instanceof AbortSignal))fail();
 readRuntimeDatabaseConfig(env);readGoogleSourceDatabaseConfig(env);readShopifyPartnerRuntimeConfig(env);
 createConfiguredSourceEvidenceCipher(env);
 if(Number(env.ADSTABLE_GOOGLE_SOURCE_DB_TIMEOUT_MS)>5000||Number(env.ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DB_TIMEOUT_MS)>5000)fail();
 let runtime,coordinator;
 try{
  runtime=createGoogleServerRuntime({environment:env,poolFactory:runtimePoolFactory});
  coordinator=createGoogleAcceptanceCoordinatorPostgresClient({environment:env,poolFactory:coordinatorPoolFactory});
 }catch{void runtime?.close().catch(()=>{});fail();}
 const work=createRefreshWorkRepository(coordinator),quota=createSharedQuotaRepository(coordinator),identity=createIdentityAuthorityRepository(runtime);
 const vault=createTokenVault({database:runtime,environment:env,now:()=>new Date(now())});
 let used=false,running=false,closed=false,reader=null;
 async function close(){if(running)throw Error("GOOGLE_RAW_CAPTURE_BUSY");if(closed)return;closed=true;
  const results=await Promise.allSettled([reader?.close(),coordinator.close(),runtime.close()]);
  if(results.some(r=>r.status==="rejected"))throw Error("GOOGLE_RAW_CAPTURE_CLOSE_UNCONFIRMED");}
 return Object.freeze({async run(...args){
  if(args.length||used||closed)throw Error("GOOGLE_RAW_CAPTURE_EXECUTION_USED");used=true;running=true;
  const controller=new AbortController(),forward=()=>controller.abort();signal?.addEventListener("abort",forward,{once:true});if(signal?.aborted)forward();
  const start=now(),deadline=Math.min(start+90000,Date.parse(p.expiresAt)),timer=setTimeout(forward,Math.max(1,deadline-start));
  // Reserve both native observations and the bounded encrypted write. These are
  // derived worst-case costs of this single plan, never provider quota defaults.
  const cost={...GOOGLE_ACCEPTANCE_WORK_COST,
   rows:configuration.limits.maxRows+2*configuration.limits.maxLinks+configuration.storageLimits.maxRows,
   bytes:configuration.limits.maxBytes+configuration.storageLimits.maxBytes,
   dbWrites:GOOGLE_ACCEPTANCE_WORK_COST.dbWrites+2*configuration.storageLimits.maxRows+2};
  let claim,phase=null,admissionSent=false,paused=false,captured=null,renewal=null;
  const current=()=>{const t=now();return !controller.signal.aborted&&Number.isSafeInteger(t)&&t>=start&&t<deadline;};
  const stopped=(reason)=>Object.freeze({status:captured?.status==="unconfirmed"||captured?.sourceStored===true?"unconfirmed":"stopped",reason,sourceStored:captured?captured.sourceStored:false,
   receiptVerified:captured?.receiptVerified??false,recordCount:null,empty:null,reservationMayExist:admissionSent&&!paused,...boundary});
  const owner={workspaceId:p.workspaceId,installGeneration:Number(p.installGeneration),shopId:p.shopId,shopDomain:p.shopDomain};
  const readIdentity=()=>identity.load({...owner,provider:"google_ads"});
  const bound=a=>a?.workspaceId===p.workspaceId&&String(a.installGeneration)===p.installGeneration&&a.status==="connected"
   &&a.connectionId===p.connectionId&&a.selectionEpoch===p.selectionId&&a.reportingAccountId===p.accountId
   &&a.connectionVersion===(renewal?.version??p.connectionVersion)&&a.credentialId===(renewal?.credentialId??p.credentialId);
  const sourceMatches=s=>s?.workspaceId===p.workspaceId&&s.installGeneration===p.installGeneration&&s.provider==="google_ads"
   &&s.accountId===p.accountId&&s.connectionId===p.connectionId&&s.connectionVersion===p.connectionVersion&&s.selectionId===p.selectionId;
  const context=()=>({claim,window:p.window});
  async function stop(reason){
   if(claim){try{const snapshot=await work.readAdmissionSnapshot();await work.recordStop({job:claim,reason,expectedRevision:snapshot.state.revision});}catch{}}
   return stopped(reason);
  }
  async function advance(stage){if(!current()||await work.advanceStage({...context(),expectedStage:phase,stage})!==true)throw Error("GOOGLE_RAW_CAPTURE_STAGE_UNCONFIRMED");phase=stage;}
  async function execute(){
   if(!current())return stopped("stopped_before_call");
   const verified=await loadGoogleBackgroundOwner({database:runtime,owner});
   if(!current()||!bound(await readIdentity())||!current())return stopped("authority_required");
   const snapshot=await work.readPreflightSnapshot();if(!current())return stopped("stopped_before_call");
   if(snapshot?.configured!==true)return stopped("configuration_missing");
   const candidates=snapshot.candidates?.filter(sourceMatches);if(candidates?.length!==1)return stopped("authority_required");
   const source=candidates[0],jobId=createHash("sha256").update(JSON.stringify(["google_raw_capture_v1",p.operationId,p.workspaceId,p.installGeneration,p.accountId])).digest("hex");
   const proposal=planRefreshPreflightAdmissions({...snapshot,now:now(),candidates:[{id:jobId,workspaceId:p.workspaceId,installGeneration:p.installGeneration,
    provider:"google_ads",accountId:p.accountId,scheduledHour:source.scheduledHour,queuedAt:source.queuedAt,workClass:"bootstrap",
    cost,authority:{installationVerified:true,connected:true,setupComplete:true,allowedWindow:true}}]});
   if(proposal.status!=="proposed")return stopped("admission_waiting");
   if(!current()||deadline-now()<80000)return stopped("stopped_before_call");
   admissionSent=true;
   if(await work.commitPreflight({expectedRevision:snapshot.state.revision,queueRevision:snapshot.queueRevision,nextState:proposal.nextState,
    source,window:p.window,partitionId:"google-raw-capture:"+p.operationId,deadlineAt:deadline})!==true)return stopped("admission_not_accepted");
   claim=proposal.admitted[0];await advance("checking_authority");
   if(!current()||!bound(await readIdentity())||!current()||!await work.loadBoundAuthority(context())||!current())return stop("authority_required");
   await advance("request_intent");
   const verifier=createAuthorityQuotaEntitlementVerifier({store:work,quotaStore:quota,appId:env.SHOPIFY_APP_GID,environment:env,fetchFn,now,
    limits:{requestTimeoutMs:10000,finishReserveMs:10000,deadlineAt:deadline}});
   const entitlement=await verifier.verify(context());
   if(entitlement?.status!=="verified")return stop(entitlement?.externalOutcome==="unknown"?"request_outcome_unknown":"entitlement_required");
   const execution={...context(),entitlementReceipt:entitlement.receipt},q=await work.loadQuotaContext({...execution,provider:"google_ads"});
   if(q?.merchant?.targetAccountId!==p.merchantId||q.merchant.quotaAccountId!==p.merchantQuotaAccountId
    ||q.merchant.bindingEpoch!==p.merchantBindingEpoch||q.merchant.apiVersion!=="products/v1")return stop("configuration_missing");
   if(!current()||deadline-now()<70000||!bound(await readIdentity())||!current())return stop("authority_required");
   const tokenVault=Object.freeze({loadProviderTokenSet:v=>vault.loadProviderTokenSet(v),async renewGoogleIdentityCredential(v){
    if(renewal||!current()||v.connectionId!==p.connectionId||v.expectedVersion!==p.connectionVersion||v.expectedCredentialId!==p.credentialId)
     throw Error("GOOGLE_RAW_CAPTURE_RENEWAL_UNCONFIRMED");
    const result=await vault.renewGoogleIdentityCredential(v);renewal=result;return result;
   }});
   reader=createGoogleRawReader({environment:env,verified,tokenVault,execution,configuration:{merchantId:p.merchantId,
    limits:configuration.limits,storageLimits:configuration.storageLimits,sourcePolicy:configuration.sourcePolicy},
    signal:controller.signal,now,fetchFn,poolFactory:readerPoolFactory});
   captured=await reader.run();await reader.close();
   if(captured.status!=="stored")return stop(["provider_permission_denied","provider_throttled"].includes(captured.reason)?captured.reason:"request_outcome_unknown");
   if(!current()||deadline-now()<10000||!bound(await readIdentity())||!await work.loadBoundAuthority(context())
    ||await work.isEntitlementCurrent({...context(),receipt:entitlement.receipt})!==true)return stop("authority_check_failed_after_request");
   await advance("response_received");
   if(!current()||await work.finishClaim({claim,outcome:"paused"})!==true)return stopped("closure_unconfirmed");paused=true;
   if(!current()||!bound(await readIdentity()))return stopped("authority_check_failed_after_request");
   return Object.freeze({...captured,operationId:p.operationId,jobPaused:true,reservationMayExist:false,...boundary});
  }
  let result;
  try{result=await execute();}catch{result=stopped(claim?"execution_unconfirmed":"admission_unconfirmed");}
  finally{clearTimeout(timer);signal?.removeEventListener("abort",forward);controller.abort();running=false;}
  try{await close();}catch{return Object.freeze({...result,status:"unconfirmed",reason:"close_unconfirmed",recordCount:null,empty:null});}
  return result;
 },close});
}
