import {createHash} from "node:crypto";
import {createGoogleAcceptanceCoordinatorPostgresClient} from "../database/google-acceptance-coordinator-postgres.server.js";
import {createRefreshWorkRepository} from "../database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../database/shared-quota-repository.server.js";
import {createIdentityRuntimeAuthorityLoader} from "../providers/identity-runtime-authority.server.js";
import {planRefreshPreflightAdmissions} from "./admission-policy.server.js";
import {createAuthorityQuotaEntitlementVerifier} from "./entitlement-check.server.js";
import {createGoogleReadRunner} from "./google-read-runner.server.js";
import {readGoogleSourceDatabaseConfig} from "../database/google-source-postgres.server.js";
import {readShopifyPartnerRuntimeConfig} from "../shopify/partner-api.server.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&/^[1-9][0-9]{0,18}$/.test(x)&&BigInt(x)<=9223372036854775807n;
const positive=x=>Number.isSafeInteger(x)&&x>0;
const exact=(x,keys)=>x&&typeof x==="object"&&!Array.isArray(x)&&Object.keys(x).sort().join()===keys.slice().sort().join();
const fail=()=>{throw Error("GOOGLE_ACCEPTANCE_CONFIGURATION_REQUIRED");};
const boundary=Object.freeze({sourceStored:false,mappingVerified:false,DatasetWritePerformed:false,authorizesActivation:false});
export const GOOGLE_ACCEPTANCE_READER_LIMITS=Object.freeze({maxElapsedMs:60000,maxBytes:1048576,maxPages:1,maxRows:1000,maxLinkPages:1,maxLinks:1000});
// Conservative whole-operation reservation, including authenticated identity and
// fresh Partner entitlement. Provider-native quota is still debited per HTTP.
export const GOOGLE_ACCEPTANCE_WORK_COST=Object.freeze({requests:5,dbWrites:64,connections:3,rows:1000,bytes:1048576});

export function readGoogleAcceptancePlan(environment,now=Date.now()){
 if(environment?.ADSTABLE_GOOGLE_ACCEPTANCE_ENABLED!=="true")return null;
 const raw=environment.ADSTABLE_GOOGLE_ACCEPTANCE_PLAN;
 if(typeof raw!=="string"||Buffer.byteLength(raw)>8192||!Number.isSafeInteger(now))fail();
 let p;try{p=JSON.parse(raw);}catch{fail();}
 if(!exact(p,["operationId","workspaceId","installGeneration","shopId","shopDomain","accountId","connectionId","connectionVersion",
  "credentialId","selectionId","merchantId","merchantQuotaAccountId","merchantBindingEpoch","window","expiresAt"])
  ||![p.operationId,p.workspaceId,p.connectionId,p.credentialId].every(x=>typeof x==="string"&&UUID.test(x))
  ||![p.installGeneration,p.accountId,p.selectionId,p.merchantId,p.merchantQuotaAccountId].every(id)
  ||!positive(p.connectionVersion)||!positive(p.merchantBindingEpoch)||!/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(p.shopId)
  ||typeof p.shopDomain!=="string"||!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(p.shopDomain)
  ||!exact(p.window,["from","to"])||p.window.from!==p.window.to||!/^\d{4}-\d{2}-\d{2}$/.test(p.window.from)
  ||!Number.isFinite(Date.parse(p.window.from))||new Date(p.window.from).toISOString().slice(0,10)!==p.window.from
  ||typeof p.expiresAt!=="string"||!Number.isFinite(Date.parse(p.expiresAt))
  ||Date.parse(p.expiresAt)<=now||Date.parse(p.expiresAt)>now+900000)fail();
 return p;
}

