import "@shopify/shopify-api/adapters/node";
import {shopifyApi,ApiVersion,LogSeverity,Session} from "@shopify/shopify-api";
import {abstractFetch,setAbstractFetchFunc} from "@shopify/shopify-api/runtime";
import {createShopifyAdminIdentitySdkBridge} from "../../app/lib/refresh/shopify-admin-sdk-quota-bridge.server.js";
import {createRefreshShopifyOrderReader} from "../../app/lib/refresh/quota-authority-binding.server.js";
import {SHOPIFY_ORDER_READ_QUERIES as queries} from "../../app/lib/shopify/order-read-protocol.server.js";
import {SHOPIFY_PERMISSION_SCOPES_QUERY} from "../../app/lib/shopify/permission-scope-protocol.server.js";
import {quotaRouteIdentity} from "../../app/lib/refresh/quota-scope-resolver.server.js";

const original=abstractFetch;
export const restoreShopifyOrderFixtureFetch=()=>setAbstractFetchFunc(original);
const sdkRoot=import.meta.resolve("@shopify/shopify-app-react-router/server");
const {graphqlClientFactory}=await import(new URL("./clients/admin/graphql.mjs",sdkRoot));
const {handleClientErrorFactory}=await import(new URL("./authenticate/admin/helpers/handle-client-error.mjs",sdkRoot));
const api=shopifyApi({apiKey:"a".repeat(32),apiSecretKey:"b".repeat(32),hostName:"example.com",apiVersion:ApiVersion.October26,
  isEmbeddedApp:true,logger:{level:LogSeverity.Error,log:()=>{}}});
const gid=(t,n)=>`gid://shopify/${t}/${n}`;
const shop={id:gid("Shop","12"),myshopifyDomain:"test.myshopify.com"};
const workspace="11111111-1111-4111-8111-111111111111",stamp="2026-10-01T12:00:00Z";
const money=(amount="0.00")=>({shopMoney:{amount,currencyCode:"USD"},presentmentMoney:{amount,currencyCode:"EUR"}});
function header(n="10") {return {id:gid("Order",n),createdAt:"2026-09-30T12:00:00Z",updatedAt:stamp,processedAt:stamp,cancelledAt:null,
  test:false,taxesIncluded:false,currencyCode:"USD",presentmentCurrencyCode:"EUR",displayFinancialStatus:"PAID",
  ...Object.fromEntries(["subtotalPriceSet","currentSubtotalPriceSet","originalTotalPriceSet","totalPriceSet","currentTotalPriceSet",
    "totalTaxSet","currentTotalTaxSet","totalDiscountsSet","currentTotalDiscountsSet","totalShippingPriceSet",
    "currentShippingPriceSet","totalRefundedSet"].map(k=>[k,money()]))};}
function line(n) {return {id:gid("LineItem",n),quantity:1,currentQuantity:1,isGiftCard:false,product:{id:gid("Product","100")},
  variant:{id:gid("ProductVariant","200"),product:{id:gid("Product","100")}},originalTotalSet:money("50.00"),
  discountedTotalSet:money("45.00"),priceAfterAllDiscountsBeforeTaxesSet:money("45.00")};}
