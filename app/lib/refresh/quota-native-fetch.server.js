// Quota at the actual HTTP boundary, not once per report/snapshot.
import {quotaResponseFeedback} from "./quota-response-feedback.server.js";
import {googleQuotaObservation} from "./google-quota-observation.server.js";
import {shopifyAdminIdentityFamily,shopifyAdminCostFeedback} from "./shopify-admin-identity-quota.server.js";
import {SHOPIFY_ADMIN_COST_UNIT} from "./shared-quota.server.js";
const controls=new WeakMap();
const managed=new WeakMap();
// Brand proves only this local transport construction, never authority or configured limits.
export function isQuotaManagedFetchForProvider(value,provider) {return managed.get(value)===provider;}
const metaIdentityFields = Object.freeze([
  ["identity_ad", "id,account_id,campaign_id,adset_id,creative"],
  ["identity_adset", "id,account_id,promoted_object"],
  ["identity_adset", "id,account_id,promoted_object,campaign_id"],
  ["identity_creative", "id,account_id,product_set_id"],
  ["identity_product_set", "id,product_catalog"],
  ["catalog_products", "id,retailer_id,retailer_product_group_id,product_catalog,product_feed"],
].map(([family, fields]) => Object.freeze([family, fields.split(",").sort().join(",")])));
function metaIdentityFamily(url, catalog, init) {
  const allowed = catalog ? ["fields", "appsecret_proof", "limit", "after"] : ["fields", "appsecret_proof"];
  if (init?.body != null || [...url.searchParams.keys()].some(k => !allowed.includes(k) || url.searchParams.getAll(k).length !== 1)) return null;
  const fields = (url.searchParams.get("fields") ?? "").split(",");
  if (fields.some(f => !/^[a-z_]+$/.test(f)) || new Set(fields).size !== fields.length
    || catalog && url.searchParams.get("limit") !== "100") return null;
  const key = fields.sort().join(","), selected = metaIdentityFields.find(([, expected]) => expected === key)?.[0];
  return catalog ? selected === "catalog_products" ? selected : null : selected === "catalog_products" ? null : selected;
}
function control(status,priorBoundaryAttempts=null) {
  const error=new Error(status==="waiting"?"SHARED_QUOTA_WAITING":"SHARED_QUOTA_NOT_DISPATCHED");
  controls.set(error,Object.freeze({status,boundaryExternalOutcome:"not_sent",priorBoundaryAttempts}));
  return error;
}
export function quotaBoundaryControl(error) {return controls.get(error)??null;}

