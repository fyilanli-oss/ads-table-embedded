import {shopifyOrderEntitlementBinding} from "./shopify-order-entitlement.server.js";
import {createQuotaScopeResolver} from "./quota-scope-resolver.server.js";
import {createQuotaManagedFetch,createQuotaReadExecution,quotaBoundaryControl} from "./quota-native-fetch.server.js";
import {createSharedQuotaGuard} from "./shared-quota.server.js";
import {isShopifyAdminIdentitySdkBridge,closeShopifyAdminOrderSdkClient} from "./shopify-admin-sdk-quota-bridge.server.js";
import {createShopifyOrderReadExecution} from "../shopify/order-collection.server.js";

const flags={workerAdmitted:false,authorizesDispatch:false,authorizesActivation:false,resumeAuthorized:false,reloadFirstPageAuthorized:false,checkpointAdvanced:false,persistable:false,DatasetWritePerformed:false};
const fail=()=>{throw Error("SHOPIFY_ORDER_ADMIN_INPUT_INVALID");};
const freeze=v=>{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};

// Inactive, installation-owned composition; no provider/account/day identity, SDK
// bootstrap/global hook mutation, session/token lookup, scheduler or Dataset writer.
export function createIndependentShopifyOrderReader({entitlementCheck,verification,admin,sdkBridge,quotaStore,limits,timeoutMs,signal,fetchFn=globalThis.fetch,...extra}={}){
  if(Object.keys(extra).length||!isShopifyAdminIdentitySdkBridge(sdkBridge)||typeof admin?.graphql!=="function"
    ||typeof fetchFn!=="function"||signal!==undefined&&!(signal instanceof AbortSignal))fail();
  const binding=shopifyOrderEntitlementBinding(entitlementCheck),preview=binding.peek(verification),caps=structuredClone(limits);
  const maxima={maxElapsedMs:600000,maxRequests:10000,maxRows:1000000,maxBytes:134217728,pageSize:100};
  if(!caps||Object.keys(caps).sort().join(",")!=="maxBytes,maxElapsedMs,maxRequests,maxRows,pageSize"
    ||Object.entries(maxima).some(([k,max])=>!Number.isSafeInteger(caps[k])||caps[k]<1||caps[k]>max)
    ||caps.pageSize!==preview.h.p.pageSize
    ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000||timeoutMs>caps.maxElapsedMs
    ||!["resolveRoute","reserve","settle","stop","recordFeedback"].every(k=>typeof quotaStore?.[k]==="function"))fail();
  // Costs come from the actual SQL reservation, retained in its genuine binding.
  if(!preview.h.cost||caps.maxRows>preview.h.cost.rows||caps.maxBytes>preview.h.cost.bytes)fail();
  const graphql=admin.graphql.bind(admin);let used=false;
  return Object.freeze({async readEvidence(...overrides){
    if(overrides.length||used)fail();used=true;
    const b=binding.take(verification),h=b.h,{database,now}=b;
    const o=h.p.owner,base=[o.installationId,o.workspaceId,o.installGeneration,o.shopId,o.shopDomain,h.p.key,h.attemptId,h.fence];
    const receipt=[{type:"timestamptz",value:b.receipt.observedAt},{type:"text",value:b.receipt.sourceHash}];
    let begun=false,client,handingOff=false;
    const started=now(),live=()=>{const n=now();return Number.isSafeInteger(n)&&n>=started&&b.deadlineAt-n>=b.finishReserveMs&&!signal?.aborted;};
    async function one(name,tail=[],withReceipt=true){
      const extras=[...(withReceipt?receipt:[]),...tail],types=["bigint","uuid","bigint","text","text","text","uuid","bigint",...extras.map(x=>x.type)];
      const r=await database.query(`select operations.${name}(${types.map((t,i)=>`$${i+1}::${t}`).join(",")}) as result`,[...base,...extras.map(x=>x.value)]);
      if(!Array.isArray(r?.rows)||r.rows.length!==1||!Object.hasOwn(r.rows[0],"result"))throw Error();return r.rows[0].result;
    }
    async function stop(reason,status){
      try{const r=await one("stop_shopify_order_read",[{type:"text",value:reason}],false);
        if(r?.recorded!==true||typeof r.reservationRetained!=="boolean"||!Number.isSafeInteger(r.adminRequests)||r.adminRequests<0)throw Error();
        return freeze({status,reason,rangeKey:h.p.key,attemptId:h.attemptId,...r,collection:null,...flags});
      }catch{return freeze({status:"needs_attention",reason:"order_stop_unconfirmed",rangeKey:h.p.key,attemptId:h.attemptId,reservationRetained:true,collection:null,...flags});}
    }
    try{
      if(!Number.isSafeInteger(started)||!live())return freeze({status:"not_current",reservationRetained:true,collection:null,...flags});
      const context=await one("begin_shopify_order_read",[{type:"jsonb",value:JSON.stringify(caps)},{type:"timestamptz",value:new Date(b.deadlineAt).toISOString()}]);
      if(context===null)return freeze({status:"not_current",reservationRetained:true,collection:null,...flags});
      begun=true;
      if(context.provider!=="shopify_admin"||context.accountId!==o.shopDomain||context.apiVersion!=="2026-10")throw Error();
      const pinned=JSON.stringify(context);
      async function load(){if(!live())return null;const ctx=await one("load_shopify_order_read_context");return live()&&JSON.stringify(ctx)===pinned?ctx:null;}
      const resolve=createQuotaScopeResolver({store:quotaStore,loadContext:async({provider})=>provider==="shopify_admin"?load():null});
      const transport=createQuotaManagedFetch({provider:"shopify_admin",lane:"background",readExecution:createQuotaReadExecution(),
        guard:createSharedQuotaGuard({store:quotaStore,now}),resolveOperation:resolve,isDispatchCurrent:async(metadata,key)=>await resolve(metadata)===key,
        fetchFn:async(input,init)=>{if(!live()||await one("dispatch_shopify_order_read")!==true||!live())throw Error("ORDER_DISPATCH_NOT_CURRENT");return fetchFn(input,init);}});
      const remaining=b.deadlineAt-now()-b.finishReserveMs;if(!Number.isSafeInteger(remaining)||remaining<1)throw Error();
      client=sdkBridge.wrapOrders({admin:{graphql},transport,signal,timeoutMs:Math.min(timeoutMs,remaining)});
      const execution=createShopifyOrderReadExecution({client,shop:{id:o.shopId,myshopifyDomain:o.shopDomain},
        scope:{workspace_id:o.workspaceId,installation_generation:o.installGeneration,installation_id:null,
          job:{source:"shopify_orders",attempt_id:h.attemptId,range_key:h.p.key,fence:h.fence}},
        range:h.p.range,limits:{...caps,maxElapsedMs:Math.min(caps.maxElapsedMs,remaining)},includeOrderHistory:h.p.includeOrderHistory,signal,
        loadInstallationOwner:async()=>{if(!live())return null;const owner=await one("load_shopify_order_read_owner");return live()&&owner?.installationId===o.installationId?owner:null;},
        checkCurrent:async()=>Boolean(await load())});
      const collection=await execution.readEvidence();
      if(!live())return stop("authority_changed","not_current");
      handingOff=true;
      if(await one("observe_shopify_order_read",[{type:"jsonb",value:JSON.stringify(collection.stats)}])!==true||!live())return stop("handoff_unconfirmed","needs_attention");
      return freeze({status:collection.journeyPagesComplete?"collected_not_durably_committed":"incomplete_not_durably_committed",collection,
        rangeKey:h.p.key,attemptId:h.attemptId,reservationRetained:true,...flags});
    }catch(error){
      if(!begun)return freeze({status:"needs_attention",reason:"order_intent_unconfirmed",rangeKey:h.p.key,attemptId:h.attemptId,reservationRetained:true,collection:null,...flags});
      if(quotaBoundaryControl(error)?.status==="waiting")return stop("quota_not_dispatched","quota_waiting");
      return stop(handingOff?"handoff_unconfirmed":"read_failed","needs_attention");
    }finally{if(client)closeShopifyAdminOrderSdkClient(client);}
  }});
}