const visit=n=>({__typename:"CustomerVisit",id:gid("CustomerVisit",n),occurredAt:"2026-09-30T12:00:00Z",source:"facebook",sourceDescription:null,sourceType:"SOCIAL"});
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const prewriteOwner=()=>({workspaceId:workspace,installGeneration:3,shopId:shop.id,shopDomain:shop.myshopifyDomain});
function connection(rows,variables,prefix) {
  const offset=variables.after===null?0:Number(variables.after.split(":").at(-1))+1;
  const selected=rows.slice(offset,offset+variables.first);
  return {edges:selected.map((node,i)=>({cursor:`${prefix}:${offset+i}`,node})),
    pageInfo:{hasNextPage:offset+selected.length<rows.length,endCursor:selected.length?`${prefix}:${offset+selected.length-1}`:null}};
}
function fixture() {
  const calls=[],loads=[],lookups=[],reservations=[],settles=[],stops=[],feedback=[],auth=[],q={headerScans:0,journeyStarts:0,scopeReads:0};
  const rows={headers:[header()],lines:[line("1"),line("2")],moments:[visit("1"),visit("2"),visit("3")]};
  const bridge=createShopifyAdminIdentitySdkBridge();setAbstractFetchFunc(bridge.fetch);
  const session=new Session({id:`offline_${shop.myshopifyDomain}`,shop:shop.myshopifyDomain,state:"synthetic",isOnline:false,
    accessToken:"SECRET-TOKEN",scope:"read_orders,read_products"});
  const admin={graphql:graphqlClientFactory({params:{api,logger:{debug:()=>{}}},session,
    handleClientError:handleClientErrorFactory({request:new Request("https://example.com"),onError:async x=>auth.push(x)})})};
  const context={provider:"shopify_admin",clientScopeKey:"a".repeat(64),connectionScopeKey:"b".repeat(64),connectionEpoch:3,
    accountId:shop.myshopifyDomain,organizationId:null,apiVersion:"2026-10"};
  const keys=[...Object.keys(queries),"permission_scopes"].map(family=>quotaRouteIdentity(context,{provider:"shopify_admin",family,accountId:context.accountId,
    organizationId:null,version:context.apiVersion,includes:[]}).routeKey);
  const quotaStore={resolveRoute:async x=>{lookups.push(x);return q.missing?null:keys.includes(x.routeKey)?x.routeKey:null;},
    reserve:async x=>{reservations.push(x);await q.reserving?.();if(q.waitAt===reservations.length)return {status:"waiting"};
      // Synthetic receipt/cost only. No native profile or point limit is established.
      return {...x,status:"reserved",dispatchBeforeMs:Date.now()+10000,dispatchBudgetMs:10000,
        costBudget:{unit:"shopify_admin_query_points",reservedRequestedCost:10}};},
    settle:async x=>{settles.push(x);return true;},stop:async x=>{stops.push(x);return true;},
    recordFeedback:async x=>{feedback.push(x);return true;}};
  const config={verified:{installationAuthority:{authority:"shopify_installation_verified",workspaceId:workspace,installGeneration:3,status:"active"},
    identity:{shop:{authority:"shopify_admin_verified",shopId:shop.id,myshopifyDomain:shop.myshopifyDomain},
      session:{authority:"shopify_id_token_verified",shopDomain:shop.myshopifyDomain}},context:{admin}},sdkBridge:bridge,
    claim:{workspaceId:workspace,installGeneration:"3",provider:"meta",accountId:"act_1",id:"job1",fence:2},
    window:{from:"2026-10-01",to:"2026-10-01"},entitlementReceipt:{observedAt:"2026-10-28T06:00:00Z"},
    range:{fromInclusive:"2026-10-01T00:00:00Z",toExclusive:"2026-10-02T00:00:00Z"},
    limits:{maxElapsedMs:10000,maxRequests:100,maxRows:1000,maxBytes:1000000,pageSize:1},now:Date.now,quotaStore,
    workStore:{loadQuotaContext:async input=>{loads.push(input);await q.loading?.();return q.lost?null:context;}},
    fetchFn:async(endpoint,init)=>{
      const request=JSON.parse(init.body),family=request.query===SHOPIFY_PERMISSION_SCOPES_QUERY?"permission_scopes":Object.entries(queries).find(([,v])=>v===request.query)?.[0],v=request.variables;
      calls.push({family,variables:structuredClone(v),signal:init.signal});
      if(family==="order_headers"&&v.after===null)q.headerScans++;
      if(family==="order_journey"&&v.after===null)q.journeyStarts++;
      if(family==="permission_scopes")q.scopeReads++;
      const data={shop:structuredClone(shop)};
      if(family==="permission_scopes")data.currentAppInstallation={id:gid("AppInstallation","9"),accessScopes:[{handle:"read_products"},{handle:"read_orders"}]};
      else if(family==="order_headers")data.orders=connection(rows.headers,v,"headers");
      else {
        data.order={id:v.orderId,updatedAt:stamp};
        if(family==="order_lines")data.order.lineItems=connection(rows.lines,v,"lines");
        else data.order.customerJourneySummary={ready:true,firstVisit:rows.moments[0]??null,lastVisit:rows.moments.at(-1)??null,
          moments:connection(rows.moments,v,"moments")};
      }
      const payload={data,extensions:{cost:{requestedQueryCost:8,actualQueryCost:5,
        throttleStatus:{maximumAvailable:1000,currentlyAvailable:995,restoreRate:50}}}};
      await q.native?.({family,variables:v,payload,scan:q.headerScans,journeyStart:q.journeyStarts,scopeRead:q.scopeReads});
      if(q.delay)await pause(q.delay);if(q.throw)throw Error("SECRET-NATIVE");
      return Response.json(payload,{status:q.status??200});
    }};
  return {q,rows,calls,loads,lookups,reservations,settles,stops,feedback,auth,config,context,create:()=>createRefreshShopifyOrderReader(config)};
}

export {fixture,connection,gid,shop,workspace,stamp,money,header,line,visit,gate,pause,prewriteOwner};
