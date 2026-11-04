import {createGoogleSourcePostgresClient} from "../database/google-source-postgres.server.js";
import {createConfiguredSourceEvidenceCipher,readSourceStoragePolicy} from "../database/source-evidence-config.server.js";
import {createSourceEvidenceRepository,canonicalSourceJson} from "../database/source-evidence-store.server.js";
import {createRefreshWorkRepository} from "../database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../database/shared-quota-repository.server.js";
import {createRefreshGoogleIdentityReader,refreshGoogleSourceStorageContext} from "./quota-authority-binding.server.js";
import {isGoogleBackgroundOwner} from "./google-background-owner.server.js";
import {runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";

const boundary=Object.freeze({mappingVerified:false,DatasetWritePerformed:false,authorizesActivation:false});
const fail=()=>{throw Error("GOOGLE_RAW_READER_CONFIGURATION_REQUIRED");};
// One admitted native-only capture. No Shopify product lookup, reviewed source
// rule, accepted mapping, report writer, cron, token disclosure or automatic retry.
export function createGoogleRawReader({environment,verified,tokenVault,execution,configuration,signal,
 now=Date.now,poolFactory,fetchFn=globalThis.fetch}={}) {
 if(!isGoogleBackgroundOwner(verified)||typeof tokenVault?.loadProviderTokenSet!=="function"
  ||typeof now!=="function"||typeof fetchFn!=="function")fail();
 const env={...environment},scope=structuredClone(execution),c=structuredClone(configuration),l=c?.limits,s=c?.storageLimits;
 if(!c||Object.keys(c).sort().join()!=="limits,merchantId,sourcePolicy,storageLimits"||scope?.claim?.provider!=="google_ads"
  ||!l||Object.keys(l).sort().join()!=="maxBytes,maxElapsedMs,maxLinkPages,maxLinks,maxPages,maxRows"
  ||Object.values(l).some(v=>!Number.isSafeInteger(v)||v<1)||l.maxBytes>16777216||l.maxElapsedMs>60000||l.maxPages!==1||l.maxLinkPages!==1
  ||["maxPages","maxRows","maxLinks","maxLinkPages"].some(k=>l[k]>1000)
  ||!s||Object.keys(s).sort().join()!=="maxBytes,maxRows"||!Number.isSafeInteger(s.maxRows)||s.maxRows<1||s.maxRows>1000
  ||!Number.isSafeInteger(s.maxBytes)||s.maxBytes<1||s.maxBytes>16777216)fail();
 const cipher=createConfiguredSourceEvidenceCipher(env),policy=readSourceStoragePolicy(c.sourcePolicy,now());
 const database=createGoogleSourcePostgresClient({environment:env,poolFactory});
 let used=false,running=false,closed=false;
 return Object.freeze({async run(...args){
  if(args.length||used||closed)throw Error("GOOGLE_RAW_READER_EXECUTION_USED");used=true;running=true;
  let reader,stored=null,bytes=0,limited=false,httpFailure=null;
  try{return await runIdentityReadDeadline({signal,timeoutMs:l.maxElapsedMs,run:async child=>{
   const boundedFetch=async(input,init)=>{
    if(child.aborted)throw Error("GOOGLE_RAW_READER_ABORTED");
    const response=await fetchFn(input,init);
    if(child.aborted||!(response instanceof Response))throw Error("GOOGLE_RAW_READER_STOPPED");
    if(!response.ok)httpFailure=[401,403].includes(response.status)?"provider_permission_denied":response.status===429?"provider_throttled":"provider_http_error";
    if(!response.body)return response;
    const stream=response.body.getReader(),chunks=[],cancel=()=>{void stream.cancel().catch(()=>{});};
    child.addEventListener("abort",cancel,{once:true});
    try{for(;;){if(child.aborted)throw Error("GOOGLE_RAW_READER_ABORTED");const part=await stream.read();
      if(child.aborted)throw Error("GOOGLE_RAW_READER_ABORTED");if(part.done)break;
      bytes+=part.value.byteLength;if(bytes>l.maxBytes){limited=true;cancel();throw Error("GOOGLE_RAW_READER_BOUNDS");}chunks.push(part.value);}
     return new Response(Buffer.concat(chunks),{status:response.status,statusText:response.statusText,headers:response.headers});
    }finally{child.removeEventListener("abort",cancel);stream.releaseLock();}
   };
   reader=createRefreshGoogleIdentityReader({verified,database,tokenVault,environment:env,...scope,
    workStore:createRefreshWorkRepository(database),quotaStore:createSharedQuotaRepository(database),merchantId:c.merchantId,
    developerToken:env.GOOGLE_ADS_DEVELOPER_TOKEN,signal:child,now,readNow:()=>new Date(now()),fetchFn:boundedFetch,
    maxElapsedMs:l.maxElapsedMs,maxPages:l.maxPages,maxRows:l.maxRows,maxLinkPages:l.maxLinkPages,maxLinks:l.maxLinks,
    executionDeadlineAt:new Date(now()+l.maxElapsedMs).toISOString(),sourceStorage:{cipher,policy,limits:s}});
   const observation=await reader.readEvidence();stored=refreshGoogleSourceStorageContext(observation);
   if(child.aborted||stored?.status!=="committed"||observation.sourceStored!==true)throw Error("GOOGLE_RAW_READER_SOURCE_UNCONFIRMED");
   // Only after known commit: independently reload the exact receipt. Unknown
   // writes never enter this readback or a second write; they require inspection.
   const receipt=await createSourceEvidenceRepository(database).inspect({owner:stored.owner,attemptId:stored.attemptId,ordinal:0});
   if(child.aborted||canonicalSourceJson(receipt)!==canonicalSourceJson(stored.receipt))throw Error("GOOGLE_RAW_READER_READBACK_UNCONFIRMED");
   return Object.freeze({status:"stored",sourceStored:true,receiptVerified:true,recordCount:observation.native_source.records.length,
    empty:observation.native_source.records.length===0,responseBytes:bytes,receipt:Object.freeze({batchId:receipt.batchId,
     commitId:receipt.commitId,digest:receipt.digest}),...boundary});
  }});}catch(error){
   const source=stored??refreshGoogleSourceStorageContext(error)??refreshGoogleSourceStorageContext(reader);
   return Object.freeze({status:source?"unconfirmed":"stopped",sourceStored:source?.status==="committed"?true:source?null:false,
    receiptVerified:false,recordCount:null,empty:null,reason:limited?"response_limit":httpFailure??"capture_unconfirmed",...boundary});
  }finally{running=false;}
 },async close(){if(running)throw Error("GOOGLE_RAW_READER_BUSY");if(closed)return;closed=true;await database.close();}});
}
