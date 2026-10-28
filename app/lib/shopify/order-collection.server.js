import {sqlIdentityKey} from "../providers/prewrite-owner.server.js";
import {createShopifyOrderPageRequest,parseShopifyOrderPage,nextShopifyOrderPageRequest,SHOPIFY_ORDER_READ_API_VERSION,ShopifyOrderProtocolError} from "./order-read-protocol.server.js";
import {isShopifyAdminOrderSdkClient,closeShopifyAdminOrderSdkClient} from "../refresh/shopify-admin-sdk-quota-bridge.server.js";
import {runIdentityReadDeadline,IdentityReadDeadlineError} from "../providers/identity-read-deadline.server.js";
import {quotaBoundaryControl} from "../refresh/quota-native-fetch.server.js";
import {SHOPIFY_PERMISSION_SCOPES_QUERY,parseShopifyPermissionScopePage,ShopifyPermissionScopeProtocolError} from "./permission-scope-protocol.server.js";
import {permissionContext,assessIdentityPermissionScopes} from "../oauth/identity-permission-preflight.server.js";

export class ShopifyOrderCollectionError extends Error {
  constructor(code){super(`SHOPIFY_ORDER_COLLECTION_${code}`);this.name="ShopifyOrderCollectionError";}
}
const fail=code=>{throw new ShopifyOrderCollectionError(code);};
const freeze=v=>{if(v&&typeof v==="object"){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const signature=v=>JSON.stringify(v);
const journeySummary=p=>({state:p.state,ready:p.ready??null,firstVisit:p.firstVisit??null,lastVisit:p.lastVisit??null});
const observations=new WeakSet();
// In-process provenance only, never permission, persistence or snapshot authority.
export function isShopifyOrderCollectionObservation(value){return observations.has(value);}

// Trusted server composition only. checkCurrent is supplied by the private fenced
// factory, never by a product route/user or as a replacement for HTTP quota/permission.
// A genuine SDK client brand proves construction only, not owner or live access proof.
export function createShopifyOrderReadExecution({client,shop,scope,range,limits,signal,checkCurrent,loadInstallationOwner,includeOrderHistory=false,...extra}={}) {
  if(Object.keys(extra).length||!isShopifyAdminOrderSdkClient(client)||typeof checkCurrent!=="function"||typeof loadInstallationOwner!=="function"
    ||!limits||typeof limits!=="object"||Array.isArray(limits)
    ||Object.keys(limits).sort().join(",")!=="maxBytes,maxElapsedMs,maxRequests,maxRows,pageSize"
    ||typeof includeOrderHistory!=="boolean"||signal!==undefined&&!(signal instanceof AbortSignal))fail("INPUT_INVALID");
  const caps=structuredClone(limits),expectedShop=structuredClone(shop),owner=structuredClone(scope),window=structuredClone(range);
  const maxima={maxElapsedMs:600000,maxRequests:10000,maxRows:1000000,maxBytes:134217728,pageSize:100};
  if(Object.entries(maxima).some(([key,max])=>!Number.isSafeInteger(caps[key])||caps[key]<1||caps[key]>max))fail("LIMITS_INVALID");
  const initial=createShopifyOrderPageRequest({family:"order_headers",shop:expectedShop,range:window,first:caps.pageSize});
  const permissionOwner=permissionContext({provider:"shopify",workspaceId:owner?.workspace_id,installGeneration:owner?.installation_generation,
    shopId:expectedShop.id,shopDomain:expectedShop.myshopifyDomain});
  if(owner.installation_id!==null)fail("INSTALLATION_OVERRIDE_FORBIDDEN");
  const graphql=client.graphql.bind(client);
  let used=false;
  return Object.freeze({async readEvidence(...args){
    if(args.length)fail("OVERRIDE_FORBIDDEN");
    if(used)fail("EXECUTION_USED");used=true;
    let closed=false;
    const started=performance.now();
    const stats={requests:0,rows:0,SDKResponseBytes:0};
    try {
      return await runIdentityReadDeadline({signal,timeoutMs:caps.maxElapsedMs,run:async child=>{
        const check=()=>{
          if(closed||child.aborted)fail("ABORTED");
          if(performance.now()-started>=caps.maxElapsedMs)throw new IdentityReadDeadlineError("IDENTITY_READ_DEADLINE_EXCEEDED");
        };
        async function current(){
          check();let identity;try{identity=await loadInstallationOwner();}catch{fail("AUTHORITY_READ_FAILED");}check();
          if(!identity||!sqlIdentityKey(identity.installationId)||identity.workspaceId!==permissionOwner.workspaceId
            ||identity.installGeneration!==permissionOwner.installGeneration||identity.shopId!==permissionOwner.shopId
            ||identity.shopDomain!==permissionOwner.shopDomain
            ||owner.installation_id!==null&&owner.installation_id!==identity.installationId)fail("AUTHORITY_CHANGED");
          if(await checkCurrent()!==true)fail("AUTHORITY_CHANGED");check();owner.installation_id=identity.installationId;
        }
        async function json(response){
          if(!response?.ok||typeof response.body?.getReader!=="function")fail("RESPONSE_INVALID");
          const reader=response.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true});let text="",done=false;
          const cancel=()=>{void reader.cancel().catch(()=>{});};
          child.addEventListener("abort",cancel,{once:true});
          try {
            while(true){
              check();const part=await reader.read();check();
              if(part.done){done=true;break;}
              if(!(part.value instanceof Uint8Array))fail("RESPONSE_INVALID");
              if(part.value.byteLength>caps.maxBytes-stats.SDKResponseBytes)fail("BYTE_LIMIT");
              stats.SDKResponseBytes+=part.value.byteLength;text+=decoder.decode(part.value,{stream:true});
            }
            text+=decoder.decode();check();return JSON.parse(text);
          } finally {
            child.removeEventListener("abort",cancel);
            if(!done)cancel();
            reader.releaseLock();
          }
        }
        async function payload(request){
          check();if(stats.requests>=caps.maxRequests)fail("REQUEST_LIMIT");
          await current();stats.requests++;
          const response=await graphql(request.query,{variables:request.variables,tries:1,signal:child});check();
          const body=await json(response);check();return body;
        }
        async function page(request){
          const parsed=parseShopifyOrderPage({request,body:await payload(request)});
          if(parsed.rows.length>caps.maxRows-stats.rows)fail("ROW_LIMIT");stats.rows+=parsed.rows.length;
          await current();return parsed;
        }
        async function scopes(){
          const observedAt=new Date().toISOString();
          const native=parseShopifyPermissionScopePage({shop:expectedShop,body:await payload({query:SHOPIFY_PERMISSION_SCOPES_QUERY,variables:{}})});
          const evidence={source:"shopify_current_app_installation",context:permissionOwner,observedAt,complete:true,...native};
          const assessment=assessIdentityPermissionScopes({context:permissionOwner,evidence,includeOrderHistory});
          if(assessment.scopeStatus!=="observed_sufficient")fail("SCOPES_REQUIRED");
          await current();return {evidence,assessment};
        }
        async function headers(first){
          const rows=[];let request=first;
          while(request){const parsed=await page(request);rows.push(...parsed.rows);request=nextShopifyOrderPageRequest({request,page:parsed});}
          return rows;
        }
        function childRequest(family,h,first=caps.pageSize){return createShopifyOrderPageRequest({family,shop:expectedShop,orderId:h.id,updatedAt:h.updatedAt,first});}
        function validOrder(p){if(["stale_order","order_unavailable"].includes(p.state))fail("ORDER_CHANGED");}
        async function lines(h){
          const rows=[];let request=childRequest("order_lines",h);
          while(request){const p=await page(request);validOrder(p);if(p.state!=="parsed")fail("LINES_INCOMPLETE");
            rows.push(...p.rows);request=nextShopifyOrderPageRequest({request,page:p});}
          return rows;
        }
        async function journey(h){
          const rows=[];let request=childRequest("order_journey",h),first=null;
          while(request){
            const p=await page(request);validOrder(p);
            if(first===null)first=p;
            else if(signature(journeySummary(first))!==signature(journeySummary(p)))fail("JOURNEY_CHANGED");
            rows.push(...p.rows);
            // Pending/unavailable attribution is an observed state, not a retry.
            if(p.state!=="parsed")break;
            request=nextShopifyOrderPageRequest({request,page:p});
          }
          return {...journeySummary(first),moments:rows,fullyPaged:first.state==="parsed"};
        }
        await current();
        const permissionsBefore=await scopes();
        const before=await headers(initial),orders=[];
        for(const h of before){
          check();const items=await lines(h),visits=await journey(h);
          orders.push({header:h,lineItems:items,journey:visits});
        }
        // Explicit consistency observations, not failure retries. No extra query
        // family: reread the existing journey first page and selected header window.
        for(const order of orders){
          const p=await page(childRequest("order_journey",order.header,1));validOrder(p);
          const {moments,fullyPaged,...summary}=order.journey;
          if(signature(summary)!==signature(journeySummary(p))
            ||signature(moments[0]??null)!==signature(p.rows[0]??null))fail("JOURNEY_CHANGED");
        }
        const after=await headers(createShopifyOrderPageRequest({family:"order_headers",shop:expectedShop,range:window,first:caps.pageSize}));
        const observed=new Map(before.map(h=>[h.id,signature(h)]));
        if(after.length!==before.length||after.some(h=>observed.get(h.id)!==signature(h)))fail("ORDER_SET_CHANGED");
        const permissionsAfter=await scopes();
        if(permissionsBefore.evidence.appInstallationId!==permissionsAfter.evidence.appInstallationId)fail("APP_INSTALLATION_CHANGED");
        if(signature([...permissionsBefore.evidence.scopes].sort())!==signature([...permissionsAfter.evidence.scopes].sort()))fail("SCOPES_CHANGED");
        await current();check();
        const journeyPagesComplete=orders.every(o=>o.journey.fullyPaged);
        const result=freeze({source:"Shopify_Order_LineItem_and_journey_observations",apiVersion:SHOPIFY_ORDER_READ_API_VERSION,
          scope:owner,shop:expectedShop,extractionRange:window,state:journeyPagesComplete?"collected":"journey_incomplete",
          salesPagesComplete:true,journeyPagesComplete,orders,stats:{...stats},
          nativeScopeObservation:{includeOrderHistory,before:permissionsBefore,after:permissionsAfter},nativeScopeListObserved:true,
          consistency:{headerWindowReobserved:true,orderVersionReobserved:true,journeySummaryAndFirstMomentReobserved:true,
            atomicSnapshotVerified:false,journeyMiddleUnchangedVerified:false},
          nativePermissionVerified:false,historicalCoverageVerified:false,providerClaimVerified:false,exactOverlapVerified:false,
          canonicalScopeReady:false,authorizesActivation:false,persistable:false,DatasetWritePerformed:false});
        check();observations.add(result);return result;
      }});
    } catch(error){
      if(quotaBoundaryControl(error)||error instanceof IdentityReadDeadlineError||error instanceof ShopifyOrderCollectionError)throw error;
      // Preserve only fixed protocol error codes, never SDK/provider bodies/messages.
      if(error instanceof ShopifyOrderProtocolError||error instanceof ShopifyPermissionScopeProtocolError)throw error;
      fail("FAILED");
    } finally {closed=true;closeShopifyAdminOrderSdkClient(client);}
  }});
}
