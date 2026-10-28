import test from "node:test";
import assert from "node:assert/strict";
import {createShopifyOrderPageRequest as request,parseShopifyOrderPage as parse,nextShopifyOrderPageRequest as next,
  SHOPIFY_ORDER_READ_QUERIES as queries,SHOPIFY_ORDER_READ_API_VERSION as version} from "../app/lib/shopify/order-read-protocol.server.js";
import {createQuotaManagedFetch,quotaBoundaryControl} from "../app/lib/refresh/quota-native-fetch.server.js";
import {shopifyAdminIdentityFamily} from "../app/lib/refresh/shopify-admin-identity-quota.server.js";

const shop={id:"gid://shopify/Shop/12",myshopifyDomain:"test.myshopify.com"};
const range={fromInclusive:"2026-10-01T00:00:00Z",toExclusive:"2026-10-02T00:00:00Z"};
const stamp="2026-10-01T12:00:00Z",orderId="gid://shopify/Order/9007199254740993";
const gid=(type,id)=>`gid://shopify/${type}/${id}`;
const money=(amount="0.00",currencyCode="USD")=>({shopMoney:{amount,currencyCode},presentmentMoney:{amount:"0.00",currencyCode:"EUR"}});
function header(id=orderId) {
  return {id,createdAt:"2026-09-01T12:00:00Z",updatedAt:stamp,processedAt:"2026-09-01T12:00:00Z",cancelledAt:null,
    test:false,taxesIncluded:false,currencyCode:"USD",presentmentCurrencyCode:"EUR",displayFinancialStatus:"PAID",
    ...Object.fromEntries(["subtotalPriceSet","currentSubtotalPriceSet","originalTotalPriceSet","totalPriceSet","currentTotalPriceSet",
      "totalTaxSet","currentTotalTaxSet","totalDiscountsSet","currentTotalDiscountsSet","totalShippingPriceSet",
      "currentShippingPriceSet","totalRefundedSet"].map(k=>[k,money()]))};
}
function line(id="100") {return {id:gid("LineItem",id),quantity:4,currentQuantity:2,isGiftCard:false,
  product:{id:gid("Product","10")},variant:{id:gid("ProductVariant","20"),product:{id:gid("Product","10")}},
  originalTotalSet:money("100.00"),discountedTotalSet:money("90.00"),priceAfterAllDiscountsBeforeTaxesSet:money("45.00")};}
function visit(id="1") {return {__typename:"CustomerVisit",id:gid("CustomerVisit",id),occurredAt:"2026-09-30T12:00:00Z",
  source:"facebook",sourceDescription:null,sourceType:"SOCIAL"};}
const conn=(rows=[],hasNextPage=false,prefix="c")=>({edges:rows.map((node,i)=>({node,cursor:`${prefix}${i}`})),
  pageInfo:{hasNextPage,endCursor:rows.length?`${prefix}${rows.length-1}`:null}});
function config(family="order_headers",extra={}) {return {family,shop:structuredClone(shop),...(family==="order_headers"?{range:structuredClone(range)}:{orderId,updatedAt:stamp}),...extra};}
function body(family="order_headers") {
  if(family==="order_headers")return {data:{shop:structuredClone(shop),orders:conn([header()])}};
  return {data:{shop:structuredClone(shop),order:{id:orderId,updatedAt:stamp,...family==="order_lines"?{lineItems:conn([line()])}:
    {customerJourneySummary:{ready:true,firstVisit:visit(),lastVisit:visit("2"),moments:conn([visit(),visit("2")])}}}}};
}
const read=(family,raw=body(family),c=config(family))=>parse({request:request(c),body:raw});

for(const family of Object.keys(queries))test(`fixed ${family} shape uses documented pinned version and separate pagination`,()=>{
  const r=request(config(family));assert.equal(r.query,queries[family]);assert.equal(r.apiVersion,"2026-10");assert.equal(version,"2026-10");
  assert.equal(r.variables.first,100);assert.equal(r.variables.after,null);assert.ok(Object.isFrozen(r.variables));
  const p=parse({request:r,body:body(family)});assert.equal(p.state,"parsed");assert.equal(next({request:r,page:p}),null);
  for(const key of ["runtimeAuthorityVerified","authorizesActivation","mappingWritePerformed","DatasetWritePerformed"])assert.equal(p[key],false);
});