function descriptor(provider,input,init) {
  if(typeof input!=="string"&&!(input instanceof URL)) throw control("not_configured");
  let url;
  try {url=new URL(input);} catch {throw control("not_configured");}
  const method=(init?.method??"GET").toUpperCase();
  if(url.protocol!=="https:"||url.username||url.password||url.hash) throw control("not_configured");
  const path=url.pathname.replace(/\/$/,"");
  let family,accountId=null,version=null,organizationId=null;
  if(provider==="shopify_partner"&&url.origin==="https://partners.shopify.com"&&method==="POST") {
    const match=path.match(/^\/([1-9][0-9]*)\/api\/(\d{4}-\d{2})\/graphql\.json$/);
    if(match){family="partner_graphql";version=match[2];organizationId=match[1];}
  } else if(provider==="shopify_admin"&&method==="POST"&&/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(url.hostname)&&url.port==="") {
    const match=path.match(/^\/admin\/api\/(\d{4}-(?:01|04|07|10))\/graphql\.json$/);
    if(match&&!url.search&&url.pathname===path) {
      family=shopifyAdminIdentityFamily(init?.body);version=match[1];accountId=url.hostname;
    }
  } else if(provider==="meta"&&url.origin==="https://graph.facebook.com") {
    const match=path.match(/^\/(v[0-9]+\.[0-9]+)\/(act_[0-9]+)\/insights$/);
    if(match&&method==="GET"){family=url.searchParams.get("breakdowns")==="product_id"?"product_insights":"insights";version=match[1];accountId=match[2];}
    const common=path.match(/^\/(v[0-9]+\.[0-9]+)\/(oauth\/access_token|debug_token|me\/adaccounts|me\/permissions)$/);
    if(common&&((common[2]==="me/permissions"&&method==="DELETE")||(common[2]!=="me/permissions"&&["GET","POST"].includes(method)))) {
      version=common[1];family=({"oauth/access_token":"token","debug_token":"token_debug","me/adaccounts":"account_discovery","me/permissions":"revoke"})[common[2]];
    }
    const identity = path.match(/^\/(v[0-9]+\.[0-9]+)\/[1-9][0-9]{0,29}(\/products)?$/);
    if (identity && method === "GET") {
      family = metaIdentityFamily(url, Boolean(identity[2]), init);
      version = identity[1];
      // Graph object/catalog IDs are NOT ad-account IDs. Current account/client scope
      // must still come from the trusted context loader and approved operation profile.
    }
  } else if(provider==="google_ads") {
    if(url.origin==="https://oauth2.googleapis.com"&&method==="POST"&&["/token","/revoke"].includes(path)) family=path==="/token"?"token":"revoke";
    if(url.origin==="https://googleads.googleapis.com") {
      const search=path.match(/^\/(v[0-9]+)\/customers\/([0-9]+)\/googleAds:search$/);
      const discovery=path.match(/^\/(v[0-9]+)\/customers:listAccessibleCustomers$/);
      if(search&&method==="POST"){family="reporting_query";version=search[1];accountId=search[2];}
      if(discovery&&method==="GET"){family="account_discovery";version=discovery[1];}
    }
    if(url.origin==="https://merchantapi.googleapis.com"&&method==="GET"&&init?.body==null) {
      const products=path.match(/^\/products\/v1\/accounts\/([1-9][0-9]{0,18})\/products$/);
      const queryOk=[...url.searchParams.keys()].every(k=>["pageSize","pageToken"].includes(k)&&url.searchParams.getAll(k).length===1);
      if(products&&BigInt(products[1])<=9223372036854775807n&&queryOk&&url.searchParams.get("pageSize")==="1000") {
        family="merchant_products";version="products/v1";accountId=products[1];
      }
    }
  } else if(provider==="klaviyo"&&url.origin==="https://a.klaviyo.com") {
    const families={"/api/metrics":["GET","metrics"],"/api/events":["GET","events"],"/api/accounts":["GET","account_discovery"],
      "/api/campaign-values-reports":["POST","campaign_values"],"/api/flow-values-reports":["POST","flow_values"],"/oauth/token":["POST","token"],"/oauth/revoke":["POST","revoke"]};
    if(families[path]?.[0]===method) family=families[path][1];
  }
  if(!family) throw control("not_configured");
  if(provider==="klaviyo"&&path.startsWith("/api/")) version=init.headers?.get?.("revision")??null;
  // include modifiers may have extra quotas. Never send filter/fields/query/body/token to resolver.
  if(provider==="klaviyo"&&(url.searchParams.getAll("include").length>1||[...url.searchParams.keys()].some(k=>k.startsWith("additional-fields")))) throw control("not_configured");
  const includes=provider==="klaviyo"?(url.searchParams.get("include")??"").split(",").filter(Boolean).sort():[];
  if(includes.some(v=>!/^[a-z][a-z0-9_.-]{0,63}$/.test(v))) throw control("not_configured");
  return Object.freeze({provider,family,accountId,organizationId,version,includes:Object.freeze([...new Set(includes)])});
}

