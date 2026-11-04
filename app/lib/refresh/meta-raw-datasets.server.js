import {randomUUID} from "node:crypto";
import {buildMetaAdChannelInsightsUrl,buildMetaProductBreakdownInsightsUrl} from "../providers/meta-reporting.server.js";
import {inspectMetaAccessToken,META_GRAPH_VERSION,createMetaAppSecretProof} from "../providers/meta-graph.server.js";
import {parseMetaRawJson,projectMetaRawPage} from "../providers/meta-raw-projection.server.js";
import {createIdentityRuntimeAuthorityLoader} from "../providers/identity-runtime-authority.server.js";
import {createConfiguredSourceEvidenceCipher} from "../database/source-evidence-config.server.js";
import {createMetaSourcePostgresClient} from "../database/meta-source-postgres.server.js";
import {createRefreshWorkRepository} from "../database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../database/shared-quota-repository.server.js";
import {storeMetaRawDataset} from "../database/meta-dataset-source-store.server.js";
import {createRefreshMetaRawTransport} from "./quota-authority-binding.server.js";
import {isMetaBackgroundOwner} from "./meta-background-owner.server.js";
import {runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";

export const META_RAW_DATASETS=Object.freeze({account_performance:"ad_channel_daily_insights",product_performance:"ad_product_breakdown_daily_insights"});
const fail=code=>{throw Error(code);};
const boundary={mappingVerified:false,DatasetWritePerformed:false,authorizesActivation:false,catalogueIdentityVerified:false};
export function createMetaRawDatasetReader({environment,verified,tokenVault,execution,configuration,signal,now=Date.now,poolFactory,fetchFn=globalThis.fetch}){
 if(!isMetaBackgroundOwner(verified)||execution?.claim?.provider!=="meta")fail("META_RAW_OWNER_REQUIRED");
 const env={...environment},c=structuredClone(configuration),scope=structuredClone(execution),l=c.limits;
 const database=createMetaSourcePostgresClient({environment:env,poolFactory}),workStore=createRefreshWorkRepository(database),quotaStore=createSharedQuotaRepository(database);
 const cipher=createConfiguredSourceEvidenceCipher(env);
 let used=false,running=false,closed=false;
 return Object.freeze({async run(){
  if(used||closed)fail("META_RAW_EXECUTION_USED");used=true;running=true;
  const datasets=Object.fromEntries(Object.keys(META_RAW_DATASETS).map(k=>[k,{status:"not_attempted",recordCount:null,empty:null}]));
  let bytes=0,requests=0,rows=0,active=null,writeSent=false,writeKnown=false,providerFailure=null;
  try{return await runIdentityReadDeadline({signal,timeoutMs:l.maxElapsedMs,run:async child=>{
   const started=now(),check=()=>{if(child.aborted)fail("read_aborted");};
   const loader=createIdentityRuntimeAuthorityLoader({verified,database,tokenVault,provider:"meta",signal:child,now:()=>new Date(now())});
   const current=await loader.loadCurrent(),initial=await workStore.loadQuotaContext({...scope,provider:"meta"});check();
   if(!initial||initial.accountId!==current.account.id||current.account.id!==scope.claim.accountId||initial.apiVersion!==META_GRAPH_VERSION)fail("authority_changed");
   const guard=async()=>{check();await loader.loadCurrent();if(JSON.stringify(await workStore.loadQuotaContext({...scope,provider:"meta"}))!==JSON.stringify(initial))fail("authority_changed");check();};
   const transport=createRefreshMetaRawTransport({workStore,quotaStore,...scope,now,fetchFn:async(url,init)=>{
    check();if(++requests>l.maxRequests)fail("request_limit");
    const response=await fetchFn(url,{...init,signal:child,redirect:"error"});check();
    if(!response.ok)providerFailure=[401,403].includes(response.status)?"provider_permission_denied":response.status===429?"provider_throttled":"provider_http_error";
    const stream=response.body?.getReader();if(!stream)fail("response_invalid");const chunks=[];
    const cancel=()=>{void stream.cancel().catch(()=>{});};child.addEventListener("abort",cancel,{once:true});
    try{for(;;){check();const p=await stream.read();check();if(p.done)break;bytes+=p.value.byteLength;if(bytes>l.maxBytes){cancel();fail("response_limit");}chunks.push(p.value);}
     return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
    }finally{child.removeEventListener("abort",cancel);stream.releaseLock();}
   }});
   await guard();
   const permission=await inspectMetaAccessToken({config:{appId:env.META_APP_ID,appSecret:env.META_APP_SECRET,graphVersion:META_GRAPH_VERSION},
    accessToken:current.tokenSet.access_token,permissionProfile:"identity_v1",fetchFn:transport,now:()=>new Date(now())});
   await guard();
   const owner={workspaceId:verified.installationAuthority.workspaceId,installationId:current.installationId,generation:String(verified.installationAuthority.installGeneration),
    shopId:verified.identity.shop.shopId,shopDomain:verified.identity.shop.myshopifyDomain,provider:"meta",connectionId:current.connectionId,
    connectionVersion:String(current.connectionVersion),credentialId:current.credentialId,accountId:current.account.id,selectionEpoch:current.selectionEpoch};
   const checkPermission=()=>{if(Date.parse(permission.expiresAt)<=now())fail("permission_expired");};
   for(const [dataset,family] of Object.entries(META_RAW_DATASETS)){
    active=dataset;writeSent=false;writeKnown=false;let after=null;const pages=[],seen=new Set();
    for(let n=0;;n++){
     if(n>=l.maxPages)fail("page_limit");await guard();checkPermission();
     const build=dataset==="account_performance"?buildMetaAdChannelInsightsUrl:buildMetaProductBreakdownInsightsUrl;
     // Fixed existing builders. Never follow native paging.next (contains credentials).
     const url=new URL(build({adAccountId:current.account.id,dateWindow:{start:scope.window.from,end:scope.window.to},after,graphVersion:META_GRAPH_VERSION,includePromotedProductMetrics:true}));
     url.searchParams.set("appsecret_proof",createMetaAppSecretProof({accessToken:current.tokenSet.access_token,appSecret:env.META_APP_SECRET}));
     const response=await transport(url.toString(),{method:"GET",headers:{accept:"application/json",authorization:`Bearer ${current.tokenSet.access_token}`}});
     if(!response.ok)fail("provider_http_error");
     const body=parseMetaRawJson(await response.text());
     if(Object.hasOwn(body,"error")){providerFailure="provider_api_error";fail("provider_api_error");}
     const projected=projectMetaRawPage(body,{family,ordinal:n,accountId:current.account.id,window:scope.window,requestId:response.headers.get("x-fb-trace-id")});
     await guard();checkPermission();rows+=projected.page.records.length;if(rows>l.maxRows)fail("row_limit");pages.push(projected.page);
     if(projected.cursor===null)break;if(seen.has(projected.cursor))fail("cursor_loop");seen.add(projected.cursor);after=projected.cursor;
    }
    const count=pages.reduce((n,p)=>n+p.records.length,0);
    pages.unshift({family:"meta_permission_check",ordinal:0,records:[],selectedFields:["scopes","verifiedAt","expiresAt"],scopes:permission.scopes,verifiedAt:permission.verifiedAt,expiresAt:permission.expiresAt});
    await guard();checkPermission();writeSent=true;
    const receipt=await storeMetaRawDataset({database,owner,attemptId:randomUUID(),dataset,pages,complete:true,cipher,policy:c.sourcePolicy,limits:c.storageLimits,now:new Date(now()).toISOString(),onCommitted:()=>{writeKnown=true;},
     read:{jobId:scope.claim.id,fence:String(scope.claim.fence),window:scope.window,observedAt:scope.entitlementReceipt.observedAt,operationId:c.operationId,quotaContext:initial,
      completedAt:new Date(now()).toISOString(),deadlineAt:new Date(started+l.maxElapsedMs).toISOString(),permissionExpiresAt:permission.expiresAt}});
    await guard();checkPermission();datasets[dataset]={status:"stored",recordCount:count,empty:count===0,...receipt};
   }
   return {status:"stored",sourceStored:true,receiptVerified:true,contentVerified:true,recordCount:rows,empty:rows===0,datasets,responseBytes:bytes,...boundary};
  }});}catch(error){
   const permitted=new Set(["authority_changed","read_aborted","response_invalid","response_limit","request_limit","page_limit","row_limit","cursor_loop","permission_expired"]);
   const reason=providerFailure??(error?.code==="IDENTITY_READ_DEADLINE_EXCEEDED"?"read_deadline_exceeded":error?.code==="IDENTITY_READ_ABORTED"?"read_aborted":permitted.has(error?.message)?error.message:
    ["GOOGLE_RAW_RESPONSE_INVALID","META_RAW_RESPONSE_INVALID"].includes(error?.message)?"response_invalid":"capture_unconfirmed");
   if(active)datasets[active]={status:writeSent?"unconfirmed":"failed",reason,recordCount:null,empty:null};
   return {status:writeSent&&!writeKnown?"unconfirmed":"stopped",reason,sourceStored:writeSent&&!writeKnown?null:writeKnown||Object.values(datasets).some(v=>v.status==="stored"),
    receiptVerified:false,contentVerified:false,recordCount:null,empty:null,datasets,...boundary};
  }finally{running=false;}
 },async close(){if(running)fail("META_RAW_BUSY");if(closed)return;closed=true;await database.close();}});
}
