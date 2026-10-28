import {fixture,prewriteOwner} from "./shopify-order-fixture.js";
import {createShopifyOrderRangePlanner} from "../../app/lib/refresh/shopify-order-range-plan.server.js";
import {createShopifyOrderWorkReservations} from "../../app/lib/refresh/shopify-order-work-reservation.server.js";
import {createShopifyOrderEntitlementCheck} from "../../app/lib/refresh/shopify-order-entitlement.server.js";
import {createIndependentShopifyOrderReader} from "../../app/lib/refresh/shopify-order-admin-reader.server.js";
import {quotaRouteIdentity} from "../../app/lib/refresh/quota-scope-resolver.server.js";

export async function independentOrderFixture(){
  const f=fixture(),owner=prewriteOwner(),s={phase:"pre_request",requests:0,current:true,sql:[]};
  const partner={provider:"shopify_partner",clientScopeKey:"c".repeat(64),connectionScopeKey:"d".repeat(64),connectionEpoch:1,accountId:null,organizationId:"123",apiVersion:"2026-07"};
  const partnerKey=quotaRouteIdentity(partner,{provider:"shopify_partner",family:"partner_graphql",accountId:null,organizationId:"123",version:"2026-07",includes:[]}).routeKey;
  const database={async query(sql,args){s.sql.push({sql,args});
    if(sql.includes("reserve_shopify_order_work")){s.attempt=args[6];return {rows:[{result:{status:"reserved",attemptId:s.attempt,rangeKey:args[5],fence:9,cost:{requests:1,dbWrites:1,connections:1,rows:1000,bytes:1000000}}}]};}
    if(sql.includes("begin_shopify_order_entitlement")){s.phase="entitlement_intent";return {rows:[{result:{observedAt:new Date().toISOString(),quotaContext:partner}}]};}
    if(sql.includes("load_shopify_order_entitlement_context"))return {rows:[{result:partner}]};
    if(sql.includes("dispatch_shopify_order_entitlement")){s.phase="entitlement_dispatched";return {rows:[{result:true}]};}
    if(sql.includes("apply_shopify_order_entitlement")){s.phase="entitlement_observed";const snap=JSON.parse(args[8]);return {rows:[{result:{...snap,sourceObservedAt:snap.observedAt}}]};}
    if(sql.includes("shopify_order_entitlement_is_current"))return {rows:[{result:s.current}]};
    if(sql.includes("begin_shopify_order_read")){if(s.beginFalse)return {rows:[{result:null}]};s.phase="order_intent";s.caps=JSON.parse(args[10]);if(s.beginError)throw Error("private");return {rows:[{result:{...f.context}}]};}
    if(sql.includes("load_shopify_order_read_owner"))return {rows:[{result:s.current?{...owner,installationId:s.ownerId??owner.installationId}:null}]};
    if(sql.includes("load_shopify_order_read_context")){s.onContext?.();return {rows:[{result:s.current?{...f.context}:null}]};}
    if(sql.includes("dispatch_shopify_order_read")){s.requests++;s.phase="order_reading";if(s.dispatchError)throw Error("private");return {rows:[{result:s.current}]};}
    if(sql.includes("observe_shopify_order_read")){s.phase="order_observed";s.stats=JSON.parse(args[10]);if(s.observeError)throw Error("private");return {rows:[{result:s.current}]};}
    if(sql.includes("stop_shopify_order_read")){s.stopCount=(s.stopCount??0)+1;s.phase="stopped";s.stopReason=args[8];if(s.stopError)throw Error("private");
      return {rows:[{result:{recorded:true,reservationRetained:args[8]!=="quota_not_dispatched"||s.requests>0,adminRequests:s.requests}}]};}
    if(sql.includes("release_shopify_order_work"))return {rows:[{result:s.phase==="pre_request"}]};
    throw Error("UNEXPECTED_SQL");
  }};
  const quotaStore={resolveRoute:r=>r.provider==="shopify_partner"?Promise.resolve(partnerKey):f.config.quotaStore.resolveRoute(r),
    reserve:async r=>r.operationKey===partnerKey?{...r,status:"reserved",dispatchBeforeMs:Date.now()+10000,dispatchBudgetMs:10000}:f.config.quotaStore.reserve(r),
    settle:r=>r.operationKey===partnerKey?Promise.resolve(true):f.config.quotaStore.settle(r),
    stop:r=>r.operationKey===partnerKey?Promise.resolve(true):f.config.quotaStore.stop(r),recordFeedback:r=>f.config.quotaStore.recordFeedback(r)};
  const plan=await createShopifyOrderRangePlanner({expected:owner,database:f.config.database,
    policy:{anchorAt:"2026-10-01T00:00:00Z",cadenceMs:3600000,sliceMs:86400000,settleDelayMs:0,maxRanges:1,pageSize:1,includeOrderHistory:false},
    now:()=>new Date("2026-10-02T00:00:00Z")}).plan({fromInclusive:"2026-10-01T00:00:00Z"});
  const work=createShopifyOrderWorkReservations({database}),reservation=await work.reserve({plan,rangeKey:plan.ranges[0].key});
  const entitlementCheck=createShopifyOrderEntitlementCheck({reservations:work,quotaStore,now:Date.now,
    environment:{SHOPIFY_PARTNER_ORG_ID:"123",SHOPIFY_APP_GID:"gid://shopify/App/456",SHOPIFY_PARTNER_API_ACCESS_TOKEN:"synthetic"},
    limits:{requestTimeoutMs:1000,finishReserveMs:10,deadlineAt:Date.now()+20000},fetchFn:async()=>Response.json({data:{activeSubscription:{shop:{id:owner.shopId,myshopifyDomain:owner.shopDomain},
      billingPeriod:"EVERY_30_DAYS",cancelAtEndOfCycle:false,trialEndsAt:null,currentBillingCycle:{startTime:new Date(Date.now()-86400000).toISOString(),endTime:new Date(Date.now()+86400000).toISOString()},
      items:[{handle:"monthly",price:{active:false}}],pendingUpdate:null}}})});
  const verification=await entitlementCheck.verify({reservation});if(verification.status!=="verified")throw Error("fixture billing failed");s.sql=[];
  const options={entitlementCheck,verification,admin:f.config.verified.context.admin,sdkBridge:f.config.sdkBridge,quotaStore,limits:f.config.limits,timeoutMs:1000,fetchFn:f.config.fetchFn};
  return {f,s,owner,plan,options,verification,entitlementCheck,create:(extra={})=>createIndependentShopifyOrderReader({...options,...extra})};
}