export function createQuotaManagedFetch({provider,guard,resolveOperation,isDispatchCurrent,lane,fetchFn=globalThis.fetch}) {
  if(!["shopify_partner","shopify_admin","meta","google_ads","klaviyo"].includes(provider)||typeof guard?.execute!=="function"||typeof resolveOperation!=="function"
    ||!["interactive","background"].includes(lane)||typeof fetchFn!=="function"||managed.has(fetchFn)) throw new Error("QUOTA_NATIVE_TRANSPORT_INPUT_INVALID");
  let attempts=0,closed=false;
  const fetchManaged=async(input,init={})=>{
    if(closed) throw control("not_configured",attempts);
    // Copy mutable URL/header/form objects BEFORE awaiting resolver or quota persistence.
    let requestUrl,requestInit;
    try {
      if(typeof input!=="string"&&!(input instanceof URL)) throw Error();
      requestUrl=new URL(input).toString();
      if(init.body!=null&&typeof init.body!=="string"&&!(init.body instanceof URLSearchParams)) throw Error();
      requestInit={method:(init.method??"GET").toUpperCase(),headers:new Headers(init.headers),
        ...(init.body==null?{}:{body:init.body.toString()}),...(init.signal?{signal:init.signal}:{}),redirect:"error"};
    } catch {throw control("not_configured");}
    const metadata=descriptor(provider,requestUrl,requestInit);
    if(requestInit.signal?.aborted) throw control("not_sent");
    let operationKey;
    try {operationKey=await resolveOperation(metadata);} catch {throw control("not_configured");}
    if(!/^[a-f0-9]{64}$/.test(operationKey??"")) throw control("not_configured");
    if(closed||requestInit.signal?.aborted) throw control("not_sent",attempts);
    let response,rejected=false,quotaSignal=null,quotaObservation=null,adminPayload,costBudgetExceeded=false;
    let result;
    try {result=await guard.execute({operationKey,lane,...provider==="shopify_admin"?{requiredCostUnit:SHOPIFY_ADMIN_COST_UNIT}:{},
      beforeDispatch:async()=>{
        if(closed||requestInit.signal?.aborted) return false;
        const current=isDispatchCurrent?await isDispatchCurrent(metadata,operationKey):true;
        return current===true&&!closed&&!requestInit.signal?.aborted;
      },run:async(requestedCostCeiling)=>{
      // No silent redirect: credentials cannot move to another target or bypass a second debit.
      if(closed||requestInit.signal?.aborted) throw Error("QUOTA_NATIVE_DISPATCH_CLOSED");
      if(provider==="shopify_admin"&&(!Number.isSafeInteger(requestedCostCeiling)||requestedCostCeiling<1))throw Error("QUOTA_NATIVE_COST_BUDGET_REQUIRED");
      attempts++;
      response=await fetchFn(requestUrl,requestInit);
      if(!response||typeof response.ok!=="boolean"||typeof response.json!=="function") return {outcome:"unknown"};
      rejected=!response.ok;
      if((response.headers?.get?.("content-type")??"").includes("json")) {
        try {
          const payload=await response.clone().json();
          if(provider==="shopify_admin")adminPayload=payload;
          quotaObservation=googleQuotaObservation(metadata,response.status,payload);
          const errors=Array.isArray(payload?.errors)?payload.errors:[];
          rejected=rejected||Boolean(payload?.error)||errors.length>0;
          if(provider==="shopify_admin"&&payload&&Object.hasOwn(payload,"errors")&&!Array.isArray(payload.errors))rejected=true;
          // Only the documented Partner throttle shape can name a shared-quota signal here.
          // 401/403, mixed GraphQL errors, Google 429 and arbitrary header/JSON scope IDs cannot widen it.
          if(provider==="shopify_partner"&&[200,429].includes(response.status)&&!payload?.error&&errors.length>0
            &&errors.every(error=>String(error?.extensions?.code)==="429")) quotaSignal="shopify_partner_throttled";
        } catch {rejected=true;}
      }
      const feedback=provider==="shopify_admin"?shopifyAdminCostFeedback(response.status,adminPayload):quotaResponseFeedback(metadata,response);
      if(provider==="shopify_admin"&&["shopify_admin_cost_observed","shopify_admin_cost_partial"].includes(feedback.kind)) {
        costBudgetExceeded=feedback.requestedQueryCost>requestedCostCeiling;
        if(costBudgetExceeded){rejected=true;closed=true;}
      }
      // Admin success needs a complete native cost observation; missing/invalid is never zero.
      if(provider==="shopify_admin"&&feedback.kind!=="shopify_admin_cost_observed")rejected=true;
      return rejected?{outcome:"rejected",connectionFailure:[401,403].includes(response.status),quotaSignal,feedback,quotaObservation,
        ...costBudgetExceeded?{costBudgetExceeded:true}:{}}:{outcome:"success",value:response,feedback};
    }});} catch {throw new Error("QUOTA_NATIVE_TRANSPORT_UNAVAILABLE");}
    if(result?.status==="returned") return result.value;
    if(result?.status==="stopped"&&result.stopRecorded===true&&costBudgetExceeded)throw new Error("QUOTA_NATIVE_COST_BUDGET_EXCEEDED");
    // Keep native HTTP 401/403/429 handlers, but only AFTER the quota stop persists.
    // The native parser owns the unchanged response; its body never enters quota persistence.
    if(result?.status==="stopped"&&result.stopRecorded===true&&rejected&&response) {
      if(response.ok) throw new Error("QUOTA_NATIVE_PROVIDER_REJECTED");
      return response;
    }
    if(["waiting","not_configured","clock_invalid","already_reserved","not_sent"].includes(result?.status)) {
      // A first-boundary wait terminates this execution's transport, including pending concurrent entries.
      if(result.status==="waiting"&&attempts===0) closed=true;
      throw control(result.status,attempts);
    }
    // Unknown external execution must never be misclassified as a proven-not-sent wait.
    throw new Error("QUOTA_NATIVE_TRANSPORT_STOPPED");
  };
  managed.set(fetchManaged,provider);
  return fetchManaged;
}
