import {randomUUID} from "node:crypto";
import {KLAVIYO_REPORTING_API_REVISION} from "../providers/klaviyo-reporting.server.js";
import {collectKlaviyoRawDatasets} from "./klaviyo-raw-collection.server.js";
import {createIdentityRuntimeAuthorityLoader} from "../providers/identity-runtime-authority.server.js";
import {createConfiguredSourceEvidenceCipher} from "../database/source-evidence-config.server.js";
import {createKlaviyoSourcePostgresClient} from "../database/klaviyo-source-postgres.server.js";
import {createRefreshWorkRepository} from "../database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../database/shared-quota-repository.server.js";
import {storeKlaviyoRawDataset} from "../database/klaviyo-dataset-source-store.server.js";
import {createRefreshKlaviyoRawTransport} from "./quota-authority-binding.server.js";
import {isKlaviyoBackgroundOwner} from "./klaviyo-background-owner.server.js";
import {runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";

export const KLAVIYO_RAW_DATASETS=Object.freeze({configuration:"klaviyo_account",account_performance:"klaviyo_campaign_report",product_performance:"klaviyo_ordered_product_events"});
const fail=code=>{throw Error(code);};
const boundary={mappingVerified:false,DatasetWritePerformed:false,authorizesActivation:false,catalogueIdentityVerified:false};
export function createKlaviyoRawDatasetReader({environment,verified,tokenVault,execution,configuration,signal,now=Date.now,poolFactory,delay,pacerFactory,fetchFn=globalThis.fetch}){
 if(!isKlaviyoBackgroundOwner(verified)||execution?.claim?.provider!=="klaviyo")fail("KLAVIYO_RAW_OWNER_REQUIRED");
 const env={...environment},c=structuredClone(configuration),scope=structuredClone(execution),l=c.limits;
 const database=createKlaviyoSourcePostgresClient({environment:env,poolFactory}),workStore=createRefreshWorkRepository(database),quotaStore=createSharedQuotaRepository(database);
 const cipher=createConfiguredSourceEvidenceCipher(env);
 let used=false,running=false,closed=false;
 return Object.freeze({async run(){
  if(used||closed)fail("KLAVIYO_RAW_EXECUTION_USED");used=true;running=true;
  const datasets=Object.fromEntries(Object.keys(KLAVIYO_RAW_DATASETS).map(k=>[k,{status:"not_attempted",recordCount:null,empty:null}]));
  let bytes=0,requests=0,rows=0,active=null,writeSent=false,writeKnown=false,providerFailure=null;
  try{return await runIdentityReadDeadline({signal,timeoutMs:l.maxElapsedMs,run:async child=>{
   const started=now(),check=()=>{if(child.aborted)fail("read_aborted");};
   const loader=createIdentityRuntimeAuthorityLoader({verified,database,tokenVault,provider:"klaviyo",signal:child,now:()=>new Date(now())});
   const current=await loader.loadCurrent(),initial=await workStore.loadQuotaContext({...scope,provider:"klaviyo"});check();
   if(!initial||initial.accountId!==current.account.id||current.account.id!==scope.claim.accountId||initial.apiVersion!==KLAVIYO_REPORTING_API_REVISION)fail("authority_changed");
   const guard=async()=>{check();await loader.loadCurrent();if(JSON.stringify(await workStore.loadQuotaContext({...scope,provider:"klaviyo"}))!==JSON.stringify(initial))fail("authority_changed");check();};
   const transport=createRefreshKlaviyoRawTransport({workStore,quotaStore,...scope,now,fetchFn:async(url,init)=>{
    check();if(++requests>l.maxRequests)fail("request_limit");
    const response=await fetchFn(url,{...init,signal:child,redirect:"error"});check();
    if(!response.ok)providerFailure=[401,403].includes(response.status)?"provider_permission_denied":response.status===429?"provider_throttled":"provider_http_error";
    const stream=response.body?.getReader();if(!stream)fail("response_invalid");const chunks=[];
    const cancel=()=>{void stream.cancel().catch(()=>{});};child.addEventListener("abort",cancel,{once:true});
    try{for(;;){check();const p=await stream.read();check();if(p.done)break;bytes+=p.value.byteLength;if(bytes>l.maxBytes){cancel();fail("response_limit");}chunks.push(p.value);}
     return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
    }finally{child.removeEventListener("abort",cancel);stream.releaseLock();}
   }});
   if(Date.parse(current.tokenSet.expires_at)<=now()+l.maxElapsedMs+60000)fail("credential_refresh_required");
   const source=c.source;if(!source||source.provider!=="klaviyo"||source.accountId!==current.account.id)fail("authority_changed");
   const owner={workspaceId:verified.installationAuthority.workspaceId,installationId:current.installationId,generation:String(verified.installationAuthority.installGeneration),
    shopId:verified.identity.shop.shopId,shopDomain:verified.identity.shop.myshopifyDomain,provider:"klaviyo",connectionId:current.connectionId,
    connectionVersion:String(current.connectionVersion),credentialId:current.credentialId,accountId:current.account.id,selectionEpoch:current.selectionEpoch};
   await collectKlaviyoRawDatasets({accessToken:current.tokenSet.access_token,accountId:current.account.id,source,window:scope.window,limits:l,transport,guard,signal:child,now,delay,pacerFactory,
    onStartDataset:dataset=>{active=dataset;writeSent=false;writeKnown=false;},
    onDataset:async({dataset,pages,complete,coverage,recordCount})=>{
     active=dataset;writeSent=false;writeKnown=false;await guard();writeSent=true;
     const receipt=await storeKlaviyoRawDataset({database,owner,attemptId:randomUUID(),dataset,pages,complete,cipher,policy:c.sourcePolicy,limits:c.storageLimits,now:new Date(now()).toISOString(),onCommitted:()=>{writeKnown=true;},
      read:{jobId:scope.claim.id,fence:String(scope.claim.fence),window:scope.window,observedAt:scope.entitlementReceipt.observedAt,operationId:c.operationId,quotaContext:initial,
       completedAt:new Date(now()).toISOString(),deadlineAt:new Date(started+l.maxElapsedMs).toISOString(),coverage}});
     await guard();datasets[dataset]={status:complete?"stored":coverage.every(v=>v.state!=="present")?"unavailable":"partial",recordCount,empty:recordCount===null?null:recordCount===0,...receipt};
    }});
   const complete=Object.values(datasets).every(v=>v.status==="stored");
   rows=complete?Object.values(datasets).reduce((n,v)=>n+v.recordCount,0):null;
   return {status:complete?"stored":"partial",sourceStored:true,receiptVerified:true,contentVerified:true,recordCount:rows,empty:rows===null?null:rows===0,datasets,responseBytes:bytes,...boundary};
  }});}catch(error){
   const permitted=new Set(["authority_changed","read_aborted","response_invalid","response_limit","request_limit","page_limit","row_limit","cursor_loop","credential_refresh_required"]);
   const reason=providerFailure??(error?.code==="IDENTITY_RUNTIME_CREDENTIAL_REFRESH_REQUIRED"?"credential_refresh_required":error?.code==="IDENTITY_READ_DEADLINE_EXCEEDED"?"read_deadline_exceeded":error?.code==="IDENTITY_READ_ABORTED"?"read_aborted":permitted.has(error?.message)?error.message:
    ["GOOGLE_RAW_RESPONSE_INVALID","KLAVIYO_RAW_RESPONSE_INVALID"].includes(error?.message)?"response_invalid":"capture_unconfirmed");
   if(active)datasets[active]={status:writeSent?"unconfirmed":"failed",reason,recordCount:null,empty:null};
   return {status:writeSent&&!writeKnown?"unconfirmed":"stopped",reason,sourceStored:writeSent&&!writeKnown?null:writeKnown||Object.values(datasets).some(v=>v.receiptVerified===true),
    receiptVerified:false,contentVerified:false,recordCount:null,empty:null,datasets,...boundary};
  }finally{running=false;}
 },async close(){if(running)fail("KLAVIYO_RAW_BUSY");if(closed)return;closed=true;await database.close();}});
}
