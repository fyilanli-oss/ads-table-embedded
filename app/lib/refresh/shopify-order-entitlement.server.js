import {shopifyOrderWorkReservationBinding} from "./shopify-order-work-reservation.server.js";
import {createScopeResolvedQuotaClients} from "../providers/quota-managed-clients.server.js";
import {readShopifyPartnerRuntimeConfig} from "../shopify/partner-api.server.js";
import {reconcileShopifyAppPricingEntitlement} from "../shopify/app-pricing-entitlement.server.js";
import {quotaBoundaryControl} from "./quota-native-fetch.server.js";

const flags={workerAdmitted:false,authorizesDispatch:false,authorizesActivation:false,checkpointAdvanced:false,persistable:false,DatasetWritePerformed:false};
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const fail=()=>{throw Error("SHOPIFY_ORDER_ENTITLEMENT_INPUT_INVALID");};
// Explicit inactive native composition: no route/cron/Admin/Dataset reader or retry entry.
export function createShopifyOrderEntitlementCheck({reservations,quotaStore,environment,now,limits,fetchFn=globalThis.fetch,...extra}={}){
  if(Object.keys(extra).length||typeof now!=="function"||typeof fetchFn!=="function")fail();
  const binding=shopifyOrderWorkReservationBinding(reservations),database=binding.database;
  const env={...environment},config=readShopifyPartnerRuntimeConfig(env),bound=structuredClone(limits);
  for(const k of ["requestTimeoutMs","finishReserveMs","deadlineAt"])if(!Number.isSafeInteger(bound?.[k])||bound[k]<1)fail();
  if(bound.requestTimeoutMs>2147483647||!["resolveRoute","reserve","settle","stop","recordFeedback"].every(k=>typeof quotaStore?.[k]==="function"))fail();
  const verified=new WeakMap();
  const args=h=>[h.p.owner.installationId,h.p.owner.workspaceId,h.p.owner.installGeneration,h.p.owner.shopId,h.p.owner.shopDomain,h.p.key,h.attemptId,h.fence];
  async function one(name,h,tail=[]){
    const types=["bigint","uuid","bigint","text","text","text","uuid","bigint",...tail.map(x=>x.type)];
    const sql=`select operations.${name}(${types.map((t,i)=>`$${i+1}::${t}`).join(",")}) as result`;
    const r=await database.query(sql,[...args(h),...tail.map(x=>x.value)]);
    if(!Array.isArray(r?.rows)||r.rows.length!==1||!Object.hasOwn(r.rows[0],"result"))throw Error();return r.rows[0].result;
  }
  async function current(h,receipt){return await one("shopify_order_entitlement_is_current",h,[{type:"timestamptz",value:receipt.observedAt},{type:"text",value:receipt.sourceHash}])===true;}
  async function stop(h,reason,status){
    try{const r=await one("stop_shopify_order_entitlement",h,[{type:"text",value:reason}]);
      if(r?.recorded!==true||typeof r.reservationRetained!=="boolean")throw Error();
      return freeze({status,reason,attemptId:h.attemptId,rangeKey:h.p.key,stopRecorded:true,reservationRetained:r.reservationRetained,...flags,entitlementVerified:false});
    }catch{return freeze({status:"needs_attention",reason:"entitlement_stop_unconfirmed",attemptId:h.attemptId,rangeKey:h.p.key,stopRecorded:false,reservationRetained:true,...flags,entitlementVerified:false});}
  }
  return Object.freeze({async verify({reservation,...overrides}={}){
    if(Object.keys(overrides).length||!binding.has(reservation))fail();
    const started=now(),left=()=>{const t=now();return Number.isSafeInteger(t)&&t>=started?bound.deadlineAt-t:-1;};
    if(!Number.isSafeInteger(started)||started<0)fail();
    if(left()<bound.requestTimeoutMs+bound.finishReserveMs)return freeze({status:"not_started",reservationRetained:true,...flags,entitlementVerified:false});
    const h=binding.take(reservation);let intentConfirmed=false,sent=false,writeAttempted=false;
    try{
      const intent=await one("begin_shopify_order_entitlement",h);
      if(intent===null)return freeze({status:"not_current",attemptId:h.attemptId,rangeKey:h.p.key,reservationRetained:true,...flags,entitlementVerified:false});
      if(typeof intent?.observedAt!=="string"||!Number.isFinite(Date.parse(intent.observedAt))||intent.quotaContext?.provider!=="shopify_partner"
        ||intent.quotaContext.apiVersion!=="2026-07"||intent.quotaContext.organizationId!==config.organizationId)throw Error();
      intentConfirmed=true;
      if(left()<bound.requestTimeoutMs+bound.finishReserveMs)return stop(h,"entitlement_not_dispatched","not_started");
      const pinned=JSON.stringify(intent.quotaContext);
      const partnerApi=createScopeResolvedQuotaClients({store:quotaStore,now,lane:"background",
        loadContext:async({provider})=>{
          if(provider!=="shopify_partner"||left()<bound.finishReserveMs)return null;
          const ctx=await one("load_shopify_order_entitlement_context",h);
          return JSON.stringify(ctx)===pinned?ctx:null;
        },fetchFn:async(input,init)=>{
          if(left()<bound.finishReserveMs)throw Error("ORDER_ENTITLEMENT_DEADLINE");
          if(await one("dispatch_shopify_order_entitlement",h)!==true||left()<bound.finishReserveMs)throw Error("ORDER_ENTITLEMENT_DISPATCH_NOT_CURRENT");
          sent=true;return fetchFn(input,init);
        }}).shopify({environment:env});
      const controller=new AbortController();let timer;
      const result=await reconcileShopifyAppPricingEntitlement({
        installation:{authority:"shopify_installation_verified",shopId:h.p.owner.shopId,shopDomain:h.p.owner.shopDomain,installGeneration:h.p.owner.installGeneration},
        appId:config.appId,observedAt:new Date(intent.observedAt),
        partnerApi:{async activeSubscription(request){
          const read=Promise.resolve().then(()=>partnerApi.activeSubscription({...request,signal:controller.signal}));
          const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error("ORDER_ENTITLEMENT_TIMEOUT"));},bound.requestTimeoutMs);});
          try{return await Promise.race([read,timeout]);}finally{clearTimeout(timer);}
        }},repository:{async applySnapshot(snapshot){
          if(left()<bound.finishReserveMs)throw Error("ORDER_ENTITLEMENT_DEADLINE");
          writeAttempted=true;
          return one("apply_shopify_order_entitlement",h,[{type:"jsonb",value:JSON.stringify(snapshot)}]);
        }}
      });
      if(result.entitlementStatus==="subscription_required")return stop(h,"entitlement_denied","denied");
      const receipt={observedAt:new Date(result.sourceObservedAt).toISOString(),sourceHash:result.sourceHash};
      if(left()<bound.finishReserveMs||!await current(h,receipt)||left()<bound.finishReserveMs)return stop(h,"authority_changed","not_current");
      const outcome=freeze({status:"verified",attemptId:h.attemptId,rangeKey:h.p.key,receipt,reservationRetained:true,...flags,entitlementVerified:true});
      verified.set(outcome,{h,receipt,started});return outcome;
    }catch(error){
      if(!intentConfirmed)return freeze({status:"needs_attention",reason:"entitlement_intent_unconfirmed",attemptId:h.attemptId,rangeKey:h.p.key,reservationRetained:true,...flags,entitlementVerified:false});
      if(!sent&&quotaBoundaryControl(error))return stop(h,"entitlement_not_dispatched","not_dispatched");
      return stop(h,writeAttempted?"entitlement_write_unconfirmed":"entitlement_unknown","needs_attention");
    }
  },async isCurrent({verification,...overrides}={}){
    const v=verified.get(verification);if(Object.keys(overrides).length||!v)fail();
    const timely=()=>{const t=now();return Number.isSafeInteger(t)&&t>=v.started&&bound.deadlineAt-t>=bound.finishReserveMs;};
    try{return timely()&&await current(v.h,v.receipt)&&timely();}catch{return false;}
  }});
}
