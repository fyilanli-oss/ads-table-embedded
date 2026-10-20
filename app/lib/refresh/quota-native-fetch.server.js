// Quota at the actual HTTP boundary, not once per report/snapshot.
const controls=new WeakMap();
const managed=new WeakSet();
function control(status) {
  const error=new Error(status==="waiting"?"SHARED_QUOTA_WAITING":"SHARED_QUOTA_NOT_DISPATCHED");
  controls.set(error,Object.freeze({status,boundaryExternalOutcome:"not_sent"}));
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
  } else if(provider==="meta"&&url.origin==="https://graph.facebook.com") {
    const match=path.match(/^\/(v[0-9]+\.[0-9]+)\/(act_[0-9]+)\/insights$/);
    if(match&&method==="GET"){family=url.searchParams.get("breakdowns")==="product_id"?"product_insights":"insights";version=match[1];accountId=match[2];}
    const common=path.match(/^\/(v[0-9]+\.[0-9]+)\/(oauth\/access_token|debug_token|me\/adaccounts|me\/permissions)$/);
    if(common&&((common[2]==="me/permissions"&&method==="DELETE")||(common[2]!=="me/permissions"&&["GET","POST"].includes(method)))) {
      version=common[1];family=({"oauth/access_token":"token","debug_token":"token_debug","me/adaccounts":"account_discovery","me/permissions":"revoke"})[common[2]];
    }
  } else if(provider==="google_ads") {
    if(url.origin==="https://oauth2.googleapis.com"&&method==="POST"&&["/token","/revoke"].includes(path)) family=path==="/token"?"token":"revoke";
    if(url.origin==="https://googleads.googleapis.com") {
      const search=path.match(/^\/(v[0-9]+)\/customers\/([0-9]+)\/googleAds:search$/);
      const discovery=path.match(/^\/(v[0-9]+)\/customers:listAccessibleCustomers$/);
      if(search&&method==="POST"){family="reporting_query";version=search[1];accountId=search[2];}
      if(discovery&&method==="GET"){family="account_discovery";version=discovery[1];}
    }
  } else if(provider==="klaviyo"&&url.origin==="https://a.klaviyo.com") {
    const families={"/api/metrics":["GET","metrics"],"/api/events":["GET","events"],"/api/accounts":["GET","account_discovery"],
      "/api/campaign-values-reports":["POST","campaign_values"],"/api/flow-values-reports":["POST","flow_values"],"/oauth/token":["POST","token"],"/oauth/revoke":["POST","revoke"]};
    if(families[path]?.[0]===method) family=families[path][1];
  }
  if(!family) throw control("not_configured");
  // include modifiers may have extra quotas. Never send filter/fields/query/body/token to resolver.
  if(provider==="klaviyo"&&(url.searchParams.getAll("include").length>1||[...url.searchParams.keys()].some(k=>k.startsWith("additional-fields")))) throw control("not_configured");
  const includes=provider==="klaviyo"?(url.searchParams.get("include")??"").split(",").filter(Boolean).sort():[];
  if(includes.some(v=>!/^[a-z][a-z0-9_.-]{0,63}$/.test(v))) throw control("not_configured");
  return Object.freeze({provider,family,accountId,organizationId,version,includes:Object.freeze([...new Set(includes)])});
}

export function createQuotaManagedFetch({provider,guard,resolveOperation,lane,fetchFn=globalThis.fetch}) {
  if(!["shopify_partner","meta","google_ads","klaviyo"].includes(provider)||typeof guard?.execute!=="function"||typeof resolveOperation!=="function"
    ||!["interactive","background"].includes(lane)||typeof fetchFn!=="function"||managed.has(fetchFn)) throw new Error("QUOTA_NATIVE_TRANSPORT_INPUT_INVALID");
  const fetchManaged=async(input,init={})=>{
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
    let response,rejected=false;
    let result;
    try {result=await guard.execute({operationKey,lane,run:async()=>{
      // No silent redirect: credentials cannot move to another target or bypass a second debit.
      response=await fetchFn(requestUrl,requestInit);
      if(!response||typeof response.ok!=="boolean"||typeof response.json!=="function") return {outcome:"unknown"};
      rejected=!response.ok;
      if(!rejected&&(response.headers?.get?.("content-type")??"").includes("json")) {
        try {
          const payload=await response.clone().json();
          rejected=Boolean(payload?.error)||(Array.isArray(payload?.errors)&&payload.errors.length>0);
        } catch {rejected=true;}
      }
      return rejected?{outcome:"rejected"}:{outcome:"success",value:response};
    }});} catch {throw new Error("QUOTA_NATIVE_TRANSPORT_UNAVAILABLE");}
    if(result?.status==="returned") return result.value;
    // Keep native HTTP 401/403/429 handlers, but only AFTER the quota stop persists.
    // The native parser owns the unchanged response; its body never enters quota persistence.
    if(result?.status==="stopped"&&result.stopRecorded===true&&rejected&&response) {
      if(response.ok) throw new Error("QUOTA_NATIVE_PROVIDER_REJECTED");
      return response;
    }
    if(["waiting","not_configured","clock_invalid","already_reserved","not_sent"].includes(result?.status)) throw control(result.status);
    // Unknown external execution must never be misclassified as a proven-not-sent wait.
    throw new Error("QUOTA_NATIVE_TRANSPORT_STOPPED");
  };
  managed.add(fetchManaged);
  return fetchManaged;
}
