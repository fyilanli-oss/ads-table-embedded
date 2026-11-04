import {randomUUID} from "node:crypto";
import {buildGoogleReportingQueries,GOOGLE_REPORTING_QUERY_FAMILIES} from "../providers/google-reporting.server.js";
import {createGoogleAdsRestClient} from "../providers/google-ads-rest.server.js";
import {GOOGLE_MERCHANT_LINK_QUERY} from "../providers/google-merchant-account-link.server.js";
import {readMerchantProductSourceSnapshot,takeMerchantSourcePages} from "../providers/google-product-identity-reader.server.js";
import {parseGoogleRawJson,projectGoogleRawPage,googleRawScalar} from "../providers/google-raw-projection.server.js";
import {createIdentityRuntimeAuthorityLoader} from "../providers/identity-runtime-authority.server.js";
import {createConfiguredSourceEvidenceCipher} from "../database/source-evidence-config.server.js";
import {createGoogleSourcePostgresClient} from "../database/google-source-postgres.server.js";
import {createRefreshWorkRepository} from "../database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../database/shared-quota-repository.server.js";
import {storeGoogleRawDataset} from "../database/google-dataset-source-store.server.js";
import {createRefreshGoogleRawTransport} from "./quota-authority-binding.server.js";
import {prepareGoogleRefreshCredential} from "./google-refresh-credential.server.js";
import {isGoogleBackgroundOwner} from "./google-background-owner.server.js";
import {runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";

export const GOOGLE_RAW_DATASETS=Object.freeze({
 account_performance:Object.freeze(GOOGLE_REPORTING_QUERY_FAMILIES.slice(0,9)),
 product_performance:Object.freeze(GOOGLE_REPORTING_QUERY_FAMILIES.slice(9)),
 merchant_identity:Object.freeze(["google_merchant_link","merchant_products"]),
});
const fail=code=>{throw Error(code);};
const safeReasons=new Set(["response_limit","page_limit","row_limit","request_limit","merchant_link_changed","merchant_target_not_linked","authority_changed","configuration_missing"]);
const boundary={mappingVerified:false,DatasetWritePerformed:false,authorizesActivation:false};

// Fixed three datasets, no caller query/family/URL selector and no report writes.
// Each completed dataset is committed independently, but one operation links all
// envelopes. A failure halts further native requests and never becomes zero.
export function createGoogleRawDatasetReader({environment,verified,tokenVault,execution,configuration,signal,now=Date.now,poolFactory,fetchFn=globalThis.fetch}) {
 if(!isGoogleBackgroundOwner(verified))fail("GOOGLE_RAW_DATASET_OWNER_REQUIRED");
 const c=structuredClone(configuration),env={...environment},scope=structuredClone(execution),l=c.limits;
 const database=createGoogleSourcePostgresClient({environment:env,poolFactory,datasetMode:true});
 const workStore=createRefreshWorkRepository(database),quotaStore=createSharedQuotaRepository(database),cipher=createConfiguredSourceEvidenceCipher(env);
 let used=false,running=false,closed=false;
 return Object.freeze({async run(){
  if(used||closed)fail("GOOGLE_RAW_DATASET_EXECUTION_USED");used=true;running=true;
  const datasets=Object.fromEntries(Object.keys(GOOGLE_RAW_DATASETS).map(k=>[k,{status:"not_attempted",recordCount:null,empty:null}]));
  let bytes=0,requests=0,totalRows=0,writeSent=false,writeKnown=false,activeDataset=null;
  try{return await runIdentityReadDeadline({signal,timeoutMs:l.maxElapsedMs,run:async child=>{
   const check=()=>{if(child.aborted)fail("stopped");};
   const transport=createRefreshGoogleRawTransport({workStore,quotaStore,...scope,now,fetchFn:async(url,init)=>{
    check();if(++requests>l.maxRequests)fail("request_limit");
    const response=await fetchFn(url,{...init,signal:child,redirect:"error"});check();
    const stream=response.body?.getReader();if(!stream)fail("response_invalid");const chunks=[];
    const cancel=()=>{void stream.cancel().catch(()=>{});};child.addEventListener("abort",cancel,{once:true});
    try{for(;;){check();const part=await stream.read();check();if(part.done)break;
      bytes+=part.value.byteLength;if(bytes>l.maxBytes){cancel();fail("response_limit");}chunks.push(part.value);}
     return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
    }finally{child.removeEventListener("abort",cancel);stream.releaseLock();}
   }});
   await prepareGoogleRefreshCredential({verified,database,tokenVault,workStore,execution:scope,environment:env,fetchFn:transport,signal:child,now,
    minimumValidityMs:l.maxElapsedMs+20000});check();
   const loader=createIdentityRuntimeAuthorityLoader({verified,database,tokenVault,provider:"google_ads",signal:child,now:()=>new Date(now())});
   const current=await loader.loadCurrent(),initial=await workStore.loadQuotaContext({...scope,provider:"google_ads"});check();
   if(!initial||initial.accountId!==scope.claim.accountId)fail("authority_changed");
   const guard=async()=>{check();await loader.loadCurrent();
    if(JSON.stringify(await workStore.loadQuotaContext({...scope,provider:"google_ads"}))!==JSON.stringify(initial))fail("authority_changed");check();};
   const owner={workspaceId:verified.installationAuthority.workspaceId,installationId:current.installationId,
    generation:String(verified.installationAuthority.installGeneration),shopId:verified.identity.shop.shopId,shopDomain:verified.identity.shop.myshopifyDomain,
    provider:"google_ads",connectionId:current.connectionId,connectionVersion:String(current.connectionVersion),credentialId:current.credentialId,
    accountId:current.account.id,selectionEpoch:current.selectionEpoch};
   const queries=buildGoogleReportingQueries({dateWindow:{start:scope.window.from,end:scope.window.to}});
   let active=null,captured=null,linkTotal=null;
   const client=createGoogleAdsRestClient({accessToken:current.tokenSet.access_token,developerToken:env.GOOGLE_ADS_DEVELOPER_TOKEN,
    loginCustomerId:current.account.login_account_id,fetchFn:async(url,init)=>{
     await guard();const response=await transport(url,{...init,signal:child});check();
     if(response.ok){const text=await response.text(),body=parseGoogleRawJson(text);
      if(active)captured=projectGoogleRawPage(body,{...active,accountId:current.account.id,requestId:response.headers.get("request-id")??response.headers.get("x-google-request-id")});
      else linkTotal=body.totalResultsCount===undefined?null:googleRawScalar(body.totalResultsCount);
      return new Response(text,{status:response.status,headers:response.headers});}
     return response;
   }});
   const save=async(dataset,pages,complete,reason=null)=>{
    await guard();const recordCount=pages.reduce((n,p)=>n+(p.records?.length??0),0);
    writeSent=true;writeKnown=false;
    const receipt=await storeGoogleRawDataset({database,owner,attemptId:randomUUID(),dataset,pages,complete,cipher,policy:c.sourcePolicy,limits:c.storageLimits,now:new Date(now()).toISOString(),onCommitted:()=>{writeKnown=true;},
     read:{jobId:scope.claim.id,fence:String(scope.claim.fence),window:scope.window,observedAt:scope.entitlementReceipt.observedAt,
      operationId:c.operationId,quotaContext:initial,completedAt:new Date(now()).toISOString(),deadlineAt:new Date(now()+Math.max(1,l.maxElapsedMs-(now()-started))).toISOString()}});
    writeKnown=true;await guard();
    datasets[dataset]={status:complete?"stored":"unavailable",reason,recordCount:complete?recordCount:null,empty:complete?recordCount===0:null,...receipt};
   };
   const started=now();
   for(const dataset of ["account_performance","product_performance"]){activeDataset=dataset;writeSent=false;writeKnown=false;const pages=[];
    for(const family of GOOGLE_RAW_DATASETS[dataset]){let cursor=null,queryRows=0,expectedTotal=null;const seen=new Set();
     for(let n=0;;n++){
      if(n>=l.maxPages)fail("page_limit");active={query:queries[family],family,ordinal:n};captured=null;
      const page=await client.search({customerId:current.account.id,query:queries[family],pageToken:cursor});await guard();
      if(!captured||captured.records.length!==page.results.length)fail("response_invalid");
      if(captured.selectedFields.includes("segments.date")&&page.results.some(r=>r.segments?.date!==scope.window.from))fail("response_invalid");
      totalRows+=captured.records.length;if(totalRows>l.maxRows)fail("row_limit");pages.push(captured);
      queryRows+=captured.records.length;
      if(captured.declaredTotal!==null){
       if(BigInt(captured.declaredTotal)>BigInt(l.maxRows))fail("row_limit");
       if(expectedTotal!==null&&expectedTotal!==captured.declaredTotal)fail("response_invalid");expectedTotal=captured.declaredTotal;
      }
      if(page.next_page_token===null||page.next_page_token===""){if(expectedTotal!==null&&BigInt(queryRows)!==BigInt(expectedTotal))fail("response_invalid");break;}
      if(seen.has(page.next_page_token))fail("page_limit");seen.add(page.next_page_token);cursor=page.next_page_token;
     }
    }
    active=null;await save(dataset,pages,true);
   }
   // Merchant discovery is a separate observation. No relationship is created,
   // no ID chosen automatically and no absent catalogue represented as zero.
   active=null;activeDataset="merchant_identity";writeSent=false;writeKnown=false;
   const links=async()=>{await guard();const page=await client.search({customerId:current.account.id,query:GOOGLE_MERCHANT_LINK_QUERY});await guard();
    if(page.next_page_token!==null&&page.next_page_token!==""||page.results.length>l.maxLinks)fail("page_limit");
    if(linkTotal!==null&&(!/^[0-9]{1,19}$/.test(linkTotal)||BigInt(linkTotal)!==BigInt(page.results.length)))fail("response_invalid");
    const names=new Set();const rows=page.results.map(r=>{const v=r.productLink,id=v?.productLinkId,merchant=v?.merchantCenter?.merchantCenterId;
     if(v?.type!=="MERCHANT_CENTER"||! /^[1-9][0-9]{0,18}$/.test(id??"")||! /^[1-9][0-9]{0,18}$/.test(merchant??"")
      ||v.resourceName!==`customers/${current.account.id}/productLinks/${id}`||names.has(v.resourceName))fail("response_invalid");names.add(v.resourceName);
     return {resourceName:v.resourceName,productLinkId:id,type:v.type,merchantCenter:{merchantCenterId:merchant}};});
    totalRows+=rows.length;if(totalRows>l.maxRows)fail("row_limit");return rows;};
   const before=await links(),pages=[{family:"google_merchant_link",ordinal:0,phase:"before",records:before,selectedFields:["product_link"]}];
   if(!c.merchant){
    pages.push({family:"google_merchant_status",ordinal:1,records:[],selectedFields:["catalogueState"],catalogueState:before.length?"merchant_context_required":"merchant_link_absent"});
    await save("merchant_identity",pages,false,before.length?"merchant_context_required":"merchant_link_absent");
   }else{
    if(Object.keys(c.merchant).some(k=>initial.merchant?.[k]!==c.merchant[k])||before.filter(r=>r.merchantCenter.merchantCenterId===c.merchant.targetAccountId).length!==1)fail("merchant_target_not_linked");
    const source=await readMerchantProductSourceSnapshot({merchantId:c.merchant.targetAccountId,accessToken:current.tokenSet.access_token,
     fetchFn:async(url,init)=>{await guard();const r=await transport(url,{...init,signal:child});await guard();
      if(!r.ok)return r;const text=await r.text();parseGoogleRawJson(text);return new Response(text,{status:r.status,headers:r.headers});},signal:child,maxPages:l.maxPages,maxRows:Math.max(1,l.maxRows-totalRows),captureSource:true});
    totalRows+=source.records.length;if(totalRows>l.maxRows)fail("row_limit");
    for(const p of takeMerchantSourcePages(source))pages.push({family:p.family,ordinal:pages.length,records:p.payload.records,selectedFields:["name","offerId","feedLabel","contentLanguage","dataSource","legacyLocal"]});
    const after=await links();if(JSON.stringify(before)!==JSON.stringify(after))fail("merchant_link_changed");
    pages.push({family:"google_merchant_link",ordinal:pages.length,phase:"after",records:after,selectedFields:["product_link"]});
    await save("merchant_identity",pages,true);
   }
   const complete=Object.values(datasets).every(v=>v.status==="stored");
   return {status:complete?"stored":"partial",sourceStored:true,receiptVerified:true,contentVerified:true,datasets,
    recordCount:complete?totalRows:null,empty:complete?totalRows===0:null,responseBytes:bytes,...boundary};
  }});}catch(error){
   if(activeDataset&&datasets[activeDataset].status==="not_attempted")datasets[activeDataset]={status:writeSent?"unconfirmed":"failed",recordCount:null,empty:null};
   return {status:writeSent&&!writeKnown?"unconfirmed":"stopped",reason:safeReasons.has(error?.message)?error.message:"capture_unconfirmed",
    sourceStored:writeSent&&!writeKnown?null:writeSent&&writeKnown||Object.values(datasets).some(v=>v.status==="stored"||v.status==="unavailable"),
    receiptVerified:false,contentVerified:false,recordCount:null,empty:null,datasets,...boundary};
  }finally{running=false;}
 },async close(){if(running)fail("GOOGLE_RAW_DATASET_BUSY");if(closed)return;closed=true;await database.close();}});
}