test("all accessible updated orders are requested without paid/platform/test/status exclusions or business-date guesses",()=>{
  const r=request(config());assert.equal(r.variables.query,"updated_at:>='2026-10-01T00:00:00Z' updated_at:<'2026-10-02T00:00:00Z'");
  assert.match(r.query,/sortKey: UPDATED_AT/);assert.doesNotMatch(r.variables.query,/paid|source|test|processed_at|created_at/);
  assert.doesNotMatch(Object.values(queries).join("\n"),/\b(customer|email|phone|billingAddress|shippingAddress|marketingEvent|remoteId|referrerUrl|landingPage)\s*[{(\s]/);
});

test("opaque request snapshots shop, range and order version without trusting JSON copies",()=>{
  const c=config(),r=request(c);c.shop.id=gid("Shop","99");c.range.fromInclusive=stamp;
  assert.equal(parse({request:r,body:body()}).scope.id,shop.id);
  for(const fake of [{...r},JSON.parse(JSON.stringify(r)),null])assert.throws(()=>parse({request:fake,body:body()}),/REQUEST_REQUIRED/);
  assert.throws(()=>{r.variables.after="other";},TypeError);
});

for(const bad of [{family:"other"},{first:0},{first:101},{first:1.5},{first:"1"},{after:""},{after:1},{after:"\n"},
  {range:{fromInclusive:"2026-10-01",toExclusive:stamp}},{range:{fromInclusive:stamp,toExclusive:stamp}},
  {range:{fromInclusive:"2026-02-30T00:00:00Z",toExclusive:stamp}},
  {range:{fromInclusive:"2026-10-01T00:00:00+03:00",toExclusive:stamp}},
  {range:{...range,query:"status:paid"}},{orderId},{query:"status:paid"}])
  test(`invalid request rejected: ${JSON.stringify(bad)}`,()=>assert.throws(()=>request(config("order_headers",bad)),/SHOPIFY_ORDER_/));

test("child requests require exact Order ID and observed version, never take header range",()=>{
  for(const bad of [{orderId:9007199254740993},{orderId:gid("Product","10")},{orderId:gid("Order","18446744073709551616")},
    {updatedAt:undefined},{updatedAt:"2026-10-01"},{range}])assert.throws(()=>request(config("order_lines",bad)),/SHOPIFY_ORDER_/);
  assert.equal(request(config("order_lines")).variables.orderId,orderId);
});

test("native zero and exact decimal strings survive without numeric rounding or currency conversion",()=>{
  const raw=body();raw.data.orders.edges[0].node.totalPriceSet=money("9007199254740993.123456789");
  const p=read("order_headers",raw),h=p.rows[0];assert.equal(h.id,orderId);assert.equal(h.totalPriceSet.shopMoney.amount,"9007199254740993.123456789");
  assert.equal(h.totalRefundedSet.shopMoney.amount,"0.00");assert.equal(h.totalPriceSet.presentmentMoney.currencyCode,"EUR");
  assert.ok(Object.isFrozen(h.totalPriceSet.shopMoney));assert.notEqual(h.totalPriceSet,raw.data.orders.edges[0].node.totalPriceSet);
});

test("nullable original amounts stay null and are never interpreted as zero",()=>{
  const raw=body();for(const k of ["subtotalPriceSet","totalTaxSet","totalDiscountsSet"])raw.data.orders.edges[0].node[k]=null;
  const p=read("order_headers",raw);assert.equal(p.rows[0].totalTaxSet,null);assert.equal(p.rows[0].totalDiscountsSet,null);
  delete raw.data.orders.edges[0].node.totalPriceSet;assert.throws(()=>read("order_headers",raw),/MONEY_INVALID/);
});

test("documented non-ISO currency token is retained without claiming FX support",()=>{
  const raw=body(),h=raw.data.orders.edges[0].node;h.currencyCode="USDC";h.totalPriceSet=money("1.25","USDC");
  const p=read("order_headers",raw);assert.equal(p.rows[0].currencyCode,"USDC");assert.equal(p.rows[0].totalPriceSet.shopMoney.currencyCode,"USDC");
});

test("refund, cancellation, test order and original/current amounts remain independent observed facts",()=>{
  const raw=body(),h=raw.data.orders.edges[0].node;h.totalPriceSet=money("3900.00");h.currentTotalPriceSet=money("1950.00");
  h.totalRefundedSet=money("1950.00");h.cancelledAt=stamp;h.test=true;h.displayFinancialStatus="PARTIALLY_REFUNDED";
  const row=read("order_headers",raw).rows[0];assert.equal(row.totalPriceSet.shopMoney.amount,"3900.00");
  assert.equal(row.currentTotalPriceSet.shopMoney.amount,"1950.00");assert.equal(row.cancelledAt,stamp);assert.equal(row.test,true);
});

for(const amount of [0,null,"NaN","1e3","1,000.00","Infinity"])test(`malformed money is not zero: ${amount}`,()=>{
  const raw=body();raw.data.orders.edges[0].node.totalPriceSet.shopMoney.amount=amount;
  assert.throws(()=>read("order_headers",raw),/MONEY_INVALID/);
});

test("wrong shop cannot publish rows even if IDs otherwise match",()=>{
  const raw=body();raw.data.shop.id=gid("Shop","99");assert.throws(()=>read("order_headers",raw),/SHOP_MISMATCH/);
});

for(const errors of [[{message:"SECRET permission",extensions:{code:"ACCESS_DENIED"}}],{message:"SECRET"},null])test("GraphQL partial/error data is never accepted as an empty or complete page",()=>{
  const raw=body();raw.errors=errors;assert.throws(()=>read("order_headers",raw),e=>e.message==="SHOPIFY_ORDER_GRAPHQL_INVALID");
});

test("empty terminal page is real empty at this request scope, not complete historical access proof",()=>{
  const raw=body();raw.data.orders=conn();const p=read("order_headers",raw);assert.deepEqual(p.rows,[]);
  assert.deepEqual(p.pagination,{hasNextPage:false,endCursor:null});assert.equal(p.runtimeAuthorityVerified,false);
  delete raw.data.orders;assert.throws(()=>read("order_headers",raw),/PAGE_INVALID/);
});

test("all three independent connections continue by own cursors and preserve request scope",()=>{
  for(const family of Object.keys(queries)){
    const r=request(config(family)),raw=body(family),c=family==="order_headers"?raw.data.orders:
      family==="order_lines"?raw.data.order.lineItems:raw.data.order.customerJourneySummary.moments;
    c.pageInfo.hasNextPage=true;const p=parse({request:r,body:raw}),n=next({request:r,page:p});
    assert.equal(n.family,family);assert.equal(n.variables.after,c.pageInfo.endCursor);assert.equal(n.query,r.query);assert.equal(n.apiVersion,r.apiVersion);
    assert.equal(n.variables.orderId,r.variables.orderId);assert.equal(n.variables.query,r.variables.query);
    assert.throws(()=>next({request:r,page:{...p}}),/PAGE_PROOF_REQUIRED/);
    assert.throws(()=>next({request:request(config(family)),page:p}),/PAGE_PROOF_REQUIRED/);
  }
});

for(const mutate of [c=>c.pageInfo.hasNextPage="true",c=>c.pageInfo.endCursor="wrong",c=>delete c.pageInfo.endCursor,
  c=>{c.edges=[];c.pageInfo.hasNextPage=true;c.pageInfo.endCursor=null;},c=>{c.edges.push(structuredClone(c.edges[0]));},
  c=>{c.edges[0].cursor=null;},c=>{c.edges[0].node=null;}])test("invalid or non-progressing cursor page fails closed",()=>{
  const raw=body();mutate(raw.data.orders);assert.throws(()=>read("order_headers",raw),/(PAGE|CURSOR)_INVALID/);
});

test("duplicate entity with different cursor is rejected within and across pages",()=>{
  const r=request(config()),raw=body();raw.data.orders.pageInfo.hasNextPage=true;
  const p=parse({request:r,body:raw}),n=next({request:r,page:p}),again=body();again.data.orders=conn([header()],false,"next");
  assert.throws(()=>parse({request:n,body:again}),/DUPLICATE_ID/);
  raw.data.orders=conn([header(),header()]);assert.throws(()=>parse({request:r,body:raw}),/DUPLICATE_ID/);
});

test("cursor cycles are rejected across multiple accepted pages",()=>{
  let r=request(config());let raw=body();raw.data.orders.pageInfo.hasNextPage=true;
  r=next({request:r,page:parse({request:r,body:raw})});raw=body();raw.data.orders=conn([header(gid("Order","2"))],true,"b");
  r=next({request:r,page:parse({request:r,body:raw})});raw=body();raw.data.orders=conn([header(gid("Order","3"))],true,"c");
  assert.throws(()=>parse({request:r,body:raw}),/PAGE_INVALID/);
});

test("updated-at range and sort are enforced across the whole header continuation",()=>{
  for(const date of ["2026-09-30T23:59:59Z",range.toExclusive]){
    const raw=body();raw.data.orders.edges[0].node.updatedAt=date;assert.throws(()=>read("order_headers",raw),/RANGE_MISMATCH/);
  }
  const r=request(config()),raw=body();raw.data.orders.pageInfo.hasNextPage=true;
  const n=next({request:r,page:parse({request:r,body:raw})}),later=body();later.data.orders=conn([header(gid("Order","2"))],false,"b");
  later.data.orders.edges[0].node.updatedAt="2026-10-01T11:00:00Z";assert.throws(()=>parse({request:n,body:later}),/ORDER_SORT_INVALID/);
});

for(const family of ["order_lines","order_journey"])test(`${family} missing versus changed order are distinct from empty children`,()=>{
  const raw=body(family);raw.data.order=null;assert.equal(read(family,raw).state,"order_unavailable");
  raw.data.order=body(family).data.order;raw.data.order.updatedAt="2026-10-01T12:00:01Z";
  const p=read(family,raw);assert.equal(p.state,"stale_order");assert.deepEqual(p.rows,[]);assert.equal(p.pagination,null);
  raw.data.order.id=gid("Order","2");assert.throws(()=>read(family,raw),/ORDER_MISMATCH/);
});

test("line IDs remain independent of product and variant; repeated product sales are not deduplicated",()=>{
  const raw=body("order_lines");raw.data.order.lineItems=conn([line("100"),line("101")]);
  const p=read("order_lines",raw);assert.equal(p.rows.length,2);assert.equal(p.rows[0].quantity,4);assert.equal(p.rows[0].currentQuantity,2);
  assert.equal(p.rows[0].product.id,p.rows[1].product.id);assert.notEqual(p.rows[0].id,p.rows[1].id);
  assert.equal(p.rows[0].priceAfterAllDiscountsBeforeTaxesSet.shopMoney.amount,"45.00");
});

test("missing native product/variant does not drop the sale or invent an identity",()=>{
  const raw=body("order_lines"),l=raw.data.order.lineItems.edges[0].node;l.product=null;l.variant=null;
  const row=read("order_lines",raw).rows[0];assert.equal(row.product,null);assert.equal(row.variant,null);assert.equal(row.productIdentityState,"unavailable");
  assert.equal(row.quantity,4);delete l.product;assert.throws(()=>read("order_lines",raw),/ID_INVALID/);
});

test("variant parent conflict and fractional or missing quantity fail closed",()=>{
  const raw=body("order_lines"),l=raw.data.order.lineItems.edges[0].node;l.variant.product.id=gid("Product","99");
  assert.throws(()=>read("order_lines",raw),/PRODUCT_CONFLICT/);l.variant.product.id=l.product.id;
  for(const n of [undefined,null,-1,0.5,"1"]){l.quantity=n;assert.throws(()=>read("order_lines",raw),/SCHEMA_INVALID/);}
});

test("journey unavailable, pending, ready-with-missing-moments and ready-empty remain separate",()=>{
  const r=request(config("order_journey")),raw=body("order_journey");raw.data.order.customerJourneySummary=null;
  assert.equal(parse({request:r,body:raw}).state,"journey_unavailable");
  const j={ready:false,firstVisit:null,lastVisit:null,moments:null};raw.data.order.customerJourneySummary=j;
  let p=parse({request:r,body:raw});assert.equal(p.state,"journey_pending");assert.equal(p.pagination,null);
  j.ready=true;p=parse({request:r,body:raw});assert.equal(p.state,"journey_moments_unavailable");
  j.moments=conn();p=parse({request:r,body:raw});assert.equal(p.state,"parsed");assert.deepEqual(p.rows,[]);
  assert.equal(p.firstVisit,null);assert.equal(p.lastVisit,null);assert.equal(p.paidAttribution,"unclassified");
});

test("pending journey observations are retained but cannot authorize normal continuation",()=>{
  const r=request(config("order_journey")),raw=body("order_journey");raw.data.order.customerJourneySummary.ready=false;
  raw.data.order.customerJourneySummary.moments.pageInfo.hasNextPage=true;
  const p=parse({request:r,body:raw});assert.equal(p.rows.length,2);assert.equal(p.state,"journey_pending");assert.equal(next({request:r,page:p}),null);
});

test("platform/first/last/tactic observations never invent paid attribution, native ad IDs, role or overlap",()=>{
  const p=read("order_journey");assert.equal(p.firstVisit.source,"facebook");assert.equal(p.lastVisit.id,gid("CustomerVisit","2"));
  assert.equal(p.rows[0].sourceType,"SOCIAL");assert.equal(p.providerClaimVerified,false);assert.equal(p.exactOverlapVerified,false);
  assert.equal(p.paidAttribution,"unclassified");assert.equal(Object.hasOwn(p,"SalesRole"),false);assert.equal(Object.hasOwn(p,"adId"),false);
});

test("unknown journey moment type fails instead of silently truncating chronology",()=>{
  const raw=body("order_journey");raw.data.order.customerJourneySummary.moments.edges[0].node.__typename="FutureMoment";
  assert.throws(()=>read("order_journey",raw),/MOMENT_TYPE_UNSUPPORTED/);
});

test("unexpected payload fields and raw errors are not copied into parsed output",()=>{
  const raw=body();raw.data.orders.edges[0].node.customer={email:"SECRET"};raw.extensions={cost:{raw:"SECRET"}};
  assert.ok(!JSON.stringify(read("order_headers",raw)).includes("SECRET"));
});

for(const search of [[{warnings:[{message:"SECRET invalid field"}]}],{},null,[{warnings:null}]])
  test("native search warning or malformed search diagnostics cannot manufacture empty-page proof",()=>{
    const raw=body();raw.data.orders=conn();raw.extensions={search};
    assert.throws(()=>read("order_headers",raw),e=>e.message==="SHOPIFY_ORDER_SEARCH_INVALID");
  });

test("clean native search diagnostics and cost feedback do not enter sales data",()=>{
  const raw=body();raw.extensions={search:[{path:["orders"],query:"SECRET",warnings:[]}],cost:{requestedQueryCost:10}};
  const p=read("order_headers",raw);assert.equal(p.rows.length,1);assert.ok(!JSON.stringify(p).includes("SECRET"));
});

test("missing or null required processed timestamp is not accepted as a normal nullable field",()=>{
  const raw=body();raw.data.orders.edges[0].node.processedAt=null;
  assert.throws(()=>read("order_headers",raw),/TIME_INVALID/);
});

for(const family of Object.keys(queries))test(`${family} preparation cannot bypass the unopened Admin HTTP family/profile gate`,async()=>{
  const r=request(config(family)),raw=JSON.stringify({query:r.query,variables:r.variables});let lookedUp=0,reserved=0,sent=0;
  assert.equal(shopifyAdminIdentityFamily(raw),null);
  const fetch=createQuotaManagedFetch({provider:"shopify_admin",lane:"background",resolveOperation:async()=>{lookedUp++;return "a".repeat(64);},
    guard:{execute:async()=>{reserved++;}},fetchFn:async()=>{sent++;}});
  await assert.rejects(fetch("https://test.myshopify.com/admin/api/2026-10/graphql.json",{method:"POST",body:raw}),
    e=>quotaBoundaryControl(e)?.status==="not_configured");
  assert.equal(lookedUp,0);assert.equal(reserved,0);assert.equal(sent,0);
});
