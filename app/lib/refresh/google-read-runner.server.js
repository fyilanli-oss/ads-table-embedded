import {createGoogleSourcePostgresClient} from "../database/google-source-postgres.server.js";
import {createRefreshWorkRepository} from "../database/refresh-work-repository.server.js";
import {createSharedQuotaRepository} from "../database/shared-quota-repository.server.js";
import {createRefreshGoogleIdentityReader} from "./quota-authority-binding.server.js";
import {runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";
import {quotaBoundaryControl} from "./quota-native-fetch.server.js";
import {refreshWorkIdentity} from "./work-stop-policy.server.js";
import {permissionContext} from "../oauth/identity-permission-preflight.server.js";

const invalid=()=>{throw Error("GOOGLE_READ_RUNNER_CONFIGURATION_REQUIRED");};
const freeze=x=>Object.freeze(x);
const boundary=freeze({sourceStored:false,mappingVerified:false,DatasetWritePerformed:false,authorizesActivation:false});

// Dedicated trusted background entry for one ALREADY admitted job. It does not
// create/admit/finish jobs, install an SDK hook or publish reports.
// No source key, retention policy, parser rule or Merchant selector is introduced.
export function createGoogleReadRunner({environment,verified,tokenVault,execution,configuration,signal,
 now=Date.now,poolFactory,fetchFn=globalThis.fetch}={}){
 if(typeof now!=="function"||typeof fetchFn!=="function"||typeof tokenVault?.loadProviderTokenSet!=="function"
  ||signal!==undefined&&!(signal instanceof AbortSignal))invalid();
 let config,scope,env,caller,loadToken,renewToken;
 try{
  config=structuredClone(configuration);scope=structuredClone(execution);env={...environment};
  caller={installationAuthority:structuredClone(verified?.installationAuthority),identity:{
    session:{authority:verified?.identity?.session?.authority,shopDomain:verified?.identity?.session?.shopDomain},
    shop:{authority:verified?.identity?.shop?.authority,shopId:verified?.identity?.shop?.shopId,myshopifyDomain:verified?.identity?.shop?.myshopifyDomain}},
   context:{admin:{graphql:verified.context.admin.graphql.bind(verified.context.admin)}}};
  loadToken=tokenVault.loadProviderTokenSet.bind(tokenVault);
  renewToken=typeof tokenVault.renewGoogleIdentityCredential==="function"?tokenVault.renewGoogleIdentityCredential.bind(tokenVault):null;
  refreshWorkIdentity(scope.claim,{claimRequired:true});
  permissionContext({provider:"shopify",workspaceId:caller.installationAuthority.workspaceId,
   installGeneration:caller.installationAuthority.installGeneration,shopId:caller.identity.shop.shopId,shopDomain:caller.identity.shop.myshopifyDomain});
 }catch{invalid();}
 const l=config?.limits;
 if(!config||Object.keys(config).sort().join()!=="limits,merchantId"
  ||typeof config.merchantId!=="string"||! /^[1-9][0-9]{0,18}$/.test(config.merchantId)||BigInt(config.merchantId)>9223372036854775807n
  ||!scope||Object.keys(scope).sort().join()!=="claim,entitlementReceipt,window"||scope.claim?.provider!=="google_ads"
  ||caller.installationAuthority.authority!=="shopify_installation_verified"||caller.installationAuthority.status!=="active"
  ||caller.installationAuthority.workspaceId!==scope.claim.workspaceId||String(caller.installationAuthority.installGeneration)!==scope.claim.installGeneration
  ||caller.identity.session?.authority!=="shopify_id_token_verified"||caller.identity.shop?.authority!=="shopify_admin_verified"
  ||caller.identity.session.shopDomain!==caller.identity.shop.myshopifyDomain
  ||typeof scope.entitlementReceipt?.observedAt!=="string"||!Number.isFinite(Date.parse(scope.entitlementReceipt.observedAt))
  ||scope.window?.from!==scope.window?.to||typeof scope.window?.from!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(scope.window.from)
  ||!Number.isFinite(Date.parse(scope.window.from))||new Date(scope.window.from).toISOString().slice(0,10)!==scope.window.from
  ||!l||Object.keys(l).sort().join()!=="maxBytes,maxElapsedMs,maxLinkPages,maxLinks,maxPages,maxRows"
  ||Object.values(l).some(x=>!Number.isSafeInteger(x)||x<1)||l.maxBytes>16777216||l.maxElapsedMs>120000
  ||["maxLinkPages","maxLinks","maxPages","maxRows"].some(k=>l[k]>1000)
  ||typeof env.GOOGLE_ADS_DEVELOPER_TOKEN!=="string"||!env.GOOGLE_ADS_DEVELOPER_TOKEN||env.GOOGLE_ADS_DEVELOPER_TOKEN.length>256
  ||/[\u0000-\u0020\u007f]/.test(env.GOOGLE_ADS_DEVELOPER_TOKEN))invalid();
 const database=createGoogleSourcePostgresClient({environment:env,poolFactory});
 const workStore=createRefreshWorkRepository(database),quotaStore=createSharedQuotaRepository(database);
 let used=false,running=false,closed=false;
 return freeze({
  async run(...args){
   if(args.length||used||closed)throw Error("GOOGLE_READ_RUNNER_EXECUTION_USED");
   used=true;running=true;let bytes=0,limited=false,httpFailure=null;
   try{return await runIdentityReadDeadline({signal,timeoutMs:l.maxElapsedMs,run:async child=>{
    const started=now();
    const checkTime=()=>{const t=now();if(child.aborted||!Number.isSafeInteger(started)||!Number.isSafeInteger(t)||started<0||t<started||t-started>=l.maxElapsedMs)throw Error("IDENTITY_READ_DEADLINE_EXCEEDED");};
    checkTime();
    const initial=await workStore.loadQuotaContext({...scope,provider:"google_ads"});
    if(child.aborted||!initial||initial.accountId!==scope.claim.accountId||initial.merchant?.targetAccountId!==config.merchantId)
     throw Error("GOOGLE_READ_RUNNER_AUTHORITY_REQUIRED");
    // Bound the aggregate decoded response stream before JSON parsing/cloning.
    // The quota adapter still receives the original HTTP status and headers.
    const boundedFetch=async(input,init)=>{
     if(child.aborted)throw Error("GOOGLE_READ_RUNNER_ABORTED");
     const response=await fetchFn(input,init);
     if(child.aborted)throw Error("GOOGLE_READ_RUNNER_ABORTED");
     if(!(response instanceof Response))throw Error("GOOGLE_READ_RUNNER_RESPONSE_INVALID");
     if(!response.ok&&httpFailure===null)httpFailure=[401,403].includes(response.status)?"provider_permission_denied":response.status===429?"provider_throttled":"provider_http_error";
     if(!response.body)return response;
     const reader=response.body.getReader(),chunks=[];
     const cancel=()=>{void reader.cancel().catch(()=>{});};
     child.addEventListener("abort",cancel,{once:true});
     try{
      for(;;){
       if(child.aborted)throw Error("GOOGLE_READ_RUNNER_ABORTED");
       const part=await reader.read();if(part.done)break;
       bytes+=part.value.byteLength;
       if(bytes>l.maxBytes){limited=true;cancel();throw Error("GOOGLE_READ_RUNNER_RESPONSE_LIMIT");}
       chunks.push(part.value);
      }
      if(child.aborted)throw Error("GOOGLE_READ_RUNNER_ABORTED");
      return new Response(Buffer.concat(chunks),{status:response.status,statusText:response.statusText,headers:response.headers});
     }finally{child.removeEventListener("abort",cancel);reader.releaseLock();}
    };
    const reader=createRefreshGoogleIdentityReader({verified:caller,database,
     tokenVault:freeze({loadProviderTokenSet:loadToken,
      ...renewToken?{renewGoogleIdentityCredential:renewToken}:{}}),environment:env,
     ...scope,merchantId:config.merchantId,developerToken:env.GOOGLE_ADS_DEVELOPER_TOKEN,
     workStore,quotaStore,signal:child,now,readNow:()=>new Date(now()),fetchFn:boundedFetch,
     maxElapsedMs:l.maxElapsedMs,maxPages:l.maxPages,maxRows:l.maxRows,maxLinkPages:l.maxLinkPages,maxLinks:l.maxLinks});
    const observation=await reader.readEvidence();
    const current=await workStore.loadQuotaContext({...scope,provider:"google_ads"});
    checkTime();
    if(child.aborted||JSON.stringify(initial)!==JSON.stringify(current))throw Error("GOOGLE_READ_RUNNER_AUTHORITY_CHANGED");
    const source=observation?.native_source;
    if(observation.provider!=="google_ads"||observation.account_id!==scope.claim.accountId||observation.merchant_id!==config.merchantId
     ||observation.provider_link_verified!==true||source?.complete!==true||!Array.isArray(source.records)
     ||source.records.length>l.maxRows||!Number.isSafeInteger(source.pages)||source.pages<1||source.pages>l.maxPages)
     throw Error("GOOGLE_READ_RUNNER_RESULT_INVALID");
    return freeze({status:"read_complete",provider:"google_ads",recordCount:source.records.length,empty:source.records.length===0,
     pages:source.pages,responseBytes:bytes,completedAt:observation.link_evidence.completed_at,...boundary});
   }});}catch(error){
    const control=quotaBoundaryControl(error);
    const reason=limited?"response_limit":httpFailure??(control?"quota_"+control.status:
     ["GOOGLE_READ_RUNNER_AUTHORITY_REQUIRED","GOOGLE_READ_RUNNER_AUTHORITY_CHANGED","GOOGLE_READ_RUNNER_RESULT_INVALID",
      "IDENTITY_READ_ABORTED","IDENTITY_READ_DEADLINE_EXCEEDED"].includes(error?.message)?error.message:"read_not_confirmed");
    return freeze({status:"read_stopped",provider:"google_ads",recordCount:null,empty:null,reason,...boundary});
   }finally{running=false;}
  },
  async close(){if(running)throw Error("GOOGLE_READ_RUNNER_BUSY");if(closed)return;closed=true;await database.close();},
 });
}
