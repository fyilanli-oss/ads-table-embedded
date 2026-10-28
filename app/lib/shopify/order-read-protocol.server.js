// Inactive, pure request/response protocol. No HTTP, credential, permission, quota,
// owner authority, durable cursor, accounting formula or Dataset write is performed.
import {normalizeShopDomain} from "./installation-authority.server.js";

const requests=new WeakMap(),pages=new WeakMap();
const fail=code=>{throw new Error(`SHOPIFY_ORDER_${code}`);};
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const freeze=v=>{if(object(v)||Array.isArray(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const moneyFields=["subtotalPriceSet","currentSubtotalPriceSet","originalTotalPriceSet","totalPriceSet","currentTotalPriceSet",
  "totalTaxSet","currentTotalTaxSet","totalDiscountsSet","currentTotalDiscountsSet",
  "totalShippingPriceSet","currentShippingPriceSet","totalRefundedSet"];
const nullableMoney=new Set(["subtotalPriceSet","totalTaxSet","totalDiscountsSet"]);
const moneySelection="{ shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }";
const visitSelection="{ id occurredAt source sourceDescription sourceType }";
const connectionSelection="pageInfo { hasNextPage endCursor }";
export const SHOPIFY_ORDER_READ_API_VERSION="2026-10";
export const SHOPIFY_ORDER_READ_QUERIES=Object.freeze({
  order_headers:`#graphql
    query AdsTableOrderHeaders($first: Int!, $after: String, $query: String!) {
      shop { id myshopifyDomain }
      orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
        edges { cursor node {
          id createdAt updatedAt processedAt cancelledAt test taxesIncluded
          currencyCode presentmentCurrencyCode displayFinancialStatus
          ${moneyFields.map(f=>`${f} ${moneySelection}`).join("\n          ")}
        } }
        ${connectionSelection}
      }
    }`,
  order_lines:`#graphql
    query AdsTableOrderLines($orderId: ID!, $first: Int!, $after: String) {
      shop { id myshopifyDomain }
      order(id: $orderId) { id updatedAt lineItems(first: $first, after: $after) {
        edges { cursor node {
          id quantity currentQuantity isGiftCard
          product { id } variant { id product { id } }
          originalTotalSet ${moneySelection}
          discountedTotalSet(withCodeDiscounts: true) ${moneySelection}
          priceAfterAllDiscountsBeforeTaxesSet ${moneySelection}
        } }
        ${connectionSelection}
      } }
    }`,
  order_journey:`#graphql
    query AdsTableOrderJourney($orderId: ID!, $first: Int!, $after: String) {
      shop { id myshopifyDomain }
      order(id: $orderId) { id updatedAt customerJourneySummary {
        ready firstVisit ${visitSelection} lastVisit ${visitSelection}
        moments(first: $first, after: $after) {
          edges { cursor node { __typename occurredAt ... on CustomerVisit {
            id source sourceDescription sourceType
          } } }
          ${connectionSelection}
        }
      } }
    }`,
});

// Classify only the exact native SDK request body, not a permission/owner proof.
// No order ID, range, query, cursor or row is forwarded to quota scope resolution.
export function shopifyOrderReadFamily(raw) {
  if(typeof raw!=="string"||raw.length>65536)return null;
  try {
    const body=JSON.parse(raw);
    if(JSON.stringify(body)!==raw||!object(body)||Object.keys(body).sort().join(",")!=="query,variables")return null;
    const family=Object.entries(SHOPIFY_ORDER_READ_QUERIES).find(([,q])=>q===body.query)?.[0],v=body.variables;
    if(!family||!object(v)||!Number.isSafeInteger(v.first)||v.first<1||v.first>100)return null;
    cursor(v.after);
    if(family==="order_headers") {
      if(Object.keys(v).sort().join(",")!=="after,first,query"||typeof v.query!=="string")return null;
      const range=/^updated_at:>='([^']+)' updated_at:<'([^']+)'$/.exec(v.query);
      if(!range)return null;
      const from=instant(range[1]),to=instant(range[2]);
      if(!from.endsWith("Z")||!to.endsWith("Z")||Date.parse(from)>=Date.parse(to))return null;
    } else {
      if(Object.keys(v).sort().join(",")!=="after,first,orderId")return null;
      gid(v.orderId,"Order");
    }
    return family;
  } catch {return null;}
}

function gid(v,type) {
  if(typeof v!=="string"||!new RegExp(`^gid://shopify/${type}/[1-9][0-9]{0,19}$`).test(v)
    ||BigInt(v.slice(v.lastIndexOf("/")+1))>18446744073709551615n)fail("ID_INVALID");
  return v;
}
function instant(v) {
  if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)
    ||!Number.isFinite(Date.parse(v)))fail("TIME_INVALID");
  const day=v.slice(0,10),clock=v.slice(11,19);
  if(new Date(day+"T00:00:00Z").toISOString().slice(0,10)!==day||clock.slice(0,2)>"23"||clock.slice(3,5)>"59"||clock.slice(6,8)>"59")fail("TIME_INVALID");
  return v;
}
const nullableInstant=v=>v===null?null:instant(v);
function cursor(v) {
  if(v!==null&&(typeof v!=="string"||v.length<1||v.length>4096||/[\u0000-\u001f]/.test(v)))fail("CURSOR_INVALID");
  return v;
}
function text(v,nullable=false) {
  if(nullable&&v===null)return null;
  if(typeof v!=="string"||v.length>8192)fail("SCHEMA_INVALID");return v;
}
// Native CurrencyCode includes non-ISO values (for example USDC). Preserve the
// enum token; support for conversion is a separate FX decision, never implied here.
function currency(v) {if(typeof v!=="string"||!/^[A-Z][A-Z0-9_]{0,31}$/.test(v))fail("MONEY_INVALID");return v;}
function money(v,nullable=false) {
  if(nullable&&v===null)return null;
  if(!object(v))fail("MONEY_INVALID");
  return Object.fromEntries(["shopMoney","presentmentMoney"].map(k=>{
    const m=v[k];if(!object(m)||typeof m.amount!=="string"||m.amount.length>128||! /^-?\d+(?:\.\d+)?$/.test(m.amount))fail("MONEY_INVALID");
    return [k,{amount:m.amount,currencyCode:currency(m.currencyCode)}];
  }));
}

// Explicit instant range is an updated-at extraction window, NOT a sales business
// day, paid-order filter, historical grant, timezone inference or refund calculation.
export function createShopifyOrderPageRequest({family,shop,range,orderId,updatedAt,first=100,after=null,...extra}={}) {
  if(Object.keys(extra).length||!Object.hasOwn(SHOPIFY_ORDER_READ_QUERIES,family)||!object(shop)
    ||!Number.isSafeInteger(first)||first<1||first>100)fail("REQUEST_INVALID");
  const expectedShop={id:gid(shop.id,"Shop"),myshopifyDomain:normalizeShopDomain(shop.myshopifyDomain)};
  if(shop.myshopifyDomain!==expectedShop.myshopifyDomain)fail("SHOP_INVALID");
  cursor(after);
  let variables,scope;
  if(family==="order_headers") {
    if(orderId!==undefined||updatedAt!==undefined||!object(range)||Object.keys(range).sort().join(",")!=="fromInclusive,toExclusive")fail("REQUEST_INVALID");
    const from=instant(range.fromInclusive),to=instant(range.toExclusive);
    if(!from.endsWith("Z")||!to.endsWith("Z")||Date.parse(from)>=Date.parse(to))fail("RANGE_INVALID");
    variables={first,after,query:`updated_at:>='${from}' updated_at:<'${to}'`};
    scope={range:{fromInclusive:from,toExclusive:to}};
  } else {
    if(range!==undefined)fail("REQUEST_INVALID");
    variables={orderId:gid(orderId,"Order"),first,after};scope={orderId: variables.orderId,updatedAt:instant(updatedAt)};
  }
  const request=freeze({family,apiVersion:SHOPIFY_ORDER_READ_API_VERSION,query:SHOPIFY_ORDER_READ_QUERIES[family],variables});
  requests.set(request,{shop:expectedShop,...scope,seenCursors:[],seenIds:[],lastUpdatedAt:null});
  return request;
}

function connection(v,request,meta,decode) {
  if(!object(v)||!Array.isArray(v.edges)||v.edges.length>request.variables.first||!object(v.pageInfo)
    ||typeof v.pageInfo.hasNextPage!=="boolean")fail("PAGE_INVALID");
  const end=cursor(v.pageInfo.endCursor),seen=new Set(meta.seenCursors),ids=new Set(meta.seenIds),rows=[],cursors=[];
  for(const edge of v.edges) {
    if(!object(edge)||!object(edge.node)||cursor(edge.cursor)===null||seen.has(edge.cursor)||edge.cursor===request.variables.after)fail("PAGE_INVALID");
    seen.add(edge.cursor);cursors.push(edge.cursor);
    const row=decode(edge.node);if(ids.has(row.id))fail("DUPLICATE_ID");ids.add(row.id);rows.push(row);
  }
  if(end!==(cursors.at(-1)??null)||v.pageInfo.hasNextPage&&(rows.length===0||end===request.variables.after))fail("PAGE_INVALID");
  return {rows,pagination:{hasNextPage:v.pageInfo.hasNextPage,endCursor:end},seenIds:[...ids],seenCursors:[...seen]};
}
function header(v,meta) {
  const id=gid(v.id,"Order"),createdAt=instant(v.createdAt),updatedAt=instant(v.updatedAt);
  if(Date.parse(updatedAt)<Date.parse(meta.range.fromInclusive)||Date.parse(updatedAt)>=Date.parse(meta.range.toExclusive))fail("RANGE_MISMATCH");
  if(typeof v.test!=="boolean"||typeof v.taxesIncluded!=="boolean")fail("SCHEMA_INVALID");
  return {id,createdAt,updatedAt,processedAt:instant(v.processedAt),cancelledAt:nullableInstant(v.cancelledAt),
    test:v.test,taxesIncluded:v.taxesIncluded,currencyCode:currency(v.currencyCode),presentmentCurrencyCode:currency(v.presentmentCurrencyCode),
    displayFinancialStatus:text(v.displayFinancialStatus,true),...Object.fromEntries(moneyFields.map(k=>[k,money(v[k],nullableMoney.has(k))]))};
}
function line(v) {
  if(![v.quantity,v.currentQuantity].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647)||typeof v.isGiftCard!=="boolean")fail("SCHEMA_INVALID");
  const product=v.product===null?null:{id:gid(v.product?.id,"Product")};
  const variant=v.variant===null?null:{id:gid(v.variant?.id,"ProductVariant"),product:{id:gid(v.variant?.product?.id,"Product")}};
  if(product&&variant&&product.id!==variant.product.id)fail("PRODUCT_CONFLICT");
  return {id:gid(v.id,"LineItem"),quantity:v.quantity,currentQuantity:v.currentQuantity,isGiftCard:v.isGiftCard,product,variant,
    productIdentityState:product===null?"unavailable":"observed",
    originalTotalSet:money(v.originalTotalSet),discountedTotalSet:money(v.discountedTotalSet),
    priceAfterAllDiscountsBeforeTaxesSet:money(v.priceAfterAllDiscountsBeforeTaxesSet)};
}
function visit(v) {
  if(!object(v)||typeof v.id!=="string"||v.id.length>2048||!/^gid:\/\/shopify\/CustomerVisit\/[^\s?#]+$/.test(v.id))fail("VISIT_INVALID");
  if(v.sourceType!==null&&(typeof v.sourceType!=="string"||! /^[A-Z][A-Z0-9_]{0,127}$/.test(v.sourceType)))fail("VISIT_INVALID");
  return {id:v.id,occurredAt:instant(v.occurredAt),source:text(v.source),sourceDescription:text(v.sourceDescription,true),sourceType:v.sourceType};
}

// Caller-supplied JSON is parsed data, never runtime/native access proof. The opaque
// request binds validation/continuation only and cannot grant quota or read permission.
export function parseShopifyOrderPage({request,body}={}) {
  const meta=requests.get(request);if(!meta)fail("REQUEST_REQUIRED");
  if(!object(body)||(Object.hasOwn(body,"errors")&&(!Array.isArray(body.errors)||body.errors.length>0))
    ||!object(body.data))fail("GRAPHQL_INVALID");
  // Shopify can return search warnings alongside apparently successful data.
  // An ignored/misparsed range must not become evidence of an empty extraction.
  if(object(body.extensions)&&Object.hasOwn(body.extensions,"search")) {
    if(!Array.isArray(body.extensions.search)||body.extensions.search.some(s=>!object(s)
      ||Object.hasOwn(s,"warnings")&&(!Array.isArray(s.warnings)||s.warnings.length>0)))fail("SEARCH_INVALID");
  }
  const data=body.data;
  if(data.shop?.id!==meta.shop.id||data.shop?.myshopifyDomain!==meta.shop.myshopifyDomain)fail("SHOP_MISMATCH");
  const base={family:request.family,scope:{...meta.shop},orderId:meta.orderId??null,
    runtimeAuthorityVerified:false,snapshotVerified:false,authorizesActivation:false,mappingWritePerformed:false,DatasetWritePerformed:false};
  let result,nextMeta=meta;
  if(request.family==="order_headers") {
    const c=connection(data.orders,request,meta,v=>header(v,meta));
    let last=meta.lastUpdatedAt;
    for(const row of c.rows){if(last!==null&&Date.parse(row.updatedAt)<Date.parse(last))fail("ORDER_SORT_INVALID");last=row.updatedAt;}
    result={state:"parsed",...base,rows:c.rows,pagination:c.pagination};nextMeta={...meta,seenIds:c.seenIds,seenCursors:c.seenCursors,lastUpdatedAt:last};
  } else {
    if(!Object.hasOwn(data,"order"))fail("SCHEMA_INVALID");
    if(data.order===null)result={state:"order_unavailable",...base,rows:[],pagination:null};
    else {
      const order=data.order;
      if(gid(order.id,"Order")!==meta.orderId)fail("ORDER_MISMATCH");
      if(Date.parse(instant(order.updatedAt))!==Date.parse(meta.updatedAt))result={state:"stale_order",...base,rows:[],pagination:null};
      else if(request.family==="order_lines") {
        const c=connection(order.lineItems,request,meta,line);
        result={state:"parsed",...base,observedUpdatedAt:order.updatedAt,rows:c.rows,pagination:c.pagination};
        nextMeta={...meta,seenIds:c.seenIds,seenCursors:c.seenCursors};
      } else {
        if(!Object.hasOwn(order,"customerJourneySummary"))fail("SCHEMA_INVALID");
        const j=order.customerJourneySummary;
        if(j===null)result={state:"journey_unavailable",...base,rows:[],pagination:null};
        else {
          if(!object(j)||typeof j.ready!=="boolean")fail("SCHEMA_INVALID");
          const firstVisit=j.firstVisit===null?null:visit(j.firstVisit),lastVisit=j.lastVisit===null?null:visit(j.lastVisit);
          let c=null;
          if(j.moments!==null)c=connection(j.moments,request,meta,v=>{if(v.__typename!=="CustomerVisit")fail("MOMENT_TYPE_UNSUPPORTED");return visit(v);});
          result={state:!j.ready?"journey_pending":c===null?"journey_moments_unavailable":"parsed",...base,
            observedUpdatedAt:order.updatedAt,ready:j.ready,firstVisit,lastVisit,rows:c?.rows??[],pagination:c?.pagination??null,
            paidAttribution:"unclassified",providerClaimVerified:false,exactOverlapVerified:false};
          if(c)nextMeta={...meta,seenIds:c.seenIds,seenCursors:c.seenCursors};
        }
      }
    }
  }
  const page=freeze(result);pages.set(page,{request,nextMeta});return page;
}

// Pure next-request descriptor only. No automatic retry, HTTP or persisted checkpoint.
export function nextShopifyOrderPageRequest({request,page}={}) {
  const proof=pages.get(page);
  if(!proof||proof.request!==request)fail("PAGE_PROOF_REQUIRED");
  if(page.state!=="parsed"||page.pagination?.hasNextPage!==true)return null;
  const next=freeze({family:request.family,apiVersion:request.apiVersion,query:request.query,variables:{...request.variables,after:page.pagination.endCursor}});
  requests.set(next,proof.nextMeta);return next;
}
