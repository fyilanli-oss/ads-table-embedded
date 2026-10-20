import {reconcileShopifyAppPricingEntitlement} from "../shopify/app-pricing-entitlement.server.js";
import {refreshWorkIdentity} from "./work-stop-policy.server.js";
import {createQuotaManagedClients,quotaManagedClientProvider} from "../providers/quota-managed-clients.server.js";
import {refreshQuotaWait,refreshQuotaWaitBoundary} from "./quota-work-wait.server.js";

// Internal adapter only. No route, scheduler, service credential or automatic retry.
// Legacy unbound adapters require authorizeRead. Managed native clients MUST omit it (one HTTP debit).
export function createRefreshEntitlementVerifier({store,partnerApi,appId,authorizeRead,now,limits}) {
  const managed=quotaManagedClientProvider(partnerApi)==="shopify_partner";
  if (!["loadRefreshInstallation","applyEntitlementSnapshot","isEntitlementCurrent"].every(k=>typeof store?.[k]==="function")
    || typeof partnerApi?.activeSubscription!=="function" || (managed?authorizeRead!==undefined:typeof authorizeRead!=="function") || typeof now!=="function"
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
        // Managed native HTTP already debits the shared quota: never also call the old reservation callback.
        if(!managed && await authorizeRead({claim:structuredClone(claim)})!==true) return {status:"not_started"};
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
            .then(payload=>{returned=true;return {kind:"returned",payload};},error=>{
              const wait=refreshQuotaWait(error,"entitlement",claim);
              return wait?{kind:"quota_wait",wait}:{kind:"unknown"};
            });
          const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({kind:"unknown"}),configured.requestTimeoutMs);});
          let result;
          try {result=await Promise.race([read,timeout]);} finally {clearTimeout(timer);}
          if(result.kind==="quota_wait") throw result.wait;
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
      } catch(error) {
        if(refreshQuotaWaitBoundary(error)==="entitlement") return error;
        return {status:"unavailable",externalOutcome:attempted?(returned?"settled":"unknown"):"not_sent"};
      }
    },
    async isCurrent({claim,receipt}) {
      try {return await store.isEntitlementCurrent({claim,receipt})===true;} catch {return false;}
    },
  });
}

// Explicit inactive composition. A fresh transport per verification prevents another job's
// request history or a first-boundary wait from being reused. No routes/credentials are configured here.
export function createQuotaRefreshEntitlementVerifier({store,appId,guard,resolveOperation,environment,fetchFn,now,limits,authorizeRead}) {
  if(authorizeRead!==undefined) throw new Error("REFRESH_ENTITLEMENT_DOUBLE_QUOTA_FORBIDDEN");
  return Object.freeze({
    async verify(context) {
      const partnerApi=createQuotaManagedClients({guard,resolveOperation,lane:"background",fetchFn}).shopify({environment});
      return createRefreshEntitlementVerifier({store,partnerApi,appId,now,limits}).verify(context);
    },
    async isCurrent({claim,receipt}) {
      try {return await store.isEntitlementCurrent({claim,receipt})===true;} catch {return false;}
    },
  });
}