// Trusted server entry only. The request supplies neither plan, caller, job nor
// entitlement. No source writer, fake page, stage reset or Dataset handoff.
export function createGoogleAcceptanceExecution({environment,verified,database,tokenVault,operationId,
 coordinatorPoolFactory,readerPoolFactory,fetchFn=globalThis.fetch,now=Date.now,signal}={}){
 const env={...environment},plan=readGoogleAcceptancePlan(env,now());
 if(!plan||operationId!==plan.operationId||typeof database?.query!=="function"||typeof now!=="function"
  ||typeof fetchFn!=="function"||signal!==undefined&&!(signal instanceof AbortSignal))fail();
 readGoogleSourceDatabaseConfig(env);readShopifyPartnerRuntimeConfig(env);
 if(Number(env.ADSTABLE_GOOGLE_SOURCE_DB_TIMEOUT_MS)>5000||Number(env.ADSTABLE_GOOGLE_ACCEPTANCE_COORDINATOR_DB_TIMEOUT_MS)>5000
  ||typeof env.GOOGLE_ADS_DEVELOPER_TOKEN!=="string"||!env.GOOGLE_ADS_DEVELOPER_TOKEN||env.GOOGLE_ADS_DEVELOPER_TOKEN.length>256
  ||/[\u0000-\u0020\u007f]/.test(env.GOOGLE_ADS_DEVELOPER_TOKEN))fail();
 let caller;
 try{caller={installationAuthority:structuredClone(verified.installationAuthority),identity:structuredClone(verified.identity),
  context:{admin:{graphql:verified.context.admin.graphql.bind(verified.context.admin)}}};}catch{fail();}
 if(caller.installationAuthority.workspaceId!==plan.workspaceId||String(caller.installationAuthority.installGeneration)!==plan.installGeneration
  ||caller.identity.shop.shopId!==plan.shopId||caller.identity.shop.myshopifyDomain!==plan.shopDomain)fail();
 // The loader rejects structurally unverified caller/session/installation inputs.
 const authority=createIdentityRuntimeAuthorityLoader({verified:caller,database,tokenVault,provider:"google_ads",now:()=>new Date(now()),signal});
 const coordinator=createGoogleAcceptanceCoordinatorPostgresClient({environment:env,poolFactory:coordinatorPoolFactory});
 const work=createRefreshWorkRepository(coordinator),quota=createSharedQuotaRepository(coordinator);
 const bound=a=>a?.connectionId===plan.connectionId&&a.connectionVersion===plan.connectionVersion
  &&a.credentialId===plan.credentialId&&a.selectionEpoch===plan.selectionId&&a.account.id===plan.accountId;
 const sourceMatches=s=>s?.workspaceId===plan.workspaceId&&s.installGeneration===plan.installGeneration
  &&s.provider==="google_ads"&&s.accountId===plan.accountId&&s.connectionId===plan.connectionId
  &&s.connectionVersion===plan.connectionVersion&&s.selectionId===plan.selectionId;
 const jobId=createHash("sha256").update(JSON.stringify(["google_acceptance_v1",plan.operationId,plan.workspaceId,plan.installGeneration,plan.accountId])).digest("hex");
 const stopped=(reason,extra={})=>Object.freeze({status:"stopped",reason,recordCount:null,empty:null,...boundary,...extra});
 let used=false;
 return Object.freeze({async run(...args){
  if(used||args.length)throw Error("GOOGLE_ACCEPTANCE_EXECUTION_USED");used=true;
  let claim,reader,result,phase=null,admissionSent=false,paused=false;
  const start=now(),deadline=Math.min(start+90000,Date.parse(plan.expiresAt)),controller=new AbortController();
  const abort=()=>controller.abort();signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(abort,Math.max(1,deadline-start));
  const current=()=>{const t=now();return Number.isSafeInteger(t)&&t>=start&&t<deadline&&!controller.signal.aborted;};
  const context=()=>({claim,window:plan.window});
  async function stop(reason){
   if(!claim)return stopped(reason,{reservationMayExist:admissionSent});
   try{const s=await work.readAdmissionSnapshot();const r=await work.recordStop({job:claim,reason,expectedRevision:s.state.revision});
    return stopped(reason,{stopRecorded:r?.recorded===true,reservationMayExist:r?.recorded!==true});
   }catch{return stopped(reason,{stopRecorded:false,reservationMayExist:true});}
  }
  async function advance(stage){
   if(!current()||await work.advanceStage({...context(),expectedStage:phase,stage})!==true)throw Error("ACCEPTANCE_STAGE_UNCONFIRMED");phase=stage;
  }
  async function execute(){
   if(!current()||!bound(await authority.loadCurrent()))return stopped("authority_required");
   const snapshot=await work.readPreflightSnapshot();
   if(!current())return stopped("stopped_before_call");
   if(snapshot?.configured!==true)return stopped("configuration_missing");
   const candidates=snapshot.candidates?.filter(sourceMatches);
   if(candidates?.length!==1)return stopped("authority_required");
   const source=candidates[0];
   const proposal=planRefreshPreflightAdmissions({...snapshot,now:now(),candidates:[{id:jobId,workspaceId:plan.workspaceId,
    installGeneration:plan.installGeneration,provider:"google_ads",accountId:plan.accountId,scheduledHour:source.scheduledHour,queuedAt:source.queuedAt,
    workClass:"bootstrap",cost:GOOGLE_ACCEPTANCE_WORK_COST,
    authority:{installationVerified:true,connected:true,setupComplete:true,allowedWindow:true}}]});
   if(proposal.status!=="proposed")return stopped("admission_waiting");
   if(!current()||deadline-now()<80000)return stopped("stopped_before_call");
   admissionSent=true;
   const accepted=await work.commitPreflight({expectedRevision:snapshot.state.revision,queueRevision:snapshot.queueRevision,nextState:proposal.nextState,
    source,window:plan.window,partitionId:"google-acceptance:"+plan.operationId,deadlineAt:deadline});
   if(accepted!==true)return stopped("admission_not_accepted");
   claim=proposal.admitted[0];
   await advance("checking_authority");
   const initial=await work.loadBoundAuthority(context());
   const allowed=a=>a&&a.workspaceId===plan.workspaceId&&a.installGeneration===plan.installGeneration&&a.provider==="google_ads"&&a.accountId===plan.accountId
    &&a.connectionId===plan.connectionId&&a.connectionVersion===plan.connectionVersion
    &&["installationVerified","connected","setupComplete","allowedWindow"].every(k=>a[k]===true);
   if(!allowed(initial)||!bound(await authority.loadCurrent()))return stop("authority_required");
   await advance("request_intent");
   const entitlement=createAuthorityQuotaEntitlementVerifier({store:work,quotaStore:quota,appId:env.SHOPIFY_APP_GID,environment:env,fetchFn,now,
    limits:{requestTimeoutMs:10000,finishReserveMs:10000,deadlineAt:deadline}});
   const receipt=await entitlement.verify(context());
   if(receipt?.status!=="verified")return stop(receipt?.externalOutcome==="unknown"?"request_outcome_unknown":"entitlement_required");
   if(!current()||deadline-now()<70000||!allowed(await work.loadBoundAuthority(context()))||!bound(await authority.loadCurrent()))return stop("authority_required");
   const execution={...context(),entitlementReceipt:receipt.receipt};
   const q=await work.loadQuotaContext({...execution,provider:"google_ads"});
   const merchant=q?.merchant;
   if(merchant?.targetAccountId!==plan.merchantId||merchant.quotaAccountId!==plan.merchantQuotaAccountId
    ||merchant.bindingEpoch!==plan.merchantBindingEpoch||merchant.apiVersion!=="products/v1")return stop("configuration_missing");
   if(!current()||deadline-now()<70000)return stop("stopped_before_call");
   reader=createGoogleReadRunner({environment:env,verified:caller,tokenVault,execution,configuration:{merchantId:plan.merchantId,limits:GOOGLE_ACCEPTANCE_READER_LIMITS},
    poolFactory:readerPoolFactory,fetchFn,now,signal:controller.signal});
   const observation=await reader.run();
   await reader.close(); // drain even after the reader's timeout before owner lifecycle SQL
   if(observation.status!=="read_complete")return stop(["provider_permission_denied","provider_throttled"].includes(observation.reason)?observation.reason:"request_outcome_unknown");
   if(!current()||deadline-now()<10000||!allowed(await work.loadBoundAuthority(context()))||!bound(await authority.loadCurrent())
    ||await work.isEntitlementCurrent({...context(),receipt:receipt.receipt})!==true)return stop("authority_check_failed_after_request");
   // Count metadata is returned below; it is not a report page or Dataset payload.
   await advance("response_received");
   if(!current()||await work.finishClaim({claim,outcome:"paused"})!==true)return stopped("closure_unconfirmed",{reservationMayExist:true});
   paused=true;
   if(!current()||!bound(await authority.loadCurrent()))return stopped("authority_check_failed_after_request",{jobPaused:true,reservationMayExist:false});
   return Object.freeze({...observation,status:"observed",operationId:plan.operationId,jobPaused:true});
  }
  try{result=await execute();}catch{result=stopped(claim?"execution_unconfirmed":"admission_unconfirmed",{reservationMayExist:admissionSent&&!paused,...paused?{jobPaused:true}:{}});}
  finally{
   clearTimeout(timer);signal?.removeEventListener("abort",abort);
   const closed=await Promise.allSettled([reader?.close(),coordinator.close()]);
   if(closed.some(x=>x.status==="rejected"))result=stopped("closure_unconfirmed",{reservationMayExist:admissionSent&&!paused,...paused?{jobPaused:true}:{}});
  }
  return result;
 }});
}
