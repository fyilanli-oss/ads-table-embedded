import {readGoogleMerchantDiscoveryPlan,discoverGoogleMerchantLinks,renewGoogleMerchantCredential} from "../providers/google-merchant-discovery.server.js";
import {googleAdsRestFailureMetadata} from "../providers/google-ads-rest.server.js";
import {runIdentityReadDeadline} from "../providers/identity-read-deadline.server.js";
import {createIdentityAuthorityRepository} from "../database/identity-authority-repository.server.js";
import {createTokenVault} from "../oauth/token-vault.server.js";
import {inspectGoogleIdentityCredential} from "../oauth/google-identity-credential.server.js";
import {createGoogleServerRuntime} from "./google-server-runtime.server.js";
import {loadGoogleBackgroundOwner} from "./google-background-owner.server.js";

const fail=()=>{throw Error("GOOGLE_MERCHANT_SERVER_CONFIGURATION_REQUIRED");};
const reasons=new Set(["authority_required","authority_changed","stopped","response_invalid","response_limit","incomplete_response",
 "request_contract_invalid","configuration_required","renewal_not_allowed","renewal_write_unconfirmed"]);
export function readGoogleMerchantServerPlan(environment,now=Date.now()) {
 const p=readGoogleMerchantDiscoveryPlan(environment,now);
 if(p?.purpose==="renew_credential")fail();
 return p;
}

// Reuses the actual native reader/renewal and private database-owner capability.
// No browser caller, Merchant ID, job, source writer, scheduler or new SQL grant.
export function createGoogleMerchantServerExecution({environment,operationId,signal,now=Date.now,fetchFn=globalThis.fetch,runtimePoolFactory}={}) {
 if(typeof now!=="function"||typeof fetchFn!=="function"||signal!==undefined&&!(signal instanceof AbortSignal))fail();
 const env={...environment},p=readGoogleMerchantServerPlan(env,now());
 if(!p||p.operationId!==operationId||typeof env.GOOGLE_ADS_DEVELOPER_TOKEN!=="string"||!env.GOOGLE_ADS_DEVELOPER_TOKEN
  ||env.GOOGLE_ADS_DEVELOPER_TOKEN.length>256||/[\u0000-\u0020\u007f]/.test(env.GOOGLE_ADS_DEVELOPER_TOKEN))fail();
 const runtime=createGoogleServerRuntime({environment:env,poolFactory:runtimePoolFactory});
 let vault;try{vault=createTokenVault({database:runtime,environment:env,now:()=>new Date(now())});}
 catch{void runtime.close().catch(()=>{});fail();}
 const identity=createIdentityAuthorityRepository(runtime),owner={workspaceId:p.workspaceId,installGeneration:Number(p.installGeneration),shopId:p.shopId,shopDomain:p.shopDomain};
 let used=false,running=false,closed=false;
 async function close(){if(running)throw Error("GOOGLE_MERCHANT_SERVER_BUSY");if(closed)return;closed=true;await runtime.close();}
 return Object.freeze({async run(...args){
  if(args.length||used||closed)throw Error("GOOGLE_MERCHANT_SERVER_EXECUTION_USED");used=true;running=true;
  let result;
  try{result=await runIdentityReadDeadline({signal,timeoutMs:20000,run:async child=>{
   const guard=()=>{if(child.aborted||!Number.isSafeInteger(now())||now()>=Date.parse(p.expiresAt))throw Object.assign(Error(),{code:"stopped"});};
   const database={async query(sql,values){guard();const r=await runtime.query(sql,values);guard();return r;}};
   guard();const verified=await loadGoogleBackgroundOwner({database,owner});guard();
   const before=await identity.load({...owner,provider:"google_ads"});guard();
   if(!before||before.status!=="connected"||before.connectionId!==p.connectionId||before.connectionVersion!==p.connectionVersion
    ||before.credentialId!==p.credentialId||before.selectionEpoch!==p.selectionId||before.reportingAccountId!==p.accountId)
    throw Object.assign(Error(),{code:"authority_required"});
   const token=await vault.loadProviderTokenSet({credentialId:p.credentialId,installationAuthority:verified.installationAuthority,provider:"google_ads"});guard();
   let plan=p,committed=null,renewalAttempted=false;
   const tokenVault={async loadProviderTokenSet(v){guard();const r=await vault.loadProviderTokenSet(v);guard();return r;},async renewGoogleIdentityCredential(v){
    guard();if(renewalAttempted)throw Object.assign(Error(),{code:"renewal_write_unconfirmed"});renewalAttempted=true;
    committed=await vault.renewGoogleIdentityCredential(v);guard();return committed;
   }};
   if(inspectGoogleIdentityCredential(token,()=>new Date(now())).needsRefresh){
    await renewGoogleMerchantCredential({verified,database,tokenVault,environment:env,plan:p,signal:child,now,fetchFn});guard();
    if(!committed)throw Object.assign(Error(),{code:"renewal_write_unconfirmed"});
    plan=Object.freeze({...p,credentialId:committed.credentialId,connectionVersion:committed.version});
   }
   const links=await discoverGoogleMerchantLinks({verified,database,tokenVault,environment:env,plan,signal:child,now,fetchFn});guard();
   return {...links,credential_renewed:committed!==null};
  }});}catch(error){
   const code=error?.code;
   result={status:"stopped",reason:reasons.has(code)?code:googleAdsRestFailureMetadata(error)?"provider_error":"read_unconfirmed"};
  }finally{running=false;}
  try{await close();}catch{return {status:"stopped",reason:"close_unconfirmed"};}
  return result;
 },close});
}
