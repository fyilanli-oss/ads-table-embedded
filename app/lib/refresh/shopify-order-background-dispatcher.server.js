import {createHash} from "node:crypto";
import {shopifyApi,ApiVersion,LogSeverity,Session} from "@shopify/shopify-api";
import {readShopifyAppRuntimeConfig} from "../shopify/shopify-app-config.server.js";
import {createEncryptedShopifySessionStorage} from "../shopify/encrypted-session-storage.server.js";
import {readShopifyPartnerRuntimeConfig} from "../shopify/partner-api.server.js";
import {createShopifyOrderWorkReservations,shopifyOrderWorkReservationBinding} from "./shopify-order-work-reservation.server.js";
import {createShopifyOrderEntitlementCheck,shopifyOrderEntitlementBinding} from "./shopify-order-entitlement.server.js";
import {createIndependentShopifyOrderReader} from "./shopify-order-admin-reader.server.js";
import {initializeShopifyAdminRefreshSdk,getShopifyAdminRefreshSdkBridge} from "./shopify-admin-sdk-bootstrap.server.js";
import {isShopifyAdminIdentitySdkBridge} from "./shopify-admin-sdk-quota-bridge.server.js";

const fail=()=>{throw Error("SHOPIFY_ORDER_DISPATCH_INPUT_INVALID");};
const flags={authorizesActivation:false,checkpointAdvanced:false,persistable:false,DatasetWritePerformed:false,
  resumeAuthorized:false,reloadFirstPageAuthorized:false};
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const integer=(v,max)=>Number.isSafeInteger(v)&&v>0&&v<=max;

// Explicit composition for a dedicated background process. Importing does not install
// hooks, load sessions, create connections, start a timer, or dispatch work. The SDK
// node adapter must already be installed, as required by the existing bootstrap.
export function initializeShopifyOrderBackgroundHost(options){
  if(!options||Object.hasOwn(options,"sdkBridge"))fail();
  const bridge=initializeShopifyAdminRefreshSdk();
  return createShopifyOrderBackgroundDispatcher({...options,sdkBridge:bridge,checkHost:()=>getShopifyAdminRefreshSdkBridge()===bridge});
}

