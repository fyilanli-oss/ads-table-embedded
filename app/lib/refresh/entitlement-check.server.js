import {reconcileShopifyAppPricingEntitlement} from "../shopify/app-pricing-entitlement.server.js";
import {refreshWorkIdentity} from "./work-stop-policy.server.js";

// Internal adapter only. No route, scheduler, service credential or automatic retry.
// authorizeRead must reserve the SHARED Partner-client quota, including foreground consumers.
export function createRefreshEntitlementVerifier({store,partnerApi,appId,authorizeRead,now,limits}) {
  if (!["loadRefreshInstallation","applyEntitlementSnapshot","isEntitlementCurrent"].every(k=>typeof store?.[k]==="function")
    || typeof partnerApi?.activeSubscription!=="function" || typeof authorizeRead!=="function" || typeof now!=="function"
    || !/^gid:\/\/shopify\/App\/[1-9][0-9]*$/.test(appId??"") || partnerApi.appId!==appId) throw new Error("REFRESH_ENTITLEMENT_INPUT_INVALID");
  for(const key of ["requestTimeoutMs","finishReserveMs","deadlineAt"])
    if(!Number.isSafeInteger(limits?.[key])||limits[key]<1) throw new Error("REFRESH_ENTITLEMENT_INPUT_INVALID");
  if(limits.requestTimeoutMs>2147483647) throw new Error("REFRESH_ENTITLEMENT_INPUT_INVALID");
  const configured=structuredClone(limits);
  return Object.freeze({
    async verify({claim:input}) {
      const claim=structuredClone(input);refreshWorkIdentity(claim,{claimRequired:true});
      let attempted=false,returned=false;
      const started=now();
      const left=()=>{const t=now();return Number.isSafeInteger(t)&&t>=started?configured.deadlineAt-t:-1;};
      try {
        if(!Number.isSafeInteger(started)||started<0||left()<configured.requestTimeoutMs+configured.finishReserveMs) return {status:"not_started"};
        const installation=await store.loadRefreshInstallation({claim});
        if(!installation || installation.workspaceId!==claim.workspaceId || String(installation.installGeneration)!==claim.installGeneration
          || installation.status!=="active") return {status:"not_current"};
        if(await authorizeRead({claim:structuredClone(claim)})!==true) return {status:"not_started"};
        const current=await store.loadRefreshInstallation({claim});
        if(!current || ["workspaceId","installGeneration","shopId","shopDomain","status"].some(k=>current[k]!==installation[k])) return {status:"not_current"};
        const observedAt=new Date(current.observedAt);
        if(Number.isNaN(observedAt.valueOf())) return {status:"unavailable",externalOutcome:"not_sent"};
        if(left()<configured.requestTimeoutMs+configured.finishReserveMs) return {status:"not_started"};
        const controller=new AbortController();let timer;
        const boundedApi={activeSubscription:async request=>{
          // This query path performs exactly one external read; no cache fallback.
          attempted=true;
          const read=Promise.resolve().then(()=>partnerApi.activeSubscription({...request,signal:controller.signal}))
            .then(payload=>{returned=true;return {kind:"returned",payload};},()=>({kind:"unknown"}));
          const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({kind:"unknown"}),configured.requestTimeoutMs);});
          let result;
          try {result=await Promise.race([read,timeout]);} finally {clearTimeout(timer);}
          if(result.kind!=="returned") {controller.abort();throw new Error("REFRESH_ENTITLEMENT_REQUEST_UNKNOWN");}
          return result.payload;
        }};
        const result=await reconcileShopifyAppPricingEntitlement({
          installation:{authority:"shopify_installation_verified",shopId:installation.shopId,shopDomain:installation.shopDomain,
            installGeneration:Number(installation.installGeneration)},
          appId,partnerApi:boundedApi,observedAt,
          repository:{applySnapshot:async snapshot=>{
            if(left()<configured.finishReserveMs) throw new Error("REFRESH_ENTITLEMENT_DEADLINE");
            return store.applyEntitlementSnapshot({claim,snapshot});
          }},
        });
        if(left()<configured.finishReserveMs) return {status:"unavailable",externalOutcome:"settled"};
        if(result.entitlementStatus==="subscription_required") return {status:"denied",externalOutcome:"settled"};
        const receipt={observedAt:observedAt.toISOString()};
        if(await store.isEntitlementCurrent({claim,receipt})!==true || left()<configured.finishReserveMs) return {status:"unavailable",externalOutcome:"settled"};
        return {status:"verified",receipt,externalOutcome:"settled"};
      } catch {return {status:"unavailable",externalOutcome:attempted?(returned?"settled":"unknown"):"not_sent"};}
    },
    async isCurrent({claim,receipt}) {
      try {return await store.isEntitlementCurrent({claim,receipt})===true;} catch {return false;}
    },
  });
}