export function createShopifyOrderBackgroundDispatcher({database,sessionDatabase,quotaStore,environment,now,
  sdkBridge,limits,fetchFn=globalThis.fetch,signal,checkHost=()=>true,...extra}={}){
  if(Object.keys(extra).length||typeof now!=="function"||typeof fetchFn!=="function"||typeof checkHost!=="function"
    ||!isShopifyAdminIdentitySdkBridge(sdkBridge)||typeof sessionDatabase?.query!=="function"
    ||signal!==undefined&&!(signal instanceof AbortSignal))fail();
  const caps=structuredClone(limits),env={...environment};
  const maxima={maxJobs:100,maxCandidates:100,maxElapsedMs:600000,jobTimeoutMs:600000,requestTimeoutMs:600000,finishReserveMs:600000};
  if(!caps||Object.keys(caps).sort().join(",")!=="collection,finishReserveMs,jobTimeoutMs,maxCandidates,maxElapsedMs,maxJobs,requestTimeoutMs"
    ||Object.entries(maxima).some(([k,max])=>!integer(caps[k],max))
    ||caps.requestTimeoutMs+caps.finishReserveMs>=caps.jobTimeoutMs||caps.jobTimeoutMs>caps.maxElapsedMs)fail();
  const cm={maxElapsedMs:600000,maxRequests:10000,maxRows:1000000,maxBytes:134217728,pageSize:100};
  if(!caps.collection||Object.keys(caps.collection).sort().join(",")!==Object.keys(cm).sort().join(",")
    ||Object.entries(cm).some(([k,max])=>!integer(caps.collection[k],max))||caps.requestTimeoutMs>caps.collection.maxElapsedMs)fail();
  if(!["resolveRoute","reserve","settle","stop","recordFeedback"].every(k=>typeof quotaStore?.[k]==="function"))fail();
  const config=readShopifyAppRuntimeConfig(env);
  readShopifyPartnerRuntimeConfig(env);
  const sessions=createEncryptedShopifySessionStorage({database:sessionDatabase,environment:env});
  const api=shopifyApi({apiKey:config.apiKey,apiSecretKey:config.apiSecretKey,hostName:new URL(config.appUrl).hostname,
    scopes:config.scopes,apiVersion:ApiVersion.October26,isEmbeddedApp:true,logger:{level:LogSeverity.Error,log:()=>{}}});
  const work=createShopifyOrderWorkReservations({database}),binding=shopifyOrderWorkReservationBinding(work);
  const lifetime=new AbortController(),abort=AbortSignal.any([lifetime.signal,signal].filter(Boolean));
  let busy=false,closed=false;
  function sessionFingerprint(session,owner){
    const at=now();
    if(!Number.isSafeInteger(at)||!(session instanceof Session)||session.id!==`offline_${owner.shopDomain}`
      ||session.shop!==owner.shopDomain||session.isOnline!==false||typeof session.accessToken!=="string"||!session.accessToken
      ||session.expires!==undefined&&(!(session.expires instanceof Date)||!Number.isFinite(session.expires.getTime())||session.expires.getTime()<=at))
      throw Error("SHOPIFY_ORDER_OFFLINE_SESSION_UNAVAILABLE");
    // Kept privately only; neither plaintext token nor fingerprint is returned/logged.
    return createHash("sha256").update(JSON.stringify(session.toPropertyArray(true))).digest("hex");
  }
  return Object.freeze({close(...args){if(args.length)fail();closed=true;lifetime.abort();},async runBatch(...args){
    if(args.length||busy||closed)fail();busy=true;
    const results=[],excluded=[],started=now();let last=started,terminal="batch_limit";
    const current=()=>{try{const at=now();const ok=Number.isSafeInteger(at)&&Number.isSafeInteger(started)&&at>=last&&at>=started
      &&at-started<caps.maxElapsedMs&&!closed&&!abort.aborted&&checkHost()===true;last=at;return ok;}catch{return false;}};
    try{
      if(!Number.isSafeInteger(started)||started<0)fail();
      while(results.length<caps.maxJobs){
        if(!current()){terminal="stopped";break;}
        // Do not reserve work without enough time for its fresh entitlement check.
        if(started+caps.maxElapsedMs-now()<=caps.requestTimeoutMs+caps.finishReserveMs){terminal="deadline";break;}
        const reservation=await work.reserveNext({maxCandidates:caps.maxCandidates,excludeWorkspaceIds:excluded});
        if(reservation.status!=="reserved"){
          terminal=reservation.status;results.push(reservation);break;
        }
        const h=binding.peek(reservation),owner=h.p.owner;excluded.push(owner.workspaceId);
        if(!current()){
          results.push(await work.releaseBeforeRequest({reservation}));terminal="stopped";break;
        }
        if(caps.collection.pageSize!==h.p.pageSize||caps.collection.maxRows>h.cost.rows||caps.collection.maxBytes>h.cost.bytes){
          results.push({...await work.releaseBeforeRequest({reservation}),reason:"collection_limits_outside_reservation"});
          terminal="configuration_required";break;
        }
        const deadlineAt=Math.min(started+caps.maxElapsedMs,now()+caps.jobTimeoutMs);
        const checker=createShopifyOrderEntitlementCheck({reservations:work,quotaStore,environment:env,now,signal:abort,
          limits:{requestTimeoutMs:caps.requestTimeoutMs,finishReserveMs:caps.finishReserveMs,deadlineAt},fetchFn});
        const verified=await checker.verify({reservation});
        if(verified.status!=="verified"){
          results.push(verified);terminal=verified.status;
          // First provider/unknown outcome ends this batch; no retry or other-shop fallback.
          break;
        }
        try{
          const b=shopifyOrderEntitlementBinding(checker).peek(verified);
          const live=async()=>current()&&await checker.isCurrent({verification:verified})&&current();
          if(!await live())throw Error();
          const sessionId=`offline_${b.h.p.owner.shopDomain}`,session=await sessions.loadSession(sessionId);
          if(!await live())throw Error();
          const fingerprint=sessionFingerprint(session,owner);
          async function sessionCurrent(){
            if(!await live())throw Error();
            const latest=await sessions.loadSession(sessionId);
            if(sessionFingerprint(latest,owner)!==fingerprint||!await live())throw Error();
          }
          const admin={async graphql(query,options){
            await sessionCurrent();
            const client=new api.clients.Graphql({session});
            const response=await client.request(query,{variables:options.variables,retries:0,signal:options.signal});
            // Same response representation used by the pinned React Router SDK.
            return new Response(JSON.stringify(response));
          }};
          const reader=createIndependentShopifyOrderReader({entitlementCheck:checker,verification:verified,admin,sdkBridge,quotaStore,
            limits:caps.collection,timeoutMs:caps.requestTimeoutMs,signal:abort,fetchFn:async(input,init)=>{
              await sessionCurrent();const response=await fetchFn(input,init);await sessionCurrent();return response;
            }});
          const result=await reader.readEvidence();
          results.push(result);
          if(!["collected_not_durably_committed","incomplete_not_durably_committed"].includes(result.status)){
            terminal=result.status;break;
          }
        }catch{
          results.push(freeze({status:"needs_attention",reason:"background_session_or_authority_unavailable",
            attemptId:reservation.attemptId,rangeKey:reservation.rangeKey,reservationRetained:true,collection:null,...flags}));
          terminal="needs_attention";break;
        }
      }
      return freeze({status:terminal,results,...flags});
    }finally{busy=false;}
  }});
}
